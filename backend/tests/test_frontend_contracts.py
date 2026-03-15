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
    app_source = read_frontend("App.tsx")

    assert 'title="Best direct options"' in results_source
    assert 'title="Full craftable list"' in results_source
    assert 'title="Almost craftable"' in results_source
    assert results_source.index('title="Best direct options"') < results_source.index('title="Full craftable list"')
    assert results_source.index('title="Full craftable list"') < results_source.index('title="Almost craftable"')
    assert 'activeSection === "Craft now"' in results_source
    assert 'title="Full craftable list"' not in app_source


def test_near_craft_views_use_missing_summary_without_slots_column() -> None:
    views_source = read_frontend("components/data-views.tsx")

    assert "<th>Still missing</th>" in views_source
    assert "<th>Station</th>" in views_source
    assert "<th>Slots</th>" not in views_source
    assert "row.missing_items" in views_source
    assert "Any Water" not in views_source


def test_results_rail_surfaces_real_score_and_missing_groups() -> None:
    views_source = read_frontend("components/data-views.tsx")
    results_source = read_frontend("components/ResultsRail.tsx")

    assert "row.smart_score" in views_source
    assert 'title="Real smart-score ranking"' in views_source
    assert "slotLabel(row.missing_slots)" in views_source
    assert "BEST_DIRECT_PREVIEW = 5" in results_source
    assert "NEAR_PREVIEW = 6" in results_source
    assert "Show less" in results_source


def test_ingredient_lists_render_with_commas() -> None:
    views_source = read_frontend("components/data-views.tsx")

    assert 'orderedTokens.join(", ")' in views_source
    assert "ingredientSummary(row.ingredient_list, row.ingredients)" in views_source
    assert "ingredientSummary(recipe.ingredient_list, recipe.ingredients)" in views_source
    assert "<strong>Recipe:</strong>" in views_source
    assert 'className="result-card-recipe"' in views_source


def test_frontend_uses_dashboard_refresh_and_keeps_metadata_static() -> None:
    app_source = read_frontend("App.tsx")

    assert app_source.count("api.getMetadata(") == 1
    assert "api.getDashboard(" in app_source
    assert "api.getOverview(" not in app_source
    assert "api.getInventory(" not in app_source
    assert 'if (!hasBootstrapped || !metadata || activeSection !== "Craft now") return;' in app_source


def test_bootstrap_does_not_block_the_shell_on_secondary_panel_fetches() -> None:
    app_source = read_frontend("App.tsx")
    bootstrap_start = app_source.index("async function bootstrap() {")
    bootstrap_end = app_source.index("void bootstrap();", bootstrap_start)
    bootstrap_block = app_source[bootstrap_start:bootstrap_end]

    assert "const [hasBootstrapped, setHasBootstrapped] = useState(false);" in app_source
    assert "await api.getMetadata()" in bootstrap_block
    assert "await refreshCraftNow(" not in bootstrap_block
    assert "await api.getDashboard(" not in bootstrap_block
    assert "setHasBootstrapped(true);" in app_source
    assert "setIsLoading(false);" in app_source


def test_inventory_mutations_share_one_refresh_contract_including_imports() -> None:
    app_source = read_frontend("App.tsx")

    assert "const refreshInventoryDrivenViews = useCallback(async () => {" in app_source
    assert "refreshSharedPanels(selectedStations, nearThreshold)" in app_source
    assert 'if (activeSection === "Craft now")' in app_source
    assert "refreshCraftNow(selectedStations, sortMode, nearThreshold)" in app_source
    assert "if (plannerRequested && planTarget.trim())" in app_source
    assert "refreshes.push(executePlanner())" in app_source
    assert "if (shoppingRequested && parseShoppingTargets(shoppingText).length)" in app_source
    assert "refreshes.push(executeShoppingList())" in app_source
    assert "await refreshInventoryDrivenViews();" in app_source
    assert "handleInventoryMutation(api.importText(bulkText))" in app_source
    assert "handleInventoryMutation(api.importCsv(file))" in app_source
    assert "handleInventoryMutation(api.importExcel(file))" in app_source


