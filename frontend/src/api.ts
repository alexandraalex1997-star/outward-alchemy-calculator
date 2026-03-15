import type {
  DashboardResponse,
  DirectResponse,
  InventoryResponse,
  MetadataResponse,
  PlannerResponse,
  ShoppingListResponse,
  NearResponse,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  getMetadata: () => request<MetadataResponse>("/api/metadata"),
  getDashboard: (stations: string[], maxMissingSlots = 2) => {
    const params = new URLSearchParams();
    params.set("max_missing_slots", String(maxMissingSlots));
    stations.forEach((station) => params.append("stations", station));
    return request<DashboardResponse>(`/api/results/dashboard?${params.toString()}`);
  },
  getDirect: (sortMode: string, stations: string[], limit?: number, maxMissingSlots = 2) => {
    const params = new URLSearchParams();
    params.set("sort_mode", sortMode);
    params.set("max_missing_slots", String(maxMissingSlots));
    if (limit) params.set("limit", String(limit));
    stations.forEach((station) => params.append("stations", station));
    return request<DirectResponse>(`/api/results/direct?${params.toString()}`);
  },
  getNear: (stations: string[], limit?: number, maxMissingSlots = 2) => {
    const params = new URLSearchParams();
    params.set("max_missing_slots", String(maxMissingSlots));
    if (limit) params.set("limit", String(limit));
    stations.forEach((station) => params.append("stations", station));
    return request<NearResponse>(`/api/results/near?${params.toString()}`);
  },
  addInventoryItem: (item: string, qty: number) =>
    request<InventoryResponse>("/api/inventory/items/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item, qty }),
    }),
  setInventoryItem: (item: string, qty: number) =>
    request<InventoryResponse>(`/api/inventory/items/${encodeURIComponent(item)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qty }),
    }),
  replaceInventory: (items: Array<{ item: string; qty: number }>) =>
    request<InventoryResponse>("/api/inventory/replace", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    }),
  importCsv: async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<InventoryResponse>("/api/inventory/import/csv", { method: "POST", body });
  },
  importExcel: async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<InventoryResponse>("/api/inventory/import/excel", { method: "POST", body });
  },
  getPlanner: (target: string, maxDepth: number, stations: string[]) =>
    request<PlannerResponse>("/api/results/planner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, max_depth: maxDepth, stations }),
    }),
  getShoppingList: (targets: Array<{ item: string; qty: number }>, maxDepth: number, stations: string[]) =>
    request<ShoppingListResponse>("/api/results/shopping-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets, max_depth: maxDepth, stations }),
    }),
};
