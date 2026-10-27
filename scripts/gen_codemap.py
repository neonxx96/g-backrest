#!/usr/bin/env python3
"""Generate the deterministic SignalScript public-code map."""

from __future__ import annotations

import ast
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
OUTPUT_FILE = ROOT_DIR / "docs" / "CODEMAP.md"
PY_DIRS = ("backend/app", "engine", "recorder", "strategies")
JS_DIRS = ("frontend/src",)
JS_EXPORT_RE = re.compile(r"\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)")
JS_IMPORT_RE = re.compile(r"\bimport\s+(?:[\w\s{},*]+)\s+from\s+['\"]([^'\"]+)['\"]")
JS_CALL_RE = re.compile(r"\b([A-Za-z_$][\w$]*)\s*\(")
JS_KEYWORDS = frozenset({"if", "for", "while", "switch", "catch", "function"})


def relative(path: Path) -> str:
    return path.relative_to(ROOT_DIR).as_posix()


def module_name(path: Path) -> str:
    return ".".join(path.relative_to(ROOT_DIR).with_suffix("").parts)


def call_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def parse_python(path: Path) -> dict[str, list[str]]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except (OSError, SyntaxError, UnicodeDecodeError):
        return {"symbols": [], "imports": [], "calls": []}
    symbols, imports, calls = [], [], []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and not node.name.startswith("_"):
            symbols.append(node.name)
        elif isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            imports.extend(f"{module}.{alias.name}" if module else alias.name for alias in node.names)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            name = call_name(node.func)
            if name and not name.startswith("_"):
                calls.append(name)
    return {"symbols": sorted(set(symbols)), "imports": sorted(set(imports)), "calls": sorted(set(calls))}


def parse_js(path: Path) -> dict[str, list[str]]:
    try:
        content = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return {"symbols": [], "imports": [], "calls": []}
    return {
        "symbols": sorted(set(JS_EXPORT_RE.findall(content))),
        "imports": sorted(set(JS_IMPORT_RE.findall(content))),
        "calls": sorted({name for name in JS_CALL_RE.findall(content) if name not in JS_KEYWORDS}),
    }


def collect_modules() -> dict[str, dict[str, object]]:
    modules: dict[str, dict[str, object]] = {}
    for directory in PY_DIRS:
        target = ROOT_DIR / directory
        if target.exists():
            for path in sorted(target.rglob("*.py")):
                if "tests" not in path.parts and "__pycache__" not in path.parts:
                    modules[relative(path)] = {"kind": "Python", "module": module_name(path), **parse_python(path)}
    for directory in JS_DIRS:
        target = ROOT_DIR / directory
        if target.exists():
            for path in sorted([*target.rglob("*.js"), *target.rglob("*.jsx"), *target.rglob("*.ts"), *target.rglob("*.tsx")]):
                if ".test." not in path.name and "node_modules" not in path.parts:
                    modules[relative(path)] = {"kind": "Frontend", "module": relative(path), **parse_js(path)}
    return modules


def importing_callers(modules: dict[str, dict[str, object]]) -> dict[str, list[str]]:
    callers: dict[str, set[str]] = defaultdict(set)
    python_modules = {str(data["module"]): path for path, data in modules.items() if data["kind"] == "Python"}
    for source, data in modules.items():
        for imported in data["imports"]:
            for module, target in python_modules.items():
                if imported == module or imported.startswith(f"{module}."):
                    callers[target].add(source)
    return {path: sorted(items) for path, items in callers.items()}


def listed(values: list[str], limit: int = 10) -> str:
    if not values:
        return "—"
    suffix = ", …" if len(values) > limit else ""
    return ", ".join(f"`{value}`" for value in values[:limit]) + suffix


def generate_codemap() -> str:
    modules = collect_modules()
    callers = importing_callers(modules)
    lines = [
        "# SignalScript Code Map",
        "",
        "> Generated automatically by `scripts/gen_codemap.py`; do not edit manually.",
        "> Python uses `ast`; JS/TS uses deterministic export/import/call regexes.",
        "> Run `python scripts/gen_codemap.py`; use `--check` in CI.",
        "",
        "Each entry is `file → public symbols → direct call targets/imports → importing callers`.",
        "JS/TS call targets are lexical candidates, not a type-resolved call graph.",
        "",
    ]
    for heading, kind in (("## 1. Python modules", "Python"), ("## 2. Frontend JS/TS modules", "Frontend")):
        lines.extend([heading, ""])
        for path, data in modules.items():
            if data["kind"] != kind:
                continue
            lines.append(f"### `{path}`")
            lines.append(f"- **Public symbols:** {listed(data['symbols'])}")
            lines.append(f"- **Calls / imports:** {listed(data['calls'] or data['imports'])}")
            lines.append(f"- **Imported by:** {listed(callers.get(path, []), 8)}")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    content = generate_codemap()
    if "--check" in sys.argv:
        if OUTPUT_FILE.exists() and OUTPUT_FILE.read_text(encoding="utf-8") == content:
            print("[PASS] docs/CODEMAP.md is up to date.")
            return
        print("[FAIL] docs/CODEMAP.md is outdated. Run 'python scripts/gen_codemap.py'.")
        raise SystemExit(1)
    OUTPUT_FILE.write_text(content, encoding="utf-8")
    print(f"[OK] Generated docs/CODEMAP.md ({len(content.splitlines())} lines).")


if __name__ == "__main__":
    main()
