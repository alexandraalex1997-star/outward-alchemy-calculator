import type { InventoryItem, MetadataResponse } from "../types";

type CatalogRow = {
  item: string;
  category: string;
  qty: number;
  effects: string;
};

export function buildInventoryMap(items: InventoryItem[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  (items ?? []).forEach((item) => map.set(item.item, item.qty));
  return map;
}

export function buildItemStatsMap(itemStats: MetadataResponse["item_stats"] | undefined) {
  const map = new Map<string, MetadataResponse["item_stats"][number]>();
  (itemStats ?? []).forEach((row) => map.set(row.item, row));
  return map;
}

export function buildCatalogRows(
  categories: MetadataResponse["categories"] | undefined,
  inventoryMap: Map<string, number>,
  itemStatsMap: Map<string, MetadataResponse["item_stats"][number]>,
): CatalogRow[] {
  return (categories ?? []).flatMap((category) =>
    category.items.map((item) => ({
      item,
      category: category.name,
      qty: inventoryMap.get(item) ?? 0,
      effects: itemStatsMap.get(item)?.effects ?? "",
    })),
  );
}

export function filterCatalogRows(
  rows: CatalogRow[],
  searchText: string,
  selectedCategories: string[],
  showOwnedOnly: boolean,
): CatalogRow[] {
  const search = searchText.trim().toLowerCase();
  return rows.filter((row) => {
    const categoryMatch = selectedCategories.length === 0 || selectedCategories.includes(row.category);
    const searchMatch = !search || row.item.toLowerCase().includes(search);
    const ownedMatch = !showOwnedOnly || row.qty > 0;
    return categoryMatch && searchMatch && ownedMatch;
  });
}

export function buildRecipeTargets(recipes: MetadataResponse["recipes"] | undefined) {
  return Array.from(new Set((recipes ?? []).map((recipe) => recipe.result))).sort();
}

export function buildRecipeCategoryOptions(recipes: MetadataResponse["recipes"] | undefined) {
  return Array.from(new Set((recipes ?? []).map((recipe) => recipe.category || "Uncategorized"))).sort();
}

export function filterDatabaseRecipes(
  recipes: MetadataResponse["recipes"] | undefined,
  searchText: string,
  selectedStations: string[],
  selectedCategories: string[],
) {
  const search = searchText.trim().toLowerCase();
  return (recipes ?? []).filter((recipe) => {
    const category = recipe.category || "Uncategorized";
    const categoryMatch = selectedCategories.length === 0 || selectedCategories.includes(category);
    const stationMatch = selectedStations.length > 0 && selectedStations.includes(recipe.station);
    const searchBlob = [recipe.result, recipe.ingredients, recipe.effects, recipe.station, recipe.recipe_page, recipe.section]
      .join(" ")
      .toLowerCase();
    const searchMatch = !search || searchBlob.includes(search);
    return categoryMatch && stationMatch && searchMatch;
  });
}

export function filterIngredientGroups(groups: MetadataResponse["ingredient_groups"] | undefined, searchText: string) {
  const search = searchText.trim().toLowerCase();
  return (groups ?? []).filter((group) => {
    if (!search) return true;
    return `${group.group} ${group.members.join(" ")}`.toLowerCase().includes(search);
  });
}

export function filterItemStats(rows: MetadataResponse["item_stats"] | undefined, searchText: string) {
  const search = searchText.trim().toLowerCase();
  return (rows ?? []).filter((row) => {
    if (!search) return true;
    return `${row.item} ${row.category} ${row.effects}`.toLowerCase().includes(search);
  });
}

export function createStationFilterNote(selectedStations: string[]) {
  return selectedStations.length
    ? `Stations: ${selectedStations.join(", ")}`
    : "No stations selected. Recipe views will be empty.";
}

export function deriveMetadataDefaults(metadata: MetadataResponse) {
  const stations = [...metadata.stations];
  const inventoryCategories = metadata.categories.map((category) => category.name);
  const recipeCategories = buildRecipeCategoryOptions(metadata.recipes);
  const recipeTargets = buildRecipeTargets(metadata.recipes);

  return {
    stations,
    inventoryCategories,
    recipeCategories,
    recipeTargets,
  };
}
