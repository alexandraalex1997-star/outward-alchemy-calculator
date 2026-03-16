from __future__ import annotations

import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[2]


def read_frontend(path: str) -> str:
    return (BASE_DIR / "frontend" / "src" / path).read_text(encoding="utf-8")


def test_view_config_maps_tabs_to_expected_logic() -> None:
    config = json.loads(read_frontend("config/view-config.json"))
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
    controls = json.loads(read_frontend("config/planning-controls.json"))
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

    assert 'type RailSectionId = "snapshot" | "planning" | "bulk" | "data";' in support_rail_source
    assert 'onToggleSection("snapshot")' in support_rail_source
    assert 'onToggleSection("planning")' in support_rail_source
    assert 'onToggleSection("bulk")' in support_rail_source
    assert 'onToggleSection("data")' in support_rail_source
    assert 'className="panel-toggle"' in ui_source
    assert "Support rail" not in support_rail_source
    assert "Quick tools" not in support_rail_source
    assert "How this works" not in support_rail_source


def test_direct_result_sections_are_clearly_distinguished() -> None:
    results_source = read_frontend("components/ResultsRail.tsx")
    app_source = read_frontend("App.tsx")

    assert "<h3>Craftable recipes</h3>" in results_source
    assert "<h3>Almost craftable</h3>" in results_source
    assert results_source.index("<h3>Craftable recipes</h3>") < results_source.index("<h3>Almost craftable</h3>")
    assert 'title="Best direct options"' not in results_source
    assert 'title="Full craftable list"' not in results_source
    assert 'if (!hasBootstrapped || !metadata || activeSection !== "Craft now") return;' not in app_source


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
    assert "Show more" not in results_source
    assert "Show less" not in results_source
    assert 'className="results-preview"' in results_source


def test_ingredient_lists_render_with_commas() -> None:
    views_source = read_frontend("components/data-views.tsx")

    assert 'orderedTokens.join(", ")' in views_source
    assert "ingredientSummary(row.ingredient_list, row.ingredients)" in views_source
    assert "ingredientSummary(recipe.ingredient_list, recipe.ingredients)" in views_source
    assert 'className="result-card-detail-label">Recipe<' in views_source
    assert 'className="result-card-detail-value"' in views_source


def test_frontend_uses_dashboard_refresh_and_keeps_metadata_static() -> None:
    app_source = read_frontend("App.tsx")
    type_source = read_frontend("types.ts")

    assert app_source.count("api.getMetadata(") == 1
    assert "api.getDashboard(" in app_source
    assert "api.getDirect(" in app_source
    assert "api.getNear(" in app_source
    assert "outward_sync_path: string;" in type_source
    assert "metadata?.outward_sync_path" in app_source
    assert "C:\\Users\\Alexandra" not in app_source
    assert "api.getOverview(" not in app_source
    assert "api.getInventory(" not in app_source
    assert 'if (!hasBootstrapped || !metadata || activeSection !== "Craft now") return;' not in app_source


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
    assert "refreshCraftNow(selectedStations, sortMode, nearThreshold)" in app_source
    assert "refreshNearResults(selectedStations, nearThreshold)" in app_source
    assert "if (plannerRequested && planTarget.trim())" in app_source
    assert "refreshes.push(executePlanner())" in app_source
    assert "if (shoppingRequested && parseShoppingTargets(shoppingText).length)" in app_source
    assert "refreshes.push(executeShoppingList())" in app_source
    assert "await refreshInventoryDrivenViews();" in app_source
    assert "api.importText(" not in app_source
    assert "handleInventoryMutation(api.importCsv(file))" in app_source
    assert "handleInventoryMutation(api.importLatestOutwardInventory())" in app_source
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
    helper_source = read_frontend("lib/app-utils.ts")

    assert '({ item: item.item, qty: item.qty })' in helper_source
    assert 'headers.join(",")' in helper_source
    assert 'JSON.stringify(row[header] ?? "")' in helper_source


