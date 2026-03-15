from __future__ import annotations

import json
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd
import streamlit as st

from ui_layout import (
    load_ui_styles,
    named_block,
    named_expander,
    named_panel,
    render_active_section_note,
    render_compact_stats,
    render_empty_state,
    render_hero,
    render_hook,
    render_section_header,
    render_section_nav,
    render_tab_help,
    render_table_header,
)


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"


# Data loading and crafting logic.
def normalize(text: str) -> str:
    return " ".join(str(text or "").strip().split())


def key(text: str) -> str:
    return normalize(text).casefold()


@st.cache_data
def load_recipes() -> pd.DataFrame:
    live = DATA_DIR / "recipes.csv"
    sample = DATA_DIR / "recipes.sample.csv"
    path = live if live.exists() else sample
    df = pd.read_csv(path)
    for column in ["recipe_id", "recipe_page", "section", "result", "station", "ingredients"]:
        df[column] = df[column].fillna("").astype(str).map(normalize)
    df["result_qty"] = df["result_qty"].fillna(1).astype(int)
    df["ingredient_list"] = df["ingredients"].apply(
        lambda raw: [normalize(token) for token in str(raw).split("|") if normalize(token)]
    )
    df["result_key"] = df["result"].map(key)
    return df


@st.cache_data
def load_raw_groups() -> Dict[str, List[str]]:
    live = DATA_DIR / "ingredient_groups.json"
    sample = DATA_DIR / "ingredient_groups.sample.json"
    path = live if live.exists() else sample
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {key(group_name): [normalize(item) for item in members] for group_name, members in data.items()}


@st.cache_data
def load_item_metadata() -> Dict[str, dict]:
    path = DATA_DIR / "item_metadata.json"
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    out: Dict[str, dict] = {}
    for item_name, meta in raw.items():
        effects = meta.get("effects", [])
        if isinstance(effects, str):
            effects = [effects]
        out[key(item_name)] = {
            "item": normalize(item_name),
            "heal": float(meta.get("heal", 0) or 0),
            "stamina": float(meta.get("stamina", 0) or 0),
            "mana": float(meta.get("mana", 0) or 0),
            "sale_value": float(meta.get("sale_value", 0) or 0),
            "effects": [normalize(effect) for effect in effects if normalize(effect)],
            "category": normalize(meta.get("category", "")),
        }
    return out


@st.cache_data
def sanitize_groups(recipes_df: pd.DataFrame, raw_groups: Dict[str, List[str]]) -> Dict[str, List[str]]:
    known_items = set()
    for _, row in recipes_df.iterrows():
        known_items.add(row["result"])
        known_items.update(row["ingredient_list"])

    cleaned: Dict[str, List[str]] = {}
    for group_name, members in raw_groups.items():
        seen = set()
        filtered: List[str] = []
        for member in members:
            member = normalize(member)
            if not member or member not in known_items or key(member) == group_name or key(member) in raw_groups:
                continue
            member_key = key(member)
            if member_key in seen:
                continue
            seen.add(member_key)
            filtered.append(member)
        if filtered:
            cleaned[group_name] = filtered
    return cleaned


@st.cache_data
def build_recipe_index(recipes_df: pd.DataFrame) -> Dict[str, List[dict]]:
    out: Dict[str, List[dict]] = {}
    for _, row in recipes_df.iterrows():
        out.setdefault(row["result_key"], []).append(row.to_dict())
    return out


@st.cache_data
def build_item_catalog(recipes_df: pd.DataFrame, groups: Dict[str, List[str]]) -> List[str]:
    items = set()
    for _, row in recipes_df.iterrows():
        items.add(row["result"])
        items.update(row["ingredient_list"])
    for members in groups.values():
        items.update(members)
    return sorted(item for item in items if item and key(item) not in groups)


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


@st.cache_data
def build_catalog_by_category(catalog: List[str], metadata: Dict[str, dict]) -> Dict[str, List[str]]:
    grouped: Dict[str, List[str]] = {}
    for item_name in catalog:
        grouped.setdefault(infer_item_category(item_name, metadata), []).append(item_name)
    order = ["Food", "Potions and Drinks", "Cooking ingredients", "Alchemy", "Materials", "Equipment", "Other"]
    return {category: sorted(grouped[category]) for category in order if category in grouped}


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


