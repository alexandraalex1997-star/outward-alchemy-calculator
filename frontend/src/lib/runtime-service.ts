import * as XLSX from "xlsx";

import type {
  DashboardResponse,
  DirectResponse,
  InventoryItem,
  InventoryResponse,
  MetadataResponse,
  NearResponse,
  PlannerResponse,
  RecipeDebugResponse,
  ShoppingListResponse,
} from "../types";
import {
  buildRuntimeData,
  calculateDashboard,
  calculateDirect,
  calculateNear,
  calculatePlanner,
  calculateRecipeDebug,
  calculateShoppingList,
  counterFromItems,
  counterToItems,
  inventoryResponse,
  normalize,
  type RuntimeData,
} from "./runtime-calculator";

const DATA_URL = `${import.meta.env.BASE_URL}data/calculator-data.json`;
const INVENTORY_STORAGE_KEY = "outward-crafting-helper.inventory.v2";
const SOURCE_STORAGE_KEY = "outward-crafting-helper.inventory-source.v2";

export type RuntimeInventorySource = {
  kind: "url_sync" | "manual_upload" | "saved_inventory";
  label: string;
  detail: string;
  exportedAtUtc?: string;
};

export type UrlSyncStatus =
  | { status: "none" }
  | { status: "applied"; source: RuntimeInventorySource }
  | { status: "invalid"; message: string };

type UrlInventoryPayload = {
  source?: string;
  exportedAtUtc?: string;
  inventoryType?: string;
  items: Array<{
    name?: string;
    canonicalName?: string;
    quantity?: number;
    qty?: number;
  }>;
};

let metadataPromise: Promise<MetadataResponse> | null = null;
let runtimeDataPromise: Promise<RuntimeData> | null = null;

function readJsonStorage<T>(key: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJsonStorage(key: string, value: unknown) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

async function loadMetadata() {
  if (!metadataPromise) {
    metadataPromise = fetch(DATA_URL).then(async (response) => {
      if (!response.ok) {
        throw new Error("Failed to load the bundled calculator data.");
      }
      return (await response.json()) as MetadataResponse;
    });
  }
  return metadataPromise;
}

async function loadRuntimeData() {
  if (!runtimeDataPromise) {
    runtimeDataPromise = loadMetadata().then((metadata) => buildRuntimeData(metadata));
  }
  return runtimeDataPromise;
}

function readInventoryCounter() {
  const saved = readJsonStorage<InventoryItem[]>(INVENTORY_STORAGE_KEY) ?? [];
  return counterFromItems(saved);
}

function writeInventoryCounter(items: InventoryItem[], source?: RuntimeInventorySource) {
  writeJsonStorage(INVENTORY_STORAGE_KEY, items);
  const nextSource =
    source ??
    readInventorySource() ?? {
      kind: "saved_inventory" as const,
      label: "Browser inventory",
      detail: "Using the inventory currently stored in this browser.",
    };
  writeJsonStorage(SOURCE_STORAGE_KEY, nextSource);
}

function readInventorySource(): RuntimeInventorySource | null {
  return readJsonStorage<RuntimeInventorySource>(SOURCE_STORAGE_KEY);
}

function resolveColumn(record: Record<string, unknown>, aliases: string[]) {
  const entries = Object.entries(record);
  const match = entries.find(([column]) => aliases.includes(normalize(column).toLocaleLowerCase()));
  return match?.[1];
}

function parseSheetRows(rows: Record<string, unknown>[]) {
  const items: InventoryItem[] = [];
  for (const row of rows) {
    const itemValue = resolveColumn(row, ["item", "ingredient", "name"]) ?? Object.values(row)[0];
    const qtyValue = resolveColumn(row, ["qty", "quantity", "count"]) ?? Object.values(row)[1] ?? 1;
    const item = normalize(String(itemValue ?? ""));
    const qty = Math.max(0, Math.trunc(Number(qtyValue) || 0));
    if (!item || qty <= 0) continue;
    items.push({ item, qty });
  }
  return counterToItems(counterFromItems(items));
}

async function parseInventoryFile(file: File) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("The selected file does not contain a readable worksheet.");
  }
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
  const items = parseSheetRows(rows);
  if (!items.length) {
    throw new Error("No inventory rows were found in the selected file.");
  }
  return items;
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const normalized = padded + "=".repeat((4 - (padded.length % 4 || 4)) % 4);
  return new TextDecoder().decode(
    Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0)),
  );
}

function readSyncValueFromHash(hash: string) {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  return params.get("sync") ?? params.get("modSync") ?? params.get("inventory");
}

export function parseUrlInventoryPayloadValue(rawValue: string | null): UrlSyncStatus {
  if (!rawValue) {
    return { status: "none" };
  }

  try {
    const payloadText = rawValue.startsWith("{")
      ? rawValue
      : rawValue.startsWith("b64:")
        ? decodeBase64Url(rawValue.slice(4))
        : decodeBase64Url(rawValue);
    const payload = JSON.parse(payloadText) as UrlInventoryPayload;
    if (!Array.isArray(payload.items)) {
      return { status: "invalid", message: "The mod sync link is missing its inventory items." };
    }

    const items = payload.items
      .map((entry) => {
        const item = normalize(entry.canonicalName ?? entry.name ?? "");
        const qty = Math.max(0, Math.trunc(Number(entry.quantity ?? entry.qty ?? 0) || 0));
        return item && qty > 0 ? { item, qty } : null;
      })
      .filter((entry): entry is InventoryItem => entry != null);

    if (!items.length) {
      return { status: "invalid", message: "The mod sync link did not contain any usable inventory rows." };
    }

    const mergedItems = counterToItems(counterFromItems(items));
    const source = {
      kind: "url_sync" as const,
      label: "Mod URL sync",
      detail: payload.exportedAtUtc
        ? `Loaded ${mergedItems.length} inventory lines from the mod link exported at ${payload.exportedAtUtc}.`
        : `Loaded ${mergedItems.length} inventory lines from the mod link.`,
      exportedAtUtc: payload.exportedAtUtc,
    };
    writeInventoryCounter(mergedItems, source);
    return { status: "applied", source };
  } catch {
    return { status: "invalid", message: "The mod sync link could not be parsed. Check the URL payload and try again." };
  }
}

