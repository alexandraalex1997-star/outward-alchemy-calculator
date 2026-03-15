from __future__ import annotations

from collections import Counter, deque
from typing import Dict, List, Optional, Tuple

import pandas as pd


TEXT_REPAIRS = {
    "â€“": "-",
    "â€”": "-",
    "â€™": "'",
    "â€œ": '"',
    "â€": '"',
}

TEXT_REPAIRS.update(
    {
        "\u00e2\u20ac\u201c": "-",
        "\u00e2\u20ac\u201d": "-",
        "\u00e2\u20ac\u2122": "'",
        "\u00e2\u20ac\u0153": '"',
        "\u00e2\u20ac\ufffd": '"',
    }
)

CANONICAL_GROUPS: Dict[str, List[str]] = {
    "water": ["Clean Water", "Salt Water", "Rancid Water", "Leyline Water"],
    "egg": [
        "Bird Egg",
        "Cooked Bird Egg",
        "Larva Egg",
        "Cooked Larva Egg",
        "Veaber's Egg",
        "Boiled Veaber Egg",
        "Torcrab Egg",
        "Cooked Torcrab Egg",
    ],
    "fish": [
        "Boiled Miasmapod",
        "Miasmapod",
        "Grilled Rainbow Trout",
        "Grilled Salmon",
        "Raw Rainbow Trout",
        "Raw Salmon",
        "Antique Eel",
        "Grilled Eel",
        "Manaheart Bass",
        "Grilled Manaheart Bass",
        "Pypherfish",
        "Larva Egg",
    ],
    "meat": [
        "Raw Meat",
        "Cooked Meat",
        "Raw Alpha Meat",
        "Cooked Alpha Meat",
        "Raw Jewel Meat",
        "Cooked Jewel Meat",
        "Boozu's Meat",
        "Cooked Boozu's Meat",
        "Raw Torcrab Meat",
        "Grilled Torcrab Meat",
    ],
    "mushroom": [
        "Blood Mushroom",
        "Common Mushroom",
        "Grilled Woolshroom",
        "Nightmare Mushroom",
        "Star Mushroom",
        "Sulphuric Mushroom",
        "Woolshroom",
    ],
    "vegetable": [
        "Cactus Fruit",
        "Boiled Cactus Fruit",
        "Gaberries",
        "Boiled Gaberries",
        "Krimp Nut",
        "Marshmelon",
        "Grilled Marshmelon",
        "Turmmip",
        "Boiled Turmmip",
        "Grilled Mushroom",
        "Seared Root",
        "Smoke Root",
        "Dreamer's Root",
        "Crawlberry",
        "Purpkin",
        "Golden Crescent",
        "Ableroot",
        "Rainbow Peach",
        "Maize",
    ],
    "basic armor": ["Desert Tunic", "Makeshift Leather Attire"],
    "basic boots": ["Makeshift Leather Boots"],
    "basic helm": ["Makeshift Leather Hat"],
    "bread (any)": ["Bread", "Bread Of The Wild", "Toast"],
    "advanced tent": [
        "Advanced Tent",
        "Luxury Tent",
        "Mage Tent",
        "Fur Tent",
        "Camouflaged Tent",
        "Plant Tent",
        "Calygrey Bone Cage",
        "Scourge Cocoon",
        "Corruption Totemic Lodge",
        "Ethereal Totemic Lodge",
        "Fire Totemic Lodge",
        "Ice Totemic Lodge",
        "Lightning Totemic Lodge",
    ],
}


def normalize(text: str) -> str:
    value = str(text or "")
    for broken, fixed in TEXT_REPAIRS.items():
        value = value.replace(broken, fixed)
    return " ".join(value.strip().split())


def key(text: str) -> str:
    return normalize(text).casefold()


def normalize_station(text: str) -> str:
    station = normalize(text)
    return station or "Manual Crafting"


