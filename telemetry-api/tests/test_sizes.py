"""Every Python function of the telemetry API, its scripts and its tests is at most 60 lines, and every file at most
400 (Sprint 7 close, tech review TECH-8): the limits ESLint holds the extension's TypeScript to, read here from the
syntax tree, so a route added to a function near the limit fails a test instead of a review.
"""

import ast
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
FILES = sorted(path for folder in ("app", "scripts", "tests") for path in (ROOT / folder).rglob("*.py"))
MAX_FUNCTION_LINES = 60
MAX_FILE_LINES = 400


def test_reads_every_folder() -> None:
    assert {path.parent.name for path in FILES} == {"app", "scripts", "tests"}


@pytest.mark.parametrize("path", FILES, ids=lambda path: str(path.relative_to(ROOT)))
def test_keeps_functions_to_60_lines_and_files_to_400(path: Path) -> None:
    text = path.read_text("utf-8")
    assert len(text.splitlines()) <= MAX_FILE_LINES
    for node in ast.walk(ast.parse(text)):
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            length = (node.end_lineno or node.lineno) - node.lineno + 1
            assert length <= MAX_FUNCTION_LINES, f"{node.name}: {length} lines"