def test_inventory_editor_reads_overview_and_table_from_live_inventory_state() -> None:
    editor_source = read_frontend("components/InventoryEditor.tsx")

    assert "inventory?.unique_items ?? 0" in editor_source
    assert "inventory?.total_quantity ?? 0" in editor_source
    assert "inventoryMap.get(row.item) ?? 0" in editor_source
    assert "filteredCatalogRows.length" in editor_source
    assert "<th>Buffs</th>" in editor_source
    assert 'row.effects || "None"' in editor_source
    assert 'className="inventory-summary-head"' in editor_source
    assert 'className="inventory-table-tools"' in editor_source
    assert 'className="button subtle table-utility-button"' in editor_source
    assert 'className="data-table ingredient-table"' in editor_source


def test_inventory_table_tools_and_headers_use_the_new_layout_contract() -> None:
    editor_source = read_frontend("components/InventoryEditor.tsx")
    css = read_frontend("styles/app.css")

    assert "inventory-manager-shell" in editor_source
    assert "inventory-band" in editor_source
    assert "inventory-band--controls" in editor_source
    assert "inventory-band--table" in editor_source
    assert "inventory-categories-row" in editor_source
    assert "inventory-foot-stat" in editor_source
    assert 'className="inventory-summary-head"' in editor_source
    assert "summary-action-button" in editor_source
    assert 'className="inventory-table-tools"' in editor_source
    assert ".inventory-manager-shell {" in css
    assert ".inventory-band {" in css
    assert ".inventory-band--controls {" in css
    assert ".inventory-band--table {" in css
    assert ".inventory-categories-row {" in css
    assert ".inventory-summary-head {" in css
    assert ".inventory-table-tools {" in css
    assert ".table-utility-button {" in css
    assert ".ingredient-table th," in css or ".ingredient-table th" in css
    assert ".craft-table th," in css or ".craft-table th" in css
    assert "text-align: center;" in css
    assert "overflow-wrap: normal;" in css
    assert ".qty-cell-input {" in css
    assert ".row-action-button {" in css


def test_slider_and_select_styling_contracts_exist() -> None:
    support_rail_source = read_frontend("components/SupportRail.tsx")
    css = read_frontend("styles/app.css")

    assert '.planning-tools-layout input[type="range"] {' in css
    assert "::-webkit-slider-thumb" in css
    assert "::-moz-range-thumb" in css
    assert 'className="planning-range-grid"' in support_rail_source
    assert 'className="compact-range-control"' in support_rail_source
    assert 'className="planning-tools-layout"' in support_rail_source
    assert 'className="planning-group planning-group--stations"' in support_rail_source
    assert 'className="planning-group planning-group--ranges"' in support_rail_source
    assert "Route depth" in support_rail_source
    assert "Missing slots" in support_rail_source
    assert "planning-range-note" in support_rail_source
    assert ".planning-range-grid {" in css
    assert ".compact-range-control {" in css
    assert ".compact-range-value {" in css
    assert ".planning-range-note {" in css
    assert ".panel-select select {" in css
    assert "appearance: none;" in css


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


def test_craft_now_main_view_contains_the_full_craftable_card_panel_and_sort_control() -> None:
    results_source = read_frontend("components/ResultsRail.tsx")
    views_source = read_frontend("components/data-views.tsx")

    assert "<CraftResultsTable" not in results_source
    assert "<BestDirectCards" in results_source
    assert "<h3>Craftable recipes</h3>" in results_source
    assert '<span>Sort craftable recipes</span>' in results_source
    assert 'className="results-section-content"' in results_source
    assert 'className="craftable-card-toolbar"' in results_source
    assert 'className="results-preview results-preview--craftable"' in results_source
    assert "Showing all" in results_source
    assert "Sorting changes order, not inclusion." in results_source
    assert 'className="result-card-topline"' in views_source
    assert 'className="result-card-header-cluster"' in views_source
    assert 'className="result-card-meta result-card-meta--inline"' in views_source
    assert 'className="result-card-detail-grid"' in views_source


