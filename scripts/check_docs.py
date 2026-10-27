#!/usr/bin/env python3
"""
check_docs.py — Documentation Integrity & CodeMap Verification Gate.
Ensures documentation rules and CODEMAP.md remain synchronized with code changes.
"""

import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "scripts"))

try:
    from gen_codemap import generate_codemap, OUTPUT_FILE
except ImportError:
    print("[FAIL] Unable to import gen_codemap.")
    sys.exit(1)

REQUIRED_DOCS = [
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "HANDOFF.md",
    "PROGRESS.md",
    "docs/ARCHITECTURE.md",
    "docs/ROADMAP.md",
    "docs/HISTORY.md",
    "docs/AGENT_ROUTING.md",
    "docs/CODEMAP.md",
    "docs/design/DESIGN_GUIDE.md",
]


def check_required_docs() -> bool:
    all_ok = True
    for doc in REQUIRED_DOCS:
        p = ROOT_DIR / doc
        if not p.exists():
            print(f"[FAIL] Missing required documentation file: {doc}")
            all_ok = False
    return all_ok


def check_agents_md_limits() -> bool:
    agents_path = ROOT_DIR / "AGENTS.md"
    if not agents_path.exists():
        return False

    content = agents_path.read_text(encoding="utf-8")
    lines = content.splitlines()
    size = len(content.encode("utf-8"))

    if len(lines) > 150:
        print(f"[FAIL] AGENTS.md exceeds 150 lines target: {len(lines)} lines.")
        return False
    if size > 8192:
        print(f"[FAIL] AGENTS.md exceeds 8 KB limit: {size} bytes.")
        return False

    return True


def check_codemap_freshness() -> bool:
    if not OUTPUT_FILE.exists():
        print(f"[FAIL] {OUTPUT_FILE} does not exist.")
        return False

    current_content = OUTPUT_FILE.read_text(encoding="utf-8")
    generated_content = generate_codemap()

    if current_content != generated_content:
        print(f"[FAIL] docs/CODEMAP.md is outdated. Run 'python scripts/gen_codemap.py' to update.")
        return False

    return True


def main():
    print("--- SignalScript Documentation Integrity Check ---")

    if not check_required_docs():
        sys.exit(1)

    if not check_agents_md_limits():
        sys.exit(1)

    if not check_codemap_freshness():
        sys.exit(1)

    print("[PASS] All documentation integrity rules and CodeMap verified.")
    sys.exit(0)


if __name__ == "__main__":
    main()