def counts_from_text(raw: str) -> Counter:
    counts = Counter()
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if "," in line:
            item, qty = line.rsplit(",", 1)
        elif "\t" in line:
            item, qty = line.rsplit("\t", 1)
        else:
            item, qty = line, "1"
        item = normalize(item)
        try:
            qty = int(float(qty.strip()))
        except Exception:
            qty = 1
        if item and qty > 0:
            counts[item] += qty
    return counts


def inventory_from_df(df: pd.DataFrame) -> Counter:
    counts = Counter()
    item_col = None
    qty_col = None
    for column in df.columns:
        column_key = key(column)
        if column_key in {"item", "ingredient", "name"} and item_col is None:
            item_col = column
        if column_key in {"qty", "quantity", "count"} and qty_col is None:
            qty_col = column
    if item_col is None:
        item_col = df.columns[0]
    if qty_col is None:
        qty_col = df.columns[1] if len(df.columns) > 1 else None

    for _, row in df.iterrows():
        item = normalize(row[item_col])
        if not item:
            continue
        qty = 1 if qty_col is None else row[qty_col]
        try:
            qty = int(float(qty))
        except Exception:
            qty = 1
        if qty > 0:
            counts[item] += qty
    return counts


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


def count_missing_slots(recipe_ingredients: List[str], inventory: Counter, groups: Dict[str, List[str]]) -> Tuple[int, List[str]]:
    trial = Counter(inventory)
    missing: List[str] = []
    for ingredient in recipe_ingredients:
        ingredient_key = key(ingredient)
        if ingredient_key in groups:
            found = None
            for candidate in groups[ingredient_key]:
                if trial.get(candidate, 0) > 0:
                    found = candidate
                    break
            if found is not None:
                trial[found] -= 1
            else:
                options_preview = ", ".join(groups[ingredient_key][:4])
                suffix = "..." if len(groups[ingredient_key]) > 4 else ""
                missing.append(f"{ingredient} ({options_preview}{suffix})")
        else:
            if trial.get(ingredient, 0) > 0:
                trial[ingredient] -= 1
            else:
                missing.append(ingredient)
    return len(missing), missing


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


def render_inventory_table(inventory: Counter, item_label: str = "item") -> pd.DataFrame:
    rows = [{item_label: item_name, "qty": qty} for item_name, qty in sorted(inventory.items())]
    return pd.DataFrame(rows)


def inventory_picker_state(catalog: List[str]) -> Dict[str, int]:
    if "picker_inventory" not in st.session_state:
        st.session_state["picker_inventory"] = {}
    picker_inventory = {
        normalize(item_name): int(qty)
        for item_name, qty in st.session_state["picker_inventory"].items()
        if normalize(item_name) in catalog and int(qty) > 0
    }
    st.session_state["picker_inventory"] = picker_inventory
    return picker_inventory


def add_selected_search_item() -> None:
    selected = normalize(st.session_state.get("inventory_search_select"))
    if not selected:
        return
    picker_inventory = {
        normalize(item_name): int(qty)
        for item_name, qty in st.session_state.get("picker_inventory", {}).items()
        if int(qty) > 0
    }
    current_qty = int(picker_inventory.get(selected, 0))
    picker_inventory[selected] = max(1, current_qty + (0 if current_qty > 0 else 1))
    st.session_state["picker_inventory"] = picker_inventory
    st.session_state["inventory_search_select"] = None