def test_long_result_lists_use_internal_scroll_containers_without_changing_column_contract() -> None:
    css = read_frontend("styles/app.css")
    app_source = read_frontend("App.tsx")
    support_rail_source = read_frontend("components/SupportRail.tsx")
    results_source = read_frontend("components/ResultsRail.tsx")

    assert ".results-preview {" in css
    assert "max-height: clamp(8rem, 20vh, 12rem);" in css
    assert "overflow-y: auto;" in css
    assert ".results-preview--craftable {" in css
    assert "max-height: clamp(11rem, 28vh, 18rem);" in css
    assert ".right-column .results-preview:not(.results-preview--craftable)" in css
    assert "grid-template-areas: \"left center right\";" in css
    assert "@media (max-width: 1520px)" in css
    assert "@media (max-width: 1340px)" in css
    assert "\"left center\"" in css
    assert "\"left right\"" in css
    assert "display: grid;" not in css[css.index(".utility-rail__scroll {"):css.index(".main-column,")]
    assert "grid-template-columns:" in css
    assert "clamp(228px, 17vw, 276px)" in css
    assert "minmax(0, 1.16fr)" in css
    assert "minmax(306px, 0.92fr)" in css
    assert 'className="app-page page-shell"' in app_source
    assert 'className={classNames("app-shell", "page-main", leftCollapsed && "left-collapsed")}' in app_source
    assert 'className="utility-rail__scroll"' in support_rail_source
    assert 'className="results-rail right-column"' in results_source


def test_category_chips_stay_on_one_line_with_scroll_instead_of_wrapping() -> None:
    css = read_frontend("styles/app.css")
    editor_source = read_frontend("components/InventoryEditor.tsx")

    assert 'className="chip-group category-chip-row"' in editor_source
    assert ".category-chip-row {" in css
    assert "flex-wrap: nowrap;" in css
    assert "overflow-x: auto;" in css


def test_left_rail_uses_a_scroll_region_so_expanding_one_section_does_not_hide_others() -> None:
    css = read_frontend("styles/app.css")
    support_rail_source = read_frontend("components/SupportRail.tsx")

    assert ".utility-rail {" in css
    assert "display: flex;" in css
    assert "flex-direction: column;" in css
    assert "position: sticky;" in css
    assert "top: 0;" in css
    assert ".utility-rail__header {" in css
    assert ".utility-rail__scroll {" in css
    assert "min-height: 0;" in css
    assert "flex: 1 1 auto;" in css
    assert "overflow-y: auto;" in css
    assert "display: contents" not in css
    assert 'className="utility-rail__header"' in support_rail_source
    assert 'className="utility-rail__scroll"' in support_rail_source


def test_right_rail_cards_are_collapsible_and_can_stay_open_independently() -> None:
    css = read_frontend("styles/app.css")
    results_source = read_frontend("components/ResultsRail.tsx")
    views_source = read_frontend("components/data-views.tsx")

    assert "type RightRailSectionId = " in results_source
    assert "openSections" in results_source
    assert "near: true" in results_source
    assert "results-section-head" in results_source
    assert "results-section-content" in results_source
    assert "results-section-toggle" in results_source
    assert ".results-workspace {" in css
    assert ".results-workspace-section {" in css
    assert ".results-section-head {" in css
    assert "Show more" not in results_source
    assert 'className="result-card-topline"' in views_source
    assert 'className="result-card-side"' in views_source
    assert 'className="result-card-pill"' in views_source
    assert 'className="result-card-detail-grid"' in views_source
    assert 'className="near-card-topline"' in views_source
    assert ".craftable-card-toolbar {" in css
    assert ".results-preview--craftable {" in css


def test_inventory_sync_card_prioritizes_outward_sync_and_keeps_manual_upload_as_fallback() -> None:
    support_rail_source = read_frontend("components/SupportRail.tsx")
    css = read_frontend("styles/app.css")

    assert "Paste text" not in support_rail_source
    assert "Load latest Outward inventory" in support_rail_source
    assert "Upload CSV / Excel" in support_rail_source
    assert "Recommended" in support_rail_source
    assert "Last loaded:" in support_rail_source
    assert "Watched file" in support_rail_source
    assert "Copy path" in support_rail_source
    assert 'className="upload-stack sync-stack"' in support_rail_source
    assert ".upload-stack {" in css
    assert ".bulk-upload-button {" in css
    assert ".sync-status-card {" in css
    assert ".sync-path-text {" in css


