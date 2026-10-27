#!/usr/bin/env python3
"""
gen_codemap.py — Deterministic Code Map Generator for SignalScript.
Generates docs/CODEMAP.md mapping files -> public symbols -> imports/calls.
Supports --check flag for quality gates (exits with 1 if outdated).
"""

import ast
import os
import re
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
OUTPUT_FILE = ROOT_DIR / "docs" / "CODEMAP.md"

PY_DIRS = ["backend/app", "engine", "recorder", "strategies"]
JS_DIRS = ["frontend/src"]

JS_EXPORT_REGEX = re.compile(
    r"export\s+(?:default\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_]+)",
    re.MULTILINE
)
JS_IMPORT_REGEX = re.compile(
    r"import\s+(?:[\w\s{},*]+)\s+from\s+['\"]([^'\"]+)['\"]",
    re.MULTILINE
)


def parse_python_file(path: Path) -> dict:
    try:
        content = path.read_text(encoding="utf-8")
        tree = ast.parse(content, filename=str(path))
    except Exception:
        return {"symbols": [], "imports": []}

    symbols = []
    imports = []

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if not node.name.startswith("_") or node.name.startswith("__"):
                symbols.append(f"func {node.name}")
        elif isinstance(node, ast.ClassDef):
            methods = [
                m.name for m in node.body
                if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))
                and (not m.name.startswith("_") or m.name.startswith("__"))
            ]
            method_str = f"({', '.join(methods[:4])}{'...' if len(methods) > 4 else ''})" if methods else ""
            symbols.append(f"class {node.name} {method_str}".strip())
        elif isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            for alias in node.names:
                imports.append(f"{mod}.{alias.name}" if mod else alias.name)

    return {
        "symbols": sorted(symbols),
        "imports": sorted(set(imports))
    }


def parse_js_file(path: Path) -> dict:
    try:
        content = path.read_text(encoding="utf-8")
    except Exception:
        return {"symbols": [], "imports": []}

    symbols = [f"export {name}" for name in JS_EXPORT_REGEX.findall(content)]
    imports = list(set(JS_IMPORT_REGEX.findall(content)))

    return {
        "symbols": sorted(set(symbols)),
        "imports": sorted(imports)
    }


def generate_codemap() -> str:
    lines = [
        "# SignalScript Code Map",
        "",
        "> Generated automatically by `scripts/gen_codemap.py`. Do not edit manually.",
        "> Run `python scripts/gen_codemap.py` to regenerate.",
        "",
        "---",
        ""
    ]

    # 1. Python Modules
    lines.append("## 1. Backend & Quantitative Python Modules\n")
    for d in PY_DIRS:
        target_dir = ROOT_DIR / d
        if not target_dir.exists():
            continue
        py_files = sorted(target_dir.rglob("*.py"))
        for py_file in py_files:
            if "tests" in py_file.parts or "__pycache__" in py_file.parts:
                continue
            rel_path = py_file.relative_to(ROOT_DIR).as_posix()
            data = parse_python_file(py_file)
            if not data["symbols"] and not data["imports"]:
                continue

            lines.append(f"### `{rel_path}`")
            if data["symbols"]:
                lines.append(f"- **Symbols:** {', '.join(f'`{s}`' for s in data['symbols'][:10])}")
            if data["imports"]:
                lines.append(f"- **Dependencies:** {', '.join(f'`{i}`' for i in data['imports'][:8])}")
            lines.append("")

    # 2. Frontend Modules
    lines.append("## 2. Frontend React / Vite Modules\n")
    for d in JS_DIRS:
        target_dir = ROOT_DIR / d
        if not target_dir.exists():
            continue
        js_files = sorted(list(target_dir.rglob("*.jsx")) + list(target_dir.rglob("*.js")))
        for js_file in js_files:
            if "test" in js_file.name or "node_modules" in js_file.parts:
                continue
            rel_path = js_file.relative_to(ROOT_DIR).as_posix()
            data = parse_js_file(js_file)
            if not data["symbols"] and not data["imports"]:
                continue

            lines.append(f"### `{rel_path}`")
            if data["symbols"]:
                lines.append(f"- **Exports:** {', '.join(f'`{s}`' for s in data['symbols'][:8])}")
            if data["imports"]:
                filtered_imports = [i for i in data["imports"] if not i.endswith(".css")]
                if filtered_imports:
                    lines.append(f"- **Imports:** {', '.join(f'`{i}`' for i in filtered_imports[:6])}")
            lines.append("")

    return "\n".join(lines).strip() + "\n"


def main():
    check_mode = "--check" in sys.argv
    new_content = generate_codemap()

    if check_mode:
        if not OUTPUT_FILE.exists():
            print(f"[FAIL] {OUTPUT_FILE} does not exist.")
            sys.exit(1)
        current_content = OUTPUT_FILE.read_text(encoding="utf-8")
        if current_content != new_content:
            print(f"[FAIL] {OUTPUT_FILE} is outdated. Run 'python scripts/gen_codemap.py' to update.")
            sys.exit(1)
        print(f"[PASS] {OUTPUT_FILE} is up to date.")
        sys.exit(0)

    OUTPUT_FILE.write_text(new_content, encoding="utf-8")
    print(f"[OK] Generated {OUTPUT_FILE} successfully ({len(new_content.splitlines())} lines).")


if __name__ == "__main__":
    main()