# UI rendering keeps the working Streamlit widgets but places them in named sections.
def render_inventory_picker(catalog: List[str], catalog_by_category: Dict[str, List[str]]) -> Counter:
    picker_inventory = inventory_picker_state(catalog)

    with named_block("inventory-search-block"):
        st.selectbox(
            "Search items",
            options=catalog,
            index=None,
            key="inventory_search_select",
            placeholder="Start typing an ingredient name...",
            on_change=add_selected_search_item,
            help="Start typing to filter ingredient suggestions in the dropdown, then pick one to add it.",
        )

    with named_block("inventory-filter-toolbar"):
        filter_cols = st.columns([3.2, 0.95, 0.75], gap="small")
        with filter_cols[0]:
            with named_block("categories-toolbar"):
                selected_categories = st.multiselect(
                    "Categories",
                    options=list(catalog_by_category.keys()),
                    default=list(catalog_by_category.keys()),
                    help="Filter the ingredient list to the categories you want to see.",
                )
        with filter_cols[1]:
            with named_block("owned-only-control"):
                st.markdown('<div class="filter-toolbar-spacer"></div>', unsafe_allow_html=True)
                show_owned_only = st.checkbox(
                    "Owned only",
                    value=False,
                    help="Show only the items currently in your inventory.",
                )
        with filter_cols[2]:
            with named_block("clear-control"):
                st.markdown('<div class="filter-toolbar-spacer"></div>', unsafe_allow_html=True)
                if st.button(
                    "Clear",
                    help="Remove every selected item from the inventory builder.",
                    use_container_width=True,
                    type="secondary",
                ):
                    st.session_state["picker_inventory"] = {}
                    picker_inventory = {}
                    st.rerun()

    active_categories = set(selected_categories or list(catalog_by_category.keys()))
    rows = []
    for category_name, items in catalog_by_category.items():
        if category_name not in active_categories:
            continue
        for item_name in items:
            qty = int(picker_inventory.get(item_name, 0))
            if show_owned_only and qty <= 0:
                continue
            rows.append(
                {
                    "Have it": qty > 0,
                    "Ingredient": item_name,
                    "Category": category_name,
                    "Qty": qty if qty > 0 else 1,
                }
            )

    with named_block("ingredient-list-block"):
        if not rows:
            render_empty_state("No items match the current search and filter combination.", tone="soft")
        else:
            render_table_header("Ingredient list", "This is the live filtered ingredient list. Tick or quantity-edit the rows directly here.")
            edited_rows = st.data_editor(
                pd.DataFrame(rows),
                use_container_width=True,
                hide_index=True,
                height=table_height_for_rows(len(rows), min_height=240, max_height=460, row_px=28),
                column_config={
                    "Have it": st.column_config.CheckboxColumn(
                        "Have it",
                        help="Turn this on to include the item in your inventory.",
                    ),
                    "Ingredient": st.column_config.TextColumn(
                        "Ingredient",
                        disabled=True,
                    ),
                    "Category": st.column_config.TextColumn(
                        "Category",
                        disabled=True,
                    ),
                    "Qty": st.column_config.NumberColumn(
                        "Qty",
                        min_value=1,
                        step=1,
                        help="How many of this item you currently own.",
                    ),
                },
                key="inventory_overview_editor",
            )

            visible_items = {normalize(row["Ingredient"]) for _, row in edited_rows.iterrows()}
            for _, row in edited_rows.iterrows():
                item_name = normalize(row["Ingredient"])
                if not item_name:
                    continue
                if bool(row["Have it"]):
                    picker_inventory[item_name] = int(row["Qty"])
                elif item_name in visible_items:
                    picker_inventory.pop(item_name, None)

    with named_block("inventory-stats-block"):
        render_compact_stats(
            [
                ("Categories shown", len(active_categories)),
                ("Visible now", len(rows)),
                ("Selected total", sum(picker_inventory.values())),
                ("Unique selected", len(picker_inventory)),
            ],
            columns=4,
            variant="compact",
        )

    st.session_state["picker_inventory"] = picker_inventory
    return Counter(picker_inventory)


def order_craftable_results(craftable: pd.DataFrame, sort_mode: str) -> pd.DataFrame:
    order_by = recipe_sort_options()[sort_mode]
    ascending = [False] * (len(order_by) - 1) + [True]
    if sort_mode == "Result A-Z":
        ascending = [True]
    return craftable.sort_values(order_by, ascending=ascending)


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


def column_glossary() -> List[Tuple[str, str]]:
    return [
        ("result", "The crafted item you will get."),
        ("result_qty_per_craft", "How many of that item one recipe craft produces."),
        ("max_crafts", "How many full times you can craft the recipe with your current inventory."),
        ("max_total_output", "The total number of result items you can make right now."),
        ("heal_each", "Healing value for one result item, based on your metadata file."),
        ("stamina_each", "Stamina value for one result item."),
        ("mana_each", "Mana value for one result item."),
        ("sale_value_each", "Estimated sale value for one result item."),
        ("healing_total", "Total healing if you craft every possible copy."),
        ("stamina_total", "Total stamina value if you craft every possible copy."),
        ("mana_total", "Total mana value if you craft every possible copy."),
        ("sale_value_total", "Total sale value if you craft every possible copy."),
        ("missing_slots", "How many ingredient slots are still missing for that recipe."),
        ("missing_items", "Which ingredients or ingredient groups are still missing."),
        ("effects", "Short buff or utility notes for the crafted item."),
        ("station", "The crafting station required for the recipe."),
        ("ingredients", "The ingredient list for one craft."),
    ]


