#!/usr/bin/env python3
"""Create full-length browser media from the chapter manifest; never edit sources.

Run from any directory:
    python baiyi-game/tools/prepare_media.py
    python baiyi-game/tools/prepare_media.py --manifest /path/videos.json --force

Requires ffmpeg (with libx264/AAC) and ffprobe on PATH. Uses only Python stdlib.
The manifest is a JSON list containing chapter, path, and optionally title/name.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time


PROJECT = Path(__file__).resolve().parents[1]
WORKSPACE = PROJECT.parent


def probe(path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)],
        check=True, capture_output=True, text=True,
    )
    raw = json.loads(result.stdout)
    video = next(s for s in raw["streams"] if s["codec_type"] == "video")
    audio = next((s for s in raw["streams"] if s["codec_type"] == "audio"), None)
    return {
        "durationSeconds": float(raw["format"]["duration"]),
        "videoDurationSeconds": float(video.get("duration", raw["format"]["duration"])),
        "width": video["width"], "height": video["height"],
        "videoCodec": video["codec_name"], "pixelFormat": video.get("pix_fmt"),
        "frameRate": video.get("avg_frame_rate"),
        "audioCodec": audio.get("codec_name") if audio else None,
        "audioDurationSeconds": float(audio["duration"]) if audio and "duration" in audio else None,
        "sizeBytes": path.stat().st_size,
    }


def check_output(source, output):
    checks = {
        "fullDuration": abs(source["durationSeconds"] - output["durationSeconds"]) <= 0.25,
        "fullVideoDuration": abs(source["videoDurationSeconds"] - output["videoDurationSeconds"]) <= 0.25,
        "audioPreserved": bool(source["audioCodec"]) == bool(output["audioCodec"]),
        "browserCodecs": output["videoCodec"] == "h264" and output["pixelFormat"] == "yuv420p"
        and (not output["audioCodec"] or output["audioCodec"] == "aac"),
    }
    if source["audioDurationSeconds"] is not None and output["audioDurationSeconds"] is not None:
        checks["fullAudioDuration"] = abs(source["audioDurationSeconds"] - output["audioDurationSeconds"]) <= 0.25
    return checks


def resolve_source(item, manifest):
    source = Path(item["path"]).expanduser()
    if source.is_file():
        return source.resolve()
    if not source.is_absolute() and (manifest.parent / source).is_file():
        return (manifest.parent / source).resolve()
    # Allows relocation of this project and its sibling source_videos directory.
    relocated = WORKSPACE / "source_videos" / source.name
    if relocated.is_file():
        return relocated.resolve()
    raise FileNotFoundError(f"Source missing for chapter {item['chapter']}: {source}")


def convert(item, args):
    chapter = int(item["chapter"])
    source_path = resolve_source(item, args.manifest)
    source = probe(source_path)
    target = args.output / f"ch{chapter:02d}.mp4"
    temporary = args.output / f"ch{chapter:02d}.partial.mp4"
    cached = False
    began = time.monotonic()
    if target.is_file() and not args.force:
        try:
            output = probe(target)
            cached = all(check_output(source, output).values()) and output["frameRate"] == "12/1"
        except (subprocess.CalledProcessError, ValueError, KeyError, StopIteration):
            cached = False
    if not cached:
        # Scale inside the target frame, then pad: no cropping or stretching.
        width, height = (854, 480) if source["width"] >= source["height"] else (270, 480)
        video_filter = (
            f"scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=12"
        )
        command = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-i", str(source_path), "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
            "-vf", video_filter, "-c:v", "libx264", "-preset", "veryfast", "-crf", "31",
            "-pix_fmt", "yuv420p", "-threads", "2", "-c:a", "aac", "-b:a", "48k",
            "-movflags", "+faststart", str(temporary),
        ]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(f"Chapter {chapter} ffmpeg failed: {result.stderr[-3000:]}")
        output = probe(temporary)
        checks = check_output(source, output)
        if not all(checks.values()):
            temporary.unlink(missing_ok=True)
            raise RuntimeError(f"Chapter {chapter} failed duration/codec validation: {checks}")
        temporary.replace(target)
    checks = check_output(source, output)
    return {
        "chapter": chapter, "title": item.get("title", ""),
        "sourceName": item.get("name", source_path.name),
        "sourcePath": str(source_path), "outputPath": str(target.resolve()),
        "source": source, "output": output,
        "durationDifferenceSeconds": round(output["durationSeconds"] - source["durationSeconds"], 6),
        "checks": checks, "cached": cached,
        "elapsedSeconds": round(time.monotonic() - began, 2),
    }


def write_report(args, rows, failures, expected):
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "manifestPath": str(args.manifest.resolve()), "expectedChapters": expected,
        "completedChapters": len(rows), "allPassed": len(rows) == expected and not failures,
        "settings": {"landscape": "854x480", "portrait": "270x480", "fps": 12,
                     "video": "H.264", "crf": 31, "preset": "veryfast", "audio": "AAC 48kbit/s",
                     "faststart": True, "parallelJobs": args.jobs, "durationToleranceSeconds": 0.25},
        "sourceTotalSeconds": round(sum(r["source"]["durationSeconds"] for r in rows), 6),
        "outputTotalSeconds": round(sum(r["output"]["durationSeconds"] for r in rows), 6),
        "outputTotalBytes": sum(r["output"]["sizeBytes"] for r in rows),
        "chapters": sorted(rows, key=lambda r: r["chapter"]), "failures": failures,
    }
    temporary = args.report.with_suffix(".partial.json")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=WORKSPACE / "analysis/videos.json")
    parser.add_argument("--output", type=Path, default=PROJECT / "media")
    parser.add_argument("--report", type=Path, default=WORKSPACE / "analysis/media-report.json")
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--force", action="store_true", help="Re-encode even if a validated output exists")
    args = parser.parse_args()
    if args.jobs < 1:
        parser.error("--jobs must be at least 1")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        parser.error("ffmpeg and ffprobe must be installed on PATH")
    items = json.loads(args.manifest.read_text(encoding="utf-8"))
    if len({int(item["chapter"]) for item in items}) != len(items):
        parser.error("Manifest has duplicate chapter numbers")
    for item in items:
        resolve_source(item, args.manifest)
    args.output.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    rows, failures = [], []
    write_report(args, rows, failures, len(items))
    print(f"Preparing {len(items)} complete chapters with {args.jobs} concurrent jobs", flush=True)
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = {pool.submit(convert, item, args): item for item in items}
        for future in as_completed(futures):
            item = futures[future]
            try:
                row = future.result()
                rows.append(row)
                print(f"[{len(rows)}/{len(items)}] ch{row['chapter']:02d} "
                      f"{row['source']['durationSeconds']:.3f}s -> {row['output']['durationSeconds']:.3f}s "
                      f"{row['output']['sizeBytes']/1024/1024:.2f} MiB"
                      f"{' (validated existing output)' if row['cached'] else ''}", flush=True)
            except Exception as exc:
                failures.append({"chapter": item["chapter"], "error": str(exc)})
                print(f"ERROR chapter {item['chapter']}: {exc}", file=sys.stderr, flush=True)
            write_report(args, rows, failures, len(items))
    total = sum(row["output"]["sizeBytes"] for row in rows) / 1024 / 1024
    print(f"Finished: {len(rows)}/{len(items)}, {total:.2f} MiB; report: {args.report}", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
