from __future__ import annotations

import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[2]


def read_frontend(path: str) -> str:
    return (BASE_DIR / "frontend" / "src" / path).read_text(encoding="utf-8")


def test_view_config_maps_tabs_to_expected_logic() -> None:
    config = json.loads(read_frontend("view-config.json"))
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
    controls = json.loads(read_frontend("planning-controls.json"))
    control_map = {entry["id"]: entry["affects"] for entry in controls}

    assert control_map["stations"] == ["Craft now", "Missing ingredients", "Plan a target", "Shopping list"]
    assert control_map["planner_depth"] == ["Plan a target", "Shopping list"]
    assert control_map["near_threshold"] == ["Missing ingredients", "Craft now"]


def test_gemini_shell_components_exist_and_app_uses_them() -> None:
    app_source = read_frontend("App.tsx")

    assert 'import { InventoryEditor } from "./components/InventoryEditor";' in app_source
    assert 'import { ResultsRail } from "./components/ResultsRail";' in app_source
    assert 'import { SupportRail } from "./components/SupportRail";' in app_source
    assert 'import { TopBanner } from "./components/TopBanner";' in app_source
    assert "<TopBanner" in app_source
    assert "<SupportRail" in app_source
    assert "<ResultsRail" in app_source
    assert "<InventoryEditor" in app_source


def test_sidebar_collapse_layout_contract_exists_in_css() -> None:
    css = read_frontend("styles/app.css")

    assert ".app-shell.left-collapsed" in css
    assert "grid-template-columns: var(--rail-collapsed-width)" in css
    assert "transition: grid-template-columns" in css
    assert ".rail-toggle" in css


def test_left_rail_sections_are_individually_collapsible() -> None:
    support_rail_source = read_frontend("components/SupportRail.tsx")
    ui_source = read_frontend("components/ui.tsx")

    assert 'type RailSectionId = "snapshot" | "planning" | "how" | "bulk" | "data";' in support_rail_source
    assert 'onToggleSection("snapshot")' in support_rail_source
    assert 'onToggleSection("planning")' in support_rail_source
    assert 'onToggleSection("how")' in support_rail_source
    assert 'onToggleSection("bulk")' in support_rail_source
    assert 'onToggleSection("data")' in support_rail_source
    assert 'className="panel-toggle"' in ui_source
    assert "Support rail" not in support_rail_source
    assert "Quick tools" not in support_rail_source


def test_direct_result_sections_are_clearly_distinguished() -> None:
    results_source = read_frontend("components/ResultsRail.tsx")

    assert 'title="Best direct options"' in results_source
    assert 'title="Full craftable list"' in results_source
    assert 'title="Almost craftable"' in results_source
    assert results_source.index('title="Best direct options"') < results_source.index('title="Full craftable list"')
    assert results_source.index('title="Full craftable list"') < results_source.index('title="Almost craftable"')


def test_near_craft_views_use_missing_summary_without_slots_column() -> None:
    views_source = read_frontend("components/data-views.tsx")

    assert "<th>Still missing</th>" in views_source
    assert "<th>Station</th>" in views_source
    assert "<th>Slots</th>" not in views_source
    assert "row.missing_items" in views_source
    assert "Any Water" not in views_source


def test_results_rail_surfaces_real_score_and_missing_groups() -> None:
    views_source = read_frontend("components/data-views.tsx")

    assert "row.smart_score" in views_source
    assert 'title="Real smart-score ranking"' in views_source
    assert "slotLabel(row.missing_slots)" in views_source


def test_ingredient_lists_render_with_commas() -> None:
    views_source = read_frontend("components/data-views.tsx")

    assert 'orderedTokens.join(", ")' in views_source
    assert "ingredientSummary(row.ingredient_list, row.ingredients)" in views_source
    assert "ingredientSummary(recipe.ingredient_list, recipe.ingredients)" in views_source


def test_frontend_uses_dashboard_refresh_and_keeps_metadata_static() -> None:
    app_source = read_frontend("App.tsx")

    assert app_source.count("api.getMetadata(") == 1
    assert "api.getDashboard(" in app_source
    assert "api.getOverview(" not in app_source
    assert "api.getInventory(" not in app_source
    assert 'if (!metadata || activeSection !== "Craft now") return;' in app_source


def test_banner_is_full_width_and_centered_in_css() -> None:
    css = read_frontend("styles/app.css")

    assert ".app-banner" in css
    assert "text-align: center" in css
    assert "justify-items: center" in css
