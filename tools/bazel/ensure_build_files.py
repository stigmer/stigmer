#!/usr/bin/env python3
"""
Ensure every Go module listed in go.work has a BUILD.bazel file.

Bazel requires a BUILD file in any directory it references as a package.
The MODULE.bazel config reads go.work via gazelle's go_deps extension,
which resolves each module's go.mod as a Bazel label (e.g.
//test/integration-security:go.mod). Without a BUILD.bazel in that
directory, Bazel fails with "Unable to load package."

This script parses go.work, checks each module root for a BUILD.bazel,
and creates a minimal placeholder for any that are missing. It is
idempotent -- existing BUILD.bazel files are never overwritten.

Inspired by Planton's clean_gazelle.py, but scoped to Stigmer's needs:
no deletion step (Gazelle only runs for apis/stubs/go), no go mod tidy
(handled by the apis/Makefile), and descriptive placeholders instead of
empty files.
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
GO_WORK = REPO_ROOT / "go.work"

PLACEHOLDER_TEMPLATE = (
    "# Empty BUILD file to satisfy Bazel module resolution for the\n"
    "# {module_path} go.mod. This module is not built through Bazel.\n"
)


def parse_go_work() -> list[str]:
    """Return the list of module paths from go.work (relative to repo root)."""
    text = GO_WORK.read_text()
    match = re.search(r"use\s*\((.*?)\)", text, re.DOTALL)
    if not match:
        print("ERROR: could not parse use(...) block in go.work", file=sys.stderr)
        sys.exit(1)

    modules = []
    for line in match.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        modules.append(line.lstrip("./").rstrip("/"))
    return modules


def ensure_build_files(modules: list[str]) -> list[str]:
    """Create BUILD.bazel for any module root missing one. Return seeded paths."""
    seeded = []
    for mod in modules:
        mod_dir = REPO_ROOT / mod
        build_file = mod_dir / "BUILD.bazel"

        if build_file.exists():
            continue

        if not mod_dir.exists():
            print(f"  warning: module directory does not exist: {mod}", file=sys.stderr)
            continue

        build_file.write_text(PLACEHOLDER_TEMPLATE.format(module_path=mod))
        seeded.append(mod)

    return seeded


def main():
    if not GO_WORK.exists():
        print(f"ERROR: {GO_WORK} not found", file=sys.stderr)
        sys.exit(1)

    modules = parse_go_work()
    print(f"Checking {len(modules)} go.work module(s) for BUILD.bazel files...")

    seeded = ensure_build_files(modules)

    if seeded:
        for path in seeded:
            print(f"  created: {path}/BUILD.bazel")
        print(f"✓ Seeded {len(seeded)} missing BUILD.bazel file(s)")
    else:
        print("✓ All go.work modules already have BUILD.bazel files")


if __name__ == "__main__":
    main()