export function extractUrlInventoryPayload(search: string, hash: string) {
  const params = new URLSearchParams(search);
  const rawValue =
    params.get("sync") ??
    params.get("modSync") ??
    params.get("inventory") ??
    readSyncValueFromHash(hash);

  return rawValue;
}

function stripSyncPayloadFromUrl() {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("sync");
  url.searchParams.delete("modSync");
  url.searchParams.delete("inventory");
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  hashParams.delete("sync");
  hashParams.delete("modSync");
  hashParams.delete("inventory");
  const nextHash = hashParams.toString();
  url.hash = nextHash ? `#${nextHash}` : "";
  window.history.replaceState({}, document.title, url.toString());
}

export async function getRuntimeInventorySource() {
  return readInventorySource();
}

export async function applyUrlInventorySync(options: { clearUrl?: boolean } = {}) {
  if (typeof window === "undefined") {
    return { status: "none" } satisfies UrlSyncStatus;
  }
  const result = parseUrlInventoryPayloadValue(extractUrlInventoryPayload(window.location.search, window.location.hash));
  if (options.clearUrl !== false && result.status !== "none") {
    stripSyncPayloadFromUrl();
  }
  return result;
}

export const runtimeApi = {
  async getMetadata(): Promise<MetadataResponse> {
    return loadMetadata();
  },

  async getDashboard(stations: string[], maxMissingSlots = 2): Promise<DashboardResponse> {
    return calculateDashboard(await loadRuntimeData(), readInventoryCounter(), stations, maxMissingSlots);
  },

  async getDirect(sortMode: string, stations: string[], limit?: number, maxMissingSlots = 2): Promise<DirectResponse> {
    return calculateDirect(await loadRuntimeData(), readInventoryCounter(), sortMode, stations, maxMissingSlots, limit);
  },

  async getNear(stations: string[], limit?: number, maxMissingSlots = 2): Promise<NearResponse> {
    return calculateNear(await loadRuntimeData(), readInventoryCounter(), stations, maxMissingSlots, limit);
  },

  async getRecipeDebug(result: string, stations: string[], maxMissingSlots: number, plannerDepth: number): Promise<RecipeDebugResponse> {
    return calculateRecipeDebug(await loadRuntimeData(), readInventoryCounter(), result, stations, maxMissingSlots, plannerDepth);
  },

  async addInventoryItem(item: string, qty: number): Promise<InventoryResponse> {
    const counter = readInventoryCounter();
    const normalized = normalize(item);
    if (!normalized) {
      throw new Error("Choose a valid ingredient before adding it.");
    }
    counter.set(normalized, (counter.get(normalized) ?? 0) + Math.max(1, Math.trunc(qty)));
    const items = counterToItems(counter);
    writeInventoryCounter(items);
    return inventoryResponse(counter);
  },

  async setInventoryItem(item: string, qty: number): Promise<InventoryResponse> {
    const counter = readInventoryCounter();
    const normalized = normalize(item);
    if (!normalized) return inventoryResponse(counter);
    const nextQty = Math.max(0, Math.trunc(qty));
    if (nextQty <= 0) counter.delete(normalized);
    else counter.set(normalized, nextQty);
    const items = counterToItems(counter);
    writeInventoryCounter(items);
    return inventoryResponse(counter);
  },

  async replaceInventory(items: Array<{ item: string; qty: number }>): Promise<InventoryResponse> {
    const normalizedItems = counterToItems(counterFromItems(items));
    writeInventoryCounter(normalizedItems);
    return inventoryResponse(counterFromItems(normalizedItems));
  },

  async importCsv(file: File): Promise<InventoryResponse> {
    const items = await parseInventoryFile(file);
    writeInventoryCounter(items, {
      kind: "manual_upload",
      label: "Manual upload",
      detail: `Imported ${file.name} into the browser inventory.`,
    });
    return inventoryResponse(counterFromItems(items));
  },

  async importExcel(file: File): Promise<InventoryResponse> {
    const items = await parseInventoryFile(file);
    writeInventoryCounter(items, {
      kind: "manual_upload",
      label: "Manual upload",
      detail: `Imported ${file.name} into the browser inventory.`,
    });
    return inventoryResponse(counterFromItems(items));
  },

  async getPlanner(target: string, maxDepth: number, stations: string[]): Promise<PlannerResponse> {
    return calculatePlanner(await loadRuntimeData(), readInventoryCounter(), target, maxDepth, stations);
  },

  async getShoppingList(targets: Array<{ item: string; qty: number }>, maxDepth: number, stations: string[]): Promise<ShoppingListResponse> {
    return calculateShoppingList(await loadRuntimeData(), readInventoryCounter(), targets, maxDepth, stations);
  },
};