def test_inventory_mutations_invalidate_stale_planner_and_shopping_output_before_rerun() -> None:
    app_source = read_frontend("App.tsx")

    assert "if (plannerRequested) setPlannerResult(null);" in app_source
    assert "if (shoppingRequested) setShoppingResult(null);" in app_source
    assert "Promise.allSettled(refreshes)" in app_source


def test_global_loading_state_is_not_tied_to_secondary_panel_refreshes() -> None:
    app_source = read_frontend("App.tsx")

    assert app_source.count("setIsLoading(") == 1
    assert "const [isLoading, setIsLoading] = useState(true);" in app_source


def test_refresh_helper_stays_one_way_and_does_not_call_inventory_mutation_recursively() -> None:
    app_source = read_frontend("App.tsx")

    refresh_start = app_source.index("const refreshInventoryDrivenViews = useCallback(async () => {")
    refresh_end = app_source.index("const handleInventoryMutation = useCallback(", refresh_start)
    refresh_block = app_source[refresh_start:refresh_end]

    assert "handleInventoryMutation(" not in refresh_block


def test_inventory_export_uses_the_round_trip_item_qty_csv_shape() -> None:
    app_source = read_frontend("App.tsx")

    assert '({ item: item.item, qty: item.qty })' in app_source
    assert 'headers.join(",")' in app_source
    assert 'JSON.stringify(row[header] ?? "")' in app_source


def test_inventory_editor_reads_overview_and_table_from_live_inventory_state() -> None:
    editor_source = read_frontend("components/InventoryEditor.tsx")

    assert "inventory?.unique_items ?? 0" in editor_source
    assert "inventory?.total_quantity ?? 0" in editor_source
    assert "inventoryMap.get(row.item) ?? 0" in editor_source
    assert "filteredCatalogRows.length" in editor_source


def test_pills_and_buttons_keep_text_on_one_line_in_css() -> None:
    css = read_frontend("styles/app.css")

    assert ".nav-pill," in css
    assert ".chip," in css
    assert ".button {" in css
    assert "display: inline-flex;" in css
    assert "white-space: nowrap;" in css
    assert "word-break: keep-all;" in css
    assert "flex-shrink: 0;" in css
    assert ".score-badge," in css
    assert ".near-pill {" in css or ".near-pill" in css


def test_craft_now_main_view_contains_the_full_craftable_table_and_sort_control() -> None:
    results_source = read_frontend("components/ResultsRail.tsx")

    assert "<CraftResultsTable" in results_source
    assert 'title="Full craftable list"' in results_source
    assert '<span>Sort full list</span>' in results_source
    assert 'className="result-panel-stack"' in results_source


def test_long_result_lists_use_internal_scroll_containers_without_changing_column_contract() -> None:
    css = read_frontend("styles/app.css")

    assert ".results-preview {" in css
    assert "max-height: clamp(12.75rem, 22vh, 17.5rem);" in css
    assert "overflow: auto;" in css
    assert "scrollbar-gutter: stable both-edges;" in css
    assert ".results-rail .craft-table-shell {" in css
    assert "grid-template-columns: var(--rail-width) minmax(0, 1fr) minmax(0, 1fr);" in css
    assert "height: clamp(28rem, calc(100vh - 15rem), 48rem);" in css


def test_category_chips_stay_on_one_line_with_scroll_instead_of_wrapping() -> None:
    css = read_frontend("styles/app.css")
    editor_source = read_frontend("components/InventoryEditor.tsx")

    assert 'className="chip-group category-chip-row"' in editor_source
    assert ".category-chip-row {" in css
    assert "flex-wrap: nowrap;" in css
    assert "overflow-x: auto;" in css


def test_banner_is_full_width_and_centered_in_css() -> None:
    css = read_frontend("styles/app.css")

    assert ".app-banner" in css
    assert "text-align: center" in css
    assert "justify-items: center" in css
