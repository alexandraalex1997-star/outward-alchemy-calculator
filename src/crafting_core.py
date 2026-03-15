from __future__ import annotations

from collections import Counter
from functools import lru_cache
from typing import Dict, List, Optional, Tuple

import pandas as pd


TEXT_REPAIRS = {
    "â€“": "-",
    "â€”": "-",
    "â€™": "'",
    "â€œ": '"',
    "â€": '"',
}

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


def build_item_catalog(recipes_df: pd.DataFrame, groups: Dict[str, List[str]]) -> List[str]:
    items = set()
    for _, row in recipes_df.iterrows():
        items.add(row["result"])
        items.update(row["ingredient_list"])
    for members in groups.values():
        items.update(members)
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
        if category == "Food":
            return "Food"
        return category

    name = key(item_name)
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
    order = ["Food", "Potions and Drinks", "Cooking ingredients", "Alchemy", "Materials", "Equipment", "Other"]
    return {category: sorted(grouped[category]) for category in order if category in grouped}


def option_lists(recipe_ingredients: List[str], inventory: Counter, groups: Dict[str, List[str]]) -> List[List[str]]:
    slots = []
    for ingredient in recipe_ingredients:
        ingredient_key = key(ingredient)
        if ingredient_key in groups:
            options = [item for item in groups[ingredient_key] if inventory.get(item, 0) > 0]
            if not options:
                options = groups[ingredient_key][:]
            slots.append(options)
        else:
            slots.append([ingredient])
    slots.sort(key=len)
    return slots


def consumption_patterns(
    recipe_ingredients: List[str], inventory: Counter, groups: Dict[str, List[str]]
) -> Tuple[List[str], List[Tuple[int, ...]]]:
    slots = option_lists(recipe_ingredients, inventory, groups)
    universe = sorted({item for options in slots for item in options})
    if not universe:
        return [], []
    item_index = {name: idx for idx, name in enumerate(universe)}
    patterns = set()
    current = [0] * len(universe)

    def backtrack(position: int) -> None:
        if position == len(slots):
            patterns.add(tuple(current))
            return
        for item_name in slots[position]:
            current[item_index[item_name]] += 1
            backtrack(position + 1)
            current[item_index[item_name]] -= 1

    backtrack(0)
    return universe, sorted(patterns)


def max_crafts_for_recipe(recipe_ingredients: List[str], inventory: Counter, groups: Dict[str, List[str]]) -> int:
    universe, patterns = consumption_patterns(recipe_ingredients, inventory, groups)
    if not universe:
        return 0

    start_state = tuple(int(inventory.get(item_name, 0)) for item_name in universe)

    @lru_cache(maxsize=None)
    def dp(state: Tuple[int, ...]) -> int:
        best = 0
        for pattern in patterns:
            next_state = []
            ok = True
            for have, need in zip(state, pattern):
                if have < need:
                    ok = False
                    break
                next_state.append(have - need)
            if ok:
                best = max(best, 1 + dp(tuple(next_state)))
        return best

    return dp(start_state)


def _missing_label(token: str, groups: Dict[str, List[str]]) -> str:
    token_key = key(token)
    if token_key not in groups:
        return token
    options_preview = ", ".join(groups[token_key][:4])
    suffix = "..." if len(groups[token_key]) > 4 else ""
    return f"{token} ({options_preview}{suffix})"