def explain_columns(title: str, keys: List[str]) -> None:
    glossary = dict(column_glossary())
    lines = [f"- **{column}**: {glossary[column]}" for column in keys if column in glossary]
    with st.expander(title):
        st.markdown("\n".join(lines))


def present_recipe_table(df: pd.DataFrame, columns: List[str]) -> pd.DataFrame:
    labels = {
        "result": "Item",
        "result_qty_per_craft": "Qty per craft",
        "max_crafts": "Crafts possible",
        "max_total_output": "Total output",
        "heal_each": "Heal each",
        "stamina_each": "Stamina each",
        "mana_each": "Mana each",
        "sale_value_each": "Sale value each",
        "healing_total": "Healing total",
        "stamina_total": "Stamina total",
        "mana_total": "Mana total",
        "sale_value_total": "Sale value total",
        "missing_slots": "Missing slots",
        "missing_items": "Missing items",
        "effects": "Effects / buffs",
        "station": "Station",
        "ingredients": "Ingredients",
    }
    return df[columns].rename(columns=labels)


def table_height_for_rows(row_count: int, min_height: int = 150, max_height: int = 320, row_px: int = 32) -> int:
    if row_count <= 0:
        return min_height
    return min(max_height, max(min_height, 72 + row_count * row_px))


def render_utility_sidebar(
    recipes_df: pd.DataFrame,
    groups: Dict[str, List[str]],
    item_metadata: Dict[str, dict],
    using_live: bool,
) -> Tuple[List[str], int, Counter, st.delta_generator.DeltaGenerator]:
    glossary = column_glossary()
    extra_inventory = Counter()
    with st.sidebar:
        render_hook("utility-rail")
        render_section_header(
            "utility-rail",
            "Utility rail",
            "Planning tools, helper notes, and bulk inventory actions live here.",
            eyebrow="Utility rail",
        )
        snapshot_placeholder = st.empty()

        with named_expander("planning-tools-panel", "Planning tools", expanded=True):
            st.caption("Choose stations and planner depth for the current planning pass.")
            with named_block("stations-filter"):
                station_filter = st.multiselect(
                    "Stations",
                    options=sorted(recipes_df["station"].dropna().unique().tolist()),
                    default=sorted(recipes_df["station"].dropna().unique().tolist()),
                    help="Limit recipe results to the crafting stations you want to use.",
                )
            with named_block("planner-depth-control"):
                max_depth = st.slider(
                    "Planner depth",
                    min_value=1,
                    max_value=8,
                    value=5,
                    help="Higher depth allows more intermediate crafting steps, but may take longer to search.",
                )

        with named_expander("sidebar-guide-panel", "How to use this sidebar", expanded=False):
            st.markdown(
                """
                - **Planning tools** controls stations and planner depth.
                - **Bulk add inventory** supports CSV, Excel, and pasted item lists.
                - **Snapshot** gives the quick inventory/crafting summary.
                - Use the top navigation for full views like **Craft now**, **Plan a target**, **Shopping list**, and **Missing ingredients**.
                """
            )

        with named_expander("bulk-add-panel", "Bulk add inventory", expanded=False):
            st.caption("Use this if paste/upload is faster than ticking individual ingredients.")
            uploaded = st.file_uploader(
                "Upload CSV or Excel",
                type=["csv", "xlsx"],
                help="Use an inventory sheet with an item/name column and an optional qty column.",
            )
            raw_text = st.text_area(
                "Paste item,qty lines",
                value="",
                height=120,
                placeholder="Wheat,8\nClean Water,4\nSalt,3",
                help="Formats like `item,qty`, `item<TAB>qty`, or just `item` all work.",
            )

            if uploaded is not None:
                if uploaded.name.lower().endswith(".csv"):
                    uploaded_df = pd.read_csv(uploaded)
                else:
                    uploaded_df = pd.read_excel(uploaded)
                extra_inventory.update(inventory_from_df(uploaded_df))

            if raw_text.strip():
                extra_inventory.update(counts_from_text(raw_text))

        with named_expander("data-details-panel", "Data details", expanded=False):
            st.caption(f"Recipes loaded: {len(recipes_df)}")
            st.caption(f"Ingredient groups cleaned: {len(groups)}")
            st.caption(f"Items with effect/value notes: {len(item_metadata)}")
            st.caption("Live wiki pull detected." if using_live else "Using bundled sample data until you run the sync script.")
            st.caption("Item effects and sale values come from `data/item_metadata.json`, so you can keep tuning them.")

        with named_expander("column-help-panel", "Column help", expanded=False):
            for column, description in glossary:
                st.markdown(f"- **{column}**: {description}")

    return station_filter, max_depth, extra_inventory, snapshot_placeholder