def sanitize_groups(recipes_df: pd.DataFrame, raw_groups: Dict[str, List[str]]) -> Dict[str, List[str]]:
    known_items = set()
    ingredient_tokens = set()
    result_keys = set()
    for _, row in recipes_df.iterrows():
        known_items.add(row["result"])
        known_items.update(row["ingredient_list"])
        ingredient_tokens.update(key(token) for token in row["ingredient_list"])
        result_keys.add(row["result_key"])

    cleaned: Dict[str, List[str]] = {}

    def dedupe(members: List[str], *, allow_group_only_items: bool) -> List[str]:
        seen = set()
        filtered: List[str] = []
        for member in members:
            member = normalize(member)
            member_key = key(member)
            if not member or (member_key in raw_groups and member not in known_items):
                continue
            if not allow_group_only_items and member not in known_items:
                continue
            if member_key in seen:
                continue
            seen.add(member_key)
            filtered.append(member)
        return filtered

    for group_name, members in raw_groups.items():
        if group_name not in ingredient_tokens or group_name in result_keys:
            continue
        if group_name in CANONICAL_GROUPS:
            filtered = dedupe(CANONICAL_GROUPS[group_name], allow_group_only_items=True)
        else:
            filtered = dedupe(members, allow_group_only_items=False)
        if filtered:
            cleaned[group_name] = filtered

    for group_name, members in CANONICAL_GROUPS.items():
        if group_name in ingredient_tokens and group_name not in cleaned:
            filtered = dedupe(members, allow_group_only_items=True)
            if filtered:
                cleaned[group_name] = filtered
    return cleaned


def build_recipe_index(recipes_df: pd.DataFrame) -> Dict[str, List[dict]]:
    out: Dict[str, List[dict]] = {}
    for _, row in recipes_df.iterrows():
        out.setdefault(row["result_key"], []).append(row.to_dict())
    return out


def recipe_is_valid(row: pd.Series | dict, groups: Dict[str, List[str]]) -> bool:
    ingredients = list(row["ingredient_list"])
    result = normalize(row["result"])
    result_qty = int(row.get("result_qty", 1))
    _, assignments = valid_slot_assignments(ingredients, groups, result, result_qty)
    return bool(assignments)


def prune_invalid_recipes(recipes_df: pd.DataFrame, groups: Dict[str, List[str]]) -> pd.DataFrame:
    if recipes_df.empty:
        return recipes_df.copy()
    valid_rows = recipes_df[recipes_df.apply(lambda row: recipe_is_valid(row, groups), axis=1)].copy()
    return valid_rows.reset_index(drop=True)


def build_item_catalog(recipes_df: pd.DataFrame, groups: Dict[str, List[str]], metadata: Optional[Dict[str, dict]] = None) -> List[str]:
    items = set()
    for _, row in recipes_df.iterrows():
        items.add(row["result"])
        items.update(row["ingredient_list"])
    for members in groups.values():
        items.update(members)
    for meta in (metadata or {}).values():
        item_name = normalize(meta.get("item"))
        if item_name:
            items.add(item_name)
    return sorted(item for item in items if item and key(item) not in groups)


def item_meta_for(item_name: str, metadata: Dict[str, dict]) -> dict:
    return metadata.get(
        key(item_name),
        {
            "item": normalize(item_name),
            "heal": 0.0,
            "stamina": 0.0,
            "mana": 0.0,
            "sale_value": 0.0,
            "buy_value": 0.0,
            "weight": 0.0,
            "effects": [],
            "category": "",
        },
    )


def infer_item_category(item_name: str, metadata: Dict[str, dict]) -> str:
    meta = item_meta_for(item_name, metadata)
    if meta["category"]:
        category = meta["category"]
        if category in {"Potion", "Tea"}:
            return "Potions and Drinks"
        if category == "Deployable":
            return "Deployables"
        if category == "Food":
            return "Food"
        return category

    name = key(item_name)
    if any(token in name for token in ["tent", "lodge", "bedroll", "cocoon", "cage"]):
        return "Deployables"
    if any(token in name for token in ["potion", "elixir", "varnish", "bomb", "incense", "stone", "powder", "charge"]):
        return "Alchemy"
    if any(token in name for token in ["tea", "stew", "pie", "tartine", "sandwich", "omelet", "ration", "jam", "potage", "cake"]):
        return "Food"
    if any(token in name for token in ["water", "mushroom", "berry", "fruit", "egg", "meat", "fish", "wheat", "flour", "salt", "spice", "milk"]):
        return "Cooking ingredients"
    if any(token in name for token in ["scrap", "cloth", "wood", "stone", "hide", "oil", "quartz", "remains", "beetle", "bones", "tail", "chitin"]):
        return "Materials"
    if any(token in name for token in ["sword", "axe", "mace", "bow", "shield", "armor", "boots", "helm", "lantern", "staff", "spear", "dagger"]):
        return "Equipment"
    return "Other"


def build_catalog_by_category(catalog: List[str], metadata: Dict[str, dict]) -> Dict[str, List[str]]:
    grouped: Dict[str, List[str]] = {}
    for item_name in catalog:
        grouped.setdefault(infer_item_category(item_name, metadata), []).append(item_name)
    order = ["Food", "Potions and Drinks", "Cooking ingredients", "Alchemy", "Deployables", "Materials", "Equipment", "Other"]
    return {category: sorted(grouped[category]) for category in order if category in grouped}


