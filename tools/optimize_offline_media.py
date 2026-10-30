#!/usr/bin/env python3
"""Build separate, smaller offline media without changing original game videos."""
import argparse
import concurrent.futures
import hashlib
import json
import shutil
import subprocess
import time
from datetime import date
from fractions import Fraction
from pathlib import Path


def probe(path):
    data = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)
    ]))
    video = next(s for s in data['streams'] if s['codec_type'] == 'video')
    audio = next(s for s in data['streams'] if s['codec_type'] == 'audio')
    return data, video, audio


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output-root', type=Path, required=True,
                        help='Destination containing media/chXX.mp4 and media/side/*.mp4')
    parser.add_argument('--report', type=Path)
    parser.add_argument('--crf', type=int, default=28)
    parser.add_argument('--preset', default='medium')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--budget-bytes', type=int, default=374000000)
    parser.add_argument('--normalize-input', action='store_true',
                        help='Normalize 16:9 source videos to 960x540 and at most 24 fps; never crop or add padding.')
    args = parser.parse_args()
    root, output_root = args.project_root.resolve(), args.output_root.resolve()
    if output_root == root or output_root.is_relative_to(root / 'media'):
        raise ValueError('Offline outputs must not overwrite source media.')
    report = args.report or root / ('docs/offline-media-verification-' + date.today().strftime('%Y%m%d') + '.json')
    files = sorted((root / 'media').rglob('*.mp4'), key=lambda p: p.stat().st_size, reverse=True)
    if not files:
        raise ValueError('No source videos found.')
    records_dir = output_root / 'verification'
    records_dir.mkdir(parents=True, exist_ok=True)
    started = time.time()

    def transcode(source):
        relative = source.relative_to(root)
        target = output_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        staged = target.with_name(target.stem + '.encoding.mp4')
        source_data, video, audio = probe(source)
        source_hash = sha256(source)
        source_fps = video['r_frame_rate']
        fps = str(min(Fraction(source_fps), Fraction(24))) if args.normalize_input else source_fps
        if args.normalize_input and video['width'] * 9 != video['height'] * 16:
            raise ValueError(f'Only native 16:9 sources can be normalized: {relative}')
        if not args.normalize_input and ((video['width'], video['height']) != (960, 540) or Fraction(fps) not in (12, 24)):
            raise ValueError(f'Unexpected source geometry/frame rate: {relative}')
        audio_bitrate = int(audio.get('bit_rate', 0) or 0)
        copy_audio = audio.get('codec_name') == 'aac' and 0 < audio_bitrate <= 64000
        audio_args = ['-c:a', 'copy'] if copy_audio else ['-c:a', 'aac', '-b:a', '64k']
        command = [
            'ffmpeg', '-y', '-v', 'error', '-i', str(source), '-map', '0:v:0', '-map', '0:a:0',
            '-vf', 'scale=960:540,setsar=1' if args.normalize_input else 'setsar=1', '-r', fps, '-c:v', 'libx264', '-crf', str(args.crf),
            '-preset', args.preset, '-pix_fmt', 'yuv420p', '-threads', str(args.threads),
            *audio_args, '-movflags', '+faststart', str(staged)
        ]
        subprocess.run(command, check=True)
        candidate_size = staged.stat().st_size
        selected_original = candidate_size >= source.stat().st_size and (video['width'], video['height']) == (960, 540) and Fraction(source_fps) == Fraction(fps)
        if selected_original:
            staged.unlink()
            shutil.copyfile(source, target)
        else:
            staged.replace(target)
        final_data, final_video, final_audio = probe(target)
        duration = float(final_data['format']['duration'])
        source_duration = float(source_data['format']['duration'])
        delta = duration - source_duration
        checks = {
            'resolutionMatchesTarget': (final_video['width'], final_video['height']) == (960, 540),
            'frameRateMatchesTarget': Fraction(final_video['r_frame_rate']) == Fraction(fps),
            'squarePixels': final_video.get('sample_aspect_ratio', '1:1') == '1:1',
            'h264Video': final_video['codec_name'] == 'h264',
            'aacAudioPresent': final_audio['codec_name'] == 'aac',
            'fullDurationPreserved': abs(delta) <= 0.15,
            'sourceUnmodified': sha256(source) == source_hash,
            'noSizeIncrease': target.stat().st_size <= source.stat().st_size,
        }
        if not all(checks.values()):
            raise ValueError(f'Media validation failed: {relative}: {checks}')
        record = {
            'path': relative.as_posix(), 'sourceBytes': source.stat().st_size,
            'offlineBytes': target.stat().st_size, 'candidateBytes': candidate_size,
            'selectedOriginal': selected_original, 'width': final_video['width'], 'height': final_video['height'],
            'frameRate': final_video['r_frame_rate'], 'sourceDurationSeconds': source_duration,
            'sourceWidth': video['width'], 'sourceHeight': video['height'], 'sourceFrameRate': source_fps,
            'offlineDurationSeconds': duration, 'durationDeltaSeconds': delta,
            'sourceAudioBitrate': audio_bitrate, 'offlineAudioBitrate': int(final_audio.get('bit_rate', 0) or 0),
            'audioPolicy': 'original file retained' if selected_original else 'AAC stream copy' if copy_audio else 'AAC 64 kbps encode',
            'sourceSHA256': source_hash, 'offlineSHA256': sha256(target), 'checks': checks,
        }
        (records_dir / (relative.as_posix().replace('/', '__') + '.json')).write_text(
            json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'completed': relative.as_posix(), 'sourceBytes': record['sourceBytes'],
                          'offlineBytes': record['offlineBytes'], 'ratio': round(record['offlineBytes']/record['sourceBytes'], 3),
                          'selectedOriginal': selected_original}), flush=True)
        return record

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        records = list(pool.map(transcode, files))
    records.sort(key=lambda r: r['path'])
    total = sum(r['offlineBytes'] for r in records)
    document = {
        'date': date.today().isoformat(), 'purpose': 'Separate offline HTML video optimization; original media preserved',
        'settings': {'codec': 'H.264', 'crf': args.crf, 'preset': args.preset,
                     'workers': args.workers, 'threadsPerWorker': args.threads,
                     'resolution': '16:9 normalized to 960x540' if args.normalize_input else '960x540 preserved',
                     'frameRates': 'source frame rate preserved up to 24 fps' if args.normalize_input else 'original 12/24 fps preserved',
                     'audio': 'copy AAC <=64 kbps; otherwise encode AAC64 kbps; retain original file if smaller',
                     'cropOrPadding': False},
        'fileCount': len(records), 'sourceTotalBytes': sum(r['sourceBytes'] for r in records),
        'offlineTotalBytes': total, 'budgetBytes': args.budget_bytes, 'withinBudget': total <= args.budget_bytes,
        'maximumDurationDeltaSeconds': max(abs(r['durationDeltaSeconds']) for r in records),
        'allChecksPassed': all(all(r['checks'].values()) for r in records),
        'elapsedSeconds': round(time.time()-started, 2),
        'visualReview': {'status': 'pending', 'note': 'Inspect sampled frames and subtitle legibility before release.'},
        'videos': records,
    }
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k:v for k,v in document.items() if k not in ('videos', 'settings')}, ensure_ascii=False), flush=True)
    if total > args.budget_bytes:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
