from pathlib import Path


PANEL_PATH = Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "OvernightPilotPanel.jsx"
PILOT_SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "night-pilot.ps1"


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


def test_overnight_pilot_can_load_the_diversified_three_strategy_plan():
    source = PANEL_PATH.read_text(encoding="utf-8")

    assert 'data-testid="btn-load-diversified-paper"' in source
    assert 'fetch(`${API}/diversified-paper/defaults`)' in source


def test_overnight_preflight_exposes_optimizer_and_cli_defaults_to_diversified_plan():
    panel = PANEL_PATH.read_text(encoding="utf-8")
    script = PILOT_SCRIPT_PATH.read_text(encoding="utf-8")

    assert "Backtest + forecast + optimize" in panel
    assert "backtest?.optimization" in panel
    assert "[string]$Preset = 'diversified_paper'" in script
    assert "Optimizer={0} OOS Net={1}" in script


def test_overnight_optimizer_marks_small_oos_trade_samples_as_weak_evidence():
    panel = PANEL_PATH.read_text(encoding="utf-8")

    assert "oosTrades < 30" in panel
    assert "мало сделок для уверенной OOS-оценки" in panel


def test_active_pilot_config_takes_precedence_over_stale_local_draft():
    panel = PANEL_PATH.read_text(encoding="utf-8")

    assert "hasRunningSessions" in panel
    assert "hasRunningSessions && restoredConfigs.length" in panel
