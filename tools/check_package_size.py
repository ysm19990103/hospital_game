#!/usr/bin/env python3
"""Check native main/subpackage files using the project's actual pack settings.

Run after a build: python tools/check_package_size.py
Reads project.config.json exclusions and game.json subpackage roots. Conservative
project gates use 4,000,000 raw bytes for main/independent packages and 20,000,000
in total. Ordinary subpackages have no separate 4 MB gate. Browser
HTML and offline MP4 files excluded by configuration are not counted. ZIP sizes
are comparisons only; raw sizes control exit status.
"""

import argparse
import io
import json
from pathlib import Path, PurePosixPath
import sys
import zipfile


PROJECT = Path(__file__).resolve().parents[1]


def normalize(value):
    if not isinstance(value, str):
        raise ValueError(f"Package paths must be strings: {value!r}")
    value = str(value).replace("\\", "/").strip("/")
    while value.startswith("./"):
        value = value[2:]
    if not value or value == "." or ".." in PurePosixPath(value).parts:
        raise ValueError(f"Invalid package path: {value!r}")
    return PurePosixPath(value).as_posix()


def package_files(project):
    config = json.loads((project / "project.config.json").read_text(encoding="utf-8"))
    options = config.get("packOptions", {})
    if options.get("include"):
        raise ValueError("packOptions.include is not supported by this checker; review its semantics before accepting a package gate.")
    root_setting = config.get("miniprogramRoot", "")
    package_root = (project / root_setting).resolve()
    if not package_root.is_relative_to(project.resolve()):
        raise ValueError("Native package root must be inside the project directory")
    rules = []
    for rule in options.get("ignore", []):
        if rule.get("type") not in ("file", "folder"):
            raise ValueError(f"Unsupported exclusion type: {rule.get('type')!r}; cannot safely claim this package passes.")
        rules.append((rule["type"], normalize(rule["value"])))

    included, excluded = [], []
    for path in sorted(package_root.rglob("*")):
        if not path.is_file():
            continue
        if path.is_symlink():
            raise ValueError(f"Resolve symlink before packaging: {path}")
        relative = path.relative_to(package_root).as_posix()
        ignored = any(relative == value or (kind == "folder" and relative.startswith(value + "/"))
                      for kind, value in rules)
        (excluded if ignored else included).append(path)
    return package_root, included, excluded


def subpackage_definitions(package_root):
    game = json.loads((package_root / "game.json").read_text(encoding="utf-8"))
    if "subpackages" in game and "subPackages" in game:
        raise ValueError("Use a single game.json subpackages key, not both capitalizations")
    definitions = game.get("subpackages", game.get("subPackages", []))
    if not isinstance(definitions, list):
        raise ValueError("game.json subpackages must be a list")
    packages = []
    for entry in definitions:
        root = normalize(entry["root"])
        name = str(entry.get("name") or root)
        if not (package_root / root).is_dir():
            raise ValueError(f"Subpackage root does not exist: {root}")
        for previous in packages:
            if name == previous["name"]:
                raise ValueError(f"Duplicate subpackage name: {name}")
            if root == previous["root"] or root.startswith(previous["root"] + "/") or previous["root"].startswith(root + "/"):
                raise ValueError(f"Overlapping subpackage roots: {previous['root']} and {root}")
        independent = entry.get("independent", False)
        if not isinstance(independent, bool):
            raise ValueError(f"Subpackage independent flag must be boolean: {name}")
        packages.append({"name": name, "root": root, "independent": independent})
    return packages