def test_planner_view_surfaces_route_status_steps_and_honest_inventory_labels() -> None:
    app_source = read_frontend("App.tsx")
    css = read_frontend("styles/app.css")

    assert "planner-status-strip" in app_source
    assert "Owned and can craft one more now" in app_source
    assert "Complete route with intermediates" in app_source
    assert "Craft one more" in app_source
    assert "Current bag" in app_source
    assert "formatPlannerMode" in app_source
    assert "How to craft one more" in app_source
    assert "planner-owned-strip" in app_source
    assert "Route steps" in app_source
    assert "planner-flow" in app_source
    assert "planner-summary-row" in app_source
    assert "planner-secondary-shell" in app_source
    assert "planner-bag-preview-list" in app_source
    assert "planner-bag-details" in app_source
    assert "Show full bag details" in app_source
    assert "planner-step-list" in app_source
    assert "planner-step-chip" in app_source
    assert "planner-route-shell" in app_source
    assert ".planner-status-strip {" in css
    assert ".planner-owned-strip {" in css
    assert ".planner-summary-row {" in css
    assert ".planner-summary-chip {" in css
    assert ".planner-flow {" in css
    assert ".planner-secondary-shell {" in css
    assert ".planner-bag-scroll {" in css
    assert ".planner-step-list {" in css
    assert ".planner-step-chip.is-missing {" in css


def test_recipe_database_includes_recipe_visibility_debug_and_calls_the_debug_endpoint() -> None:
    app_source = read_frontend("App.tsx")
    api_source = read_frontend("api.ts")
    css = read_frontend("styles/app.css")

    assert "Recipe visibility debug" in app_source
    assert "Uses the shared station filters" in app_source
    assert "Check recipe" in app_source
    assert "setDebugRequested(true);" in app_source
    assert "executeRecipeDebug" in app_source
    assert "api.getRecipeDebug(" in app_source
    assert "getRecipeDebug: (result: string, stations: string[], maxMissingSlots: number, plannerDepth: number) =>" in api_source
    assert "Target in bag" in app_source
    assert "Planner goal" in app_source
    assert "One-more route" in app_source
    assert "Planner mode" in app_source
    assert "planner_alignment_reason" in app_source
    assert "planner_baseline_mode" in app_source
    assert "Sort ranks" in app_source
    assert "Matching recipe rows" in app_source
    assert ".recipe-debug-panel .panel-body {" in css
    assert ".debug-grid {" in css
    assert ".debug-sort-list" in css
    assert ".debug-row-list" in css


def test_import_shortcut_surfaces_success_status_and_json_error_details() -> None:
    app_source = read_frontend("App.tsx")
    api_source = read_frontend("api.ts")
    css = read_frontend("styles/app.css")

    assert "const [statusMessage, setStatusMessage] = useState<string | null>(null);" in app_source
    assert "const [importStatus, setImportStatus] = useState<InventoryImportStatus>(INITIAL_IMPORT_STATUS);" in app_source
    assert 'title: "Latest Outward inventory loaded."' in app_source
    assert 'title: "Latest Outward inventory load failed."' in app_source
    assert "Outward sync path copied." in app_source
    assert 'className="success-banner"' in app_source
    assert "importLatestOutwardInventory: () =>" in api_source
    assert "JSON.parse(detail)" in api_source
    assert ".success-banner {" in css
    assert ".error-banner {" in css


def test_inventory_editor_uses_clearer_export_quick_add_and_table_action_labels() -> None:
    editor_source = read_frontend("components/InventoryEditor.tsx")
    css = read_frontend("styles/app.css")

    assert "Export CSV" in editor_source
    assert "Find an ingredient" in editor_source
    assert "Quantity" in editor_source
    assert 'className="quick-qty-input"' in editor_source
    assert "In bag" in editor_source
    assert "<th>Save</th>" in editor_source
    assert "table-category-tag" in editor_source
    assert "row-apply-button" in editor_source
    assert "row-remove-button" in editor_source
    assert ".quick-qty-input {" in css
    assert ".table-category-tag {" in css
    assert ".row-apply-button {" in css
    assert ".row-remove-button {" in css


def test_scrollbars_are_thin_and_scoped_to_scroll_regions() -> None:
    css = read_frontend("styles/app.css")

    assert "scrollbar-width: thin;" in css
    assert "::-webkit-scrollbar" in css
    assert "width: 6px;" in css
    assert "background: rgba(255, 120, 200, 0.28);" in css


def test_banner_is_full_width_and_centered_in_css() -> None:
    css = read_frontend("styles/app.css")

    assert ".app-page {" in css
    assert "display: flex;" in css
    assert "flex-direction: column;" in css
    assert ".app-banner" in css
    assert "text-align: center" in css
    assert "justify-items: center" in css
    assert "min-height: 6.35rem;" in css