def recipe_slot_options(recipe_ingredients: List[str], groups: Dict[str, List[str]]) -> List[Tuple[str, List[str]]]:
    slots: List[Tuple[str, List[str]]] = []
    for ingredient in recipe_ingredients:
        token_name = normalize(ingredient)
        token_key = key(token_name)
        options = groups[token_key][:] if token_key in groups else [token_name]
        slots.append((token_name, options))
    return slots


def is_noop_assignment(assignment: Tuple[str, ...], result: str, result_qty: int) -> bool:
    if not assignment:
        return False
    counts = Counter(normalize(item_name) for item_name in assignment)
    result_name = normalize(result)
    return len(counts) == 1 and counts.get(result_name, 0) == int(result_qty)


def valid_slot_assignments(
    recipe_ingredients: List[str],
    groups: Dict[str, List[str]],
    result: str,
    result_qty: int,
) -> Tuple[List[Tuple[str, List[str]]], List[Tuple[str, ...]]]:
    slots = recipe_slot_options(recipe_ingredients, groups)
    assignments: List[Tuple[str, ...]] = []
    current: List[str] = []

    def backtrack(position: int) -> None:
        if position == len(slots):
            assignment = tuple(current)
            if not is_noop_assignment(assignment, result, result_qty):
                assignments.append(assignment)
            return
        _, options = slots[position]
        for item_name in options:
            current.append(normalize(item_name))
            backtrack(position + 1)
            current.pop()

    backtrack(0)
    return slots, assignments


def assignment_sort_key(assignment: Tuple[str, ...], inventory: Counter, recipe_index: Dict[str, List[dict]]) -> Tuple[int, int, Tuple[str, ...]]:
    return (
        sum(1 for item_name in assignment if inventory.get(item_name, 0) <= 0),
        sum(1 for item_name in assignment if key(item_name) not in recipe_index),
        assignment,
    )


def self_group_slots_supported(
    slots: List[Tuple[str, List[str]]],
    assignment: Tuple[str, ...],
    result: str,
    groups: Dict[str, List[str]],
    inventory: Counter,
) -> bool:
    result_key = key(result)
    for (token_name, _), chosen_item in zip(slots, assignment):
        token_key = key(token_name)
        if token_key not in groups:
            continue
        if result_key not in {key(member) for member in groups[token_key]}:
            continue
        if inventory.get(chosen_item, 0) <= 0:
            return False
    return True


def max_crafts_for_recipe(
    recipe_ingredients: List[str],
    inventory: Counter,
    groups: Dict[str, List[str]],
    result: str,
    result_qty: int,
) -> int:
    slots = recipe_slot_options(recipe_ingredients, groups)
    if not slots:
        return 0
    result_name = normalize(result)
    relevant_items = sorted(
        {
            normalize(item_name)
            for _, options in slots
            for item_name in options
            if inventory.get(normalize(item_name), 0) > 0
        }
    )
    if not relevant_items:
        return 0

    slot_caps = [sum(int(inventory.get(normalize(item_name), 0)) for item_name in options) for _, options in slots]
    upper_bound = min(slot_caps, default=0)
    if upper_bound <= 0:
        return 0

    slot_options = [[normalize(item_name) for item_name in options] for _, options in slots]
    result_only_noop = len(slots) == int(result_qty) and all(result_name in options for options in slot_options)

    def can_craft_times(target_crafts: int) -> bool:
        if target_crafts <= 0:
            return True

        slot_demand = len(slot_options) * target_crafts
        item_caps = {item_name: int(inventory.get(item_name, 0)) for item_name in relevant_items}
        if result_only_noop and result_name in item_caps:
            # Each craft needs at least one non-result input when the only invalid pattern is a no-op self craft.
            item_caps[result_name] = min(item_caps[result_name], slot_demand - target_crafts)

        if sum(item_caps.values()) < slot_demand:
            return False
        for options in slot_options:
            if sum(item_caps.get(item_name, 0) for item_name in options) < target_crafts:
                return False

        item_nodes = [item_name for item_name in relevant_items if item_caps.get(item_name, 0) > 0]
        if not item_nodes:
            return False

        source = 0
        slot_start = 1
        item_start = slot_start + len(slot_options)
        sink = item_start + len(item_nodes)
        graph_size = sink + 1
        graph: List[List[int]] = [[] for _ in range(graph_size)]
        capacity = [[0] * graph_size for _ in range(graph_size)]
        item_index = {item_name: item_start + index for index, item_name in enumerate(item_nodes)}

        def add_edge(start: int, end: int, cap: int) -> None:
            if cap <= 0:
                return
            graph[start].append(end)
            graph[end].append(start)
            capacity[start][end] = cap

        for slot_index, options in enumerate(slot_options):
            slot_node = slot_start + slot_index
            add_edge(source, slot_node, target_crafts)
            for item_name in options:
                item_node = item_index.get(item_name)
                if item_node is not None:
                    add_edge(slot_node, item_node, target_crafts)

        for item_name, item_node in item_index.items():
            add_edge(item_node, sink, item_caps[item_name])

        flow = 0
        while flow < slot_demand:
            parent = [-1] * graph_size
            parent[source] = source
            queue = deque([source])
            while queue and parent[sink] == -1:
                node = queue.popleft()
                for nxt in graph[node]:
                    if parent[nxt] != -1 or capacity[node][nxt] <= 0:
                        continue
                    parent[nxt] = node
                    if nxt == sink:
                        break
                    queue.append(nxt)
            if parent[sink] == -1:
                break

            augment = slot_demand - flow
            node = sink
            while node != source:
                prev = parent[node]
                augment = min(augment, capacity[prev][node])
                node = prev

            node = sink
            while node != source:
                prev = parent[node]
                capacity[prev][node] -= augment
                capacity[node][prev] += augment
                node = prev
            flow += augment

        return flow == slot_demand

    low = 0
    high = upper_bound
    while low < high:
        mid = (low + high + 1) // 2
        if can_craft_times(mid):
            low = mid
        else:
            high = mid - 1
    return low


