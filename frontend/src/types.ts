export type InventoryItem = {
  item: string;
  qty: number;
};

export type InventoryResponse = {
  items: InventoryItem[];
  unique_items: number;
  total_quantity: number;
};

export type Snapshot = {
  inventory_lines: number;
  known_recipes: number;
  direct_crafts: number;
  near_crafts: number;
  best_heal: string | null;
  best_stamina: string | null;
  best_mana: string | null;
};

export type OverviewResponse = {
  inventory: InventoryResponse;
  inventory_table: InventoryItem[];
  snapshot: Snapshot;
};

export type RecipeResult = {
  result: string;
  result_qty_per_craft: number;
  max_crafts: number;
  max_total_output: number;
  station: string;
  recipe_page: string;
  section: string;
  ingredients: string;
  ingredient_list: string[];
  matched_slots: number;
  missing_slots: number;
  missing_items: string;
  heal_each: number;
  stamina_each: number;
  mana_each: number;
  sale_value_each: number;
  effects: string;
  category: string;
  healing_total: number;
  stamina_total: number;
  mana_total: number;
  sale_value_total: number;
  smart_score: number;
};

export type DirectResponse = {
  sort_mode: string;
  count: number;
  near_count: number;
  items: RecipeResult[];
};

export type NearResponse = {
  count: number;
  known_recipes: number;
  items: RecipeResult[];
};

export type CategoryGroup = {
  name: string;
  items: string[];
};

export type IngredientGroup = {
  group: string;
  members: string[];
  member_count: number;
};

export type ItemStat = {
  item: string;
  category: string;
  heal: number;
  stamina: number;
  mana: number;
  sale_value: number;
  effects: string;
};

export type RecipeDatabaseRecord = {
  recipe_id: string;
  recipe_page: string;
  section: string;
  result: string;
  result_qty: number;
  station: string;
  ingredients: string;
  ingredient_list: string[];
  effects: string;
  heal: number;
  stamina: number;
  mana: number;
  sale_value: number;
  category: string;
};

export type MetadataResponse = {
  ingredients: string[];
  categories: CategoryGroup[];
  stations: string[];
  recipe_count: number;
  recipes: RecipeDatabaseRecord[];
  ingredient_groups: IngredientGroup[];
  item_stats: ItemStat[];
};

export type PlannerResponse = {
  target: string;
  found: boolean;
  explanation: string;
  lines: string[];
  missing: InventoryItem[];
  remaining_inventory: InventoryItem[];
};

export type ShoppingListResponse = {
  targets: InventoryItem[];
  missing: InventoryItem[];
  lines: string[];
  remaining_inventory: InventoryItem[];
};