def summarize(package_root, paths, limit_bytes, name, root):
    rows = [{"path": p.relative_to(package_root).as_posix(), "bytes": p.stat().st_size}
            for p in paths]
    raw_bytes = sum(row["bytes"] for row in rows)
    memory = io.BytesIO()
    with zipfile.ZipFile(memory, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for path in paths:
            bundle.write(path, path.relative_to(package_root).as_posix())
    return {
        "name": name, "root": root, "fileCount": len(paths), "rawBytes": raw_bytes,
        "zipBytes": len(memory.getvalue()), "limitBytes": limit_bytes,
        "headroomBytes": limit_bytes - raw_bytes if limit_bytes is not None else None,
        "passed": limit_bytes is None or raw_bytes <= limit_bytes,
        "files": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, default=PROJECT)
    parser.add_argument("--main-limit-bytes", "--limit-bytes", dest="main_limit_bytes", type=int, default=4_000_000)
    parser.add_argument("--independent-limit-bytes", "--subpackage-limit-bytes", dest="independent_limit_bytes", type=int, default=4_000_000,
                        help="Gate only independent:true subpackages; ordinary subpackages use the total gate")
    parser.add_argument("--total-limit-bytes", type=int, default=20_000_000)
    parser.add_argument("--json", action="store_true", help="Print JSON including every counted native file")
    args = parser.parse_args()
    if min(args.main_limit_bytes, args.independent_limit_bytes, args.total_limit_bytes) < 1:
        parser.error("Package size limits must be positive")
    try:
        package_root, included, excluded = package_files(args.project.resolve())
        definitions = subpackage_definitions(package_root)
        main_files = []
        split_files = {definition["root"]: [] for definition in definitions}
        for path in included:
            relative = path.relative_to(package_root).as_posix()
            owner = next((definition["root"] for definition in definitions
                          if relative.startswith(definition["root"] + "/")), None)
            if owner is None:
                main_files.append(path)
            else:
                split_files[owner].append(path)
        main_package = summarize(package_root, main_files, args.main_limit_bytes, "main", "")
        subpackages = []
        for definition in definitions:
            limit = args.independent_limit_bytes if definition["independent"] else None
            summary = summarize(package_root, split_files[definition["root"]], limit, definition["name"], definition["root"])
            summary["independent"] = definition["independent"]
            subpackages.append(summary)
        total = summarize(package_root, included, args.total_limit_bytes, "total", "")
        total["sumPackageZipBytes"] = main_package["zipBytes"] + sum(p["zipBytes"] for p in subpackages)
        # Each included path belongs to exactly one package, never both main and subpackage.
        if total["rawBytes"] != main_package["rawBytes"] + sum(p["rawBytes"] for p in subpackages):
            raise ValueError("Package partition did not account for every included byte")
        result = {
            "schemaVersion": 2, "packageRoot": str(package_root),
            "ruleSource": "project.config.json / packOptions.ignore + game.json / subpackages",
            "nativeFileCount": len(included), "excludedFileCount": len(excluded),
            "mainPackage": main_package, "subpackages": subpackages, "total": total,
            "passed": main_package["passed"] and total["passed"] and all(p["passed"] for p in subpackages),
        }
    except (OSError, ValueError, KeyError) as exc:
        print(f"Native package check failed: {exc}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"{'PASS' if result['passed'] else 'FAIL'} native package gates")
        for package in [main_package] + subpackages + [total]:
            label = "MAIN" if package is main_package else ("TOTAL" if package is total else f"SUB {package['name']} [{package['root']}]")
            if package is not main_package and package is not total:
                label += " independent" if package["independent"] else " ordinary"
            budget = f" / {package['limitBytes']:,}" if package["limitBytes"] is not None else " (total gate only)"
            headroom = f"; headroom {package['headroomBytes']:,}" if package["headroomBytes"] is not None else ""
            print(f"  {'PASS' if package['passed'] else 'FAIL'} {label}: "
                  f"{package['rawBytes']:,}{budget} raw bytes; "
                  f"ZIP {package['zipBytes']:,}; {package['fileCount']} files{headroom}")
        print(f"Sum of independently zipped packages: {total['sumPackageZipBytes']:,} bytes")
        print(f"Excluded by project.config.json: {len(excluded)} files")
        print("Largest main-package files:")
        for row in sorted(main_package["files"], key=lambda row: row['bytes'], reverse=True)[:10]:
            print(f"  {row['bytes']:>9,}  {row['path']}")
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
