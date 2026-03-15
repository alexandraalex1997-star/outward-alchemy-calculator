import rawViewConfig from "../config/view-config.json";

export const NAV_ITEMS = ["Craft now", "Plan a target", "Shopping list", "Missing ingredients", "Recipe database"] as const;

export const SORT_MODES = [
  "Smart score",
  "Max crafts",
  "Max total output",
  "Healing yield",
  "Stamina yield",
  "Mana yield",
  "Sale value",
  "Result A-Z",
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
export type RailSectionId = "snapshot" | "planning" | "bulk" | "data";

export type ViewConfigEntry = {
  id: string;
  logic: string;
  summary: string;
  apis?: string[];
  viewState?: string[];
};

export const VIEW_CONFIG = rawViewConfig as ViewConfigEntry[];

export const VIEW_SUMMARIES = VIEW_CONFIG.reduce<Record<string, string>>((accumulator, entry) => {
  accumulator[entry.id] = entry.summary;
  return accumulator;
}, {});