def _missing_label(token: str, groups: Dict[str, List[str]]) -> str:
    token_key = key(token)
    if token_key not in groups:
        return token
    friendly_names = {
        "water": "Any Water",
        "fish": "Any Fish",
        "meat": "Any Meat",
        "egg": "Any Egg",
        "vegetable": "Any Vegetable",
        "mushroom": "Any Mushroom",
        "bread (any)": "Any Bread",
        "advanced tent": "Any Advanced Tent",
        "ration ingredient": "Any Ration Ingredient",
        "basic armor": "Any Basic Armor",
        "basic boots": "Any Basic Boots",
        "basic helm": "Any Basic Helm",
    }
    return friendly_names.get(token_key, f"Any {token}")


def _effect_utility(effects: List[str]) -> float:
    utility = 0.0
    for effect in effects:
        effect_key = key(effect)
        if "burnt health" in effect_key:
            utility += 7.0
        elif "burnt mana" in effect_key:
            utility += 6.8
        elif "burnt stamina" in effect_key:
            utility += 6.4
        elif "burnt" in effect_key:
            utility += 6.0
        if any(token in effect_key for token in ["health recovery", "health per second", "recovery from rest"]):
            utility += 5.0
        if any(token in effect_key for token in ["weather def", "weather defense", "weather resistance", "cold weather", "hot weather"]):
            utility += 4.8
        has_resistance = " resistance" in effect_key or " resist" in effect_key
        if any(token in effect_key for token in ["immunity", "resistance up", "impact resistance"]) or (
            has_resistance and not any(token in effect_key for token in ["-", "weakens", "reduced"])
        ):
            utility += 4.2
        if any(token in effect_key for token in ["boon", "buff", "damage bonus", "stealth", "ambush chance greatly reduced"]):
            utility += 3.6
        if any(token in effect_key for token in ["stamina cost", "mana cost"]):
            utility += 4.0 if "-" in effect_key or "reduced" in effect_key else -1.6
        if any(token in effect_key for token in ["refills hunger", "refills drink", "refills hunger and drink"]):
            utility += 4.4
        if any(token in effect_key for token in ["travel", "comfort", "ally", "utility", "alertness", "support"]):
            utility += 2.2
        if any(token in effect_key for token in ["removes", "cures", "restores", "healing", "stamina", "mana"]):
            utility += 1.2
        if "ambush chance increased" in effect_key:
            utility -= 2.8
        if "cannot be picked back up" in effect_key:
            utility -= 3.2
        if any(token in effect_key for token in ["raises corruption", "corruption while sleeping"]):
            utility -= 4.2
        if has_resistance and any(token in effect_key for token in ["-", "weakens", "reduced"]):
            utility -= 4.0
    return utility


