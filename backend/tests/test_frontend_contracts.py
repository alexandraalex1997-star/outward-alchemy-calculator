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
