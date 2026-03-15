import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

import { api } from "./api";
import rawPlanningControls from "./planning-controls.json";
import rawViewConfig from "./view-config.json";
import type {
  DirectResponse,
  IngredientGroup,
  InventoryItem,
  InventoryResponse,
  ItemStat,
  MetadataResponse,
  NearResponse,
  OverviewResponse,
  PlannerResponse,
  RecipeDatabaseRecord,
  RecipeResult,
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
type ViewConfigEntry = {
  id: string;
  logic: string;
  summary: string;
  apis?: string[];
  viewState?: string[];
};

type PlanningControlEntry = {
  id: string;
  label: string;
  summary: string;
  affects: string[];
};

const VIEW_CONFIG = rawViewConfig as ViewConfigEntry[];
const PLANNING_CONTROLS = rawPlanningControls as PlanningControlEntry[];
const VIEW_SUMMARIES = VIEW_CONFIG.reduce<Record<string, string>>((accumulator, entry) => {
  accumulator[entry.id] = entry.summary;
  return accumulator;
}, {});

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

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

function displayGroupName(group: string) {
  return group
    .split(" ")
    .map((token) => (token.startsWith("(") ? token : token.charAt(0).toUpperCase() + token.slice(1)))
    .join(" ")
    .replace("(any)", "(Any)");
}

function StatCard({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value ?? "None"}</strong>
    </div>
  );
}

function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={classNames("panel", className)}>
      <header className="panel-header">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

