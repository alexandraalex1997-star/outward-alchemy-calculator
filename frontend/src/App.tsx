import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { api } from "./api";
import {
  NAV_ITEMS,
  SORT_MODES,
  VIEW_CONFIG,
  VIEW_SUMMARIES,
} from "./lib/app-config";
import {
  buildCatalogRows,
  buildInventoryMap,
  buildItemStatsMap,
  buildRecipeCategoryOptions,
  buildRecipeTargets,
  createStationFilterNote,
  deriveMetadataDefaults,
  filterCatalogRows,
  filterDatabaseRecipes,
  filterIngredientGroups,
  filterItemStats,
} from "./lib/app-selectors";
import { downloadCsv, inventoryRows, parseShoppingTargets, toggleSelection } from "./lib/app-utils";
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
import { Panel, StatCard, classNames } from "./components/ui";
import type {
  DashboardResponse,
  DirectResponse,
  InventoryResponse,
  InventoryItem,
  MetadataResponse,
  NearResponse,
  PlannerResponse,
  RecipeDebugResponse,
  ShoppingListResponse,
} from "./types";
import type { NavItem, RailSectionId } from "./lib/app-config";

type InventoryImportSource = "Outward sync" | "Manual upload";

type InventoryImportStatus = {
  tone: "idle" | "success" | "error";
  title: string;
  detail: string;
  lastLoadedSource: string;
  lastAttemptedSource: InventoryImportSource | null;
};

type InventoryMutationResult = { ok: true } | { ok: false; message: string };
type PlannerStepKind = "craft" | "use" | "group" | "missing" | "note";
type PlannerDisplayStep = {
  indent: number;
  kind: PlannerStepKind;
  text: string;
  raw: string;
};

const INITIAL_IMPORT_STATUS: InventoryImportStatus = {
  tone: "idle",
  title: "Ready to sync inventory.",
  detail: "Use Outward sync to pull the newest mod export.",
  lastLoadedSource: "Not loaded yet",
  lastAttemptedSource: null,
};

function parsePlannerSteps(lines: string[]): PlannerDisplayStep[] {
  return lines
    .map((rawLine) => rawLine.replace(/\r/g, ""))
    .filter((rawLine) => rawLine.trim().length > 0)
    .map((rawLine) => {
      const indentMatch = rawLine.match(/^(\s*)/);
      const indent = Math.floor((indentMatch?.[1].length ?? 0) / 2);
      const trimmed = rawLine.trim().replace(/^- /, "");

      let kind: PlannerStepKind = "note";
      if (trimmed.startsWith("Craft ")) {
        kind = "craft";
      } else if (trimmed.startsWith("Use existing:")) {
        kind = "use";
      } else if (trimmed.startsWith("Fill group")) {
        kind = "group";
      } else if (trimmed.startsWith("Missing ingredient")) {
        kind = "missing";
      }

      return {
        indent,
        kind,
        text: trimmed,
        raw: rawLine,
      };
    });
}

function plannerStatusTone(found: boolean, stepCount: number): "success" | "warning" | "error" {
  if (found) return "success";
  if (stepCount > 0) return "warning";
  return "error";
}

function plannerStepLabel(kind: PlannerStepKind): string {
  switch (kind) {
    case "craft":
      return "Craft";
    case "use":
      return "Use";
    case "group":
      return "Group";
    case "missing":
      return "Missing";
    default:
      return "Note";
  }
}

function formatDebugMetric(value: number | string | null | undefined): string {
  if (value == null) return "None";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  return value;
}

function formatPlannerMode(mode: string): string {
  switch (mode) {
    case "use_existing_target":
      return "Already in bag";
    case "direct_craft_route":
      return "Direct craft";
    case "recursive_craft_route":
      return "Recursive craft";
    case "station_filtered_out":
      return "Station blocked";
    case "partial_route":
      return "Partial route";
    default:
      return "No route";
  }
}

function sortInventoryPreview(items: InventoryItem[]): InventoryItem[] {
  return [...items].sort((left, right) => {
    if (right.qty !== left.qty) {
      return right.qty - left.qty;
    }
    return left.item.localeCompare(right.item);
  });
}

