import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { api } from "./api";
import { InventoryEditor } from "./components/InventoryEditor";
import { ResultsRail } from "./components/ResultsRail";
import { SupportRail } from "./components/SupportRail";
import { TopBanner } from "./components/TopBanner";
import {
  DatabaseTable,
  IngredientGroupsTable,
  InventoryList,
  ItemStatsTable,
  NearCraftTable,
} from "./components/data-views";
import { Panel, classNames } from "./components/ui";
import rawViewConfig from "./view-config.json";
import type {
  DashboardResponse,
  InventoryItem,
  InventoryResponse,
  MetadataResponse,
  PlannerResponse,
  ShoppingListResponse,
} from "./types";

const NAV_ITEMS = ["Craft now", "Plan a target", "Shopping list", "Missing ingredients", "Recipe database"] as const;
const SORT_MODES = [
  "Smart score",
  "Max crafts",
  "Max total output",
  "Healing yield",
  "Stamina yield",
  "Mana yield",
  "Sale value",
  "Result A-Z",
] as const;

type NavItem = (typeof NAV_ITEMS)[number];
type RailSectionId = "snapshot" | "planning" | "bulk" | "data";
type ViewConfigEntry = {
  id: string;
  logic: string;
  summary: string;
  apis?: string[];
  viewState?: string[];
};

const VIEW_CONFIG = rawViewConfig as ViewConfigEntry[];
const VIEW_SUMMARIES = VIEW_CONFIG.reduce<Record<string, string>>((accumulator, entry) => {
  accumulator[entry.id] = entry.summary;
  return accumulator;
}, {});

function parseShoppingTargets(raw: string): Array<{ item: string; qty: number }> {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [item, qty] = line.includes(",") ? line.split(",") : [line, "1"];
      return { item: item.trim(), qty: Math.max(1, Number.parseInt(qty.trim(), 10) || 1) };
    });
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => JSON.stringify(row[header] ?? ""))
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function toggleSelection(current: string[], value: string) {
  return current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
}

function inventoryRows(items: InventoryItem[] | undefined): Array<Record<string, unknown>> {
  return (items ?? []).map((item) => ({ item: item.item, qty: item.qty }));
}

