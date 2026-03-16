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

export type DashboardResponse = {
  inventory: InventoryResponse;
  snapshot: Snapshot;
  best_direct: DirectResponse;
  near: NearResponse;
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
  buy_value_each: number;
  weight_each: number;
  value_per_weight_each: number;
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
  shortlist_limit?: number;
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
  buy_value: number;
  weight: number;
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
  buy_value: number;
  weight: number;
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
  mode: string;
  craft_steps: number;
  uses_existing_target: boolean;
  requires_crafting: boolean;
  target_owned_qty: number;
  already_owned: boolean;
  planning_goal: "obtain_target" | "craft_one_more";
  baseline_found: boolean;
  baseline_mode: string;
  baseline_reason: string;
  baseline_missing: InventoryItem[];
  one_more_found: boolean;
  one_more_mode: string;
  one_more_reason: string;
  one_more_missing: InventoryItem[];
  one_more_craft_steps: number;
  one_more_requires_crafting: boolean;
  owned_satisfies_target: boolean;
};

export type RecipeDebugMatch = {
  ingredients: string;
  station: string;
  max_crafts: number;
  missing_slots: number;
  matched_slots: number;
};

export type RecipeDebugSortPosition = {
  sort_mode: string;
  rank: number | null;
  total: number;
  primary_column: string;
  primary_value: number | string | null;
};

export type RecipeDebugResponse = {
  result: string;
  selected_stations: string[];
  max_missing_slots: number;
  planner_depth: number;
  target_owned_qty: number;
  recipe_database_rows: number;
  evaluated_recipe_rows: number;
  craftable_recipe_rows: number;
  near_recipe_rows: number;
  craftable_now: boolean;
  craftable_panel: boolean;
  craftable_panel_reason: string;
  near_craft: boolean;
  near_reason: string;
  smart_score: number | null;
  craftable_sort_reason: string;
  sort_positions: RecipeDebugSortPosition[];
  planner_found: boolean;
  planner_mode: string;
  planner_goal: string;
  planner_target_owned_qty: number;
  planner_already_owned: boolean;
  planner_owned_satisfies_target: boolean;
  planner_one_more_found: boolean;
  planner_one_more_mode: string;
  planner_one_more_reason: string;
  planner_one_more_missing: InventoryItem[];
  planner_baseline_found: boolean;
  planner_baseline_mode: string;
  planner_uses_existing_target: boolean;
  planner_craft_steps: number;
  planner_reason: string;
  planner_alignment_reason: string;
  planner_missing: InventoryItem[];
  matching_recipe: RecipeDebugMatch | null;
  evaluated_rows: RecipeResult[];
  craftable_rows: RecipeResult[];
  near_rows: RecipeResult[];
};

export type ShoppingListResponse = {
  targets: InventoryItem[];
  missing: InventoryItem[];
  lines: string[];
  remaining_inventory: InventoryItem[];
};