def render_utility_sidebar_extras(
    snapshot_placeholder: st.delta_generator.DeltaGenerator,
    inventory_df: pd.DataFrame,
    filtered: pd.DataFrame,
    craftable: pd.DataFrame,
    near: pd.DataFrame,
    top_heal: pd.DataFrame,
    top_stamina: pd.DataFrame,
    top_mana: pd.DataFrame,
) -> None:
    with snapshot_placeholder.container():
        with named_panel("snapshot-card", border=True):
            render_section_header(
                "snapshot-card",
                "Snapshot",
                "Compact summary of your current stash, direct options, and near-craft coverage.",
            )
            with named_block("snapshot-primary-stats"):
                render_compact_stats(
                    [
                        ("Inventory lines", len(inventory_df)),
                        ("Known recipes", len(filtered)),
                        ("Direct crafts", len(craftable)),
                        ("Near crafts", len(near)),
                    ],
                    columns=2,
                    variant="sidebar tight",
                )
            with named_block("snapshot-best-stats"):
                render_compact_stats(
                    [
                        ("Best heal", top_heal.iloc[0]["result"] if not top_heal.empty and top_heal.iloc[0]["healing_total"] > 0 else "None"),
                        ("Best stamina", top_stamina.iloc[0]["result"] if not top_stamina.empty and top_stamina.iloc[0]["stamina_total"] > 0 else "None"),
                        ("Best mana", top_mana.iloc[0]["result"] if not top_mana.empty and top_mana.iloc[0]["mana_total"] > 0 else "None"),
                    ],
                    columns=1,
                    variant="sidebar tight",
                )


def recipe_sort_options() -> Dict[str, List[str]]:
    return {
        "Smart score": ["smart_score", "max_crafts", "result"],
        "Max crafts": ["max_crafts", "max_total_output", "result"],
        "Max total output": ["max_total_output", "max_crafts", "result"],
        "Healing yield": ["healing_total", "max_total_output", "result"],
        "Stamina yield": ["stamina_total", "max_total_output", "result"],
        "Mana yield": ["mana_total", "max_total_output", "result"],
        "Sale value": ["sale_value_total", "max_total_output", "result"],
        "Result A-Z": ["result"],
    }


# Main app shell composition.
st.set_page_config(page_title="Alie's Outward Crafting", page_icon=":tea:", layout="wide")
load_ui_styles()

recipes_df = load_recipes()
raw_groups = load_raw_groups()
groups = sanitize_groups(recipes_df, raw_groups)
item_metadata = load_item_metadata()
recipe_index = build_recipe_index(recipes_df)
item_catalog = build_item_catalog(recipes_df, groups)
catalog_by_category = build_catalog_by_category(item_catalog, item_metadata)

render_hook("app-shell")
render_hero("Alie's Outward Crafting", "Compare recipes, rank recovery or value, and build a clean shopping list.")
using_live = (DATA_DIR / "recipes.csv").exists()
station_filter, max_depth, extra_inventory, snapshot_placeholder = render_utility_sidebar(
    recipes_df, groups, item_metadata, using_live
)

nav_col, _ = st.columns([0.78, 0.22], gap="small")
with nav_col:
    with named_block("top-mode-nav"):
        active_section = render_section_nav()
        render_active_section_note(active_section)
st.markdown('<div class="thin-divider"></div>', unsafe_allow_html=True)