export default function App() {
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardResponse["snapshot"] | null>(null);
  const [craftNow, setCraftNow] = useState<DirectResponse | null>(null);
  const [near, setNear] = useState<NearResponse | null>(null);
  const [plannerResult, setPlannerResult] = useState<PlannerResponse | null>(null);
  const [recipeDebugResult, setRecipeDebugResult] = useState<RecipeDebugResponse | null>(null);
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
  const [debugRecipe, setDebugRecipe] = useState("");
  const [shoppingText, setShoppingText] = useState("Life Potion,3\nWarm Potion,2");
  const [draftQuantities, setDraftQuantities] = useState<Record<string, string>>({});
  const [plannerRequested, setPlannerRequested] = useState(false);
  const [debugRequested, setDebugRequested] = useState(false);
  const [debugPanelExpanded, setDebugPanelExpanded] = useState(false);
  const [shoppingRequested, setShoppingRequested] = useState(false);
  const [databaseSearch, setDatabaseSearch] = useState("");
  const [databaseStations, setDatabaseStations] = useState<string[]>([]);
  const [databaseCategories, setDatabaseCategories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<InventoryImportStatus>(INITIAL_IMPORT_STATUS);
  const [isLoading, setIsLoading] = useState(true);
  const [hasBootstrapped, setHasBootstrapped] = useState(false);

  const deferredQuickAddValue = useDeferredValue(quickAddValue);
  const deferredDatabaseSearch = useDeferredValue(databaseSearch);

  const applyDashboard = useCallback((dashboardData: DashboardResponse) => {
    startTransition(() => {
      setInventory(dashboardData.inventory);
      setSnapshot(dashboardData.snapshot);
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

  const refreshNearResults = useCallback(async (stations: string[], currentNearThreshold: number) => {
    const nearData = await api.getNear(stations, undefined, currentNearThreshold);
    startTransition(() => {
      setNear(nearData);
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
        const defaults = deriveMetadataDefaults(meta);

        setMetadata(meta);
        setSelectedStations(defaults.stations);
        setSelectedCategories(defaults.inventoryCategories);
        setDatabaseStations(defaults.stations);
        setDatabaseCategories(defaults.recipeCategories);
        setPlanTarget(defaults.recipeTargets[0] ?? "");
        setDebugRecipe(meta.recipes.some((recipe) => recipe.result === "Astral Potion") ? "Astral Potion" : defaults.recipeTargets[0] ?? "");
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
    if (!hasBootstrapped || !metadata) return;
    void refreshCraftNow(selectedStations, sortMode, nearThreshold).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to refresh the craftable list.");
    });
  }, [hasBootstrapped, metadata, nearThreshold, refreshCraftNow, selectedStations, sortMode]);

  useEffect(() => {
    if (!hasBootstrapped || !metadata) return;
    void refreshNearResults(selectedStations, nearThreshold).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to refresh the near-craft list.");
    });
  }, [hasBootstrapped, metadata, nearThreshold, refreshNearResults, selectedStations]);

  const inventoryMap = useMemo(() => {
    return buildInventoryMap(inventory?.items);
  }, [inventory]);

  const itemStatsMap = useMemo(() => {
    return buildItemStatsMap(metadata?.item_stats);
  }, [metadata]);

  const allCatalogRows = useMemo(() => {
    return buildCatalogRows(metadata?.categories, inventoryMap, itemStatsMap);
  }, [itemStatsMap, inventoryMap, metadata]);

  const filteredCatalogRows = useMemo(() => {
    return filterCatalogRows(allCatalogRows, deferredQuickAddValue, selectedCategories, showOwnedOnly);
  }, [allCatalogRows, deferredQuickAddValue, selectedCategories, showOwnedOnly]);

  const recipeTargets = useMemo(() => {
    return buildRecipeTargets(metadata?.recipes);
  }, [metadata]);

  const recipeCategoryOptions = useMemo(() => {
    return buildRecipeCategoryOptions(metadata?.recipes);
  }, [metadata]);

  const filteredDatabaseRecipes = useMemo(() => {
    return filterDatabaseRecipes(metadata?.recipes, deferredDatabaseSearch, databaseStations, databaseCategories);
  }, [databaseCategories, databaseStations, deferredDatabaseSearch, metadata]);

  const filteredIngredientGroups = useMemo(() => {
    return filterIngredientGroups(metadata?.ingredient_groups, deferredDatabaseSearch);
  }, [deferredDatabaseSearch, metadata]);

  const filteredItemStats = useMemo(() => {
    return filterItemStats(metadata?.item_stats, deferredDatabaseSearch);
  }, [deferredDatabaseSearch, metadata]);

  const activeView = VIEW_CONFIG.find((entry) => entry.id === activeSection);
  const activeSummary = VIEW_SUMMARIES[activeSection] ?? "";
  const activeApiSummary = activeView?.apis?.join(" | ") ?? "";
  const outwardSyncPath = metadata?.outward_sync_path ?? String.raw`Documents\OutwardCraftSync\current_inventory.csv`;
  const stationFilterNote = createStationFilterNote(selectedStations);
  const plannerSteps = useMemo(() => parsePlannerSteps(plannerResult?.lines ?? []), [plannerResult]);
  const plannerMissingTotal = useMemo(
    () => (plannerResult?.missing ?? []).reduce((sum, item) => sum + item.qty, 0),
    [plannerResult],
  );
  const plannerRemainingItems = useMemo(() => plannerResult?.remaining_inventory ?? [], [plannerResult]);
  const plannerRemainingTotal = useMemo(
    () => plannerRemainingItems.reduce((sum, item) => sum + item.qty, 0),
    [plannerRemainingItems],
  );
  const plannerOwnedQty = plannerResult?.target_owned_qty ?? 0;
  const plannerRemainingUnique = plannerRemainingItems.length;
  const plannerBagPreviewItems = useMemo(() => sortInventoryPreview(plannerRemainingItems).slice(0, 6), [plannerRemainingItems]);
  const plannerHiddenBagCount = Math.max(0, plannerRemainingItems.length - plannerBagPreviewItems.length);
  const plannerActionStepCount = useMemo(
    () => plannerSteps.filter((step) => step.kind !== "note").length,
    [plannerSteps],
  );
  const plannerTone = useMemo(
    () => plannerStatusTone(plannerResult?.found ?? false, plannerSteps.length),
    [plannerResult, plannerSteps.length],
  );
  const plannerGoalLabel = useMemo(() => {
    if (!plannerResult) return "Obtain target";
    return plannerResult.planning_goal === "craft_one_more" ? "Craft one more" : "Obtain target";
  }, [plannerResult]);
  const plannerStatusTitle = useMemo(() => {
    if (!plannerResult) return "";
    if (plannerResult.already_owned && plannerResult.found && plannerResult.mode === "direct_craft_route") {
      return "Owned and can craft one more now";
    }
    if (plannerResult.already_owned && plannerResult.found) {
      return "Owned and one-more route found";
    }
    if (plannerResult.already_owned && plannerSteps.length) {
      return "Owned but one-more route is partial";
    }
    if (plannerResult.already_owned) {
      return "Owned but one-more route is blocked";
    }
    if (plannerResult.found) {
      return plannerResult.mode === "recursive_craft_route" ? "Complete route with intermediates" : "Direct craft ready";
    }
    if (plannerSteps.length) {
      return "Partial route shown";
    }
    return "No route available";
  }, [plannerResult, plannerSteps.length]);
  const plannerStatusPill = useMemo(() => {
    if (!plannerResult) return "";
    if (plannerResult.already_owned && plannerResult.found) {
      return "Can craft +1";
    }
    if (plannerResult.already_owned) {
      return "Need items for +1";
    }
    if (plannerResult.found && plannerResult.requires_crafting) {
      return "Ready to craft";
    }
    if (plannerResult.found) {
      return "Ready now";
    }
    if (plannerSteps.length) {
      return "Needs items";
    }
    return "Blocked";
  }, [plannerResult, plannerSteps.length]);
  const plannerBagTitle = useMemo(() => {
    if (!plannerResult) return "Current bag";
    if (plannerResult.already_owned && plannerResult.planning_goal === "craft_one_more") {
      return plannerResult.found ? "Bag after reserving +1" : "Current bag";
    }
    if (!plannerResult.found) return "Bag shown";
    return "Bag after route";
  }, [plannerResult]);
  const plannerBagNote = useMemo(() => {
    if (!plannerResult) return "";
    if (plannerResult.already_owned && plannerResult.planning_goal === "craft_one_more") {
      if (!plannerResult.found) {
        return "Current bag snapshot while planning one additional copy.";
      }
      return "Owned copies are preserved while the planner reserves ingredients for one more.";
    }
    if (!plannerResult.found) {
      return "Current inventory snapshot used for this partial result.";
    }
    return "What remains after following the route.";
  }, [plannerResult]);
  const plannerRouteHint = useMemo(() => {
    if (!plannerResult) return "";
    if (plannerResult.already_owned && plannerResult.planning_goal === "craft_one_more") {
      return plannerResult.found ? "Route for one additional copy." : "Closest branch toward one additional copy.";
    }
    if (plannerResult.found) {
      return "Follow these lines in order.";
    }
    return "Missing requirements are marked inline.";
  }, [plannerResult]);
  const plannerBagEmptyMessage = useMemo(() => {
    if (!plannerResult) return "No bag details available yet.";
    if (plannerResult.already_owned && plannerResult.planning_goal === "craft_one_more") {
      return plannerResult.found
        ? "This one-more route would consume every tracked item it needs."
        : "No bag items are reserved until the missing requirements are met.";
    }
    if (!plannerResult.found) return "The planner keeps the current bag unchanged when no full route is found.";
    return "This route would use up every tracked item it needs.";
  }, [plannerResult]);
  const plannerStepNote = useMemo(() => {
    if (!plannerResult) return "";
    if (plannerResult.already_owned && plannerResult.planning_goal === "craft_one_more") {
      if (!plannerActionStepCount) {
        return plannerResult.found
          ? "One more copy is immediately available with current ingredients."
          : "No confirmed one-more route lines yet.";
      }
      if (plannerResult.craft_steps > 0) {
        return `${plannerResult.craft_steps} craft action${plannerResult.craft_steps === 1 ? "" : "s"} to make one additional copy.`;
      }
      return `${plannerActionStepCount} one-more route step${plannerActionStepCount === 1 ? "" : "s"} traced by the planner.`;
    }
    if (!plannerActionStepCount) {
      return plannerResult.found ? "The route is immediate with the current inventory." : "No confirmed route lines yet.";
    }
    if (plannerResult.craft_steps > 0) {
      return `${plannerResult.craft_steps} craft action${plannerResult.craft_steps === 1 ? "" : "s"} inside ${plannerActionStepCount} route step${plannerActionStepCount === 1 ? "" : "s"}.`;
    }
    return `${plannerActionStepCount} route step${plannerActionStepCount === 1 ? "" : "s"} traced by the planner.`;
  }, [plannerActionStepCount, plannerResult]);

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

  const executeRecipeDebug = useCallback(async () => {
    if (!debugRecipe.trim()) return;
    try {
      setError(null);
      const result = await api.getRecipeDebug(debugRecipe, selectedStations, nearThreshold, plannerDepth);
      setRecipeDebugResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recipe visibility debug failed.");
    }
  }, [debugRecipe, nearThreshold, plannerDepth, selectedStations]);

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
    const refreshes: Promise<unknown>[] = [
      refreshSharedPanels(selectedStations, nearThreshold),
      refreshCraftNow(selectedStations, sortMode, nearThreshold),
      refreshNearResults(selectedStations, nearThreshold),
    ];
    if (plannerRequested && planTarget.trim()) {
      refreshes.push(executePlanner());
    }
    if (debugRequested && debugRecipe.trim()) {
      refreshes.push(executeRecipeDebug());
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
    debugRecipe,
    debugRequested,
    executePlanner,
    executeRecipeDebug,
    executeShoppingList,
    nearThreshold,
    planTarget,
    plannerRequested,
    refreshCraftNow,
    refreshNearResults,
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
    if (!debugRequested) return;
    void executeRecipeDebug();
  }, [debugRequested, executeRecipeDebug]);

  useEffect(() => {
    if (!shoppingRequested) return;
    void executeShoppingList();
  }, [executeShoppingList, shoppingRequested]);

  useEffect(() => {
    if (!statusMessage) return;
    const timeoutId = window.setTimeout(() => setStatusMessage(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [statusMessage]);

  const handleInventoryMutation = useCallback(
    async (operation: Promise<InventoryResponse>) => {
      try {
        setStatusMessage(null);
        setError(null);
        const nextInventory = await operation;
        startTransition(() => {
          setInventory(nextInventory);
          if (plannerRequested) setPlannerResult(null);
          if (debugRequested) setRecipeDebugResult(null);
          if (shoppingRequested) setShoppingResult(null);
        });
        await refreshInventoryDrivenViews();
        const result: InventoryMutationResult = { ok: true };
        return result;
      } catch (err) {
        setStatusMessage(null);
        const message = err instanceof Error ? err.message : "Inventory update failed.";
        setError(message);
        const result: InventoryMutationResult = { ok: false, message };
        return result;
      }
    },
    [debugRequested, plannerRequested, refreshInventoryDrivenViews, shoppingRequested],
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
    const imported = file.name.toLowerCase().endsWith(".csv")
      ? await handleInventoryMutation(api.importCsv(file))
      : await handleInventoryMutation(api.importExcel(file));
    if (imported.ok) {
      setImportStatus({
        tone: "success",
        title: "Manual inventory import succeeded.",
        detail: `Imported ${file.name} into the live inventory.`,
        lastLoadedSource: `Manual upload (${file.name})`,
        lastAttemptedSource: "Manual upload",
      });
      setStatusMessage(`Inventory loaded from ${file.name}.`);
      return;
    }
    setImportStatus((current) => ({
      ...current,
      tone: "error",
      title: "Manual inventory import failed.",
      detail: imported.message,
      lastAttemptedSource: "Manual upload",
    }));
  };

  const handleLatestOutwardInventory = async () => {
    const imported = await handleInventoryMutation(api.importLatestOutwardInventory());
    if (imported.ok) {
      setImportStatus({
        tone: "success",
        title: "Latest Outward inventory loaded.",
        detail: "Imported the newest mod export from your Documents sync folder.",
        lastLoadedSource: "Outward sync",
        lastAttemptedSource: "Outward sync",
      });
      setStatusMessage("Latest Outward inventory loaded.");
      return;
    }
    setImportStatus((current) => ({
      ...current,
      tone: "error",
      title: "Latest Outward inventory load failed.",
      detail: imported.message,
      lastAttemptedSource: "Outward sync",
    }));
  };

  const handleCopyOutwardSyncPath = async () => {
    try {
      await navigator.clipboard.writeText(outwardSyncPath);
      setError(null);
      setStatusMessage("Outward sync path copied.");
    } catch {
      setError("Could not copy the Outward sync path. You can still select it manually.");
    }
  };

  if (isLoading) {
    return (
      <main className="app-page page-shell">
        <div className="loading-shell">Loading the crafting calculator...</div>
      </main>
    );
  }

  return (
    <main className="app-page page-shell">
      <div className="page-hero">
        <TopBanner
          title="Alie's Outward Crafting"
          subtitle="Craft, plan, shop, and browse recipes from one live inventory."
        />
      </div>

      <div className={classNames("app-shell", "page-main", leftCollapsed && "left-collapsed")}>
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
          importStatus={importStatus}
          outwardSyncPath={outwardSyncPath}
          onBulkFile={(file) => void handleBulkFile(file)}
          onLoadLatestOutwardInventory={() => void handleLatestOutwardInventory()}
          onCopyOutwardSyncPath={() => void handleCopyOutwardSyncPath()}
        />

        <section className="main-column center-column">
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

          {error ? (
            <div className="error-banner" role="alert">
              {error}
            </div>
          ) : null}
          {!error && statusMessage ? (
            <div className="success-banner" role="status" aria-live="polite">
              {statusMessage}
            </div>
          ) : null}

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
            <Panel title="Plan a target" description="Plan the next practical route for one target. If it is already owned, this focuses on one more copy.">
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
                {plannerResult ? (
                  <div className="planner-flow">
                    <div className={classNames("planner-status-strip", `is-${plannerTone}`)}>
                      <div className="planner-status-copy">
                        <span className="planner-status-kicker">Target: {plannerResult.target || planTarget}</span>
                        <strong>{plannerStatusTitle}</strong>
                        <p>{plannerResult.explanation}</p>
                      </div>
                      <div className="planner-status-meta">
                        <span className="planner-status-pill">{plannerStatusPill}</span>
                        <span className="planner-mode-pill">{formatPlannerMode(plannerResult.mode)}</span>
                      </div>
                    </div>

                    {plannerResult.already_owned ? (
                      <div className="info-strip planner-owned-strip">
                        You currently own {plannerOwnedQty} {plannerOwnedQty === 1 ? "copy" : "copies"} of {plannerResult.target}. Planner goal:{" "}
                        {plannerGoalLabel.toLowerCase()}.
                      </div>
                    ) : null}

                    <div className="planner-summary-row">
                      <div className="planner-summary-chip">
                        <span>Planner goal</span>
                        <strong>{plannerGoalLabel}</strong>
                      </div>
                      <div className="planner-summary-chip">
                        <span>Route steps</span>
                        <strong>{plannerActionStepCount}</strong>
                      </div>
                      <div className="planner-summary-chip">
                        <span>Craft steps</span>
                        <strong>{plannerResult.craft_steps}</strong>
                      </div>
                      <div className="planner-summary-chip planner-summary-chip--missing">
                        <span>Still needed</span>
                        <strong>{plannerMissingTotal}</strong>
                      </div>
                    </div>

                    <section className="planner-route-shell planner-route-shell--primary">
                      <div className="planner-route-head">
                        <strong>{plannerResult.already_owned ? "How to craft one more" : "Route steps"}</strong>
                        <span>{plannerRouteHint}</span>
                      </div>
                      <p className="planner-route-note">{plannerStepNote}</p>
                      {plannerResult.already_owned ? (
                        <p className="planner-route-note">
                          You already own this target. These steps focus on producing one additional copy using the current inventory and station
                          filters.
                        </p>
                      ) : null}
                      {!plannerResult.found && plannerSteps.length ? (
                        <p className="planner-route-note">
                          This is the closest route the planner could prove with the current bag and filters. It stops where required ingredients
                          run out.
                        </p>
                      ) : null}
                      {plannerSteps.length ? (
                        <div className="planner-step-list">
                          {plannerSteps.map((step, index) => (
                            <div key={`${index}-${step.raw}`} className={classNames("planner-step", `is-${step.kind}`)}>
                              <div className="planner-step-line" style={{ paddingLeft: `${step.indent * 1.1}rem` }}>
                                <span className={classNames("planner-step-chip", `is-${step.kind}`)}>
                                  {plannerStepLabel(step.kind)}
                                </span>
                                <span className="planner-step-text">{step.text}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state">No additional route lines were needed for this target.</div>
                      )}
                    </section>

                    <section className="planner-needed-shell planner-needed-shell--primary">
                      <div className="planner-route-head">
                        <strong>Still needed</strong>
                        <span>
                          {plannerResult.missing.length
                            ? `${plannerResult.missing.length} missing item${plannerResult.missing.length === 1 ? "" : "s"}`
                            : "Nothing missing"}
                        </span>
                      </div>
                      {plannerResult.missing.length ? (
                        <div className="mini-table planner-needed-list">
                          {plannerResult.missing.map((item) => (
                            <div key={item.item}>
                              {item.item} x{item.qty}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state">You already have everything needed for this route.</div>
                      )}
                    </section>

                    <details className="planner-secondary-shell planner-bag-details">
                      <summary className="planner-secondary-summary">
                        <span className="planner-secondary-summary-copy">
                          <strong>{plannerBagTitle}</strong>
                          <small>{plannerBagNote}</small>
                        </span>
                        <span className="planner-secondary-summary-meta">
                          {plannerRemainingUnique} unique | {plannerRemainingTotal} total qty
                        </span>
                      </summary>

                      <div className="planner-secondary-content">
                        {plannerBagPreviewItems.length ? (
                          <div className="planner-bag-preview-list">
                            {plannerBagPreviewItems.map((item) => (
                              <div key={item.item} className="planner-bag-chip">
                                <span>{item.item}</span>
                                <strong>x{item.qty}</strong>
                              </div>
                            ))}
                            {plannerHiddenBagCount ? (
                              <div className="planner-bag-chip planner-bag-chip--muted">
                                +{plannerHiddenBagCount} more item{plannerHiddenBagCount === 1 ? "" : "s"}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="empty-state planner-bag-empty">{plannerBagEmptyMessage}</div>
                        )}

                        <div className="planner-bag-details-note">Show full bag details</div>
                        <div className="planner-bag-scroll">
                          <div className="mini-table planner-bag-table">
                            {plannerRemainingItems.length ? (
                              plannerRemainingItems.map((item) => (
                                <div key={item.item}>
                                  {item.item} x{item.qty}
                                </div>
                              ))
                            ) : (
                              <div>{plannerBagEmptyMessage}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </details>
                  </div>
                ) : (
                  <div className="empty-state">
                    Choose a target and run the planner to see the closest craft route your current inventory can support.
                  </div>
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
            <Panel
              title="Missing ingredients"
              description="Closest valid recipes and the ingredient group still blocking each one."
              className="missing-workspace-panel"
            >
              <div className="missing-workspace">
                <div className="missing-workspace-head">
                  <div className="info-strip">
                    Up to {nearThreshold} missing slot{nearThreshold === 1 ? "" : "s"} with the current station filters.
                  </div>
                  <span className="missing-workspace-count">
                    Showing {near?.count ?? 0} near-craft recipe row{(near?.count ?? 0) === 1 ? "" : "s"}.
                  </span>
                </div>
                <div className="missing-results-shell">
                  <NearCraftTable rows={near?.items ?? []} emptyMessage="Nothing falls inside the current near-craft threshold." />
                </div>
              </div>
            </Panel>
          ) : null}

          {activeSection === "Recipe database" ? (
            <Panel title="Recipe database" description="Search recipes, grouped ingredients, and item metadata." className="database-panel">
              <div className="database-view">
                <div className="database-toolbar database-toolbar--with-debug">
                  <label className="field grow">
                    <span>Search recipes, groups, or stats</span>
                    <input
                      value={databaseSearch}
                      onChange={(event) => setDatabaseSearch(event.target.value)}
                      placeholder="Search result names, ingredients, effects, pages, or metadata..."
                    />
                  </label>
                  <button
                    type="button"
                    className="button subtle database-debug-toggle"
                    onClick={() => setDebugPanelExpanded((current) => !current)}
                  >
                    {debugPanelExpanded ? "Hide debug" : "Open debug"}
                  </button>
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
                <Panel
                  title="Recipe visibility debug"
                  description="Inspector: check how one result is classified across craftable, near, and planner logic."
                  className="sub-panel recipe-debug-panel recipe-debug-panel--drawer"
                  collapsible
                  collapsed={!debugPanelExpanded}
                  onToggle={() => setDebugPanelExpanded((current) => !current)}
                >
                  <div className="view-stack">
                    <div className="inline-actions view-toolbar">
                      <label className="field grow">
                        <span>Result to inspect</span>
                        <input
                          list="recipe-debug-options"
                          value={debugRecipe}
                          onChange={(event) => {
                            setDebugRecipe(event.target.value);
                            setDebugRequested(false);
                            setRecipeDebugResult(null);
                          }}
                          placeholder="Search for a recipe result..."
                        />
                        <datalist id="recipe-debug-options">
                          {recipeTargets.map((target) => (
                            <option key={target} value={target} />
                          ))}
                        </datalist>
                      </label>
                      <button
                        type="button"
                        className="button subtle"
                        onClick={() => {
                          setDebugPanelExpanded(true);
                          setDebugRequested(true);
                          void executeRecipeDebug();
                        }}
                      >
                        Check recipe
                      </button>
                    </div>
                    <div className="info-strip">
                      Uses the shared station filters, near threshold, and planner depth from the left rail. {stationFilterNote}. Near
                      threshold: {nearThreshold}. Planner depth: {plannerDepth}.
                    </div>
                    {recipeDebugResult ? (
                      <>
                        <div className="stat-grid two-up">
                          <StatCard
                            label="Target in bag"
                            value={recipeDebugResult.target_owned_qty}
                            detail="Tracked copies of this exact result already in the live inventory"
                          />
                          <StatCard
                            label="Recipe rows"
                            value={recipeDebugResult.recipe_database_rows}
                            detail="Matching recipe rows under the current station filters"
                          />
                          <StatCard
                            label="Evaluated rows"
                            value={recipeDebugResult.evaluated_recipe_rows}
                            detail="Matching rows checked against the live inventory"
                          />
                          <StatCard
                            label="Craftable now"
                            value={recipeDebugResult.craftable_now ? "Yes" : "No"}
                            detail={recipeDebugResult.craftable_panel_reason}
                          />
                          <StatCard
                            label="Craftable panel"
                            value={recipeDebugResult.craftable_panel ? "Included" : "Excluded"}
                            detail={recipeDebugResult.craftable_panel_reason}
                          />
                          <StatCard
                            label="Craftable rows"
                            value={recipeDebugResult.craftable_recipe_rows}
                            detail="Matching rows that are craftable right now"
                          />
                          <StatCard
                            label="Near craft"
                            value={recipeDebugResult.near_craft ? "Included" : "Excluded"}
                            detail={recipeDebugResult.near_reason}
                          />
                          <StatCard
                            label="Near rows"
                            value={recipeDebugResult.near_recipe_rows}
                            detail="Matching rows inside the current near-craft threshold"
                          />
                          <StatCard
                            label="Planner route"
                            value={recipeDebugResult.planner_found ? "Found" : "Not found"}
                            detail={recipeDebugResult.planner_reason}
                          />
                          <StatCard
                            label="Planner goal"
                            value={recipeDebugResult.planner_goal === "craft_one_more" ? "Craft one more" : "Obtain target"}
                            detail={
                              recipeDebugResult.planner_already_owned
                                ? `Target already owned (${recipeDebugResult.planner_target_owned_qty}).`
                                : "Target is not currently owned."
                            }
                          />
                          <StatCard
                            label="One-more route"
                            value={recipeDebugResult.planner_one_more_found ? "Found" : "Not found"}
                            detail={recipeDebugResult.planner_one_more_reason}
                          />
                          <StatCard
                            label="Planner mode"
                            value={formatPlannerMode(recipeDebugResult.planner_mode)}
                            detail={
                              recipeDebugResult.planner_uses_existing_target
                                ? "Planner is using the target item already in the bag."
                                : recipeDebugResult.planner_craft_steps
                                  ? `${recipeDebugResult.planner_craft_steps} craft step${recipeDebugResult.planner_craft_steps === 1 ? "" : "s"} in the route`
                                  : "No craft steps are available for this result yet."
                            }
                          />
                          <StatCard
                            label="Smart score"
                            value={recipeDebugResult.smart_score != null ? recipeDebugResult.smart_score.toFixed(1) : "None"}
                            detail={
                              recipeDebugResult.matching_recipe
                                ? `${recipeDebugResult.matching_recipe.station} | ${recipeDebugResult.matching_recipe.ingredients}`
                                : "No matching recipe row is currently scored."
                            }
                          />
                        </div>
                        <div className="info-strip">{recipeDebugResult.planner_alignment_reason}</div>
                        <div className="info-strip">
                          Baseline route (obtain target): {formatPlannerMode(recipeDebugResult.planner_baseline_mode)} /{" "}
                          {recipeDebugResult.planner_baseline_found ? "Found" : "Not found"}.
                        </div>
                        <div className="info-strip">{recipeDebugResult.craftable_sort_reason}</div>
                        <div className="debug-grid">
                          <section className="debug-section">
                            <div className="debug-section-head">
                              <strong>Sort ranks</strong>
                              <span>Every craftable sort reorders the same included set.</span>
                            </div>
                            <div className="debug-sort-list">
                              {recipeDebugResult.sort_positions.map((position) => (
                                <div key={position.sort_mode} className="debug-sort-row">
                                  <div className="debug-sort-copy">
                                    <strong>{position.sort_mode}</strong>
                                    <span>
                                      {position.rank ? `Rank #${position.rank} of ${position.total}` : "Not craftable in this sort yet"}
                                    </span>
                                  </div>
                                  <span className="debug-sort-value">{formatDebugMetric(position.primary_value)}</span>
                                </div>
                              ))}
                            </div>
                          </section>
                          <section className="debug-section">
                            <div className="debug-section-head">
                              <strong>Matching recipe rows</strong>
                              <span>Useful when the same result has more than one recipe row.</span>
                            </div>
                            <div className="debug-row-list">
                              {recipeDebugResult.evaluated_rows.length ? (
                                recipeDebugResult.evaluated_rows.map((row) => (
                                  <article key={`${row.result}-${row.station}-${row.ingredients}`} className="debug-row-card">
                                    <div className="debug-row-head">
                                      <strong>{row.station}</strong>
                                      <span>{row.max_crafts > 0 ? "Craftable now" : `${row.missing_slots} slot${row.missing_slots === 1 ? "" : "s"} missing`}</span>
                                    </div>
                                    <div className="debug-row-detail">
                                      <span>Recipe</span>
                                      <strong>{row.ingredient_list.join(", ") || row.ingredients}</strong>
                                    </div>
                                    <div className="debug-row-meta">
                                      <span>Matched {row.matched_slots}</span>
                                      <span>Missing {row.missing_slots}</span>
                                      <span>Crafts {row.max_crafts}</span>
                                      <span>Smart {formatDebugMetric(row.smart_score)}</span>
                                    </div>
                                  </article>
                                ))
                              ) : (
                                <div className="empty-state">No matching recipe rows are available under the current station filters.</div>
                              )}
                            </div>
                          </section>
                        </div>
                        {recipeDebugResult.planner_missing.length ? (
                          <InventoryList
                            title="Planner still needs"
                            items={recipeDebugResult.planner_missing}
                            emptyMessage="The planner has everything it needs."
                          />
                        ) : null}
                      </>
                    ) : (
                      <div className="empty-state">
                        Pick a result and run the debug check to see why it is included or excluded across the main recipe views.
                      </div>
                    )}
                  </div>
                </Panel>
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
