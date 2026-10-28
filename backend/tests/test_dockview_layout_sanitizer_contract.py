from pathlib import Path


def test_dockview_restore_filters_unknown_panel_components_before_deserialization():
    source = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "docking" / "TerminalDockview.jsx").read_text(encoding="utf-8")
    assert "sanitizeDockviewLayout" in source
    assert "api.fromJSON(sanitizedLayout)" in source
    # A structurally valid layout may still be intentionally journal/backtest-only.
    # The restore path must reject only layouts with no renderable terminal panel,
    # rather than restoring an empty grid or overwriting it during hydration.
    assert "if (sanitizedLayout && hasRenderableTerminalPanel(sanitizedLayout))" in source


def test_dockview_recovers_from_local_snapshot_or_builds_a_default_when_workspace_api_fails():
    source = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "docking" / "TerminalDockview.jsx").read_text(encoding="utf-8")

    assert "if (!api) return;" in source
    assert "resolveDockviewLayout(workspaceDetail, readCachedDockviewLayout())" in source
    assert "workspaceDetail?.id || useLayoutStore.getState().activePresetId" in source
    assert "if (!api || !workspaceDetail) return;" not in source


def test_dockview_local_recovery_snapshot_is_written_before_debounced_sqlite_save():
    source = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "stores" / "layoutStore.js").read_text(encoding="utf-8")

    assert "persistDockviewLayoutLocally(dockviewJson);" in source
    assert source.index("persistDockviewLayoutLocally(dockviewJson);") < source.index("autosaveTimer = setTimeout")