with named_block("content-shell"):
    # Manual edit point: main workflow width vs right results sidebar width.
    inventory_col, overview_col = st.columns([1.34, 0.76], gap="medium")
    with inventory_col:
        render_hook("main-column")
        render_hook("inventory-section")
        render_section_header("inventory-section", "Inventory input", "Search, filter, and edit the ingredients you own here.")
        inventory_overview_placeholder = st.empty()
        picker_inventory = render_inventory_picker(item_catalog, catalog_by_category)

        inventory = Counter(picker_inventory)
        inventory.update(extra_inventory)

    inventory_df = render_inventory_table(inventory)
    inventory_overview_height = table_height_for_rows(len(inventory_df), min_height=112, max_height=210, row_px=24)

    with inventory_overview_placeholder.container():
        with named_panel("inventory-overview-card", border=True):
            render_section_header(
                "inventory-overview-card",
                "Inventory overview",
                "Your currently selected inventory, including anything added from paste or upload.",
            )
            with named_block("inventory-overview-top-row"):
                top_row = st.columns([1, 1, 1.08], gap="small")
                top_row[0].metric("Unique items", len(inventory))
                top_row[1].metric("Total quantity", sum(inventory.values()))
                with top_row[2]:
                    st.markdown('<div class="inventory-overview-button-spacer"></div>', unsafe_allow_html=True)
                    st.download_button(
                        "Download inventory CSV",
                        data=inventory_df.to_csv(index=False).encode("utf-8"),
                        file_name="outward_inventory.csv",
                        mime="text/csv",
                        use_container_width=True,
                        type="secondary",
                        disabled=inventory_df.empty,
                    )
            with named_block("inventory-overview-body"):
                if inventory_df.empty:
                    render_empty_state(
                        "No inventory selected yet. Add ingredients in the main list or use bulk add from the utility rail.",
                        tone="inline",
                    )
                else:
                    render_table_header("Inventory overview", "This table shows the current inventory feeding the calculator.")
                    st.dataframe(inventory_df, use_container_width=True, hide_index=True, height=inventory_overview_height)

    filtered = recipes_df[recipes_df["station"].isin(station_filter)].copy()
    results = build_direct_results(filtered, inventory, groups, item_metadata)
    craftable = results[results["max_crafts"] > 0].copy()
    near = results[(results["max_crafts"] == 0) & (results["missing_slots"] <= 2)].copy()
    ordered_preview = order_craftable_results(craftable, "Smart score") if not craftable.empty else craftable

    top_heal = craftable.sort_values(["healing_total", "result"], ascending=[False, True]).head(1)
    top_stamina = craftable.sort_values(["stamina_total", "result"], ascending=[False, True]).head(1)
    top_mana = craftable.sort_values(["mana_total", "result"], ascending=[False, True]).head(1)
    render_utility_sidebar_extras(snapshot_placeholder, inventory_df, filtered, craftable, near, top_heal, top_stamina, top_mana)

    with overview_col:
        render_hook("right-sidebar")
        with named_panel("best-direct-card", border=True):
            render_section_header(
                "best-direct-card",
                "Best direct options",
                "A quiet shortlist of the strongest immediate crafts from your current inventory.",
            )
            with named_block("best-direct-stats"):
                render_compact_stats(
                    [("Direct crafts", len(craftable)), ("Near crafts", len(near))],
                    columns=2,
                    variant="sidebar tight",
                )
            preview_cols = ["result", "max_crafts", "max_total_output", "station", "effects", "ingredients"]
            preview_df = present_recipe_table(ordered_preview.head(12), preview_cols) if not ordered_preview.empty else pd.DataFrame()
            if preview_df.empty:
                render_empty_state("Direct craft recommendations will appear here once your selected inventory can make something.")
            else:
                render_table_header("Best direct options", "A quick shortlist of the most immediately craftable options from your current inventory.")
                st.dataframe(
                    preview_df,
                    use_container_width=True,
                    hide_index=True,
                    height=table_height_for_rows(len(preview_df), min_height=150, max_height=260, row_px=28),
                )

        with named_panel("almost-craftable-card", border=True):
            render_section_header(
                "almost-craftable-card",
                "Almost craftable recipes",
                "Near-craftable recipes that are one or two missing ingredient slots away.",
            )
            with named_block("almost-craftable-stats"):
                render_compact_stats(
                    [("Near crafts", len(near)), ("Known recipes", len(filtered))],
                    columns=2,
                    variant="sidebar tight",
                )
            if near.empty:
                render_empty_state("No recipes are within one or two missing ingredient slots right now.")
            else:
                near_preview_cols = ["result", "missing_slots", "missing_items", "station", "ingredients"]
                render_table_header("Almost craftable recipes", "Recipes that are close enough to matter for the current bag and station filters.")
                st.dataframe(
                    present_recipe_table(near.sort_values(["missing_slots", "result"]).head(10), near_preview_cols),
                    use_container_width=True,
                    hide_index=True,
                    height=table_height_for_rows(min(len(near), 10), min_height=150, max_height=240, row_px=28),
                )

        with named_panel("craft-now-card", border=True):
            with named_expander("craft-now-panel", "What you can craft right now", expanded=active_section == "Craft now"):
                render_tab_help(
                    "Craft now",
                    "This answers the live question: what can I make immediately from what I already have? Sort by output, healing, stamina, mana, or sale value."
                )
                if craftable.empty:
                    render_empty_state("No direct crafts found with the current inventory.", tone="soft")
                else:
                    sort_mode = st.selectbox(
                        "Sort results by",
                        list(recipe_sort_options().keys()),
                        index=0,
                        key="craft_now_sort_side",
                        help="Choose what 'best' means for this pass: convenience, total output, healing, stamina, mana, or sale value.",
                    )
                    ordered = order_craftable_results(craftable, sort_mode)
                    craft_now_cols = [
                        "result",
                        "result_qty_per_craft",
                        "max_crafts",
                        "max_total_output",
                        "heal_each",
                        "stamina_each",
                        "mana_each",
                        "sale_value_each",
                        "effects",
                        "station",
                        "ingredients",
                    ]
                    render_table_header("Craftable recipes", "Recipes you can make immediately with the current inventory and station filters.")
                    st.dataframe(
                        present_recipe_table(ordered, craft_now_cols),
                        use_container_width=True,
                        hide_index=True,
                        height=table_height_for_rows(len(ordered), min_height=200, max_height=340, row_px=28),
                    )
                    csv_bytes = ordered.drop(columns=["ingredient_list"]).to_csv(index=False).encode("utf-8")
                    st.download_button(
                        "Download craftable recipes as CSV",
                        data=csv_bytes,
                        file_name="outward_craftable_recipes.csv",
                        mime="text/csv",
                        help="Exports the currently ranked craftable list with effect and value columns.",
                        type="secondary",
                    )

