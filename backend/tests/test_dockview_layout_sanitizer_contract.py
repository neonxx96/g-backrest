from pathlib import Path


def test_dockview_restore_filters_unknown_panel_components_before_deserialization():
    source = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "docking" / "TerminalDockview.jsx").read_text(encoding="utf-8")
    assert "sanitizeDockviewLayout" in source
    assert "api.fromJSON(sanitizedLayout)" in source
    assert "if (sanitizedLayout) {" in source