def count_missing_slots(recipe_ingredients: List[str], inventory: Counter, groups: Dict[str, List[str]]) -> Tuple[int, List[str]]:
    slot_options: List[Tuple[str, List[str]]] = []
    universe: List[str] = []
    seen_universe = set()
    for token in recipe_ingredients:
        token_name = normalize(token)
        token_key = key(token_name)
        options = groups[token_key][:] if token_key in groups else [token_name]
        slot_options.append((token_name, options))
        for option_name in options:
            normalized_option = normalize(option_name)
            if normalized_option and normalized_option not in seen_universe:
                seen_universe.add(normalized_option)
                universe.append(normalized_option)

    if not slot_options:
        return 0, []

    item_index = {name: idx for idx, name in enumerate(universe)}
    start_state = tuple(int(inventory.get(item_name, 0)) for item_name in universe)

    @lru_cache(maxsize=None)
    def dp(position: int, state: Tuple[int, ...]) -> Tuple[int, Tuple[str, ...]]:
        if position == len(slot_options):
            return 0, tuple()

        token_name, options = slot_options[position]
        best_matched, best_missing = dp(position + 1, state)
        best_missing = (_missing_label(token_name, groups),) + best_missing

        for option_name in options:
            option_index = item_index[normalize(option_name)]
            if state[option_index] <= 0:
                continue
            next_state = list(state)
            next_state[option_index] -= 1
            matched_rest, missing_rest = dp(position + 1, tuple(next_state))
            candidate = (1 + matched_rest, missing_rest)
            if candidate[0] > best_matched or (candidate[0] == best_matched and candidate[1] < best_missing):
                best_matched, best_missing = candidate

        return best_matched, best_missing

    matched_slots, missing = dp(0, start_state)
    return len(recipe_ingredients) - matched_slots, list(missing)


def smart_score(row: pd.Series) -> float:
    name = key(row["result"])
    bonus = 0.0
    if any(token in name for token in ["potion", "tea", "stew", "sandwich", "pie", "tartine", "ration"]):
        bonus += 4.0
    if row["station"] == "Alchemy Kit":
        bonus += 2.0
    if row["station"] in {"Campfire", "Cooking Pot"}:
        bonus += 1.0
    return (
        bonus
        + row["max_crafts"] * 3
        + row["max_total_output"] * 0.6
        + row["healing_total"] * 0.08
        + row["stamina_total"] * 0.06
        + row["mana_total"] * 0.08
        + row["sale_value_total"] * 0.03
        - max(1, len(row["ingredient_list"])) * 0.4
    )


def build_direct_results(
    recipes_df: pd.DataFrame, inventory: Counter, groups: Dict[str, List[str]], metadata: Dict[str, dict]
) -> pd.DataFrame:
    rows = []
    for _, row in recipes_df.iterrows():
        ingredients = row["ingredient_list"]
        result_meta = item_meta_for(row["result"], metadata)
        max_crafts = max_crafts_for_recipe(ingredients, inventory, groups)
        missing_count, missing = count_missing_slots(ingredients, inventory, groups)
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
                "missing_slots": missing_count,
                "missing_items": ", ".join(missing),
                "heal_each": result_meta["heal"],
                "stamina_each": result_meta["stamina"],
                "mana_each": result_meta["mana"],
                "sale_value_each": result_meta["sale_value"],
                "effects": "; ".join(result_meta["effects"]),
                "category": result_meta["category"],
                "healing_total": result_meta["heal"] * max_total_output,
                "stamina_total": result_meta["stamina"] * max_total_output,
                "mana_total": result_meta["mana"] * max_total_output,
                "sale_value_total": result_meta["sale_value"] * max_total_output,
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
        trial_inventory = Counter(inventory)
        steps = []
        ok = True
        for token in recipe["ingredient_list"]:
            step = plan_token(token, trial_inventory, groups, recipe_index, depth + 1, max_depth, stack + (item_key,))
            if step is None:
                ok = False
                break
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
        trial_inventory = Counter(inventory)
        total_missing = Counter()
        steps = []
        for token in recipe["ingredient_list"]:
            token_missing, token_plan = shopping_token_plan(
                token,
                trial_inventory,
                groups,
                recipe_index,
                depth + 1,
                max_depth,
                stack + (item_key,),
            )
            total_missing.update(token_missing)
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

    assert best_choice is not None
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
                "effects": "; ".join(meta["effects"]),
            }
        )
    return pd.DataFrame(rows)
