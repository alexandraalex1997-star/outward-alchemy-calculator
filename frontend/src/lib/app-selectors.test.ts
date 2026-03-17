import { describe, expect, it } from "vitest";

import type { MetadataResponse } from "../types";
import {
  buildCatalogRows,
  buildInventoryCategoryGroups,
  buildInventoryMap,
  buildItemStatsMap,
  filterCatalogRows,
} from "./app-selectors";

const metadata: MetadataResponse = {
  ingredients: ["Star Mushroom", "Hidden Relic"],
  categories: [
    {
      name: "Alchemy",
      items: ["Star Mushroom"],
    },
  ],
  stations: [],
  recipe_count: 0,
  recipes: [],
  ingredient_groups: [],
  item_stats: [
    {
      item: "Star Mushroom",
      category: "Alchemy",
      heal: 0,
      stamina: 0,
      mana: 0,
      sale_value: 0,
      buy_value: 0,
      weight: 0,
      effects: "",
    },
    {
      item: "Hidden Relic",
      category: "Equipment",
      heal: 0,
      stamina: 0,
      mana: 0,
      sale_value: 0,
      buy_value: 0,
      weight: 0,
      effects: "Rare",
    },
  ],
};

describe("inventory catalog selectors", () => {
  it("includes recognized owned items even when they are outside the curated category groups", () => {
    const inventoryMap = buildInventoryMap([
      { item: "Star Mushroom", qty: 2 },
      { item: "Hidden Relic", qty: 1 },
    ]);
    const itemStatsMap = buildItemStatsMap(metadata.item_stats);

    const rows = buildCatalogRows(metadata.categories, inventoryMap, itemStatsMap);
    const ownedOnlyRows = filterCatalogRows(rows, "", ["Alchemy", "Equipment"], true);

    expect(rows.find((row) => row.item === "Hidden Relic")).toEqual({
      item: "Hidden Relic",
      category: "Equipment",
      qty: 1,
      effects: "Rare",
    });
    expect(ownedOnlyRows.map((row) => row.item)).toEqual(["Star Mushroom", "Hidden Relic"]);
    expect(ownedOnlyRows).toHaveLength(2);
  });

  it("adds fallback category groups so owned-only rows are not hidden by default category selection", () => {
    const inventoryMap = buildInventoryMap([{ item: "Hidden Relic", qty: 1 }]);
    const itemStatsMap = buildItemStatsMap(metadata.item_stats);

    const rows = buildCatalogRows(metadata.categories, inventoryMap, itemStatsMap);
    const categories = buildInventoryCategoryGroups(metadata.categories, rows);

    expect(categories.map((category) => category.name)).toEqual(["Alchemy", "Equipment"]);
  });
});