import type {
  DashboardResponse,
  DirectResponse,
  IngredientGroup,
  InventoryItem,
  InventoryResponse,
  ItemStat,
  MetadataResponse,
  NearResponse,
  PlannerResponse,
  RecipeDatabaseRecord,
  RecipeDebugResponse,
  RecipeResult,
  ShoppingListResponse,
  Snapshot,
} from "../types";

type CounterMap = Map<string, number>;

type SlotOption = {
  tokenName: string;
  options: string[];
};

type PlanNode =
  | { type: "use"; item: string }
  | { type: "missing"; item: string }
  | { type: "group"; group: string; chosen: string; step: PlanNode }
  | { type: "craft"; item: string; recipe: RecipeDatabaseRecord; steps: PlanNode[] };

type PlannerRoute = {
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
  station_filtered_out: boolean;
};

export type RuntimeData = {
  metadata: MetadataResponse;
  groups: Map<string, string[]>;
  recipeIndex: Map<string, RecipeDatabaseRecord[]>;
  itemStats: Map<string, ItemStat>;
  stationOptions: string[];
};

const TEXT_REPAIRS: Record<string, string> = {
  "Ã¢â‚¬â€œ": "-",
  "Ã¢â‚¬â€": "-",
  "Ã¢â‚¬â„¢": "'",
  "Ã¢â‚¬Å“": '"',
  "Ã¢â‚¬Â": '"',
  "\u00e2\u20ac\u201c": "-",
  "\u00e2\u20ac\u201d": "-",
  "\u00e2\u20ac\u2122": "'",
  "\u00e2\u20ac\u0153": '"',
  "\u00e2\u20ac\ufffd": '"',
};

const FRIENDLY_GROUP_LABELS: Record<string, string> = {
  water: "Any Water",
  fish: "Any Fish",
  meat: "Any Meat",
  egg: "Any Egg",
  vegetable: "Any Vegetable",
  mushroom: "Any Mushroom",
  "bread (any)": "Any Bread",
  "advanced tent": "Any Advanced Tent",
  "ration ingredient": "Any Ration Ingredient",
  "basic armor": "Any Basic Armor",
  "basic boots": "Any Basic Boots",
  "basic helm": "Any Basic Helm",
};

const CRAFTABLE_DEBUG_SORT_MODES: Array<{ sortMode: string; primaryColumn: keyof RecipeResult | "result" }> = [
  { sortMode: "Smart score", primaryColumn: "smart_score" },
  { sortMode: "Best healing", primaryColumn: "healing_total" },
  { sortMode: "Best stamina", primaryColumn: "stamina_total" },
  { sortMode: "Best mana", primaryColumn: "mana_total" },
  { sortMode: "Max crafts", primaryColumn: "max_crafts" },
  { sortMode: "Max total output", primaryColumn: "max_total_output" },
  { sortMode: "Sale value", primaryColumn: "sale_value_total" },
  { sortMode: "Result A-Z", primaryColumn: "result" },
];

export function normalize(text: string | number | null | undefined): string {
  let value = String(text ?? "");
  for (const [broken, fixed] of Object.entries(TEXT_REPAIRS)) {
    value = value.split(broken).join(fixed);
  }
  return value.trim().replace(/\s+/g, " ");
}

export function key(text: string | number | null | undefined): string {
  return normalize(text).toLocaleLowerCase();
}

export function normalizeStation(text: string | null | undefined): string {
  const station = normalize(text);
  return station || "Manual Crafting";
}

function compareTuple(left: Array<number | string>, right: Array<number | string>) {
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === rightValue) continue;
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return leftValue - rightValue;
    }
    return String(leftValue).localeCompare(String(rightValue));
  }
  return 0;
}

export function counterFromItems(items: InventoryItem[] | Array<{ item: string; qty: number }>): CounterMap {
  const counts = new Map<string, number>();
  for (const entry of items) {
    const itemName = normalize(entry.item);
    const qty = Math.max(0, Math.trunc(Number(entry.qty) || 0));
    if (!itemName || qty <= 0) continue;
    counts.set(itemName, (counts.get(itemName) ?? 0) + qty);
  }
  return counts;
}

function cloneCounter(counter: CounterMap): CounterMap {
  return new Map(counter);
}

export function counterToItems(counter: CounterMap): InventoryItem[] {
  return [...counter.entries()]
    .filter(([, qty]) => qty > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([item, qty]) => ({ item, qty }));
}

export function inventoryResponse(counter: CounterMap): InventoryResponse {
  const items = counterToItems(counter);
  return {
    items,
    unique_items: items.length,
    total_quantity: items.reduce((sum, item) => sum + item.qty, 0),
  };
}

function getCount(counter: CounterMap, item: string) {
  return counter.get(normalize(item)) ?? 0;
}

function incrementCount(counter: CounterMap, item: string, qty: number) {
  const itemName = normalize(item);
  const nextQty = Math.max(0, Math.trunc(qty));
  if (!itemName || nextQty <= 0) return;
  counter.set(itemName, (counter.get(itemName) ?? 0) + nextQty);
}

function consumeItem(counter: CounterMap, item: string, qty = 1) {
  const itemName = normalize(item);
  const currentQty = counter.get(itemName) ?? 0;
  if (currentQty < qty) return false;
  const nextQty = currentQty - qty;
  if (nextQty <= 0) {
    counter.delete(itemName);
  } else {
    counter.set(itemName, nextQty);
  }
  return true;
}

function groupsMap(groups: IngredientGroup[]) {
  return new Map(groups.map((group) => [key(group.group), group.members.map((member) => normalize(member))]));
}

function itemStatsMap(itemStats: ItemStat[]) {
  return new Map(itemStats.map((row) => [key(row.item), row]));
}

function recipeIndex(recipes: RecipeDatabaseRecord[]) {
  const index = new Map<string, RecipeDatabaseRecord[]>();
  for (const recipe of recipes) {
    const recipeKey = key(recipe.result);
    const current = index.get(recipeKey) ?? [];
    current.push(recipe);
    index.set(recipeKey, current);
  }
  return index;
}

export function buildRuntimeData(metadata: MetadataResponse): RuntimeData {
  return {
    metadata,
    groups: groupsMap(metadata.ingredient_groups),
    recipeIndex: recipeIndex(metadata.recipes),
    itemStats: itemStatsMap(metadata.item_stats),
    stationOptions: [...metadata.stations].sort((left, right) => left.localeCompare(right)),
  };
}

function recipeSlotOptions(recipeIngredients: string[], groups: Map<string, string[]>): SlotOption[] {
  return recipeIngredients.map((ingredient) => {
    const tokenName = normalize(ingredient);
    const tokenKey = key(tokenName);
    return {
      tokenName,
      options: groups.get(tokenKey)?.map((itemName) => normalize(itemName)) ?? [tokenName],
    };
  });
}

