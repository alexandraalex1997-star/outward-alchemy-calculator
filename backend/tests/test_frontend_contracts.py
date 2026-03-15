from __future__ import annotations

import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[2]


def test_view_config_maps_tabs_to_expected_logic() -> None:
    config = json.loads((BASE_DIR / "frontend" / "src" / "view-config.json").read_text(encoding="utf-8"))
    mapping = {entry["id"]: entry["logic"] for entry in config}

    assert mapping == {
        "Craft now": "direct",
        "Plan a target": "planner",
        "Shopping list": "shopping",
        "Missing ingredients": "near",
        "Recipe database": "database",
    }

    for entry in config:
        assert entry["apis"]
        assert entry["viewState"]


def test_planning_controls_contract_spells_out_panel_impact() -> None:
    controls = json.loads((BASE_DIR / "frontend" / "src" / "planning-controls.json").read_text(encoding="utf-8"))
    control_map = {entry["id"]: entry["affects"] for entry in controls}

    assert control_map["stations"] == ["Craft now", "Missing ingredients", "Plan a target", "Shopping list"]
    assert control_map["planner_depth"] == ["Plan a target", "Shopping list"]
    assert control_map["near_threshold"] == ["Missing ingredients", "Craft now"]


def test_sidebar_collapse_layout_contract_exists_in_css() -> None:
    css = (BASE_DIR / "frontend" / "src" / "styles" / "app.css").read_text(encoding="utf-8")

    assert ".app-shell.left-collapsed" in css
    assert "grid-template-columns: var(--rail-collapsed-width)" in css
    assert "transition: grid-template-columns" in css
    assert ".rail-toggle" in css


def test_direct_result_sections_are_clearly_distinguished() -> None:
    app_source = (BASE_DIR / "frontend" / "src" / "App.tsx").read_text(encoding="utf-8")

    assert "Best direct options" in app_source
    assert "All craftable results" in app_source
    assert 'title="Craft now"' in app_source
    assert "What you can craft right now" not in app_source


def test_left_rail_sections_are_individually_collapsible() -> None:
    app_source = (BASE_DIR / "frontend" / "src" / "App.tsx").read_text(encoding="utf-8")

    assert 'const [railSections, setRailSections] = useState<Record<RailSectionId, boolean>>' in app_source
    assert 'toggleRailSection("snapshot")' in app_source
    assert 'toggleRailSection("planning")' in app_source
    assert 'toggleRailSection("how")' in app_source
    assert 'toggleRailSection("bulk")' in app_source
    assert 'toggleRailSection("data")' in app_source
    assert "className=\"panel-toggle\"" in app_source
    assert "Support rail" not in app_source
    assert "Quick tools" not in app_source


def test_near_craft_table_uses_missing_summary_without_slots_column() -> None:
    app_source = (BASE_DIR / "frontend" / "src" / "App.tsx").read_text(encoding="utf-8")

    assert "<th>Still missing</th>" in app_source
    assert "<th>Station</th>" in app_source
    assert "<th>Slots</th>" not in app_source
    assert "missing-summary" in app_source


def test_frontend_uses_dashboard_refresh_and_keeps_metadata_static() -> None:
    app_source = (BASE_DIR / "frontend" / "src" / "App.tsx").read_text(encoding="utf-8")

    assert app_source.count("api.getMetadata(") == 1
    assert "api.getDashboard(" in app_source
    assert "api.getOverview(" not in app_source
    assert "api.getInventory(" not in app_source
    assert 'if (!metadata || activeSection !== "Craft now") return;' in app_source


def test_banner_is_full_width_and_centered_in_css() -> None:
    css = (BASE_DIR / "frontend" / "src" / "styles" / "app.css").read_text(encoding="utf-8")

    assert ".app-banner" in css
    assert "text-align: center" in css
    assert "justify-items: center" in css