export default function App() {
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardResponse["snapshot"] | null>(null);
  const [bestDirect, setBestDirect] = useState<DashboardResponse["best_direct"] | null>(null);
  const [craftNow, setCraftNow] = useState<DashboardResponse["best_direct"] | null>(null);
  const [near, setNear] = useState<DashboardResponse["near"] | null>(null);
  const [plannerResult, setPlannerResult] = useState<PlannerResponse | null>(null);
  const [shoppingResult, setShoppingResult] = useState<ShoppingListResponse | null>(null);
  const [activeSection, setActiveSection] = useState<NavItem>("Craft now");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [railSections, setRailSections] = useState<Record<RailSectionId, boolean>>({
    snapshot: true,
    planning: true,
    bulk: true,
    data: false,
  });
  const [selectedStations, setSelectedStations] = useState<string[]>([]);
  const [plannerDepth, setPlannerDepth] = useState(5);
  const [nearThreshold, setNearThreshold] = useState(2);
  const [sortMode, setSortMode] = useState<string>("Smart score");
  const [quickAddValue, setQuickAddValue] = useState("");
  const [quickQty, setQuickQty] = useState(1);
  const [showOwnedOnly, setShowOwnedOnly] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [planTarget, setPlanTarget] = useState("");
  const [shoppingText, setShoppingText] = useState("Life Potion,3\nWarm Potion,2");
  const [bulkText, setBulkText] = useState("");
  const [draftQuantities, setDraftQuantities] = useState<Record<string, string>>({});
  const [plannerRequested, setPlannerRequested] = useState(false);
  const [shoppingRequested, setShoppingRequested] = useState(false);
  const [databaseSearch, setDatabaseSearch] = useState("");
  const [databaseStations, setDatabaseStations] = useState<string[]>([]);
  const [databaseCategories, setDatabaseCategories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasBootstrapped, setHasBootstrapped] = useState(false);

  const deferredQuickAddValue = useDeferredValue(quickAddValue);
  const deferredDatabaseSearch = useDeferredValue(databaseSearch);

  const applyDashboard = useCallback((dashboardData: DashboardResponse) => {
    startTransition(() => {
      setInventory(dashboardData.inventory);
      setSnapshot(dashboardData.snapshot);
      setBestDirect(dashboardData.best_direct);
      setNear(dashboardData.near);
    });
  }, []);

  const refreshSharedPanels = useCallback(
    async (stations: string[], currentNearThreshold: number) => {
      const dashboardData = await api.getDashboard(stations, currentNearThreshold);
      applyDashboard(dashboardData);
    },
    [applyDashboard],
  );

  const refreshCraftNow = useCallback(async (stations: string[], currentSortMode: string, currentNearThreshold: number) => {
    const craftNowData = await api.getDirect(currentSortMode, stations, undefined, currentNearThreshold);
    startTransition(() => {
      setCraftNow(craftNowData);
    });
  }, []);

  const toggleRailSection = useCallback((sectionId: RailSectionId) => {
    setRailSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  }, []);

  useEffect(() => {
    async function bootstrap() {
      try {
        const meta = await api.getMetadata();
        const nextStations = [...meta.stations];
        const nextInventoryCategories = meta.categories.map((category) => category.name);
        const nextRecipeCategories = Array.from(
          new Set(meta.recipes.map((recipe) => recipe.category || "Uncategorized")),
        ).sort();
        const recipeTargets = Array.from(new Set(meta.recipes.map((recipe) => recipe.result))).sort();

        setMetadata(meta);
        setSelectedStations(nextStations);
        setSelectedCategories(nextInventoryCategories);
        setDatabaseStations(nextStations);
        setDatabaseCategories(nextRecipeCategories);
        setPlanTarget(recipeTargets[0] ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load app data.");
      } finally {
        setHasBootstrapped(true);
        setIsLoading(false);
      }
    }

    void bootstrap();
  }, []);

  useEffect(() => {
    if (!hasBootstrapped || !metadata) return;
    void refreshSharedPanels(selectedStations, nearThreshold).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to refresh calculator results.");
    });
  }, [hasBootstrapped, metadata, nearThreshold, refreshSharedPanels, selectedStations]);

  useEffect(() => {
    if (!hasBootstrapped || !metadata || activeSection !== "Craft now") return;
    void refreshCraftNow(selectedStations, sortMode, nearThreshold).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to refresh the craftable list.");
    });
  }, [activeSection, hasBootstrapped, metadata, nearThreshold, refreshCraftNow, selectedStations, sortMode]);

  const inventoryMap = useMemo(() => {
    const map = new Map<string, number>();
    inventory?.items.forEach((item) => map.set(item.item, item.qty));
    return map;
  }, [inventory]);

  const allCatalogRows = useMemo(() => {
    if (!metadata) return [];
    return metadata.categories.flatMap((category) =>
      category.items.map((item) => ({
        item,
        category: category.name,
        qty: inventoryMap.get(item) ?? 0,
      })),
    );
  }, [metadata, inventoryMap]);

  const filteredCatalogRows = useMemo(() => {
    const search = deferredQuickAddValue.trim().toLowerCase();
    return allCatalogRows.filter((row) => {
      const categoryMatch = selectedCategories.length === 0 || selectedCategories.includes(row.category);
      const searchMatch = !search || row.item.toLowerCase().includes(search);
      const ownedMatch = !showOwnedOnly || row.qty > 0;
      return categoryMatch && searchMatch && ownedMatch;
    });
  }, [allCatalogRows, deferredQuickAddValue, selectedCategories, showOwnedOnly]);

  const recipeTargets = useMemo(() => {
    if (!metadata) return [];
    return Array.from(new Set(metadata.recipes.map((recipe) => recipe.result))).sort();
  }, [metadata]);

  const recipeCategoryOptions = useMemo(() => {
    if (!metadata) return [];
    return Array.from(new Set(metadata.recipes.map((recipe) => recipe.category || "Uncategorized"))).sort();
  }, [metadata]);

  const filteredDatabaseRecipes = useMemo(() => {
    const search = deferredDatabaseSearch.trim().toLowerCase();
    return (metadata?.recipes ?? []).filter((recipe) => {
      const category = recipe.category || "Uncategorized";
      const categoryMatch = databaseCategories.length === 0 || databaseCategories.includes(category);
      const stationMatch = databaseStations.length > 0 && databaseStations.includes(recipe.station);
      const searchBlob = [recipe.result, recipe.ingredients, recipe.effects, recipe.station, recipe.recipe_page, recipe.section]
        .join(" ")
        .toLowerCase();
      const searchMatch = !search || searchBlob.includes(search);
      return categoryMatch && stationMatch && searchMatch;
    });
  }, [databaseCategories, databaseStations, deferredDatabaseSearch, metadata]);

  const filteredIngredientGroups = useMemo(() => {
    const search = deferredDatabaseSearch.trim().toLowerCase();
    return (metadata?.ingredient_groups ?? []).filter((group) => {
      if (!search) return true;
      return `${group.group} ${group.members.join(" ")}`.toLowerCase().includes(search);
    });
  }, [deferredDatabaseSearch, metadata]);

  const filteredItemStats = useMemo(() => {
    const search = deferredDatabaseSearch.trim().toLowerCase();
    return (metadata?.item_stats ?? []).filter((row) => {
      if (!search) return true;
      return `${row.item} ${row.category} ${row.effects}`.toLowerCase().includes(search);
    });
  }, [deferredDatabaseSearch, metadata]);

  const activeView = VIEW_CONFIG.find((entry) => entry.id === activeSection);
  const activeSummary = VIEW_SUMMARIES[activeSection] ?? "";
  const activeApiSummary = activeView?.apis?.join(" | ") ?? "";
  const stationFilterNote = selectedStations.length
    ? `Stations: ${selectedStations.join(", ")}`
    : "No stations selected. Recipe views will be empty.";

  const executePlanner = useCallback(async () => {
    if (!planTarget) return;
    try {
      setError(null);
      const result = await api.getPlanner(planTarget, plannerDepth, selectedStations);
      setPlannerResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Planner request failed.");
    }
  }, [planTarget, plannerDepth, selectedStations]);

  const executeShoppingList = useCallback(async () => {
    try {
      setError(null);
      const targets = parseShoppingTargets(shoppingText);
      if (!targets.length) {
        setShoppingResult(null);
        return;
      }
      const result = await api.getShoppingList(targets, plannerDepth, selectedStations);
      setShoppingResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Shopping list request failed.");
    }
  }, [plannerDepth, selectedStations, shoppingText]);

  const refreshInventoryDrivenViews = useCallback(async () => {
    const refreshes: Promise<unknown>[] = [refreshSharedPanels(selectedStations, nearThreshold)];
    if (activeSection === "Craft now") {
      refreshes.push(refreshCraftNow(selectedStations, sortMode, nearThreshold));
    }
    if (plannerRequested && planTarget.trim()) {
      refreshes.push(executePlanner());
    }
    if (shoppingRequested && parseShoppingTargets(shoppingText).length) {
      refreshes.push(executeShoppingList());
    }
    const results = await Promise.allSettled(refreshes);
    const failedRefresh = results.find((result) => result.status === "rejected");
    if (failedRefresh?.status === "rejected") {
      throw failedRefresh.reason;
    }
  }, [
    activeSection,
    executePlanner,
    executeShoppingList,
    nearThreshold,
    planTarget,
    plannerRequested,
    refreshCraftNow,
    refreshSharedPanels,
    selectedStations,
    shoppingText,
    shoppingRequested,
    sortMode,
  ]);

  useEffect(() => {
    if (!plannerRequested) return;
    void executePlanner();
  }, [executePlanner, plannerRequested]);

  useEffect(() => {
    if (!shoppingRequested) return;
    void executeShoppingList();
  }, [executeShoppingList, shoppingRequested]);

  const handleInventoryMutation = useCallback(
    async (operation: Promise<InventoryResponse>) => {
      try {
        setError(null);
        const nextInventory = await operation;
        startTransition(() => {
          setInventory(nextInventory);
          if (plannerRequested) setPlannerResult(null);
          if (shoppingRequested) setShoppingResult(null);
        });
        await refreshInventoryDrivenViews();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Inventory update failed.");
      }
    },
    [plannerRequested, refreshInventoryDrivenViews, shoppingRequested],
  );

  const handleQuickAdd = async (event: FormEvent) => {
    event.preventDefault();
    const itemName = metadata?.ingredients.find((item) => item.toLowerCase() === quickAddValue.trim().toLowerCase());
    if (!itemName) {
      setError("Choose a known ingredient from the ingredient search before adding it.");
      return;
    }
    await handleInventoryMutation(api.addInventoryItem(itemName, Math.max(1, quickQty)));
    setQuickAddValue("");
    setQuickQty(1);
  };

  const applyInventoryQty = async (item: string) => {
    const nextValue = Number.parseInt(draftQuantities[item] ?? "", 10);
    if (Number.isNaN(nextValue)) return;
    await handleInventoryMutation(api.setInventoryItem(item, Math.max(0, nextValue)));
    setDraftQuantities((current) => {
      const copy = { ...current };
      delete copy[item];
      return copy;
    });
  };

  const removeInventoryItem = async (item: string) => {
    await handleInventoryMutation(api.setInventoryItem(item, 0));
    setDraftQuantities((current) => {
      const copy = { ...current };
      delete copy[item];
      return copy;
    });
  };

  const handleBulkFile = async (file: File | null) => {
    if (!file) return;
    if (file.name.toLowerCase().endsWith(".csv")) {
      await handleInventoryMutation(api.importCsv(file));
    } else {
      await handleInventoryMutation(api.importExcel(file));
    }
  };

  if (isLoading) {
    return (
      <main className="app-page">
        <div className="loading-shell">Loading the crafting calculator...</div>
      </main>
    );
  }

  return (
    <main className="app-page">
      <TopBanner
        title="Alie's Outward Crafting"
        subtitle="Craft, plan, shop, and browse recipes from one live inventory."
      />

      <div className={classNames("app-shell", leftCollapsed && "left-collapsed")}>
        <SupportRail
          leftCollapsed={leftCollapsed}
          onToggleRail={() => setLeftCollapsed((value) => !value)}
          railSections={railSections}
          onToggleSection={toggleRailSection}
          snapshot={snapshot}
          metadata={metadata}
          selectedStations={selectedStations}
          onToggleStation={(station) => setSelectedStations((current) => toggleSelection(current, station))}
          plannerDepth={plannerDepth}
          onPlannerDepthChange={setPlannerDepth}
          nearThreshold={nearThreshold}
          onNearThresholdChange={setNearThreshold}
          stationFilterNote={stationFilterNote}
          bulkText={bulkText}
          onBulkTextChange={setBulkText}
          onImportText={() => void handleInventoryMutation(api.importText(bulkText))}
          onBulkFile={(file) => void handleBulkFile(file)}
        />

        <section className="main-column">
          <section className="mode-shell">
            <nav className="mode-nav">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={classNames("nav-pill", activeSection === item && "active")}
                  onClick={() => setActiveSection(item)}
                >
                  {item}
                </button>
              ))}
            </nav>

            <div className="mode-note">
              <div>{activeSummary}</div>
              {activeApiSummary ? (
                <span className="mode-info" title={`API: ${activeApiSummary}`}>
                  i
                </span>
              ) : null}
            </div>
          </section>

          {error ? <div className="error-banner">{error}</div> : null}

          {activeSection === "Craft now" ? (
            <>
              <InventoryEditor
                inventory={inventory}
                categories={metadata?.categories ?? []}
                ingredientOptions={metadata?.ingredients ?? []}
                filteredCatalogRows={filteredCatalogRows}
                inventoryMap={inventoryMap}
                quickAddValue={quickAddValue}
                quickQty={quickQty}
                showOwnedOnly={showOwnedOnly}
                selectedCategories={selectedCategories}
                draftQuantities={draftQuantities}
                onQuickAddValueChange={setQuickAddValue}
                onQuickQtyChange={setQuickQty}
                onQuickAdd={handleQuickAdd}
                onToggleCategory={(category) => setSelectedCategories((current) => toggleSelection(current, category))}
                onToggleOwnedOnly={setShowOwnedOnly}
                onClearInventory={() => void handleInventoryMutation(api.replaceInventory([]))}
                onDraftQuantityChange={(item, value) =>
                  setDraftQuantities((current) => ({
                    ...current,
                    [item]: value,
                  }))
                }
                onToggleInventoryItem={(item, nextEnabled, currentQty) =>
                  void handleInventoryMutation(api.setInventoryItem(item, nextEnabled ? Math.max(currentQty, 1) : 0))
                }
                onApplyInventoryQty={(item) => void applyInventoryQty(item)}
                onRemoveInventoryItem={(item) => void removeInventoryItem(item)}
                onDownloadInventoryCsv={() => downloadCsv("outward_inventory.csv", inventoryRows(inventory?.items))}
              />
            </>
          ) : null}

          {activeSection === "Plan a target" ? (
            <Panel title="Plan a target" description="Run the recursive planner against the current inventory.">
              <div className="view-stack">
                <div className="inline-actions view-toolbar">
                  <label className="field grow">
                    <span>Target item</span>
                    <input
                      list="planner-target-options"
                      value={planTarget}
                      onChange={(event) => setPlanTarget(event.target.value)}
                      placeholder="Search for a target item..."
                    />
                    <datalist id="planner-target-options">
                      {recipeTargets.map((target) => (
                        <option key={target} value={target} />
                      ))}
                    </datalist>
                  </label>
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => {
                      setPlannerRequested(true);
                      void executePlanner();
                    }}
                  >
                    Run planner
                  </button>
                </div>
                <div className="info-strip">
                  {plannerResult?.explanation ??
                    "Pick a target to see the best route through the recipes your current inventory can support."}
                </div>
                {plannerResult ? (
                  <>
                    <div className="split-columns">
                      <InventoryList
                        title="Still needed"
                        items={plannerResult.missing}
                        emptyMessage="You already have everything needed for this route."
                      />
                      <InventoryList
                        title="Left in your bag"
                        items={plannerResult.remaining_inventory}
                        emptyMessage="This route would use up every item you committed to the plan."
                      />
                    </div>
                    <div className="info-strip">Follow this route step by step to craft your target with what you have right now.</div>
                    <pre className="code-block">{plannerResult.lines.join("\n") || "You can make this without any extra crafting steps."}</pre>
                  </>
                ) : (
                  <div className="empty-state">Choose a target and run the planner to see a player-friendly craft route.</div>
                )}
              </div>
            </Panel>
          ) : null}

          {activeSection === "Shopping list" ? (
            <Panel title="Shopping list" description="Build a missing-items list for multiple targets.">
              <div className="view-stack">
                <textarea
                  className="bulk-text"
                  value={shoppingText}
                  onChange={(event) => setShoppingText(event.target.value)}
                  placeholder={"Life Potion,3\nWarm Potion,2"}
                />
                <div className="inline-actions view-toolbar">
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => {
                      setShoppingRequested(true);
                      void executeShoppingList();
                    }}
                  >
                    Build list
                  </button>
                </div>
                <div className="info-strip">Targets are combined first. Stations and planner depth decide which extra crafts can cover the gaps.</div>
                {shoppingResult ? (
                  <>
                    <div className="split-columns">
                      <InventoryList title="Requested outputs" items={shoppingResult.targets} emptyMessage="No targets were parsed." />
                      <InventoryList
                        title="Still needed"
                        items={shoppingResult.missing}
                        emptyMessage="You already have enough to cover this build."
                      />
                    </div>
                    <InventoryList
                      title="Left after the build"
                      items={shoppingResult.remaining_inventory}
                      emptyMessage="This build would use up every tracked item."
                    />
                    <div className="info-strip">Use this route as your gather-and-craft checklist for the requested items.</div>
                    <pre className="code-block">{shoppingResult.lines.join("\n") || "No extra shopping steps were needed."}</pre>
                  </>
                ) : (
                  <div className="empty-state">Paste one or more `item,qty` targets and build the shopping list.</div>
                )}
              </div>
            </Panel>
          ) : null}

          {activeSection === "Missing ingredients" ? (
            <Panel title="Missing ingredients" description="Closest valid recipes and the ingredient group still blocking each one.">
              <div className="info-strip">
                Up to {nearThreshold} missing slot{nearThreshold === 1 ? "" : "s"} with the current station filters.
              </div>
              <NearCraftTable rows={near?.items ?? []} emptyMessage="Nothing falls inside the current near-craft threshold." />
            </Panel>
          ) : null}

          {activeSection === "Recipe database" ? (
            <Panel title="Recipe database" description="Search recipes, grouped ingredients, and item metadata.">
              <div className="database-view">
                <div className="database-toolbar">
                  <label className="field grow">
                    <span>Search recipes, groups, or stats</span>
                    <input
                      value={databaseSearch}
                      onChange={(event) => setDatabaseSearch(event.target.value)}
                      placeholder="Search result names, ingredients, effects, pages, or metadata..."
                    />
                  </label>
                </div>
                <div className="database-filter-grid">
                  <div className="toolbar-categories">
                    <span className="toolbar-label">Recipe categories</span>
                    <div className="chip-group">
                      {recipeCategoryOptions.map((category) => {
                        const active = databaseCategories.includes(category);
                        return (
                          <button
                            key={category}
                            type="button"
                            className={classNames("chip", active && "active")}
                            onClick={() => setDatabaseCategories((current) => toggleSelection(current, category))}
                          >
                            {category}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="toolbar-categories">
                    <span className="toolbar-label">Stations</span>
                    <div className="chip-group">
                      {metadata?.stations.map((station) => {
                        const active = databaseStations.includes(station);
                        return (
                          <button
                            key={station}
                            type="button"
                            className={classNames("chip", active && "active")}
                            onClick={() => setDatabaseStations((current) => toggleSelection(current, station))}
                          >
                            {station}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="info-strip">
                  Recipe matches: {filteredDatabaseRecipes.length} of {metadata?.recipe_count ?? 0}.
                </div>
                <DatabaseTable rows={filteredDatabaseRecipes} />
                <div className="database-columns">
                  <Panel title="Ingredient groups" description="Canonical grouped-ingredient slots used by the recipe logic." className="sub-panel">
                    <IngredientGroupsTable groups={filteredIngredientGroups} />
                  </Panel>
                  <Panel title="Item metadata" description="Stats and effects used by the ranking views." className="sub-panel">
                    <ItemStatsTable rows={filteredItemStats} />
                  </Panel>
                </div>
              </div>
            </Panel>
          ) : null}
        </section>

        <ResultsRail
          activeSection={activeSection}
          bestDirect={bestDirect}
          craftNow={craftNow}
          near={near}
          sortMode={sortMode}
          sortModes={SORT_MODES}
          onSortModeChange={setSortMode}
        />
      </div>
    </main>
  );
}