if active_section == "Plan a target":
    with named_expander("plan-target-panel", "Plan a target", expanded=True):
        render_tab_help(
            "Plan a target",
            "This tab tries to build one chosen item through sub-crafts. It is useful when an item is not directly craftable but can be reached through intermediate recipes."
        )
        target = st.selectbox(
            "Choose a target item",
            sorted(recipes_df["result"].unique().tolist()),
            help="Pick one craft result and the planner will try to reach it through sub-crafts.",
        )
        working_inventory = Counter(inventory)
        plan = plan_item(target, working_inventory, groups, recipe_index, depth=0, max_depth=max_depth, stack=tuple())
        if plan is None:
            st.warning("No multi-step plan found with the current inventory and planner depth.")
        else:
            st.success(f"A plan was found for at least 1x {target}.")
            st.code("\n".join(format_plan_lines(plan)), language="text")
            render_table_header("Inventory after crafting one target", "A preview of what remains in your bag after following the plan once.")
            st.dataframe(render_inventory_table(working_inventory), use_container_width=True, hide_index=True, height=280)

elif active_section == "Shopping list":
    with named_expander("shopping-list-panel", "Shopping list", expanded=True):
        render_tab_help(
            "Shopping list",
            "This mode is for build prep. Paste several target items and quantities, and the app estimates the smallest missing ingredient list it can find from your current stash."
        )
        target_text = st.text_area(
            "Target build",
            value="Great Life Potion,2\nBread,2\nTravel Ration,1",
            height=150,
            help="Use `item,qty` lines just like inventory input. This can contain multiple goal items.",
        )
        target_counts = counts_from_text(target_text)
        if not target_counts:
            st.info("Add at least one target item to generate a shopping list.")
        else:
            missing_counts, shopping_lines, final_inventory = build_shopping_list(
                target_counts, inventory, groups, recipe_index, max_depth=max_depth
            )
            render_table_header("Requested build", "The target items and quantities you asked the shopping list to satisfy.")
            st.dataframe(render_inventory_table(target_counts, item_label="target"), use_container_width=True, hide_index=True)
            if not missing_counts:
                st.success("Your current stash is enough for this build. No shopping needed.")
            else:
                missing_df = render_inventory_table(missing_counts)
                render_table_header("Minimum missing ingredients found", "The smallest missing ingredient list the planner found for the requested build.")
                st.dataframe(missing_df, use_container_width=True, hide_index=True)
                shopping_csv = missing_df.to_csv(index=False).encode("utf-8")
                st.download_button(
                    "Download shopping list as CSV",
                    data=shopping_csv,
                    file_name="outward_shopping_list.csv",
                    mime="text/csv",
                    help="Exports the missing ingredient list for the current target build.",
                    type="secondary",
                )

            with named_expander("shopping-plan-lines", "Show build plan", expanded=False):
                st.code("\n".join(shopping_lines), language="text")
            with named_expander("shopping-plan-remaining", "Show remaining inventory after the build", expanded=False):
                st.dataframe(render_inventory_table(final_inventory), use_container_width=True, hide_index=True)