def missing_slot_details(
    recipe_ingredients: List[str],
    inventory: Counter,
    groups: Dict[str, List[str]],
    result: str,
    result_qty: int,
) -> Tuple[int, List[str], int]:
    slots, assignments = valid_slot_assignments(recipe_ingredients, groups, result, result_qty)
    if not slots:
        return 0, [], 0
    if not assignments:
        missing = [_missing_label(token_name, groups) for token_name, _ in slots]
        return len(missing), missing, 0

    best_matched = -1
    best_missing: Tuple[str, ...] = tuple()
    for assignment in assignments:
        trial_inventory = Counter(inventory)
        missing: List[str] = []
        matched = 0
        for (token_name, _), chosen_item in zip(slots, assignment):
            if trial_inventory.get(chosen_item, 0) > 0:
                trial_inventory[chosen_item] -= 1
                matched += 1
            else:
                missing.append(_missing_label(token_name, groups))
        candidate_missing = tuple(missing)
        if matched > best_matched or (matched == best_matched and candidate_missing < best_missing):
            best_matched = matched
            best_missing = candidate_missing

    return len(slots) - best_matched, list(best_missing), best_matched


def count_missing_slots(
    recipe_ingredients: List[str],
    inventory: Counter,
    groups: Dict[str, List[str]],
    result: str,
    result_qty: int,
) -> Tuple[int, List[str]]:
    missing_count, missing, _ = missing_slot_details(recipe_ingredients, inventory, groups, result, result_qty)
    return missing_count, missing


def _effects_list(effects: str) -> List[str]:
    return [normalize(effect) for effect in str(effects or "").split(";") if normalize(effect)]


def _station_convenience(station: str) -> float:
    return {
        "Manual Crafting": 1.8,
        "Campfire": 1.4,
        "Cooking Pot": 0.9,
        "Alchemy Kit": 0.5,
    }.get(normalize_station(station), 0.7)


def _category_utility(category: str) -> float:
    return {
        "Potion": 7.5,
        "Tea": 6.0,
        "Potions and Drinks": 6.0,
        "Food": 5.0,
        "Deployable": 6.3,
        "Deployables": 6.3,
        "Alchemy": 3.0,
        "Equipment": 2.0,
        "Cooking ingredients": 1.6,
        "Materials": 0.4,
    }.get(normalize(category), 0.0)


def _name_utility_bonus(name: str, effects: str) -> float:
    name_key = key(name)
    effects_key = key(effects)
    bonus = 0.0
    if any(token in name_key for token in ["potion", "elixir", "tea"]):
        bonus += 3.8
    if any(token in name_key for token in ["ration", "stew", "sandwich", "pie", "tartine", "omelet", "fricassee"]):
        bonus += 3.2
    if any(token in name_key for token in ["jam", "bread", "jerky", "flour", "cooked", "boiled", "grilled", "roasted"]):
        bonus += 1.4
    if any(token in effects_key for token in ["boon", "buff", "restore", "heal", "stamina", "mana", "recovery", "support", "travel"]):
        bonus += 2.4
    if any(token in name_key for token in ["tent", "lodge", "cocoon", "cage", "bedroll"]):
        bonus += 2.8
    return bonus


def _economic_value(sale_value: float, buy_value: float) -> float:
    return max(float(sale_value), float(buy_value) * 0.35)


def _inferred_weight(item_name: str, category: str, explicit_weight: float) -> float:
    if explicit_weight > 0:
        return explicit_weight
    category_key = normalize(category)
    name_key = key(item_name)
    if any(token in name_key for token in ["tent", "lodge", "cocoon", "cage", "bedroll"]):
        return 5.0
    if category_key in {"Potion", "Tea", "Potions and Drinks"}:
        return 0.5
    if category_key == "Food":
        return 0.5
    if category_key == "Cooking ingredients":
        return 0.25
    if category_key == "Alchemy":
        return 0.35
    if category_key == "Materials":
        return 0.25
    if category_key in {"Equipment", "Deployable", "Deployables"}:
        return 4.0
    return 1.0