function RecipeTable({
  rows,
  columns,
  emptyMessage = "No results yet.",
}: {
  rows: RecipeResult[];
  columns: Array<{ key: keyof RecipeResult; label: string }>;
  emptyMessage?: string;
}) {
  if (!rows.length) {
    return <div className="empty-state">{emptyMessage}</div>;
  }
  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.result}-${row.station}-${row.ingredients}`}>
              {columns.map((column) => (
                <td key={column.key}>{String(row[column.key] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function slotLabel(count: number) {
  return `${count} slot${count === 1 ? "" : "s"} missing`;
}

function NearCraftTable({
  rows,
  emptyMessage = "Nothing falls inside the current near-craft threshold.",
  compact = false,
}: {
  rows: RecipeResult[];
  emptyMessage?: string;
  compact?: boolean;
}) {
  if (!rows.length) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className={classNames("table-shell", compact && "near-table-compact")}>
      <table className="data-table near-table">
        <thead>
          <tr>
            <th>Recipe</th>
            <th>{compact ? "Need" : "Near status"}</th>
            <th>{compact ? "Slots" : "Still missing"}</th>
            <th>Station</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const totalSlots = row.ingredient_list.length || row.matched_slots + row.missing_slots;
            return (
              <tr key={`${row.result}-${row.station}-${row.ingredients}`}>
                <td>
                  <div className="near-result-name">{row.result}</div>
                  {!compact ? <div className="table-note">{row.ingredients}</div> : null}
                </td>
                <td>
                  {compact ? (
                    row.missing_items || "See details"
                  ) : (
                    <>
                      <div>{slotLabel(row.missing_slots)}</div>
                      <div className="table-note">
                        {row.matched_slots}/{totalSlots} slots ready
                      </div>
                    </>
                  )}
                </td>
                <td>{compact ? slotLabel(row.missing_slots) : row.missing_items || "Nothing listed"}</td>
                <td>{row.station}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InventoryList({
  title,
  items,
  emptyMessage,
}: {
  title: string;
  items: InventoryItem[];
  emptyMessage: string;
}) {
  return (
    <Panel title={title}>
      <div className="mini-table">
        {items.length ? (
          items.map((item) => (
            <div key={item.item}>
              {item.item} x{item.qty}
            </div>
          ))
        ) : (
          <div>{emptyMessage}</div>
        )}
      </div>
    </Panel>
  );
}

function DatabaseTable({
  rows,
}: {
  rows: RecipeDatabaseRecord[];
}) {
  if (!rows.length) {
    return <div className="empty-state">No recipes match the current database filters.</div>;
  }

  return (
    <div className="table-shell recipe-database-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>Result</th>
            <th>Qty</th>
            <th>Station</th>
            <th>Ingredients</th>
            <th>Effects</th>
            <th>Category</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((recipe) => (
            <tr key={`${recipe.recipe_id}-${recipe.result}-${recipe.station}`}>
              <td>{recipe.result}</td>
              <td>{recipe.result_qty}</td>
              <td>{recipe.station}</td>
              <td>{recipe.ingredients}</td>
              <td>{recipe.effects}</td>
              <td>{recipe.category || "Uncategorized"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IngredientGroupsTable({
  groups,
}: {
  groups: IngredientGroup[];
}) {
  if (!groups.length) {
    return <div className="empty-state">No ingredient groups were loaded.</div>;
  }

  return (
    <div className="table-shell secondary-table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Members</th>
            <th>Count</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.group}>
              <td>{displayGroupName(group.group)}</td>
              <td>{group.members.join(", ")}</td>
              <td>{group.member_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemStatsTable({
  rows,
}: {
  rows: ItemStat[];
}) {
  if (!rows.length) {
    return <div className="empty-state">No item metadata matches the current search.</div>;
  }

  return (
    <div className="table-shell secondary-table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Category</th>
            <th>Heal</th>
            <th>Stamina</th>
            <th>Mana</th>
            <th>Sale</th>
            <th>Effects</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.item}>
              <td>{row.item}</td>
              <td>{row.category || "Uncategorized"}</td>
              <td>{row.heal}</td>
              <td>{row.stamina}</td>
              <td>{row.mana}</td>
              <td>{row.sale_value}</td>
              <td>{row.effects}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [bestDirect, setBestDirect] = useState<DirectResponse | null>(null);
  const [craftNow, setCraftNow] = useState<DirectResponse | null>(null);
  const [near, setNear] = useState<NearResponse | null>(null);
  const [plannerResult, setPlannerResult] = useState<PlannerResponse | null>(null);
  const [shoppingResult, setShoppingResult] = useState<ShoppingListResponse | null>(null);
  const [activeSection, setActiveSection] = useState<NavItem>("Craft now");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
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

  const deferredQuickAddValue = useDeferredValue(quickAddValue);
  const deferredDatabaseSearch = useDeferredValue(databaseSearch);

  const refreshDashboard = useCallback(
    async (stations: string[], currentSortMode: string, currentNearThreshold: number) => {
      const [inventoryData, overviewData, bestDirectData, craftNowData, nearData] = await Promise.all([
        api.getInventory(),
        api.getOverview(stations, currentNearThreshold),
        api.getDirect("Smart score", stations, 8, currentNearThreshold),
        api.getDirect(currentSortMode, stations, 24, currentNearThreshold),
        api.getNear(stations, 30, currentNearThreshold),
      ]);
      setInventory(inventoryData);
      setOverview(overviewData);
      setBestDirect(bestDirectData);
      setCraftNow(craftNowData);
      setNear(nearData);
    },
    [],
  );

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

        await refreshDashboard(nextStations, "Smart score", 2);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load app data.");
      } finally {
        setIsLoading(false);
      }
    }

    void bootstrap();
  }, [refreshDashboard]);

  useEffect(() => {
    if (!metadata) return;
    void refreshDashboard(selectedStations, sortMode, nearThreshold).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to refresh calculator results.");
    });
  }, [metadata, nearThreshold, refreshDashboard, selectedStations, sortMode]);

  const inventorySignature = useMemo(
    () => (inventory?.items ?? []).map((item) => `${item.item}:${item.qty}`).join("|"),
    [inventory],
  );

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

  useEffect(() => {
    if (!plannerRequested) return;
    void executePlanner();
  }, [executePlanner, inventorySignature, plannerRequested]);

  useEffect(() => {
    if (!shoppingRequested) return;
    void executeShoppingList();
  }, [executeShoppingList, inventorySignature, shoppingRequested]);

  const handleInventoryMutation = useCallback(
    async (operation: Promise<unknown>) => {
      try {
        setError(null);
        await operation;
        await refreshDashboard(selectedStations, sortMode, nearThreshold);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Inventory update failed.");
      }
    },
    [nearThreshold, refreshDashboard, selectedStations, sortMode],
  );

  const handleQuickAdd = async (event: React.FormEvent) => {
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
    return <main className="app-shell loading-shell">Loading the crafting calculator...</main>;
  }

  return (
    <main className={classNames("app-shell", leftCollapsed && "left-collapsed")}>
      <aside className="utility-rail">
        <button
          className="rail-toggle"
          type="button"
          onClick={() => setLeftCollapsed((value) => !value)}
          aria-label={leftCollapsed ? "Expand utility rail" : "Collapse utility rail"}
          title={leftCollapsed ? "Expand support rail" : "Collapse support rail"}
        >
          {leftCollapsed ? ">" : "<"}
        </button>
        {!leftCollapsed ? (
          <div className="rail-scroll">
            <header className="rail-header">
              <span className="eyebrow">Support rail</span>
              <h2>Quick tools</h2>
              <p>Live totals, filters, and imports.</p>
            </header>

            <Panel title="Snapshot" description="Live totals from your inventory.">
              <div className="stat-grid two-up">
                <StatCard label="Inventory lines" value={overview?.snapshot.inventory_lines ?? 0} />
                <StatCard label="Known recipes" value={overview?.snapshot.known_recipes ?? 0} />
                <StatCard label="Direct crafts" value={overview?.snapshot.direct_crafts ?? 0} />
                <StatCard label="Near crafts" value={overview?.snapshot.near_crafts ?? 0} />
              </div>
              <div className="stat-grid one-up compact-grid">
                <StatCard label="Best heal" value={overview?.snapshot.best_heal ?? null} />
                <StatCard label="Best stamina" value={overview?.snapshot.best_stamina ?? null} />
                <StatCard label="Best mana" value={overview?.snapshot.best_mana ?? null} />
              </div>
            </Panel>

            <Panel title="Planning tools" description="These settings shape crafting, near-craft, and planning views.">
              <label className="field">
                <span>Planner depth</span>
                <input type="range" min={1} max={8} value={plannerDepth} onChange={(event) => setPlannerDepth(Number(event.target.value))} />
                <strong>{plannerDepth}</strong>
              </label>
              <label className="field">
                <span>Near-craft threshold</span>
                <input
                  type="range"
                  min={1}
                  max={4}
                  value={nearThreshold}
                  onChange={(event) => setNearThreshold(Number(event.target.value))}
                />
                <strong>{nearThreshold} missing slot{nearThreshold === 1 ? "" : "s"}</strong>
              </label>
              <div className="chip-group">
                {metadata?.stations.map((station) => {
                  const active = selectedStations.includes(station);
                  return (
                    <button
                      key={station}
                      type="button"
                      className={classNames("chip", active && "active")}
                      onClick={() => setSelectedStations((current) => toggleSelection(current, station))}
                    >
                      {station}
                    </button>
                  );
                })}
              </div>
              <div className="info-strip">{stationFilterNote}</div>
              <div className="helper-list compact-list">
                {PLANNING_CONTROLS.map((control) => (
                  <div key={control.id}>
                    <strong>{control.label}:</strong> {control.summary}
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="How this works">
              <ul className="helper-list">
                <li>One inventory powers every panel.</li>
                <li>Imports, edits, planner, and shopping stay in sync.</li>
              </ul>
            </Panel>

            <Panel title="Bulk add inventory" description="Paste text or upload CSV / Excel.">
              <textarea
                className="bulk-text compact-text"
                value={bulkText}
                onChange={(event) => setBulkText(event.target.value)}
                placeholder={"Gravel Beetle,2\nClean Water,4"}
              />
              <div className="inline-actions">
                <button type="button" className="button subtle" onClick={() => void handleInventoryMutation(api.importText(bulkText))}>
                  Paste text
                </button>
                <label className="button subtle file-button">
                  Upload CSV / Excel
                  <input
                    type="file"
                    accept=".csv,.xlsx"
                    onChange={(event) => void handleBulkFile(event.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </Panel>

            <Panel title="Data details">
              <div className="helper-list">
                <div>Recipes: {metadata?.recipe_count ?? 0}</div>
                <div>Categories: {metadata?.categories.length ?? 0}</div>
                <div>Groups: {metadata?.ingredient_groups.length ?? 0}</div>
                <div>Stations: {metadata?.stations.length ?? 0}</div>
              </div>
            </Panel>
          </div>
        ) : (
          <div className="rail-peek" aria-hidden="true">
            <span>Tools</span>
          </div>
        )}
      </aside>

      <section className="main-column">
        <header className="hero-card">
          <p className="eyebrow">Outward crafting helper</p>
          <h1>Alie&apos;s Outward Crafting</h1>
          <p>Craft, plan, shop, and browse recipes from one live inventory.</p>
        </header>

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

        <Panel title="Inventory input" className="inventory-panel" description="Add, filter, and edit your live inventory.">
          <Panel title="Inventory overview" className="inline-overview inventory-overview-panel" description="Current totals.">
            <div className="inventory-overview-row">
              <StatCard label="Unique items" value={inventory?.unique_items ?? 0} />
              <StatCard label="Total quantity" value={inventory?.total_quantity ?? 0} />
              <button
                type="button"
                className="button subtle"
                onClick={() => downloadCsv("outward_inventory.csv", inventoryRows(inventory?.items))}
              >
                Download inventory CSV
              </button>
            </div>
            <div className="info-strip">
              {inventory?.items.length
                ? "This inventory powers every panel."
                : "Add items below or use bulk import."}
            </div>
          </Panel>

          <form className="quick-add-row control-strip" onSubmit={(event) => void handleQuickAdd(event)}>
            <label className="field grow">
              <span>Search items</span>
              <input
                list="ingredient-options"
                value={quickAddValue}
                onChange={(event) => setQuickAddValue(event.target.value)}
                placeholder="Find an ingredient..."
              />
              <datalist id="ingredient-options">
                {metadata?.ingredients.map((ingredient) => (
                  <option key={ingredient} value={ingredient} />
                ))}
              </datalist>
            </label>
            <label className="field quantity-field">
              <span>Qty</span>
              <input
                type="number"
                min={1}
                value={quickQty}
                onChange={(event) => setQuickQty(Math.max(1, Number(event.target.value) || 1))}
              />
            </label>
            <button type="submit" className="button primary">
              Add
            </button>
          </form>

          <div className="toolbar-row control-strip toolbar-strip">
            <div className="toolbar-categories">
              <span className="toolbar-label">Categories</span>
              <div className="chip-group">
                {metadata?.categories.map((category) => {
                  const active = selectedCategories.includes(category.name);
                  return (
                    <button
                      key={category.name}
                      type="button"
                      className={classNames("chip", active && "active")}
                      onClick={() => setSelectedCategories((current) => toggleSelection(current, category.name))}
                    >
                      {category.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="owned-toggle">
              <input
                type="checkbox"
                checked={showOwnedOnly}
                onChange={(event) => setShowOwnedOnly(event.target.checked)}
              />
              <span>Owned only</span>
            </label>
            <button type="button" className="button subtle" onClick={() => void handleInventoryMutation(api.replaceInventory([]))}>
              Clear
            </button>
          </div>

          {filteredCatalogRows.length ? (
            <>
              <div className="info-strip inventory-table-note">Edit qty, then Apply. Remove clears the item.</div>
              <div className="table-shell ingredient-table-shell">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Have it</th>
                      <th>Ingredient</th>
                      <th>Category</th>
                      <th>Qty</th>
                      <th>Apply</th>
                      <th>Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCatalogRows.map((row) => {
                      const currentQty = inventoryMap.get(row.item) ?? 0;
                      const draftValue = draftQuantities[row.item] ?? String(currentQty);
                      return (
                        <tr key={row.item}>
                          <td>
                            <input
                              type="checkbox"
                              checked={currentQty > 0}
                              onChange={(event) =>
                                void handleInventoryMutation(api.setInventoryItem(row.item, event.target.checked ? Math.max(currentQty, 1) : 0))
                              }
                            />
                          </td>
                          <td>{row.item}</td>
                          <td>{row.category}</td>
                          <td>
                            <input
                              className="qty-input"
                              type="number"
                              min={0}
                              value={draftValue}
                              onChange={(event) =>
                                setDraftQuantities((current) => ({
                                  ...current,
                                  [row.item]: event.target.value,
                                }))
                              }
                            />
                          </td>
                          <td>
                            <button type="button" className="button subtle tiny" onClick={() => void applyInventoryQty(row.item)}>
                              Apply
                            </button>
                          </td>
                          <td>
                            <button type="button" className="button subtle tiny" onClick={() => void removeInventoryItem(row.item)}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="empty-state">No ingredients match the current search and category filters.</div>
          )}

          <div className="stat-grid four-up">
            <StatCard label="Categories shown" value={(selectedCategories.length || metadata?.categories.length) ?? 0} />
            <StatCard label="Visible now" value={filteredCatalogRows.length} />
            <StatCard label="Selected total" value={inventory?.total_quantity ?? 0} />
            <StatCard label="Unique selected" value={inventory?.unique_items ?? 0} />
          </div>
        </Panel>

        {activeSection === "Craft now" ? (
          <Panel title="What you can craft right now" description="Direct crafts from your current inventory.">
            <div className="inline-actions">
              <label className="field inline-field grow">
                <span>Sort results by</span>
                <select value={sortMode} onChange={(event) => setSortMode(event.target.value)}>
                  {SORT_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                ))}
                </select>
              </label>
            </div>
            <div className="info-strip">Sort by overall utility, output, or a single stat.</div>
            <RecipeTable
              rows={craftNow?.items ?? []}
              columns={[
                { key: "result", label: "Item" },
                { key: "max_crafts", label: "Crafts" },
                { key: "max_total_output", label: "Total output" },
                { key: "station", label: "Station" },
                { key: "effects", label: "Effects" },
              ]}
              emptyMessage="No recipes are directly craftable with the current inventory and station filters."
            />
          </Panel>
        ) : null}

        {activeSection === "Plan a target" ? (
          <Panel title="Plan a target" description="Plan one target with inventory-first recursion.">
            <div className="inline-actions">
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
                "Uses your inventory first. Stations change recipes; depth changes recursion."}
            </div>
            {plannerResult ? (
              <>
                <div className="split-columns">
                  <InventoryList
                    title="Missing leaves"
                    items={plannerResult.missing}
                    emptyMessage="Nothing missing. The planner found a complete path."
                  />
                  <InventoryList
                    title="Remaining inventory"
                    items={plannerResult.remaining_inventory}
                    emptyMessage="No inventory would remain after this one-target plan."
                  />
                </div>
                <pre className="code-block">{plannerResult.lines.join("\n") || "No planner steps available."}</pre>
              </>
            ) : (
              <div className="empty-state">Choose a target and run the planner to see the recursive plan tree.</div>
            )}
          </Panel>
        ) : null}

        {activeSection === "Shopping list" ? (
          <Panel title="Shopping list" description="Build a missing-items list for multiple targets.">
            <textarea
              className="bulk-text"
              value={shoppingText}
              onChange={(event) => setShoppingText(event.target.value)}
              placeholder={"Life Potion,3\nWarm Potion,2"}
            />
            <div className="inline-actions">
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
            <div className="info-strip">Targets are combined first. Stations and depth shape intermediate crafting.</div>
            {shoppingResult ? (
              <>
                <div className="split-columns">
                  <InventoryList title="Targets" items={shoppingResult.targets} emptyMessage="No targets were parsed." />
                  <InventoryList
                    title="Missing ingredients"
                    items={shoppingResult.missing}
                    emptyMessage="Nothing missing. The current inventory can satisfy this build."
                  />
                </div>
                <InventoryList
                  title="Remaining inventory after the build"
                  items={shoppingResult.remaining_inventory}
                  emptyMessage="No items would remain after fulfilling the targets."
                />
                <pre className="code-block">{shoppingResult.lines.join("\n") || "No shopping plan lines available."}</pre>
              </>
            ) : (
              <div className="empty-state">Paste one or more `item,qty` targets and build the shopping list.</div>
            )}
          </Panel>
        ) : null}

        {activeSection === "Missing ingredients" ? (
          <Panel title="Almost craftable recipes" description="Closest valid recipes from your current inventory.">
            <div className="info-strip">
              Up to {nearThreshold} missing slot{nearThreshold === 1 ? "" : "s"}. The table shows what is still blocking each recipe.
            </div>
            <NearCraftTable
              rows={near?.items ?? []}
              emptyMessage="Nothing falls inside the current near-craft threshold."
            />
          </Panel>
        ) : null}

        {activeSection === "Recipe database" ? (
          <Panel title="Recipe database" description="Search recipes, groups, and item stats.">
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
              <Panel title="Ingredient groups" description="Canonical grouped-ingredient slots used by recipe logic.">
                <IngredientGroupsTable groups={filteredIngredientGroups} />
              </Panel>
              <Panel title="Item metadata" description="Healing, stamina, mana, sale-value, and effects used by ranking views.">
                <ItemStatsTable rows={filteredItemStats} />
              </Panel>
            </div>
          </Panel>
        ) : null}
      </section>

      <aside className="results-rail">
        <Panel title="Best direct options" description="Top direct results for the current filters.">
          <div className="stat-grid two-up">
            <StatCard label="Direct crafts" value={bestDirect?.count ?? 0} />
            <StatCard label="Near crafts" value={bestDirect?.near_count ?? 0} />
          </div>
          <RecipeTable
            rows={bestDirect?.items ?? []}
            columns={[
              { key: "result", label: "Item" },
              { key: "max_crafts", label: "Crafts" },
              { key: "station", label: "Station" },
            ]}
            emptyMessage="No direct recommendations are available for the current filters."
          />
        </Panel>

        <Panel title="Almost craftable recipes" description="Closest valid recipes under the current threshold.">
          <div className="stat-grid two-up">
            <StatCard label="Near crafts" value={near?.count ?? 0} />
            <StatCard label="Known recipes" value={near?.known_recipes ?? 0} />
          </div>
          <NearCraftTable
            compact
            rows={near?.items ?? []}
            emptyMessage="No recipes are currently inside the selected near-craft threshold."
          />
        </Panel>

        <Panel title="What you can craft right now" description="Live craftable list from your current inventory.">
          <RecipeTable
            rows={craftNow?.items ?? []}
            columns={[
              { key: "result", label: "Item" },
              { key: "max_total_output", label: "Output" },
              { key: "station", label: "Station" },
            ]}
            emptyMessage="No craftable recipes match the current inventory and station filters."
          />
        </Panel>
      </aside>
    </main>
  );
}
