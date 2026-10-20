from pathlib import Path


PANEL_PATH = Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "OvernightPilotPanel.jsx"


def test_overnight_pilot_exposes_explained_trailing_controls():
    """Risk-management settings promised by the pilot must remain operable in UI."""
    source = PANEL_PATH.read_text(encoding="utf-8")

    assert 'data-testid="overnight-trailing-enabled"' in source
    assert 'data-testid="overnight-trailing-pct"' in source
    assert 'data-testid="overnight-trailing-activation-pct"' in source
    assert "update(index, 'use_trailing'" in source
    assert "update(index, 'trailing_pct'" in source
    assert "update(index, 'trailing_activation_pct'" in source
    assert "Трейлинг" in source