def smart_score(row: pd.Series) -> float:
    ingredient_count = max(1, len(row["ingredient_list"]))
    unique_ingredients = len({key(item_name) for item_name in row["ingredient_list"]})
    effects = _effects_list(row["effects"])
    category = row["category"] or infer_item_category(row["result"], {})
    effective_weight = _inferred_weight(row["result"], category, float(row.get("weight_each", 0) or 0))
    economic_value = _economic_value(float(row["sale_value_each"]), float(row.get("buy_value_each", 0) or 0))
    strategic_bonus = 0.0
    if any("burnt" in effect for effect in map(key, effects)):
        strategic_bonus += 2.2
    if any(
        any(token in effect for token in ["weather", "resistance", "damage bonus", "mana cost", "stamina cost", "stealth", "ambush", "health per second"])
        for effect in map(key, effects)
    ):
        strategic_bonus += 1.8
    per_item_utility = (
        row["heal_each"] * 0.55
        + row["stamina_each"] * 0.5
        + row["mana_each"] * 0.62
        + economic_value * 0.12
        + len(effects) * 2.2
        + _effect_utility(effects)
        + _category_utility(category)
        + _name_utility_bonus(row["result"], row["effects"])
        + strategic_bonus
    )
    throughput_bonus = (
        min(int(row["max_crafts"]), 4) * 1.0
        + min(int(row["max_total_output"]), 8) * 0.45
        + min(int(row["result_qty_per_craft"]), 4) * 0.9
        + (int(row["result_qty_per_craft"]) / ingredient_count) * 1.6
    )
    complexity_penalty = ingredient_count * 1.15 + max(0, unique_ingredients - 1) * 0.45
    utility_density = per_item_utility / max(effective_weight, 0.25)
    value_density = economic_value / max(effective_weight, 0.25)
    weight_bonus = min(utility_density, 24.0) * 0.34 + min(value_density, 90.0) * 0.07
    carry_penalty = max(0.0, effective_weight - 0.75) * 0.62
    if per_item_utility < 5.0 and effective_weight > 2.0:
        carry_penalty += (effective_weight - 2.0) * 1.1
    if normalize(category) in {"deployable", "deployables"} and per_item_utility >= 10.0:
        carry_penalty *= 0.65
    score = per_item_utility + throughput_bonus + weight_bonus + _station_convenience(row["station"]) - complexity_penalty - carry_penalty
    if per_item_utility <= 1.5:
        score -= 1.0
    return score


def build_direct_results(
    recipes_df: pd.DataFrame, inventory: Counter, groups: Dict[str, List[str]], metadata: Dict[str, dict]
) -> pd.DataFrame:
    rows = []
    for _, row in recipes_df.iterrows():
        ingredients = row["ingredient_list"]
        result_meta = item_meta_for(row["result"], metadata)
        max_crafts = max_crafts_for_recipe(ingredients, inventory, groups, row["result"], int(row["result_qty"]))
        missing_count, missing, matched_slots = missing_slot_details(
            ingredients,
            inventory,
            groups,
            row["result"],
            int(row["result_qty"]),
        )
        max_total_output = int(max_crafts) * int(row["result_qty"])
        rows.append(
            {
                "result": row["result"],
                "result_qty_per_craft": int(row["result_qty"]),
                "max_crafts": int(max_crafts),
                "max_total_output": max_total_output,
                "station": row["station"],
                "recipe_page": row["recipe_page"],
                "section": row["section"],
                "ingredients": ", ".join(ingredients),
                "ingredient_list": ingredients,
                "matched_slots": int(matched_slots),
                "missing_slots": missing_count,
                "missing_items": ", ".join(missing),
                "heal_each": result_meta["heal"],
                "stamina_each": result_meta["stamina"],
                "mana_each": result_meta["mana"],
                "sale_value_each": result_meta["sale_value"],
                "buy_value_each": result_meta["buy_value"],
                "weight_each": _inferred_weight(
                    row["result"],
                    result_meta["category"] or infer_item_category(row["result"], metadata),
                    result_meta["weight"],
                ),
                "effects": "; ".join(result_meta["effects"]),
                "category": result_meta["category"] or infer_item_category(row["result"], metadata),
                "healing_total": result_meta["heal"] * max_total_output,
                "stamina_total": result_meta["stamina"] * max_total_output,
                "mana_total": result_meta["mana"] * max_total_output,
                "sale_value_total": result_meta["sale_value"] * max_total_output,
                "value_per_weight_each": result_meta["sale_value"] / max(
                    _inferred_weight(
                        row["result"],
                        result_meta["category"] or infer_item_category(row["result"], metadata),
                        result_meta["weight"],
                    ),
                    0.25,
                ),
            }
        )
    out = pd.DataFrame(rows)
    if out.empty:
        return out
    out["smart_score"] = out.apply(smart_score, axis=1)
    return out.sort_values(["max_crafts", "smart_score", "result"], ascending=[False, False, True]).reset_index(drop=True)


def consume_item(inventory: Counter, item: str, qty: int = 1) -> bool:
    if inventory.get(item, 0) >= qty:
        inventory[item] -= qty
        if inventory[item] <= 0:
            del inventory[item]
        return True
    return False


def pick_group_candidates(
    group_token: str, inventory: Counter, groups: Dict[str, List[str]], recipe_index: Dict[str, List[dict]]
) -> List[str]:
    members = groups.get(key(group_token), [])

    def sort_key(item_name: str) -> Tuple[int, int, str]:
        return (
            0 if inventory.get(item_name, 0) > 0 else 1,
            0 if key(item_name) in recipe_index else 1,
            item_name,
        )

    return sorted(members, key=sort_key)


