"""Contract regressions for the local critical-parts smoke script."""

import importlib.util
from pathlib import Path


_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "smoke_critical_parts.py"
_SPEC = importlib.util.spec_from_file_location("smoke_critical_parts", _SCRIPT)
_SMOKE = importlib.util.module_from_spec(_SPEC)
assert _SPEC and _SPEC.loader
_SPEC.loader.exec_module(_SMOKE)


def test_depth_smoke_accepts_explicitly_empty_exchange_book() -> None:
    """An unreachable public exchange is not a malformed local API response."""
    assert _SMOKE.is_depth_payload({"bids": [], "asks": []})


def test_depth_smoke_rejects_missing_or_malformed_book_sides() -> None:
    assert not _SMOKE.is_depth_payload({"bids": []})
    assert not _SMOKE.is_depth_payload({"bids": {}, "asks": []})