function isNoopAssignment(assignment: string[], result: string, resultQty: number) {
  if (!assignment.length) return false;
  const counts = new Map<string, number>();
  for (const itemName of assignment) {
    const normalized = normalize(itemName);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  const resultName = normalize(result);
  return counts.size === 1 && (counts.get(resultName) ?? 0) === Math.trunc(resultQty);
}

function validSlotAssignments(recipeIngredients: string[], groups: Map<string, string[]>, result: string, resultQty: number) {
  const slots = recipeSlotOptions(recipeIngredients, groups);
  const assignments: string[][] = [];
  const current: string[] = [];

  function backtrack(position: number) {
    if (position === slots.length) {
      if (!isNoopAssignment(current, result, resultQty)) {
        assignments.push([...current]);
      }
      return;
    }
    for (const itemName of slots[position].options) {
      current.push(normalize(itemName));
      backtrack(position + 1);
      current.pop();
    }
  }

  backtrack(0);
  return { slots, assignments };
}

function assignmentSortKey(assignment: string[], inventory: CounterMap, recipeIndexMap: Map<string, RecipeDatabaseRecord[]>) {
  return [
    assignment.filter((itemName) => getCount(inventory, itemName) <= 0).length,
    assignment.filter((itemName) => !recipeIndexMap.has(key(itemName))).length,
    assignment.join("|"),
  ] as Array<number | string>;
}

function selfGroupSlotsSupported(
  slots: SlotOption[],
  assignment: string[],
  result: string,
  groups: Map<string, string[]>,
  inventory: CounterMap,
) {
  const resultKey = key(result);
  return slots.every((slot, index) => {
    const tokenKey = key(slot.tokenName);
    const chosenItem = assignment[index];
    if (!groups.has(tokenKey)) return true;
    const members = new Set((groups.get(tokenKey) ?? []).map((member) => key(member)));
    if (!members.has(resultKey)) return true;
    return getCount(inventory, chosenItem) > 0;
  });
}

function maxCraftsForRecipe(recipeIngredients: string[], inventory: CounterMap, groups: Map<string, string[]>, result: string, resultQty: number) {
  const slots = recipeSlotOptions(recipeIngredients, groups);
  if (!slots.length) return 0;

  const resultName = normalize(result);
  const relevantItems = [...new Set(slots.flatMap((slot) => slot.options.map((itemName) => normalize(itemName))))].filter(
    (itemName) => getCount(inventory, itemName) > 0,
  );
  if (!relevantItems.length) return 0;

  const slotCaps = slots.map((slot) => slot.options.reduce((sum, itemName) => sum + getCount(inventory, itemName), 0));
  const upperBound = slotCaps.length ? Math.min(...slotCaps) : 0;
  if (upperBound <= 0) return 0;

  const slotOptions = slots.map((slot) => slot.options.map((itemName) => normalize(itemName)));
  const resultOnlyNoop = slots.length === Math.trunc(resultQty) && slotOptions.every((options) => options.includes(resultName));

  function canCraftTimes(targetCrafts: number) {
    if (targetCrafts <= 0) return true;

    const slotDemand = slotOptions.length * targetCrafts;
    const itemCaps = new Map<string, number>(relevantItems.map((itemName) => [itemName, getCount(inventory, itemName)]));
    if (resultOnlyNoop && itemCaps.has(resultName)) {
      itemCaps.set(resultName, Math.min(itemCaps.get(resultName) ?? 0, slotDemand - targetCrafts));
    }

    const totalItems = [...itemCaps.values()].reduce((sum, qty) => sum + qty, 0);
    if (totalItems < slotDemand) return false;
    for (const options of slotOptions) {
      const capacity = options.reduce((sum, itemName) => sum + (itemCaps.get(itemName) ?? 0), 0);
      if (capacity < targetCrafts) return false;
    }

    const itemNodes = [...itemCaps.entries()].filter(([, qty]) => qty > 0).map(([itemName]) => itemName);
    if (!itemNodes.length) return false;

    const source = 0;
    const slotStart = 1;
    const itemStart = slotStart + slotOptions.length;
    const sink = itemStart + itemNodes.length;
    const size = sink + 1;
    const graph: number[][] = Array.from({ length: size }, () => []);
    const capacity: number[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
    const itemIndex = new Map(itemNodes.map((itemName, index) => [itemName, itemStart + index]));

    function addEdge(start: number, end: number, edgeCapacity: number) {
      if (edgeCapacity <= 0) return;
      graph[start].push(end);
      graph[end].push(start);
      capacity[start][end] = edgeCapacity;
    }

    slotOptions.forEach((options, slotIndex) => {
      const slotNode = slotStart + slotIndex;
      addEdge(source, slotNode, targetCrafts);
      for (const itemName of options) {
        const itemNode = itemIndex.get(itemName);
        if (itemNode != null) {
          addEdge(slotNode, itemNode, targetCrafts);
        }
      }
    });

    for (const itemName of itemNodes) {
      addEdge(itemIndex.get(itemName)!, sink, itemCaps.get(itemName) ?? 0);
    }

    let flow = 0;
    while (flow < slotDemand) {
      const parent = Array.from({ length: size }, () => -1);
      parent[source] = source;
      const queue: number[] = [source];

      while (queue.length && parent[sink] === -1) {
        const node = queue.shift()!;
        for (const next of graph[node]) {
          if (parent[next] !== -1 || capacity[node][next] <= 0) continue;
          parent[next] = node;
          if (next === sink) break;
          queue.push(next);
        }
      }

      if (parent[sink] === -1) break;

      let augment = slotDemand - flow;
      let node = sink;
      while (node !== source) {
        const prev = parent[node];
        augment = Math.min(augment, capacity[prev][node]);
        node = prev;
      }

      node = sink;
      while (node !== source) {
        const prev = parent[node];
        capacity[prev][node] -= augment;
        capacity[node][prev] += augment;
        node = prev;
      }
      flow += augment;
    }

    return flow === slotDemand;
  }

  let low = 0;
  let high = upperBound;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (canCraftTimes(mid)) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

function missingLabel(token: string, groups: Map<string, string[]>) {
  const tokenKey = key(token);
  if (!groups.has(tokenKey)) return token;
  return FRIENDLY_GROUP_LABELS[tokenKey] ?? `Any ${token}`;
}

function missingSlotDetails(recipeIngredients: string[], inventory: CounterMap, groups: Map<string, string[]>, result: string, resultQty: number) {
  const { slots, assignments } = validSlotAssignments(recipeIngredients, groups, result, resultQty);
  if (!slots.length) {
    return { missingCount: 0, missing: [] as string[], matchedSlots: 0 };
  }
  if (!assignments.length) {
    const missing = slots.map((slot) => missingLabel(slot.tokenName, groups));
    return { missingCount: missing.length, missing, matchedSlots: 0 };
  }

  let bestMatched = -1;
  let bestMissing: string[] = [];
  for (const assignment of assignments) {
    const trialInventory = cloneCounter(inventory);
    const missing: string[] = [];
    let matched = 0;
    slots.forEach((slot, index) => {
      const chosenItem = assignment[index];
      if (getCount(trialInventory, chosenItem) > 0) {
        consumeItem(trialInventory, chosenItem, 1);
        matched += 1;
      } else {
        missing.push(missingLabel(slot.tokenName, groups));
      }
    });
    const candidateKey = missing.join("|");
    const bestKey = bestMissing.join("|");
    if (matched > bestMatched || (matched === bestMatched && candidateKey.localeCompare(bestKey) < 0)) {
      bestMatched = matched;
      bestMissing = missing;
    }
  }

  return { missingCount: slots.length - bestMatched, missing: bestMissing, matchedSlots: bestMatched };
}

function effectsList(effects: string) {
  return effects
    .split(";")
    .map((effect) => normalize(effect))
    .filter(Boolean);
}

function stationConvenience(station: string) {
  switch (normalizeStation(station)) {
    case "Manual Crafting":
      return 1.8;
    case "Campfire":
      return 1.4;
    case "Cooking Pot":
      return 0.9;
    case "Alchemy Kit":
      return 0.5;
    default:
      return 0.7;
  }
}

function categoryUtility(category: string) {
  switch (normalize(category)) {
    case "Potion":
      return 7.5;
    case "Tea":
      return 6.0;
    case "Potions and Drinks":
      return 6.0;
    case "Food":
      return 5.0;
    case "Deployable":
    case "Deployables":
      return 6.3;
    case "Alchemy":
      return 3.0;
    case "Equipment":
      return 2.0;
    case "Cooking ingredients":
      return 1.6;
    case "Materials":
      return 0.4;
    default:
      return 0.0;
  }
}

function nameUtilityBonus(name: string, effects: string) {
  const nameKey = key(name);
  const effectsKey = key(effects);
  let bonus = 0;
  if (["potion", "elixir", "tea"].some((token) => nameKey.includes(token))) bonus += 3.8;
  if (["ration", "stew", "sandwich", "pie", "tartine", "omelet", "fricassee"].some((token) => nameKey.includes(token))) bonus += 3.2;
  if (["jam", "bread", "jerky", "flour", "cooked", "boiled", "grilled", "roasted"].some((token) => nameKey.includes(token))) {
    bonus += 1.4;
  }
  if (["boon", "buff", "restore", "heal", "stamina", "mana", "recovery", "support", "travel"].some((token) => effectsKey.includes(token))) {
    bonus += 2.4;
  }
  if (["tent", "lodge", "cocoon", "cage", "bedroll"].some((token) => nameKey.includes(token))) bonus += 2.8;
  return bonus;
}

function economicValue(saleValue: number, buyValue: number) {
  return Math.max(Number(saleValue) || 0, (Number(buyValue) || 0) * 0.35);
}

function inferItemCategory(itemName: string, category: string) {
  const normalizedCategory = normalize(category);
  if (normalizedCategory) {
    if (normalizedCategory === "Potion" || normalizedCategory === "Tea") return normalizedCategory;
    if (normalizedCategory === "Food") return "Food";
    if (normalizedCategory === "Deployable") return "Deployables";
    return normalizedCategory;
  }

  const itemKey = key(itemName);
  if (["tent", "lodge", "bedroll", "cocoon", "cage"].some((token) => itemKey.includes(token))) return "Deployables";
  if (["potion", "elixir", "varnish", "bomb", "incense", "stone", "powder", "charge"].some((token) => itemKey.includes(token))) {
    return "Alchemy";
  }
  if (["tea", "stew", "pie", "tartine", "sandwich", "omelet", "ration", "jam", "potage", "cake"].some((token) => itemKey.includes(token))) {
    return "Food";
  }
  if (["water", "mushroom", "berry", "fruit", "egg", "meat", "fish", "wheat", "flour", "salt", "spice", "milk"].some((token) => itemKey.includes(token))) {
    return "Cooking ingredients";
  }
  if (["scrap", "cloth", "wood", "stone", "hide", "oil", "quartz", "remains", "beetle", "bones", "tail", "chitin"].some((token) => itemKey.includes(token))) {
    return "Materials";
  }
  if (["sword", "axe", "mace", "bow", "shield", "armor", "boots", "helm", "lantern", "staff", "spear", "dagger"].some((token) => itemKey.includes(token))) {
    return "Equipment";
  }
  return "Other";
}

function inferredWeight(itemName: string, category: string, explicitWeight: number) {
  if (explicitWeight > 0) return explicitWeight;
  const categoryKey = normalize(category);
  const nameKey = key(itemName);
  if (["tent", "lodge", "cocoon", "cage", "bedroll"].some((token) => nameKey.includes(token))) return 5.0;
  if (["Potion", "Tea", "Potions and Drinks"].includes(categoryKey)) return 0.5;
  if (categoryKey === "Food") return 0.5;
  if (categoryKey === "Cooking ingredients") return 0.25;
  if (categoryKey === "Alchemy") return 0.35;
  if (categoryKey === "Materials") return 0.25;
  if (["Equipment", "Deployable", "Deployables"].includes(categoryKey)) return 4.0;
  return 1.0;
}

function effectUtility(effects: string[]) {
  let utility = 0;
  for (const effect of effects) {
    const effectKey = key(effect);
    if (effectKey.includes("burnt health")) utility += 7.0;
    else if (effectKey.includes("burnt mana")) utility += 6.8;
    else if (effectKey.includes("burnt stamina")) utility += 6.4;
    else if (effectKey.includes("burnt")) utility += 6.0;

    if (["health recovery", "health per second", "recovery from rest"].some((token) => effectKey.includes(token))) utility += 5.0;
    if (["weather def", "weather defense", "weather resistance", "cold weather", "hot weather"].some((token) => effectKey.includes(token))) {
      utility += 4.8;
    }
    const hasResistance = effectKey.includes(" resistance") || effectKey.includes(" resist");
    if (
      ["immunity", "resistance up", "impact resistance"].some((token) => effectKey.includes(token)) ||
      (hasResistance && !["-", "weakens", "reduced"].some((token) => effectKey.includes(token)))
    ) {
      utility += 4.2;
    }
    if (["boon", "buff", "damage bonus", "stealth", "ambush chance greatly reduced"].some((token) => effectKey.includes(token))) utility += 3.6;
    if (["stamina cost", "mana cost"].some((token) => effectKey.includes(token))) {
      utility += effectKey.includes("-") || effectKey.includes("reduced") ? 4.0 : -1.6;
    }
    if (["refills hunger", "refills drink", "refills hunger and drink"].some((token) => effectKey.includes(token))) utility += 4.4;
    if (["travel", "comfort", "ally", "utility", "alertness", "support"].some((token) => effectKey.includes(token))) utility += 2.2;
    if (["removes", "cures", "restores", "healing", "stamina", "mana"].some((token) => effectKey.includes(token))) utility += 1.2;
    if (effectKey.includes("ambush chance increased")) utility -= 2.8;
    if (effectKey.includes("cannot be picked back up")) utility -= 3.2;
    if (["raises corruption", "corruption while sleeping"].some((token) => effectKey.includes(token))) utility -= 4.2;
    if (hasResistance && ["-", "weakens", "reduced"].some((token) => effectKey.includes(token))) utility -= 4.0;
  }
  return utility;
}

function smartScore(row: RecipeResult) {
  const ingredientCount = Math.max(1, row.ingredient_list.length);
  const uniqueIngredients = new Set(row.ingredient_list.map((itemName) => key(itemName))).size;
  const effects = effectsList(row.effects);
  const category = row.category || inferItemCategory(row.result, row.category);
  const effectiveWeight = inferredWeight(row.result, category, Number(row.weight_each) || 0);
  const value = economicValue(row.sale_value_each, row.buy_value_each);
  let strategicBonus = 0;
  if (effects.some((effect) => key(effect).includes("burnt"))) strategicBonus += 2.2;
  if (
    effects.some((effect) =>
      ["weather", "resistance", "damage bonus", "mana cost", "stamina cost", "stealth", "ambush", "health per second"].some((token) =>
        key(effect).includes(token),
      ),
    )
  ) {
    strategicBonus += 1.8;
  }

  const perItemUtility =
    row.heal_each * 0.55 +
    row.stamina_each * 0.5 +
    row.mana_each * 0.62 +
    value * 0.12 +
    effects.length * 2.2 +
    effectUtility(effects) +
    categoryUtility(category) +
    nameUtilityBonus(row.result, row.effects) +
    strategicBonus;

  const throughputBonus =
    Math.min(row.max_crafts, 4) * 1.0 +
    Math.min(row.max_total_output, 8) * 0.45 +
    Math.min(row.result_qty_per_craft, 4) * 0.9 +
    (row.result_qty_per_craft / ingredientCount) * 1.6;

  const complexityPenalty = ingredientCount * 1.15 + Math.max(0, uniqueIngredients - 1) * 0.45;
  const utilityDensity = perItemUtility / Math.max(effectiveWeight, 0.25);
  const valueDensity = value / Math.max(effectiveWeight, 0.25);
  const weightBonus = Math.min(utilityDensity, 24) * 0.34 + Math.min(valueDensity, 90) * 0.07;
  let carryPenalty = Math.max(0, effectiveWeight - 0.75) * 0.62;
  if (perItemUtility < 5 && effectiveWeight > 2) {
    carryPenalty += (effectiveWeight - 2) * 1.1;
  }
  if (["deployable", "deployables"].includes(key(category)) && perItemUtility >= 10) {
    carryPenalty *= 0.65;
  }

  let score = perItemUtility + throughputBonus + weightBonus + stationConvenience(row.station) - complexityPenalty - carryPenalty;
  if (perItemUtility <= 1.5) score -= 1.0;
  return score;
}

function toRecipeResult(recipe: RecipeDatabaseRecord, inventory: CounterMap, groups: Map<string, string[]>): RecipeResult {
  const resultQty = Math.trunc(recipe.result_qty || 1);
  const missingDetail = missingSlotDetails(recipe.ingredient_list, inventory, groups, recipe.result, resultQty);
  const weightEach = inferredWeight(recipe.result, recipe.category, Number(recipe.weight) || 0);
  const maxCrafts = maxCraftsForRecipe(recipe.ingredient_list, inventory, groups, recipe.result, resultQty);
  const maxTotalOutput = maxCrafts * resultQty;
  const category = recipe.category || inferItemCategory(recipe.result, recipe.category);

  const row: RecipeResult = {
    result: recipe.result,
    result_qty_per_craft: resultQty,
    max_crafts: maxCrafts,
    max_total_output: maxTotalOutput,
    station: normalizeStation(recipe.station),
    recipe_page: recipe.recipe_page,
    section: recipe.section,
    ingredients: recipe.ingredient_list.join(", "),
    ingredient_list: [...recipe.ingredient_list],
    matched_slots: missingDetail.matchedSlots,
    missing_slots: missingDetail.missingCount,
    missing_items: missingDetail.missing.join(", "),
    heal_each: Number(recipe.heal) || 0,
    stamina_each: Number(recipe.stamina) || 0,
    mana_each: Number(recipe.mana) || 0,
    sale_value_each: Number(recipe.sale_value) || 0,
    buy_value_each: Number(recipe.buy_value) || 0,
    weight_each: weightEach,
    value_per_weight_each: (Number(recipe.sale_value) || 0) / Math.max(weightEach, 0.25),
    effects: normalize(recipe.effects),
    category,
    healing_total: (Number(recipe.heal) || 0) * maxTotalOutput,
    stamina_total: (Number(recipe.stamina) || 0) * maxTotalOutput,
    mana_total: (Number(recipe.mana) || 0) * maxTotalOutput,
    sale_value_total: (Number(recipe.sale_value) || 0) * maxTotalOutput,
    smart_score: 0,
  };
  row.smart_score = smartScore(row);
  return row;
}

function sortByFields(rows: RecipeResult[], orderBy: Array<{ field: keyof RecipeResult | "result"; ascending: boolean }>) {
  return [...rows].sort((left, right) => {
    for (const { field, ascending } of orderBy) {
      const leftValue = left[field];
      const rightValue = right[field];
      if (leftValue === rightValue) continue;
      const comparison =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue));
      return ascending ? comparison : -comparison;
    }
    return 0;
  });
}

function recipeSortOrder(sortMode: string): Array<{ field: keyof RecipeResult; ascending: boolean }> {
  switch (sortMode) {
    case "Max crafts":
      return [
        { field: "max_crafts", ascending: false },
        { field: "max_total_output", ascending: false },
        { field: "result", ascending: true },
      ] as Array<{ field: keyof RecipeResult | "result"; ascending: boolean }>;
    case "Max total output":
      return [
        { field: "max_total_output", ascending: false },
        { field: "max_crafts", ascending: false },
        { field: "result", ascending: true },
      ];
    case "Best healing":
      return [
        { field: "healing_total", ascending: false },
        { field: "max_total_output", ascending: false },
        { field: "result", ascending: true },
      ];
    case "Best stamina":
      return [
        { field: "stamina_total", ascending: false },
        { field: "max_total_output", ascending: false },
        { field: "result", ascending: true },
      ];
    case "Best mana":
      return [
        { field: "mana_total", ascending: false },
        { field: "max_total_output", ascending: false },
        { field: "result", ascending: true },
      ];
    case "Sale value":
      return [
        { field: "sale_value_total", ascending: false },
        { field: "max_total_output", ascending: false },
        { field: "result", ascending: true },
      ];
    case "Result A-Z":
      return [{ field: "result", ascending: true }];
    default:
      return [
        { field: "smart_score", ascending: false },
        { field: "max_crafts", ascending: false },
        { field: "result", ascending: true },
      ];
  }
}

export function orderCraftableResults(rows: RecipeResult[], sortMode: string) {
  return sortByFields(rows, recipeSortOrder(sortMode));
}

function orderedNearResults(rows: RecipeResult[]) {
  return [...rows].sort((left, right) =>
    compareTuple(
      [left.missing_slots, -left.matched_slots, left.result],
      [right.missing_slots, -right.matched_slots, right.result],
    ),
  );
}

function matchingResultRows<T extends { result: string }>(rows: T[], result: string) {
  const resultKey = key(result);
  return rows.filter((row) => key(row.result) === resultKey);
}

function orderedEvaluatedMatches(rows: RecipeResult[]) {
  return [...rows].sort((left, right) =>
    compareTuple(
      [-left.max_crafts, -left.matched_slots, left.missing_slots, -left.smart_score, left.result],
      [-right.max_crafts, -right.matched_slots, right.missing_slots, -right.smart_score, right.result],
    ),
  );
}

function filteredRecipes(data: RuntimeData, stations?: string[]) {
  if (stations == null) return [...data.metadata.recipes];
  const normalizedStations = stations.map((station) => normalizeStation(station)).filter(Boolean);
  if (!normalizedStations.length) return [] as RecipeDatabaseRecord[];
  return data.metadata.recipes.filter((recipe) => normalizedStations.includes(normalizeStation(recipe.station)));
}

function recipeSurfaceFrames(data: RuntimeData, inventory: CounterMap, stations?: string[], maxMissingSlots = 2) {
  const filtered = filteredRecipes(data, stations);
  const evaluated = filtered.map((recipe) => toRecipeResult(recipe, inventory, data.groups));
  const craftable = evaluated.filter((row) => row.max_crafts > 0);
  const near = evaluated.filter((row) => row.max_crafts === 0 && row.missing_slots <= maxMissingSlots && row.matched_slots > 0);
  return { filtered, evaluated, craftable, near };
}

function snapshotEffectTokens(effects: string) {
  return effects
    .split(";")
    .map((effect) => key(effect))
    .filter(Boolean);
}

function snapshotEffectAmount(effects: string[], fragment: string) {
  let best = 0;
  for (const effect of effects) {
    if (!effect.includes(fragment)) continue;
    const match = effect.match(/(\d+(?:\.\d+)?)/);
    best = Math.max(best, match ? Number(match[1]) : 1);
  }
  return best;
}

function snapshotRowMatchesStat(row: RecipeResult, statEachColumn: "heal_each" | "stamina_each" | "mana_each") {
  const effects = snapshotEffectTokens(row.effects);
  const statValue = Number(row[statEachColumn]) || 0;
  if (statValue > 0) return true;
  if (statEachColumn === "heal_each") {
    return effects.some((effect) => effect.includes("health recovery") || effect.includes("burnt health"));
  }
  if (statEachColumn === "stamina_each") {
    return effects.some((effect) => effect.includes("stamina recovery") || effect.includes("burnt stamina"));
  }
  return effects.some((effect) => effect.includes("mana recovery") || effect.includes("burnt mana"));
}

function snapshotStatScore(row: RecipeResult, statEachColumn: "heal_each" | "stamina_each" | "mana_each") {
  const effects = snapshotEffectTokens(row.effects);
  const healthRecovery = snapshotEffectAmount(effects, "health recovery");
  const staminaRecovery = snapshotEffectAmount(effects, "stamina recovery");
  const manaRecovery = snapshotEffectAmount(effects, "mana recovery");
  const burntHealth = snapshotEffectAmount(effects, "burnt health");
  const burntStamina = snapshotEffectAmount(effects, "burnt stamina");
  const burntMana = snapshotEffectAmount(effects, "burnt mana");
  const category = key(row.category);

  if (statEachColumn === "heal_each") {
    let score =
      row.heal_each * 0.45 +
      healthRecovery * 7 +
      row.stamina_each * 0.22 +
      staminaRecovery * 7 +
      burntHealth * 0.55 +
      row.smart_score * 0.2;
    if (row.heal_each > 0 && row.stamina_each > 0) score += 4;
    if (["food", "tea", "potions and drinks"].includes(category)) score += 1;
    return score;
  }

  if (statEachColumn === "stamina_each") {
    let score =
      row.stamina_each * 0.55 +
      staminaRecovery * 9 +
      row.heal_each * 0.18 +
      healthRecovery * 4 +
      burntStamina * 0.6 +
      row.smart_score * 0.18;
    if (row.heal_each > 0 && row.stamina_each > 0) score += 4;
    if (["food", "tea", "potions and drinks"].includes(category)) score += 1;
    return score;
  }

  let score = row.mana_each * 0.95 + manaRecovery * 7 + burntMana * 0.8 + row.smart_score * 0.2;
  if (["potion", "tea", "potions and drinks", "food"].includes(category)) score += 1.5;
  return score;
}

function snapshotBestResult(craftable: RecipeResult[], statEachColumn: "heal_each" | "stamina_each" | "mana_each") {
  const eligible = craftable.filter((row) => snapshotRowMatchesStat(row, statEachColumn));
  if (!eligible.length) return null;
  return [...eligible]
    .map((row) => ({ row, score: snapshotStatScore(row, statEachColumn) }))
    .sort((left, right) =>
      compareTuple(
        [-left.score, -left.row.smart_score, -(left.row[statEachColumn] as number), -left.row.max_total_output, left.row.result],
        [-right.score, -right.row.smart_score, -(right.row[statEachColumn] as number), -right.row.max_total_output, right.row.result],
      ),
    )[0].row.result;
}

function snapshotPayload(filtered: RecipeDatabaseRecord[], craftable: RecipeResult[], near: RecipeResult[], inventory: CounterMap): Snapshot {
  return {
    inventory_lines: counterToItems(inventory).length,
    known_recipes: filtered.length,
    direct_crafts: craftable.length,
    near_crafts: near.length,
    best_heal: snapshotBestResult(craftable, "heal_each"),
    best_stamina: snapshotBestResult(craftable, "stamina_each"),
    best_mana: snapshotBestResult(craftable, "mana_each"),
  };
}

function shoppingItemPlan(
  item: string,
  inventory: CounterMap,
  groups: Map<string, string[]>,
  recipeIndexMap: Map<string, RecipeDatabaseRecord[]>,
  depth = 0,
  maxDepth = 6,
  stack: string[] = [],
): { missing: CounterMap; plan: PlanNode } {
  const itemName = normalize(item);

  if (consumeItem(inventory, itemName, 1)) {
    return { missing: new Map(), plan: { type: "use", item: itemName } };
  }

  const itemKey = key(itemName);
  if (depth >= maxDepth || stack.includes(itemKey)) {
    return { missing: new Map([[itemName, 1]]), plan: { type: "missing", item: itemName } };
  }

  const candidates = [...(recipeIndexMap.get(itemKey) ?? [])].sort((left, right) =>
    compareTuple([left.ingredient_list.length, left.station, left.result], [right.ingredient_list.length, right.station, right.result]),
  );
  if (!candidates.length) {
    return { missing: new Map([[itemName, 1]]), plan: { type: "missing", item: itemName } };
  }

  let bestChoice:
    | {
        rank: Array<number | string>;
        missing: CounterMap;
        plan: PlanNode;
        inventory: CounterMap;
      }
    | undefined;

  for (const recipe of candidates) {
    const { slots, assignments } = validSlotAssignments(recipe.ingredient_list, groups, recipe.result, recipe.result_qty);
    const orderedAssignments = [...assignments].sort((left, right) =>
      compareTuple(assignmentSortKey(left, inventory, recipeIndexMap), assignmentSortKey(right, inventory, recipeIndexMap)),
    );

    for (const assignment of orderedAssignments) {
      const trialInventory = cloneCounter(inventory);
      if (!selfGroupSlotsSupported(slots, assignment, recipe.result, groups, trialInventory)) continue;

      const totalMissing = new Map<string, number>();
      const steps: PlanNode[] = [];
      for (let index = 0; index < slots.length; index += 1) {
        const slot = slots[index];
        const chosenItem = assignment[index];
        const child = shoppingItemPlan(chosenItem, trialInventory, groups, recipeIndexMap, depth + 1, maxDepth, [...stack, itemKey]);
        for (const [missingItem, qty] of child.missing.entries()) {
          totalMissing.set(missingItem, (totalMissing.get(missingItem) ?? 0) + qty);
        }
        const nextPlan: PlanNode = groups.has(key(slot.tokenName))
          ? { type: "group", group: slot.tokenName, chosen: chosenItem, step: child.plan }
          : child.plan;
        steps.push(nextPlan);
      }

      incrementCount(trialInventory, recipe.result, Math.trunc(recipe.result_qty || 1));
      consumeItem(trialInventory, recipe.result, 1);

      const rank: Array<number | string> = [
        [...totalMissing.values()].reduce((sum, qty) => sum + qty, 0),
        totalMissing.size,
        recipe.ingredient_list.length,
        recipe.station,
      ];
      const plan: PlanNode = { type: "craft", item: itemName, recipe, steps };
      if (!bestChoice || compareTuple(rank, bestChoice.rank) < 0) {
        bestChoice = { rank, missing: totalMissing, plan, inventory: trialInventory };
      }
    }
  }

  if (!bestChoice) {
    return { missing: new Map([[itemName, 1]]), plan: { type: "missing", item: itemName } };
  }

  inventory.clear();
  for (const [inventoryItem, qty] of bestChoice.inventory.entries()) {
    inventory.set(inventoryItem, qty);
  }
  return { missing: bestChoice.missing, plan: bestChoice.plan };
}

function formatPlanLines(plan: PlanNode, level = 0): string[] {
  const pad = "  ".repeat(level);
  switch (plan.type) {
    case "use":
      return [`${pad}- Use existing: ${plan.item}`];
    case "missing":
      return [`${pad}- Missing ingredient to buy or farm: ${plan.item}`];
    case "group":
      return [`${pad}- Fill group '${plan.group}' with: ${plan.chosen}`, ...formatPlanLines(plan.step, level + 1)];
    case "craft":
      return [
        `${pad}- Craft ${plan.recipe.result} at ${plan.recipe.station} using ${plan.recipe.ingredient_list.join(", ")}`,
        ...plan.steps.flatMap((step) => formatPlanLines(step, level + 1)),
      ];
  }
}

function planSummary(plan: PlanNode, target: string, found: boolean, stationFilteredOut: boolean) {
  let craftSteps = 0;
  let useSteps = 0;
  let groupSteps = 0;
  let usesExistingTarget = false;
  const targetKey = key(target);

  function walk(step: PlanNode, atRoot = false) {
    if (step.type === "craft") {
      craftSteps += 1;
      step.steps.forEach((child) => walk(child));
      return;
    }
    if (step.type === "use") {
      useSteps += 1;
      if (atRoot && key(step.item) === targetKey) usesExistingTarget = true;
      return;
    }
    if (step.type === "group") {
      groupSteps += 1;
      walk(step.step);
    }
  }

  walk(plan, true);

  let mode = "no_route";
  if (found) {
    if (usesExistingTarget) mode = "use_existing_target";
    else if (craftSteps <= 1) mode = "direct_craft_route";
    else mode = "recursive_craft_route";
  } else if (stationFilteredOut) {
    mode = "station_filtered_out";
  } else if (craftSteps > 0 || useSteps > 0 || groupSteps > 0) {
    mode = "partial_route";
  }

  return {
    mode,
    craftSteps,
    usesExistingTarget,
    requiresCrafting: craftSteps > 0,
  };
}

function plannerExplanation(target: string, found: boolean, mode: string, stationFilteredOut: boolean, craftingOneMore: boolean, ownedQty: number) {
  if (craftingOneMore && ownedQty > 0) {
    const ownedUnit = ownedQty === 1 ? "copy" : "copies";
    const ownedPrefix = `You already have ${ownedQty} ${ownedUnit} of ${target} in your bag. `;
    if (found && mode === "direct_craft_route") {
      return `${ownedPrefix}You can craft one more directly with the current inventory, depth, and station filters.`;
    }
    if (found && mode === "recursive_craft_route") {
      return `${ownedPrefix}You can craft one more by following an intermediate route.`;
    }
    if (found) return `${ownedPrefix}A one-more route is available.`;
    if (stationFilteredOut) {
      return `${ownedPrefix}You cannot craft one more with the current station filters. Enable the missing station to build a route.`;
    }
    return `${ownedPrefix}No complete route for one more copy was found. The steps below show the closest branch and what is still missing.`;
  }

  if (found && mode === "use_existing_target") {
    return "The target is already in your bag. No crafting route is needed unless you want to make another copy.";
  }
  if (found && mode === "direct_craft_route") {
    return "Complete route found. You can craft this target directly with the current inventory, planner depth, and station filters.";
  }
  if (found) {
    return "Complete route found. The planner can build this target through intermediate crafts with the current inventory, planner depth, and station filters.";
  }
  if (stationFilteredOut) {
    return "No recipe for this target is available with the current station filters. Enable the needed station to build a route.";
  }
  return "No complete route was found. The steps below show the closest route the planner could build, and the missing list shows what is still required.";
}

function plannerRoute(data: RuntimeData, inventory: CounterMap, target: string, maxDepth: number, stations: string[] | undefined, craftingOneMore: boolean, ownedQty: number): PlannerRoute {
  const targetName = normalize(target);
  const workingInventory = cloneCounter(inventory);
  if (craftingOneMore && ownedQty > 0) {
    workingInventory.delete(targetName);
  }

  const filtered = filteredRecipes(data, stations);
  const filteredRecipeIndex = recipeIndex(filtered);
  const targetKey = key(targetName);
  const shopping = shoppingItemPlan(targetName, workingInventory, data.groups, filteredRecipeIndex, 0, maxDepth, []);
  const found = shopping.missing.size === 0;
  const stationFilteredOut = data.recipeIndex.has(targetKey) && !filteredRecipeIndex.has(targetKey);
  const summary = planSummary(shopping.plan, targetName, found, stationFilteredOut);

  const remainingInventory = found ? cloneCounter(workingInventory) : cloneCounter(inventory);
  if (craftingOneMore && ownedQty > 0 && found) {
    incrementCount(remainingInventory, targetName, ownedQty);
  }

  return {
    target: targetName,
    found,
    explanation: plannerExplanation(targetName, found, summary.mode, stationFilteredOut, craftingOneMore, ownedQty),
    lines: formatPlanLines(shopping.plan),
    missing: counterToItems(shopping.missing),
    remaining_inventory: counterToItems(remainingInventory),
    mode: summary.mode,
    craft_steps: summary.craftSteps,
    uses_existing_target: summary.usesExistingTarget,
    requires_crafting: summary.requiresCrafting,
    station_filtered_out: stationFilteredOut,
  };
}

export function calculatePlanner(data: RuntimeData, inventory: CounterMap, target: string, maxDepth: number, stations?: string[]): PlannerResponse {
  const targetName = normalize(target);
  const ownedQty = getCount(inventory, targetName);
  const baselineRoute = plannerRoute(data, inventory, targetName, maxDepth, stations, false, ownedQty);
  const oneMoreRoute = ownedQty > 0 ? plannerRoute(data, inventory, targetName, maxDepth, stations, true, ownedQty) : baselineRoute;
  const effectiveRoute = ownedQty > 0 ? oneMoreRoute : baselineRoute;
  const planningGoal = ownedQty > 0 ? "craft_one_more" : "obtain_target";

  return {
    target: targetName,
    found: effectiveRoute.found,
    explanation: effectiveRoute.explanation,
    lines: effectiveRoute.lines,
    missing: effectiveRoute.missing,
    remaining_inventory: effectiveRoute.remaining_inventory,
    mode: effectiveRoute.mode,
    craft_steps: effectiveRoute.craft_steps,
    uses_existing_target: effectiveRoute.uses_existing_target,
    requires_crafting: effectiveRoute.requires_crafting,
    target_owned_qty: ownedQty,
    already_owned: ownedQty > 0,
    planning_goal: planningGoal,
    baseline_found: baselineRoute.found,
    baseline_mode: baselineRoute.mode,
    baseline_reason: baselineRoute.explanation,
    baseline_missing: baselineRoute.missing,
    one_more_found: oneMoreRoute.found,
    one_more_mode: oneMoreRoute.mode,
    one_more_reason: oneMoreRoute.explanation,
    one_more_missing: oneMoreRoute.missing,
    one_more_craft_steps: oneMoreRoute.craft_steps,
    one_more_requires_crafting: oneMoreRoute.requires_crafting,
    owned_satisfies_target: ownedQty > 0 && baselineRoute.found && baselineRoute.mode === "use_existing_target",
  };
}

export function calculateShoppingList(
  data: RuntimeData,
  inventory: CounterMap,
  targets: Array<{ item: string; qty: number }>,
  maxDepth: number,
  stations?: string[],
): ShoppingListResponse {
  const targetCounts = new Map<string, number>();
  for (const target of targets) {
    const itemName = normalize(target.item);
    const qty = Math.max(0, Math.trunc(Number(target.qty) || 0));
    if (!itemName || qty <= 0) continue;
    targetCounts.set(itemName, (targetCounts.get(itemName) ?? 0) + qty);
  }

  const workingInventory = cloneCounter(inventory);
  const totalMissing = new Map<string, number>();
  const lines: string[] = [];
  const filteredRecipeIndex = recipeIndex(filteredRecipes(data, stations));

  for (const [itemName, qty] of [...targetCounts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`${itemName} x${qty}`);
    for (let craftIndex = 0; craftIndex < qty; craftIndex += 1) {
      const shopping = shoppingItemPlan(itemName, workingInventory, data.groups, filteredRecipeIndex, 0, maxDepth, []);
      for (const [missingItem, missingQty] of shopping.missing.entries()) {
        totalMissing.set(missingItem, (totalMissing.get(missingItem) ?? 0) + missingQty);
      }
      lines.push(...formatPlanLines(shopping.plan, 1));
      if (craftIndex < qty - 1) {
        lines.push("  - Repeat for another copy");
      }
    }
  }

  return {
    targets: counterToItems(targetCounts),
    missing: counterToItems(totalMissing),
    lines,
    remaining_inventory: counterToItems(workingInventory),
  };
}

export function calculateDashboard(data: RuntimeData, inventory: CounterMap, stations: string[], maxMissingSlots = 2): DashboardResponse {
  const frames = recipeSurfaceFrames(data, inventory, stations, maxMissingSlots);
  const bestDirect = orderCraftableResults(frames.craftable, "Smart score").slice(0, 8);
  const near = orderedNearResults(frames.near).slice(0, 30);
  return {
    inventory: inventoryResponse(inventory),
    snapshot: snapshotPayload(frames.filtered, frames.craftable, frames.near, inventory),
    best_direct: {
      sort_mode: "Smart score",
      count: frames.craftable.length,
      near_count: frames.near.length,
      shortlist_limit: 8,
      items: bestDirect,
    },
    near: {
      count: frames.near.length,
      known_recipes: frames.filtered.length,
      items: near,
    },
  };
}

export function calculateDirect(data: RuntimeData, inventory: CounterMap, sortMode: string, stations: string[], maxMissingSlots = 2, limit?: number): DirectResponse {
  const frames = recipeSurfaceFrames(data, inventory, stations, maxMissingSlots);
  let ordered = orderCraftableResults(frames.craftable, sortMode);
  if (limit != null) ordered = ordered.slice(0, limit);
  return {
    sort_mode: sortMode,
    count: frames.craftable.length,
    near_count: frames.near.length,
    items: ordered,
  };
}

export function calculateNear(data: RuntimeData, inventory: CounterMap, stations: string[], maxMissingSlots = 2, limit?: number): NearResponse {
  const frames = recipeSurfaceFrames(data, inventory, stations, maxMissingSlots);
  let ordered = orderedNearResults(frames.near);
  if (limit != null) ordered = ordered.slice(0, limit);
  return {
    count: frames.near.length,
    known_recipes: frames.filtered.length,
    items: ordered,
  };
}

function craftableSortPositions(craftable: RecipeResult[], result: string) {
  const positions: RecipeDebugResponse["sort_positions"] = [];
  const total = craftable.length;
  for (const { sortMode, primaryColumn } of CRAFTABLE_DEBUG_SORT_MODES) {
    const ordered = orderCraftableResults(craftable, sortMode);
    const matches = matchingResultRows(ordered, result);
    const bestRow = matches[0];
    const rank = bestRow ? ordered.findIndex((row) => row === bestRow) + 1 : null;
    const primaryValue = bestRow ? (bestRow[primaryColumn as keyof RecipeResult] as number | string | null) : null;
    positions.push({
      sort_mode: sortMode,
      rank,
      total,
      primary_column: primaryColumn,
      primary_value: primaryValue,
    });
  }
  return positions;
}

export function calculateRecipeDebug(
  data: RuntimeData,
  inventory: CounterMap,
  result: string,
  stations: string[],
  maxMissingSlots: number,
  plannerDepth: number,
): RecipeDebugResponse {
  const resultName = normalize(result);
  const frames = recipeSurfaceFrames(data, inventory, stations, maxMissingSlots);
  const smartRanked = orderCraftableResults(frames.craftable, "Smart score");
  const nearRanked = orderedNearResults(frames.near);
  const filteredMatches = matchingResultRows(frames.filtered, resultName);
  const evaluatedMatches = matchingResultRows(frames.evaluated, resultName);
  const craftableMatches = matchingResultRows(smartRanked, resultName);
  const nearMatches = matchingResultRows(nearRanked, resultName);

  const planner = calculatePlanner(data, inventory, resultName, plannerDepth, stations);
  const targetOwnedQty = getCount(inventory, resultName);
  const orderedEvaluated = orderedEvaluatedMatches(evaluatedMatches);
  const bestMatchingRow = craftableMatches[0] ?? orderedEvaluated[0] ?? null;
  const bestSmartScore = craftableMatches[0]?.smart_score ?? null;
  const sortPositions = craftableSortPositions(frames.craftable, resultName);

  let craftablePanelReason = "This result has recipe rows, but none of them are craftable now.";
  if (!filteredMatches.length) {
    craftablePanelReason = "No recipe rows for this result are available under the current station filters.";
  } else if (targetOwnedQty > 0 && !craftableMatches.length && planner.planning_goal === "craft_one_more" && planner.found) {
    craftablePanelReason =
      "You already own this result. The craftable panel still excludes it because no recipe row is directly craftable now, even though the planner can build one more copy through another route type.";
  } else if (targetOwnedQty > 0 && !craftableMatches.length) {
    craftablePanelReason =
      "You already own this result, but none of its recipe rows are craftable from ingredients right now. The craftable panel only shows recipe rows you can make now.";
  } else if (craftableMatches.length) {
    craftablePanelReason =
      "At least one matching recipe row is craftable now, so it appears in the main craftable recipes panel. Sorting only changes order.";
  }

  let nearReason = "No evaluated recipe rows were available for this result.";
  if (!filteredMatches.length) {
    nearReason = "No recipe rows for this result are available under the current station filters.";
  } else if (craftableMatches.length) {
    nearReason = "This result is already craftable now, so it is intentionally excluded from Almost craftable.";
  } else if (targetOwnedQty > 0 && planner.planning_goal === "craft_one_more" && planner.found) {
    nearReason =
      "You already own this result, and the planner can build one more copy. Almost craftable still only tracks direct recipe rows that are close to craftable from ingredients.";
  } else if (targetOwnedQty > 0) {
    nearReason = "You already own this result, but Almost craftable only tracks direct recipe rows that are close to craftable from ingredients.";
  } else if (nearMatches.length) {
    nearReason = `The closest matching row is inside the near-craft threshold at ${nearMatches[0].missing_slots} missing slot(s).`;
  } else if (evaluatedMatches.length && Math.max(...evaluatedMatches.map((row) => row.matched_slots)) <= 0) {
    nearReason = "No ingredient slots are currently satisfied, so it is intentionally excluded from Almost craftable.";
  } else if (evaluatedMatches.length) {
    nearReason =
      `The closest matching row still needs ${Math.min(...evaluatedMatches.map((row) => row.missing_slots))} missing slot(s), which is above the current threshold of ${maxMissingSlots}.`;
  }

  const bestSmartRank = sortPositions.find((entry) => entry.sort_mode === "Smart score")?.rank ?? null;
  const craftableSortReason = craftableMatches.length
    ? `The best matching craftable row is ranked #${bestSmartRank} by Smart score. Other sort modes can move it, but they do not remove it from the craftable panel.`
    : "No craftable row is available yet, so this result has no craftable ranking.";

  let plannerAlignmentReason = "Planner and direct craft are using different route types for this result.";
  if (targetOwnedQty > 0 && planner.planning_goal === "craft_one_more") {
    if (craftableMatches.length && planner.found) {
      plannerAlignmentReason = "You already own this target, and both planner and direct craft agree you can make one more now.";
    } else if (!craftableMatches.length && planner.found) {
      plannerAlignmentReason =
        "You already own this target. Planner can produce one more copy through a non-direct route, while the craftable panel still requires a directly craftable row.";
    } else if (!craftableMatches.length && !planner.found) {
      plannerAlignmentReason = "You already own this target, but planner and direct craft agree you cannot produce one more copy yet.";
    }
  } else if (!craftableMatches.length && planner.found && planner.mode === "recursive_craft_route") {
    plannerAlignmentReason =
      "Planner succeeds through intermediate crafting. The craftable panel only shows recipe rows you can craft directly right now.";
  } else if (craftableMatches.length && planner.found) {
    plannerAlignmentReason = "Planner and direct craft agree: at least one matching recipe row is directly craftable now.";
  } else if (!craftableMatches.length && !planner.found) {
    plannerAlignmentReason = "Planner and direct craft agree that the current inventory and filters do not complete this result yet.";
  }

  const matchingRecipe = bestMatchingRow
    ? {
        ingredients: bestMatchingRow.ingredients,
        station: bestMatchingRow.station,
        max_crafts: bestMatchingRow.max_crafts,
        missing_slots: bestMatchingRow.missing_slots,
        matched_slots: bestMatchingRow.matched_slots,
      }
    : null;

  return {
    result: resultName,
    selected_stations: stations.length ? stations.map((station) => normalizeStation(station)) : [...data.stationOptions],
    max_missing_slots: maxMissingSlots,
    planner_depth: plannerDepth,
    target_owned_qty: targetOwnedQty,
    recipe_database_rows: filteredMatches.length,
    evaluated_recipe_rows: evaluatedMatches.length,
    craftable_recipe_rows: craftableMatches.length,
    near_recipe_rows: nearMatches.length,
    craftable_now: craftableMatches.length > 0,
    craftable_panel: craftableMatches.length > 0,
    craftable_panel_reason: craftablePanelReason,
    near_craft: nearMatches.length > 0,
    near_reason: nearReason,
    smart_score: bestSmartScore,
    craftable_sort_reason: craftableSortReason,
    sort_positions: sortPositions,
    planner_found: planner.found,
    planner_mode: planner.mode,
    planner_goal: planner.planning_goal,
    planner_target_owned_qty: planner.target_owned_qty,
    planner_already_owned: planner.already_owned,
    planner_owned_satisfies_target: planner.owned_satisfies_target,
    planner_one_more_found: planner.one_more_found,
    planner_one_more_mode: planner.one_more_mode,
    planner_one_more_reason: planner.one_more_reason,
    planner_one_more_missing: planner.one_more_missing,
    planner_baseline_found: planner.baseline_found,
    planner_baseline_mode: planner.baseline_mode,
    planner_uses_existing_target: planner.uses_existing_target,
    planner_craft_steps: planner.craft_steps,
    planner_reason: planner.explanation,
    planner_alignment_reason: plannerAlignmentReason,
    planner_missing: planner.missing,
    matching_recipe: matchingRecipe,
    evaluated_rows: orderedEvaluated.slice(0, 8),
    craftable_rows: craftableMatches.slice(0, 5),
    near_rows: nearMatches.slice(0, 5),
  };
}