def plan_item(
    item: str,
    inventory: Counter,
    groups: Dict[str, List[str]],
    recipe_index: Dict[str, List[dict]],
    depth: int = 0,
    max_depth: int = 5,
    stack: Optional[Tuple[str, ...]] = None,
) -> Optional[dict]:
    stack = stack or tuple()
    item = normalize(item)

    if consume_item(inventory, item, 1):
        return {"type": "use", "item": item}

    if depth >= max_depth:
        return None

    item_key = key(item)
    if item_key in stack:
        return None

    candidates = recipe_index.get(item_key, [])
    candidates = sorted(candidates, key=lambda row: (len(row["ingredient_list"]), row["station"], row["result"]))

    for recipe in candidates:
        slots, assignments = valid_slot_assignments(
            recipe["ingredient_list"],
            groups,
            recipe["result"],
            int(recipe.get("result_qty", 1)),
        )
        for assignment in sorted(assignments, key=lambda selected: assignment_sort_key(selected, inventory, recipe_index)):
            trial_inventory = Counter(inventory)
            if not self_group_slots_supported(slots, assignment, recipe["result"], groups, trial_inventory):
                continue
            steps = []
            ok = True
            for (token_name, _), chosen_item in zip(slots, assignment):
                step = plan_item(
                    chosen_item,
                    trial_inventory,
                    groups,
                    recipe_index,
                    depth + 1,
                    max_depth,
                    stack + (item_key,),
                )
                if step is None:
                    ok = False
                    break
                if key(token_name) in groups:
                    step = {"type": "group", "group": token_name, "chosen": chosen_item, "step": step}
                steps.append(step)
            if ok:
                trial_inventory[recipe["result"]] += int(recipe.get("result_qty", 1))
                if not consume_item(trial_inventory, recipe["result"], 1):
                    ok = False
            if ok:
                inventory.clear()
                inventory.update(trial_inventory)
                return {"type": "craft", "item": item, "recipe": recipe, "steps": steps}
    return None


def plan_token(
    token: str,
    inventory: Counter,
    groups: Dict[str, List[str]],
    recipe_index: Dict[str, List[dict]],
    depth: int,
    max_depth: int,
    stack: Tuple[str, ...],
) -> Optional[dict]:
    token = normalize(token)
    token_key = key(token)
    if token_key in groups:
        for item_name in pick_group_candidates(token, inventory, groups, recipe_index):
            trial_inventory = Counter(inventory)
            step = plan_item(item_name, trial_inventory, groups, recipe_index, depth, max_depth, stack)
            if step is not None:
                inventory.clear()
                inventory.update(trial_inventory)
                return {"type": "group", "group": token, "chosen": item_name, "step": step}
        return None
    return plan_item(token, inventory, groups, recipe_index, depth, max_depth, stack)


def format_plan_lines(plan: dict, level: int = 0) -> List[str]:
    pad = "  " * level
    if plan["type"] == "use":
        return [f"{pad}- Use existing: {plan['item']}"]
    if plan["type"] == "group":
        lines = [f"{pad}- Fill group '{plan['group']}' with: {plan['chosen']}"]
        lines.extend(format_plan_lines(plan["step"], level + 1))
        return lines
    if plan["type"] == "craft":
        recipe = plan["recipe"]
        lines = [f"{pad}- Craft {recipe['result']} at {recipe['station']} using {', '.join(recipe['ingredient_list'])}"]
        for step in plan["steps"]:
            lines.extend(format_plan_lines(step, level + 1))
        return lines
    if plan["type"] == "missing":
        return [f"{pad}- Missing ingredient to buy or farm: {plan['item']}"]
    return [f"{pad}- Unknown step"]


