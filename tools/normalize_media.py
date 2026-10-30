#!/usr/bin/env python3
"""Normalize all 29 complete chapters to a shared landscape video canvas.

Usage from the project root:
  python3 tools/normalize_media.py --input media --output /tmp/baiyi-landscape \
    --report docs/media-normalization.json

Outputs are staged separately; this script never overwrites input files. It
preserves the original frame cadence and copies AAC audio without re-encoding.
Portrait and other non-16:9 pictures fit inside the canvas without cropping;
portrait side panels use a blurred, enlarged copy of the same frame. The report
is written only after all chapters pass dimension, duration and audio checks.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import subprocess


def probe(path):
    data = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)
    ]))
    video = next(s for s in data['streams'] if s['codec_type'] == 'video')
    audios = [s for s in data['streams'] if s['codec_type'] == 'audio']
    return {
        'width': video['width'], 'height': video['height'],
        'sampleAspectRatio': video.get('sample_aspect_ratio'),
        'frameRate': video.get('avg_frame_rate'), 'videoCodec': video['codec_name'],
        'videoFrames': int(video.get('nb_frames', 0)),
        'durationSeconds': float(data['format']['duration']),
        'audio': [{'codec': a['codec_name'], 'sampleRate': int(a['sample_rate']),
                   'channels': a['channels']} for a in audios],
        'bytes': path.stat().st_size,
    }


def file_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def audio_hash(path):
    return subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:a', '-c', 'copy',
        '-f', 'streamhash', '-hash', 'sha256', '-'
    ], text=True).strip()


def normalize(source, output, args):
    before = probe(source)
    if not before['audio'] or any(a['codec'] != 'aac' for a in before['audio']):
        raise ValueError(f'{source.name}: AAC audio must be present for lossless audio copy')
    width, height = args.width, args.height
    fit = f'scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,setsar=1'
    portrait = before['height'] > before['width']
    if portrait:
        # Blur at quarter resolution for a smooth backdrop with lower CPU cost.
        bw, bh = width // 4, height // 4
        filters = (
            '[0:v]split=2[foreground][background];'
            f'[background]scale={bw}:{bh}:force_original_aspect_ratio=increase,'
            f'crop={bw}:{bh},boxblur=8:1,scale={width}:{height}:flags=bicubic,setsar=1[bg];'
            f'[foreground]{fit}[fg];'
            '[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1,format=yuv420p[out]'
        )
    else:
        filters = f'[0:v]{fit},pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p[out]'
    command = [
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
        '-filter_complex_threads', '1', '-filter_complex', filters,
        '-map', '[out]', '-map', '0:a', '-map_metadata', '-1',
        '-c:v', 'libx264', '-preset', args.preset, '-crf', str(args.crf),
        '-threads', str(args.threads), '-fps_mode', 'passthrough',
        '-c:a', 'copy', '-movflags', '+faststart', str(output),
    ]
    subprocess.run(command, check=True)
    after = probe(output)
    difference = abs(after['durationSeconds'] - before['durationSeconds'])
    checks = {
        'dimensionsMatch': (after['width'], after['height']) == (width, height),
        'squarePixels': after['sampleAspectRatio'] == '1:1',
        'h264Video': after['videoCodec'] == 'h264',
        'frameRatePreserved': after['frameRate'] == before['frameRate'],
        'frameCountPreserved': after['videoFrames'] == before['videoFrames'],
        'audioPropertiesPreserved': after['audio'] == before['audio'],
        'audioPacketsIdentical': audio_hash(source) == audio_hash(output),
        'completeDuration': difference <= .1,
    }
    if not all(checks.values()):
        raise ValueError(f'{source.name}: failed checks {checks}')
    row = {
        'file': source.name, 'treatment': 'contain-with-blurred-side-panels' if portrait else 'contain-with-minimal-padding',
        'source': before, 'output': after, 'durationDifferenceSeconds': difference,
        'sourceSha256': file_hash(source), 'outputSha256': file_hash(output), 'checks': checks,
    }
    print(json.dumps({'file': source.name, 'passed': True, 'outputBytes': after['bytes']}, ensure_ascii=False), flush=True)
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--width', type=int, default=960)
    parser.add_argument('--height', type=int, default=540)
    parser.add_argument('--crf', type=int, default=27)
    parser.add_argument('--preset', default='fast')
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--workers', type=int, default=3)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        parser.error('Input and output directories must differ')
    if args.width * 9 != args.height * 16 or args.width % 2 or args.height % 2:
        parser.error('Output must be even-sized 16:9')
    sources = [args.input / f'ch{i:02}.mp4' for i in range(1, 30)]
    missing = [p.name for p in sources if not p.is_file()]
    if missing:
        parser.error(f'Missing chapters: {missing}')
    args.output.mkdir(parents=True, exist_ok=True)
    rows = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(normalize, p, args.output / p.name, args) for p in sources]
        for future in as_completed(futures):
            rows.append(future.result())
    rows.sort(key=lambda item: item['file'])
    report = {
        'schemaVersion': 1, 'chapters': len(rows), 'width': args.width, 'height': args.height,
        'aspectRatio': '16:9', 'sampleAspectRatio': '1:1',
        'codec': 'H.264 / AAC', 'audioTreatment': 'stream copy; packet hashes checked',
        'encoder': {'preset': args.preset, 'crf': args.crf, 'frameRate': 'preserved'},
        'sourceBytes': sum(r['source']['bytes'] for r in rows),
        'outputBytes': sum(r['output']['bytes'] for r in rows),
        'totalDurationSeconds': sum(r['output']['durationSeconds'] for r in rows),
        'maxDurationDifferenceSeconds': max(r['durationDifferenceSeconds'] for r in rows),
        'allChecksPassed': all(all(r['checks'].values()) for r in rows), 'files': rows,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key != 'files'}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