elif active_section == "Missing ingredients":
    with named_expander("missing-ingredients-panel", "Missing ingredients", expanded=True):
        render_tab_help(
            "Missing ingredients",
            "This is the near-miss tab. It shows recipes that are close enough to matter, so you can decide which quick pickups unlock the most useful crafts."
        )
        if near.empty:
            st.info("Nothing is within one or two missing ingredient slots right now.")
        else:
            near_cols = [
                "result",
                "missing_slots",
                "missing_items",
                "heal_each",
                "stamina_each",
                "mana_each",
                "sale_value_each",
                "station",
                "ingredients",
            ]
            render_table_header("Almost craftable recipes", "Recipes that are one or two ingredient slots away from being craftable.")
            st.dataframe(
                present_recipe_table(near.sort_values(["missing_slots", "result"]), near_cols),
                use_container_width=True,
                hide_index=True,
                height=380,
            )

elif active_section == "Recipe database":
    with named_expander("recipe-database-panel", "Recipe database", expanded=True):
        render_tab_help(
            "Recipe database",
            "This is the reference tab. Browse the full recipe set, cleaned ingredient groups, and the editable item stats that power the ranking views."
        )
        show_recipes = recipes_df.copy()
        show_recipes["ingredients"] = show_recipes["ingredient_list"].apply(lambda items: ", ".join(items))
        show_recipes["effects"] = show_recipes["result"].apply(lambda result: "; ".join(item_meta_for(result, item_metadata)["effects"]))
        show_recipes["heal"] = show_recipes["result"].apply(lambda result: item_meta_for(result, item_metadata)["heal"])
        show_recipes["stamina"] = show_recipes["result"].apply(lambda result: item_meta_for(result, item_metadata)["stamina"])
        show_recipes["mana"] = show_recipes["result"].apply(lambda result: item_meta_for(result, item_metadata)["mana"])
        show_recipes["sale_value"] = show_recipes["result"].apply(lambda result: item_meta_for(result, item_metadata)["sale_value"])
        show_recipes = show_recipes.drop(columns=["ingredient_list", "result_key"])
        render_table_header("Recipe database", "The full recipe dataset currently loaded into the app.")
        st.dataframe(show_recipes, use_container_width=True, hide_index=True, height=420)

        if groups:
            render_table_header("Ingredient groups", "Grouped ingredient tokens such as Water, Vegetable, or Meat and the items that can fill them.")
            group_rows = [{"group": group_name, "members": ", ".join(members)} for group_name, members in sorted(groups.items())]
            st.dataframe(pd.DataFrame(group_rows), use_container_width=True, hide_index=True)

        if item_metadata:
            render_table_header("Item effects and prices", "Editable metadata that powers effect text, recovery values, and sale-value ranking.")
            st.dataframe(build_metadata_table(item_metadata), use_container_width=True, hide_index=True)