def shopping_item_plan(
    item: str,
    inventory: Counter,
    groups: Dict[str, List[str]],
    recipe_index: Dict[str, List[dict]],
    depth: int = 0,
    max_depth: int = 6,
    stack: Optional[Tuple[str, ...]] = None,
) -> Tuple[Counter, dict]:
    stack = stack or tuple()
    item = normalize(item)

    if consume_item(inventory, item, 1):
        return Counter(), {"type": "use", "item": item}

    item_key = key(item)
    if depth >= max_depth or item_key in stack:
        return Counter({item: 1}), {"type": "missing", "item": item}

    candidates = recipe_index.get(item_key, [])
    if not candidates:
        return Counter({item: 1}), {"type": "missing", "item": item}

    best_choice: Optional[Tuple[Tuple[int, int, int, str], Counter, dict, Counter]] = None
    for recipe in sorted(candidates, key=lambda row: (len(row["ingredient_list"]), row["station"], row["result"])):
        slots, assignments = valid_slot_assignments(
            recipe["ingredient_list"],
            groups,
            recipe["result"],
            int(recipe.get("result_qty", 1)),
        )
        for assignment in sorted(assignments, key=lambda selected: assignment_sort_key(selected, inventory, recipe_index)):
            trial_inventory = Counter(inventory)
            if not self_group_slots_supported(slots, assignment, recipe["result"], groups, trial_inventory):
                continue
            total_missing = Counter()
            steps = []
            for (token_name, _), chosen_item in zip(slots, assignment):
                token_missing, token_plan = shopping_item_plan(
                    chosen_item,
                    trial_inventory,
                    groups,
                    recipe_index,
                    depth + 1,
                    max_depth,
                    stack + (item_key,),
                )
                total_missing.update(token_missing)
                if key(token_name) in groups:
                    token_plan = {"type": "group", "group": token_name, "chosen": chosen_item, "step": token_plan}
                steps.append(token_plan)
            trial_inventory[recipe["result"]] += int(recipe.get("result_qty", 1))
            consume_item(trial_inventory, recipe["result"], 1)
            rank = (
                sum(total_missing.values()),
                len(total_missing),
                len(recipe["ingredient_list"]),
                recipe["station"],
            )
            plan = {"type": "craft", "item": item, "recipe": recipe, "steps": steps}
            if best_choice is None or rank < best_choice[0]:
                best_choice = (rank, total_missing, plan, trial_inventory)

    if best_choice is None:
        return Counter({item: 1}), {"type": "missing", "item": item}
    inventory.clear()
    inventory.update(best_choice[3])
    return best_choice[1], best_choice[2]


def shopping_token_plan(
    token: str,
    inventory: Counter,
    groups: Dict[str, List[str]],
    recipe_index: Dict[str, List[dict]],
    depth: int,
    max_depth: int,
    stack: Tuple[str, ...],
) -> Tuple[Counter, dict]:
    token = normalize(token)
    token_key = key(token)
    if token_key not in groups:
        return shopping_item_plan(token, inventory, groups, recipe_index, depth, max_depth, stack)

    members = pick_group_candidates(token, inventory, groups, recipe_index)
    if not members:
        return Counter({token: 1}), {"type": "missing", "item": token}

    best_choice: Optional[Tuple[Tuple[int, int, str], Counter, dict, Counter]] = None
    for item_name in members:
        trial_inventory = Counter(inventory)
        missing, step = shopping_item_plan(item_name, trial_inventory, groups, recipe_index, depth, max_depth, stack)
        rank = (sum(missing.values()), len(missing), item_name)
        plan = {"type": "group", "group": token, "chosen": item_name, "step": step}
        if best_choice is None or rank < best_choice[0]:
            best_choice = (rank, missing, plan, trial_inventory)

    assert best_choice is not None
    inventory.clear()
    inventory.update(best_choice[3])
    return best_choice[1], best_choice[2]


def build_shopping_list(
    targets: Counter,
    inventory: Counter,
    groups: Dict[str, List[str]],
    recipe_index: Dict[str, List[dict]],
    max_depth: int,
) -> Tuple[Counter, List[str], Counter]:
    working_inventory = Counter(inventory)
    total_missing = Counter()
    lines: List[str] = []

    for item_name, qty in sorted(targets.items()):
        lines.append(f"{item_name} x{qty}")
        for craft_index in range(qty):
            missing, plan = shopping_item_plan(item_name, working_inventory, groups, recipe_index, 0, max_depth, tuple())
            total_missing.update(missing)
            lines.extend(format_plan_lines(plan, level=1))
            if craft_index < qty - 1:
                lines.append("  - Repeat for another copy")
    return total_missing, lines, working_inventory


def build_metadata_table(metadata: Dict[str, dict]) -> pd.DataFrame:
    rows = []
    for _, meta in sorted(metadata.items(), key=lambda pair: pair[1]["item"]):
        rows.append(
            {
                "item": meta["item"],
                "category": meta["category"],
                "heal": meta["heal"],
                "stamina": meta["stamina"],
                "mana": meta["mana"],
                "sale_value": meta["sale_value"],
                "buy_value": meta["buy_value"],
                "weight": _inferred_weight(meta["item"], meta["category"], meta["weight"]),
                "effects": "; ".join(meta["effects"]),
            }
        )
    return pd.DataFrame(rows)
