from __future__ import annotations

import json
import os
import re
from collections import Counter
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import pandas as pd

from shared import crafting_core as core
from shared import inventory_ops


BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "shared" / "data"
OUTWARD_SYNC_ENV_VAR = "OUTWARD_SYNC_INVENTORY_PATH"
DEFAULT_OUTWARD_SYNC_SUBPATH = Path("Documents") / "OutwardCraftSync" / "current_inventory.csv"
BEST_DIRECT_SHORTLIST_LIMIT = 8
NEAR_RESULTS_PREVIEW_LIMIT = 30
CRAFTABLE_DEBUG_SORT_MODES = [
    ("Smart score", "smart_score"),
    ("Best healing", "healing_total"),
    ("Best stamina", "stamina_total"),
    ("Best mana", "mana_total"),
    ("Max crafts", "max_crafts"),
    ("Max total output", "max_total_output"),
    ("Sale value", "sale_value_total"),
    ("Result A-Z", "result"),
]


def outward_sync_inventory_path() -> Path:
    configured = os.environ.get(OUTWARD_SYNC_ENV_VAR, "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / DEFAULT_OUTWARD_SYNC_SUBPATH


def _load_recipes() -> pd.DataFrame:
    live = DATA_DIR / "recipes.csv"
    sample = DATA_DIR / "recipes.sample.csv"
    path = live if live.exists() else sample
    df = pd.read_csv(path)
    for column in ["recipe_id", "recipe_page", "section", "result", "station", "ingredients"]:
        df[column] = df[column].fillna("").astype(str).map(core.normalize)
    df["station"] = df["station"].map(core.normalize_station)
    df["result_qty"] = df["result_qty"].fillna(1).astype(int)
    df["ingredient_list"] = df["ingredients"].apply(
        lambda raw: [core.normalize(token) for token in str(raw).split("|") if core.normalize(token)]
    )
    df["result_key"] = df["result"].map(core.key)
    return df


def _load_raw_groups() -> Dict[str, List[str]]:
    live = DATA_DIR / "ingredient_groups.json"
    sample = DATA_DIR / "ingredient_groups.sample.json"
    path = live if live.exists() else sample
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {core.key(group_name): [core.normalize(item) for item in members] for group_name, members in data.items()}


def _load_item_metadata() -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for path in [DATA_DIR / "item_metadata.generated.json", DATA_DIR / "item_metadata.json"]:
        if not path.exists():
            continue
        raw = json.loads(path.read_text(encoding="utf-8"))
        for item_name, meta in raw.items():
            effects = meta.get("effects", [])
            if isinstance(effects, str):
                effects = [effects]
            out[core.key(item_name)] = {
                "item": core.normalize(item_name),
                "heal": float(meta.get("heal", 0) or 0),
                "stamina": float(meta.get("stamina", 0) or 0),
                "mana": float(meta.get("mana", 0) or 0),
                "sale_value": float(meta.get("sale_value", 0) or 0),
                "buy_value": float(meta.get("buy_value", 0) or 0),
                "weight": float(meta.get("weight", 0) or 0),
                "effects": [core.normalize(effect) for effect in effects if core.normalize(effect)],
                "category": core.normalize(meta.get("category", "")),
            }
    return out


@dataclass(frozen=True)
class CalculatorData:
    recipes_df: pd.DataFrame
    groups: Dict[str, List[str]]
    item_metadata: Dict[str, dict]
    recipe_index: Dict[str, List[dict]]
    item_catalog: List[str]
    catalog_by_category: Dict[str, List[str]]
    station_options: List[str]


@dataclass(frozen=True)
class RecipeSurfaceFrames:
    filtered: pd.DataFrame
    evaluated: pd.DataFrame
    craftable: pd.DataFrame
    near: pd.DataFrame


def load_calculator_data() -> CalculatorData:
    recipes_df = _load_recipes()
    raw_groups = _load_raw_groups()
    groups = core.sanitize_groups(recipes_df, raw_groups)
    recipes_df = core.prune_invalid_recipes(recipes_df, groups)
    item_metadata = _load_item_metadata()
    recipe_index = core.build_recipe_index(recipes_df)
    item_catalog = core.build_item_catalog(recipes_df, groups, item_metadata)
    catalog_by_category = core.build_catalog_by_category(item_catalog, item_metadata)
    station_options = sorted(recipes_df["station"].dropna().unique().tolist())
    return CalculatorData(
        recipes_df=recipes_df,
        groups=groups,
        item_metadata=item_metadata,
        recipe_index=recipe_index,
        item_catalog=item_catalog,
        catalog_by_category=catalog_by_category,
        station_options=station_options,
    )


class InventoryStore:
    def __init__(self) -> None:
        self._inventory: Counter = Counter()

    def get(self) -> Counter:
        return Counter(self._inventory)

    def replace(self, inventory: Counter) -> Counter:
        self._inventory = Counter({core.normalize(item): int(qty) for item, qty in inventory.items() if int(qty) > 0})
        return self.get()

    def merge_items(self, inventory: Counter) -> Counter:
        current = self.get()
        for item, qty in inventory.items():
            item_name = core.normalize(item)
            amount = int(qty)
            if item_name and amount > 0:
                current[item_name] += amount
        self._inventory = current
        return self.get()

    def add(self, item: str, qty: int) -> Counter:
        return self.replace(Counter(inventory_ops.merge_inventory_entry(self.get(), item, qty)))

    def set_item(self, item: str, qty: int) -> Counter:
        current = self.get()
        item_name = core.normalize(item)
        amount = max(0, int(qty))
        if amount <= 0:
            current.pop(item_name, None)
        elif item_name:
            current[item_name] = amount
        self._inventory = current
        return self.get()


def recipe_sort_options() -> Dict[str, List[str]]:
    return {
        "Smart score": ["smart_score", "max_crafts", "result"],
        "Max crafts": ["max_crafts", "max_total_output", "result"],
        "Max total output": ["max_total_output", "max_crafts", "result"],
        "Best healing": ["healing_total", "max_total_output", "result"],
        "Best stamina": ["stamina_total", "max_total_output", "result"],
        "Best mana": ["mana_total", "max_total_output", "result"],
        "Healing yield": ["healing_total", "max_total_output", "result"],
        "Stamina yield": ["stamina_total", "max_total_output", "result"],
        "Mana yield": ["mana_total", "max_total_output", "result"],
        "Sale value": ["sale_value_total", "max_total_output", "result"],
        "Result A-Z": ["result"],
    }


def order_craftable_results(craftable: pd.DataFrame, sort_mode: str) -> pd.DataFrame:
    selected_sort_mode = sort_mode if sort_mode in recipe_sort_options() else "Smart score"
    order_by = recipe_sort_options()[selected_sort_mode]
    ascending = [False] * (len(order_by) - 1) + [True]
    if selected_sort_mode == "Result A-Z":
        ascending = [True]
    return craftable.sort_values(order_by, ascending=ascending)


def _inventory_counter(items: Iterable[dict]) -> Counter:
    counts = Counter()
    for item in items:
        item_name = core.normalize(item.get("item"))
        qty = int(item.get("qty", 0))
        if item_name and qty > 0:
            counts[item_name] += qty
    return counts


def _df_records(df: pd.DataFrame) -> List[dict]:
    if df.empty:
        return []
    clean = df.where(pd.notnull(df), None)
    return clean.to_dict(orient="records")


class CalculatorService:
    def __init__(self, data: CalculatorData, inventory_store: Optional[InventoryStore] = None) -> None:
        self.data = data
        self.inventory_store = inventory_store or InventoryStore()

    def get_inventory(self) -> Counter:
        return self.inventory_store.get()

    def get_inventory_response(self) -> dict:
        inventory = self.get_inventory()
        inventory_df = inventory_ops.inventory_table_df(inventory)
        return {
            "items": _df_records(inventory_df.rename(columns={"item": "item", "qty": "qty"})),
            "unique_items": len(inventory),
            "total_quantity": int(sum(inventory.values())),
        }

    def replace_inventory(self, items: List[dict]) -> dict:
        inventory = _inventory_counter(items)
        self.inventory_store.replace(inventory)
        return self.get_inventory_response()

    def add_inventory_item(self, item: str, qty: int) -> dict:
        self.inventory_store.add(item, qty)
        return self.get_inventory_response()

    def set_inventory_item(self, item: str, qty: int) -> dict:
        self.inventory_store.set_item(item, qty)
        return self.get_inventory_response()

    def import_text_inventory(self, raw_text: str) -> dict:
        imported = inventory_ops.counts_from_text(raw_text)
        self.inventory_store.replace(imported)
        return self.get_inventory_response()

    def import_csv_inventory(self, file_bytes: bytes) -> dict:
        imported = inventory_ops.inventory_from_df(pd.read_csv(BytesIO(file_bytes)))
        self.inventory_store.replace(imported)
        return self.get_inventory_response()

    def import_csv_inventory_file(self, path: Path) -> dict:
        return self.import_csv_inventory(path.read_bytes())

    def import_latest_outward_inventory(self) -> dict:
        sync_path = outward_sync_inventory_path()
        if not sync_path.is_file():
            raise FileNotFoundError(
                "Latest Outward inventory file not found at "
                f"{sync_path}. Export your inventory from the mod and try again."
            )
        return self.import_csv_inventory_file(sync_path)

    def import_excel_inventory(self, file_bytes: bytes) -> dict:
        imported = inventory_ops.inventory_from_df(pd.read_excel(BytesIO(file_bytes)))
        self.inventory_store.replace(imported)
        return self.get_inventory_response()

    def _normalized_stations(self, stations: Optional[List[str]]) -> Optional[List[str]]:
        if stations is None:
            return None
        cleaned = [core.normalize_station(station) for station in stations if core.normalize(station)]
        return cleaned

    def filtered_recipes(self, stations: Optional[List[str]] = None) -> pd.DataFrame:
        station_filter = self._normalized_stations(stations)
        if station_filter is None:
            return self.data.recipes_df.copy()
        if not station_filter:
            return self.data.recipes_df.iloc[0:0].copy()
        return self.data.recipes_df[self.data.recipes_df["station"].isin(station_filter)].copy()

    def recipe_surface_frames(
        self,
        stations: Optional[List[str]] = None,
        max_missing_slots: int = 2,
    ) -> RecipeSurfaceFrames:
        filtered = self.filtered_recipes(stations)
        inventory = self.get_inventory()
        evaluated = core.build_direct_results(filtered, inventory, self.data.groups, self.data.item_metadata)
        craftable = evaluated[evaluated["max_crafts"] > 0].copy()
        near = evaluated[
            (evaluated["max_crafts"] == 0)
            & (evaluated["missing_slots"] <= max_missing_slots)
            & (evaluated["matched_slots"] > 0)
        ].copy()
        return RecipeSurfaceFrames(
            filtered=filtered,
            evaluated=evaluated,
            craftable=craftable,
            near=near,
        )

    def _ordered_near_results(self, near: pd.DataFrame) -> pd.DataFrame:
        if near.empty:
            return near.copy()
        return near.sort_values(["missing_slots", "matched_slots", "result"], ascending=[True, False, True]).reset_index(drop=True)

    def _matching_result_rows(self, frame: pd.DataFrame, result: str) -> pd.DataFrame:
        if frame.empty:
            return frame.copy()
        result_key = core.key(result)
        return frame[frame["result"].map(core.key) == result_key].copy()

    def _ordered_evaluated_matches(self, evaluated_matches: pd.DataFrame) -> pd.DataFrame:
        if evaluated_matches.empty:
            return evaluated_matches.copy()
        return evaluated_matches.sort_values(
            ["max_crafts", "matched_slots", "missing_slots", "smart_score", "result"],
            ascending=[False, False, True, False, True],
        ).reset_index(drop=True)

    def _craftable_sort_positions(self, craftable: pd.DataFrame, result: str) -> List[dict]:
        positions: List[dict] = []
        total = int(len(craftable))
        for sort_mode, primary_column in CRAFTABLE_DEBUG_SORT_MODES:
            ordered = order_craftable_results(craftable, sort_mode) if not craftable.empty else craftable.copy()
            matches = self._matching_result_rows(ordered.reset_index(drop=True), result)
            best_row = matches.iloc[0] if not matches.empty else None
            rank = int(matches.index[0]) + 1 if not matches.empty else None
            primary_value = None if best_row is None else best_row.get(primary_column)
            if isinstance(primary_value, float):
                primary_value = float(primary_value)
            elif isinstance(primary_value, int):
                primary_value = int(primary_value)
            elif primary_value is not None:
                primary_value = str(primary_value)
            positions.append(
                {
                    "sort_mode": sort_mode,
                    "rank": rank,
                    "total": total,
                    "primary_column": primary_column,
                    "primary_value": primary_value,
                }
            )
        return positions

    def _plan_summary(self, plan: dict, target: str, *, found: bool, station_filtered_out: bool) -> dict:
        craft_steps = 0
        use_steps = 0
        missing_steps = 0
        group_steps = 0
        uses_existing_target = False
        target_key = core.key(target)

        def walk(step: dict, *, at_root: bool = False) -> None:
            nonlocal craft_steps, use_steps, missing_steps, group_steps, uses_existing_target
            step_type = step.get("type")
            if step_type == "craft":
                craft_steps += 1
                for child in step.get("steps", []):
                    walk(child)
                return
            if step_type == "use":
                use_steps += 1
                if at_root and core.key(step.get("item", "")) == target_key:
                    uses_existing_target = True
                return
            if step_type == "group":
                group_steps += 1
                child = step.get("step")
                if isinstance(child, dict):
                    walk(child)
                return
            if step_type == "missing":
                missing_steps += 1

        if isinstance(plan, dict):
            walk(plan, at_root=True)

        if found:
            if uses_existing_target:
                mode = "use_existing_target"
            elif craft_steps <= 1:
                mode = "direct_craft_route"
            else:
                mode = "recursive_craft_route"
        elif station_filtered_out:
            mode = "station_filtered_out"
        elif craft_steps > 0 or use_steps > 0 or group_steps > 0:
            mode = "partial_route"
        else:
            mode = "no_route"

        return {
            "mode": mode,
            "craft_steps": int(craft_steps),
            "use_steps": int(use_steps),
            "missing_steps": int(missing_steps),
            "group_steps": int(group_steps),
            "uses_existing_target": bool(uses_existing_target),
            "requires_crafting": bool(craft_steps > 0),
        }

    def _planner_explanation(
        self,
        *,
        target: str,
        found: bool,
        mode: str,
        station_filtered_out: bool,
        crafting_one_more: bool,
        owned_qty: int,
    ) -> str:
        if crafting_one_more and owned_qty > 0:
            owned_unit = "copy" if owned_qty == 1 else "copies"
            owned_prefix = f"You already have {owned_qty} {owned_unit} of {target} in your bag. "
            if found and mode == "direct_craft_route":
                return owned_prefix + "You can craft one more directly with the current inventory, depth, and station filters."
            if found and mode == "recursive_craft_route":
                return owned_prefix + "You can craft one more by following an intermediate route."
            if found:
                return owned_prefix + "A one-more route is available."
            if station_filtered_out:
                return (
                    owned_prefix
                    + "You cannot craft one more with the current station filters. Enable the missing station to build a route."
                )
            return (
                owned_prefix
                + "No complete route for one more copy was found. The steps below show the closest branch and what is still missing."
            )

        if found and mode == "use_existing_target":
            return "The target is already in your bag. No crafting route is needed unless you want to make another copy."
        if found and mode == "direct_craft_route":
            return "Complete route found. You can craft this target directly with the current inventory, planner depth, and station filters."
        if found:
            return (
                "Complete route found. The planner can build this target through intermediate crafts with the current inventory, "
                "planner depth, and station filters."
            )
        if station_filtered_out:
            return "No recipe for this target is available with the current station filters. Enable the needed station to build a route."
        return (
            "No complete route was found. The steps below show the closest route the planner could build, "
            "and the missing list shows what is still required."
        )

    def _planner_route(
        self,
        *,
        target: str,
        max_depth: int,
        stations: Optional[List[str]],
        base_inventory: Counter,
        crafting_one_more: bool,
        owned_qty: int,
    ) -> dict:
        target_name = core.normalize(target)
        working_inventory = Counter(base_inventory)
        if crafting_one_more and owned_qty > 0:
            # Planning one more should not consume an already-owned copy to satisfy the target.
            working_inventory.pop(target_name, None)

        filtered = self.filtered_recipes(stations)
        recipe_index = core.build_recipe_index(filtered)
        target_key = core.key(target_name)
        missing_counts, plan = core.shopping_item_plan(
            target_name,
            working_inventory,
            self.data.groups,
            recipe_index,
            depth=0,
            max_depth=max_depth,
            stack=tuple(),
        )
        found = not missing_counts
        station_filtered_out = target_key in self.data.recipe_index and target_key not in recipe_index
        plan_summary = self._plan_summary(plan, target_name, found=found, station_filtered_out=station_filtered_out)

        if found:
            remaining_inventory = Counter(working_inventory)
        else:
            remaining_inventory = Counter(base_inventory)

        if crafting_one_more and owned_qty > 0 and found:
            remaining_inventory[target_name] += owned_qty

        explanation = self._planner_explanation(
            target=target_name,
            found=found,
            mode=str(plan_summary["mode"]),
            station_filtered_out=station_filtered_out,
            crafting_one_more=crafting_one_more,
            owned_qty=owned_qty,
        )
        return {
            "target": target_name,
            "found": bool(found),
            "explanation": explanation,
            "lines": core.format_plan_lines(plan),
            "missing": _df_records(inventory_ops.inventory_table_df(missing_counts)),
            "remaining_inventory": _df_records(inventory_ops.inventory_table_df(remaining_inventory)),
            "mode": plan_summary["mode"],
            "craft_steps": plan_summary["craft_steps"],
            "uses_existing_target": plan_summary["uses_existing_target"],
            "requires_crafting": plan_summary["requires_crafting"],
            "station_filtered_out": bool(station_filtered_out),
        }

    def result_frames(
        self,
        stations: Optional[List[str]] = None,
        max_missing_slots: int = 2,
    ) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        frames = self.recipe_surface_frames(stations, max_missing_slots=max_missing_slots)
        return frames.filtered, frames.craftable, frames.near

    def _snapshot_effect_tokens(self, effects: str) -> List[str]:
        return [core.key(effect) for effect in str(effects or "").split(";") if core.normalize(effect)]

    def _snapshot_effect_amount(self, effects: List[str], fragment: str) -> float:
        best = 0.0
        for effect in effects:
            if fragment not in effect:
                continue
            match = re.search(r"(\d+(?:\.\d+)?)", effect)
            best = max(best, float(match.group(1)) if match else 1.0)
        return best

    def _snapshot_row_matches_stat(self, row: pd.Series, stat_each_column: str) -> bool:
        effects = self._snapshot_effect_tokens(str(row.get("effects", "")))
        stat_value = float(row.get(stat_each_column, 0) or 0)
        if stat_value > 0:
            return True
        if stat_each_column == "heal_each":
            return any(fragment in effect for effect in effects for fragment in ["health recovery", "burnt health"])
        if stat_each_column == "stamina_each":
            return any(fragment in effect for effect in effects for fragment in ["stamina recovery", "burnt stamina"])
        return any(fragment in effect for effect in effects for fragment in ["mana recovery", "burnt mana"])

    def _snapshot_stat_score(self, row: pd.Series, stat_each_column: str) -> float:
        effects = self._snapshot_effect_tokens(str(row.get("effects", "")))
        heal_each = float(row.get("heal_each", 0) or 0)
        stamina_each = float(row.get("stamina_each", 0) or 0)
        mana_each = float(row.get("mana_each", 0) or 0)
        smart_score = float(row.get("smart_score", 0) or 0)
        category = core.key(str(row.get("category", "")))

        health_recovery = self._snapshot_effect_amount(effects, "health recovery")
        stamina_recovery = self._snapshot_effect_amount(effects, "stamina recovery")
        mana_recovery = self._snapshot_effect_amount(effects, "mana recovery")
        burnt_health = self._snapshot_effect_amount(effects, "burnt health")
        burnt_stamina = self._snapshot_effect_amount(effects, "burnt stamina")
        burnt_mana = self._snapshot_effect_amount(effects, "burnt mana")

        if stat_each_column == "heal_each":
            score = (
                heal_each * 0.45
                + health_recovery * 7.0
                + stamina_each * 0.22
                + stamina_recovery * 7.0
                + burnt_health * 0.55
                + smart_score * 0.2
            )
            if heal_each > 0 and stamina_each > 0:
                score += 4.0
            if category in {"food", "tea", "potions and drinks"}:
                score += 1.0
            return score

        if stat_each_column == "stamina_each":
            score = (
                stamina_each * 0.55
                + stamina_recovery * 9.0
                + heal_each * 0.18
                + health_recovery * 4.0
                + burnt_stamina * 0.6
                + smart_score * 0.18
            )
            if heal_each > 0 and stamina_each > 0:
                score += 4.0
            if category in {"food", "tea", "potions and drinks"}:
                score += 1.0
            return score

        score = mana_each * 0.95 + mana_recovery * 7.0 + burnt_mana * 0.8 + smart_score * 0.2
        if category in {"potion", "tea", "potions and drinks", "food"}:
            score += 1.5
        return score

    def _snapshot_best_result(self, craftable: pd.DataFrame, stat_each_column: str) -> Optional[str]:
        eligible = craftable[craftable.apply(lambda row: self._snapshot_row_matches_stat(row, stat_each_column), axis=1)].copy()
        if eligible.empty:
            return None
        eligible["snapshot_stat_score"] = eligible.apply(lambda row: self._snapshot_stat_score(row, stat_each_column), axis=1)
        ordered = eligible.sort_values(
            ["snapshot_stat_score", "smart_score", stat_each_column, "max_total_output", "result"],
            ascending=[False, False, False, False, True],
        )
        return str(ordered.iloc[0]["result"])

    def _snapshot_payload(self, filtered: pd.DataFrame, craftable: pd.DataFrame, near: pd.DataFrame, inventory: Counter) -> dict:
        inventory_df = inventory_ops.inventory_table_df(inventory)
        return {
            "inventory_lines": len(inventory_df),
            "known_recipes": len(filtered),
            "direct_crafts": len(craftable),
            "near_crafts": len(near),
            "best_heal": self._snapshot_best_result(craftable, "heal_each"),
            "best_stamina": self._snapshot_best_result(craftable, "stamina_each"),
            "best_mana": self._snapshot_best_result(craftable, "mana_each"),
        }

    def overview(self, stations: Optional[List[str]] = None, max_missing_slots: int = 2) -> dict:
        inventory = self.get_inventory()
        frames = self.recipe_surface_frames(stations, max_missing_slots=max_missing_slots)
        inventory_df = inventory_ops.inventory_table_df(inventory)
        return {
            "inventory": self.get_inventory_response(),
            "inventory_table": _df_records(inventory_df),
            "snapshot": self._snapshot_payload(frames.filtered, frames.craftable, frames.near, inventory),
        }

    def dashboard(self, stations: Optional[List[str]] = None, max_missing_slots: int = 2) -> dict:
        inventory = self.get_inventory()
        frames = self.recipe_surface_frames(stations, max_missing_slots=max_missing_slots)
        best_direct = order_craftable_results(frames.craftable, "Smart score") if not frames.craftable.empty else frames.craftable
        near_ordered = self._ordered_near_results(frames.near)
        return {
            "inventory": self.get_inventory_response(),
            "snapshot": self._snapshot_payload(frames.filtered, frames.craftable, frames.near, inventory),
            "best_direct": {
                "sort_mode": "Smart score",
                "count": len(frames.craftable),
                "near_count": len(frames.near),
                "shortlist_limit": BEST_DIRECT_SHORTLIST_LIMIT,
                "items": _df_records(best_direct.head(BEST_DIRECT_SHORTLIST_LIMIT)),
            },
            "near": {
                "count": len(frames.near),
                "known_recipes": len(frames.filtered),
                "items": _df_records(near_ordered.head(NEAR_RESULTS_PREVIEW_LIMIT)),
            },
        }

    def direct_crafts(
        self,
        stations: Optional[List[str]] = None,
        sort_mode: str = "Smart score",
        limit: Optional[int] = None,
        max_missing_slots: int = 2,
    ) -> dict:
        frames = self.recipe_surface_frames(stations, max_missing_slots=max_missing_slots)
        ordered = order_craftable_results(frames.craftable, sort_mode) if not frames.craftable.empty else frames.craftable
        if limit is not None:
            ordered = ordered.head(limit)
        return {
            "sort_mode": sort_mode,
            "count": len(frames.craftable),
            "near_count": len(frames.near),
            "items": _df_records(ordered),
        }

    def near_crafts(
        self,
        stations: Optional[List[str]] = None,
        limit: Optional[int] = None,
        max_missing_slots: int = 2,
    ) -> dict:
        frames = self.recipe_surface_frames(stations, max_missing_slots=max_missing_slots)
        ordered = self._ordered_near_results(frames.near)
        if limit is not None:
            ordered = ordered.head(limit)
        return {
            "count": len(frames.near),
            "known_recipes": len(frames.filtered),
            "items": _df_records(ordered),
        }

    def recipe_visibility_debug(
        self,
        result: str,
        stations: Optional[List[str]] = None,
        max_missing_slots: int = 2,
        planner_depth: int = 5,
    ) -> dict:
        result_name = core.normalize(result)
        frames = self.recipe_surface_frames(stations, max_missing_slots=max_missing_slots)
        smart_ranked = order_craftable_results(frames.craftable, "Smart score") if not frames.craftable.empty else frames.craftable.copy()
        near_ranked = self._ordered_near_results(frames.near)
        evaluated_ranked = frames.evaluated.reset_index(drop=True) if not frames.evaluated.empty else frames.evaluated.copy()

        filtered_matches = self._matching_result_rows(frames.filtered, result_name)
        evaluated_matches = self._matching_result_rows(evaluated_ranked, result_name)
        craftable_matches = self._matching_result_rows(smart_ranked, result_name)
        near_matches = self._matching_result_rows(near_ranked, result_name)

        planner = self.planner(result_name, planner_depth, stations)
        target_owned_qty = int(self.get_inventory().get(result_name, 0))
        best_smart_score = float(craftable_matches.iloc[0]["smart_score"]) if not craftable_matches.empty else None
        ordered_evaluated_matches = self._ordered_evaluated_matches(evaluated_matches)
        best_matching_row = craftable_matches.iloc[0] if not craftable_matches.empty else (ordered_evaluated_matches.iloc[0] if not ordered_evaluated_matches.empty else None)
        sort_positions = self._craftable_sort_positions(frames.craftable, result_name)
        planner_goal = str(planner.get("planning_goal", "obtain_target"))
        planner_mode = str(planner["mode"])
        planner_found = bool(planner["found"])

        if filtered_matches.empty:
            craftable_panel_reason = "No recipe rows for this result are available under the current station filters."
        elif target_owned_qty > 0 and craftable_matches.empty and planner_goal == "craft_one_more" and planner_found:
            craftable_panel_reason = (
                "You already own this result. The craftable panel still excludes it because no recipe row is directly craftable now, "
                "even though the planner can build one more copy through another route type."
            )
        elif target_owned_qty > 0 and craftable_matches.empty:
            craftable_panel_reason = (
                "You already own this result, but none of its recipe rows are craftable from ingredients right now. "
                "The craftable panel only shows recipe rows you can make now."
            )
        elif craftable_matches.empty:
            craftable_panel_reason = "This result has recipe rows, but none of them are craftable now."
        else:
            craftable_panel_reason = (
                "At least one matching recipe row is craftable now, so it appears in the main craftable recipes panel. "
                "Sorting only changes order."
            )

        if filtered_matches.empty:
            near_reason = "No recipe rows for this result are available under the current station filters."
        elif not craftable_matches.empty:
            near_reason = "This result is already craftable now, so it is intentionally excluded from Almost craftable."
        elif target_owned_qty > 0 and planner_goal == "craft_one_more" and planner_found:
            near_reason = (
                "You already own this result, and the planner can build one more copy. "
                "Almost craftable still only tracks direct recipe rows that are close to craftable from ingredients."
            )
        elif target_owned_qty > 0:
            near_reason = (
                "You already own this result, but Almost craftable only tracks direct recipe rows that are close to craftable from ingredients."
            )
        elif not near_matches.empty:
            near_reason = (
                f"The closest matching row is inside the near-craft threshold at {int(near_matches.iloc[0]['missing_slots'])} missing slot(s)."
            )
        elif evaluated_matches.empty:
            near_reason = "No evaluated recipe rows were available for this result."
        elif int(evaluated_matches["matched_slots"].max()) <= 0:
            near_reason = "No ingredient slots are currently satisfied, so it is intentionally excluded from Almost craftable."
        else:
            closest_missing = int(evaluated_matches["missing_slots"].min())
            near_reason = (
                f"The closest matching row still needs {closest_missing} missing slot(s), which is above the current threshold of {max_missing_slots}."
            )

        if craftable_matches.empty:
            craftable_sort_reason = "No craftable row is available yet, so this result has no craftable ranking."
        else:
            best_smart_rank = next((entry["rank"] for entry in sort_positions if entry["sort_mode"] == "Smart score"), None)
            craftable_sort_reason = (
                f"The best matching craftable row is ranked #{best_smart_rank} by Smart score. "
                "Other sort modes can move it, but they do not remove it from the craftable panel."
            )

        if target_owned_qty > 0 and planner_goal == "craft_one_more":
            if not craftable_matches.empty and planner_found:
                planner_alignment_reason = (
                    "You already own this target, and both planner and direct craft agree you can make one more now."
                )
            elif craftable_matches.empty and planner_found:
                planner_alignment_reason = (
                    "You already own this target. Planner can produce one more copy through a non-direct route, "
                    "while the craftable panel still requires a directly craftable row."
                )
            elif craftable_matches.empty and not planner_found:
                planner_alignment_reason = (
                    "You already own this target, but planner and direct craft agree you cannot produce one more copy yet."
                )
            else:
                planner_alignment_reason = (
                    "Planner and direct craft are using different route types for the one-more copy analysis."
                )
        elif craftable_matches.empty and planner_found and planner_mode == "recursive_craft_route":
            planner_alignment_reason = (
                "Planner succeeds through intermediate crafting. "
                "The craftable panel only shows recipe rows you can craft directly right now."
            )
        elif not craftable_matches.empty and planner_found:
            planner_alignment_reason = "Planner and direct craft agree: at least one matching recipe row is directly craftable now."
        elif craftable_matches.empty and not planner_found:
            planner_alignment_reason = "Planner and direct craft agree that the current inventory and filters do not complete this result yet."
        else:
            planner_alignment_reason = "Planner and direct craft are using different route types for this result."

        matching_recipe = (
            {
                "ingredients": str(best_matching_row["ingredients"]),
                "station": str(best_matching_row["station"]),
                "max_crafts": int(best_matching_row.get("max_crafts", 0) or 0),
                "missing_slots": int(best_matching_row.get("missing_slots", 0) or 0),
                "matched_slots": int(best_matching_row.get("matched_slots", 0) or 0),
            }
            if best_matching_row is not None
            else None
        )

        selected_stations = self._normalized_stations(stations)
        return {
            "result": result_name,
            "selected_stations": selected_stations if selected_stations is not None else list(self.data.station_options),
            "max_missing_slots": int(max_missing_slots),
            "planner_depth": int(planner_depth),
            "target_owned_qty": target_owned_qty,
            "recipe_database_rows": int(len(filtered_matches)),
            "evaluated_recipe_rows": int(len(evaluated_matches)),
            "craftable_recipe_rows": int(len(craftable_matches)),
            "near_recipe_rows": int(len(near_matches)),
            "craftable_now": not craftable_matches.empty,
            "craftable_panel": not craftable_matches.empty,
            "craftable_panel_reason": craftable_panel_reason,
            "near_craft": not near_matches.empty,
            "near_reason": near_reason,
            "smart_score": best_smart_score,
            "craftable_sort_reason": craftable_sort_reason,
            "sort_positions": sort_positions,
            "planner_found": bool(planner["found"]),
            "planner_mode": planner_mode,
            "planner_goal": planner_goal,
            "planner_target_owned_qty": int(planner.get("target_owned_qty", target_owned_qty)),
            "planner_already_owned": bool(planner.get("already_owned", target_owned_qty > 0)),
            "planner_owned_satisfies_target": bool(planner.get("owned_satisfies_target", False)),
            "planner_one_more_found": bool(planner.get("one_more_found", planner_found)),
            "planner_one_more_mode": str(planner.get("one_more_mode", planner_mode)),
            "planner_one_more_reason": str(planner.get("one_more_reason", planner.get("explanation", ""))),
            "planner_one_more_missing": list(planner.get("one_more_missing", planner.get("missing", []))),
            "planner_baseline_found": bool(planner.get("baseline_found", planner_found)),
            "planner_baseline_mode": str(planner.get("baseline_mode", planner_mode)),
            "planner_uses_existing_target": bool(planner["uses_existing_target"]),
            "planner_craft_steps": int(planner["craft_steps"]),
            "planner_reason": planner["explanation"],
            "planner_alignment_reason": planner_alignment_reason,
            "planner_missing": planner["missing"],
            "matching_recipe": matching_recipe,
            "evaluated_rows": _df_records(ordered_evaluated_matches.head(8)),
            "craftable_rows": _df_records(craftable_matches.head(5)),
            "near_rows": _df_records(near_matches.head(5)),
        }

    def planner(self, target: str, max_depth: int, stations: Optional[List[str]] = None) -> dict:
        target_name = core.normalize(target)
        base_inventory = self.get_inventory()
        target_owned_qty = int(base_inventory.get(target_name, 0))

        baseline_route = self._planner_route(
            target=target_name,
            max_depth=max_depth,
            stations=stations,
            base_inventory=base_inventory,
            crafting_one_more=False,
            owned_qty=target_owned_qty,
        )

        if target_owned_qty > 0:
            one_more_route = self._planner_route(
                target=target_name,
                max_depth=max_depth,
                stations=stations,
                base_inventory=base_inventory,
                crafting_one_more=True,
                owned_qty=target_owned_qty,
            )
            effective_route = one_more_route
            planning_goal = "craft_one_more"
        else:
            one_more_route = baseline_route
            effective_route = baseline_route
            planning_goal = "obtain_target"

        return {
            "target": target_name,
            "found": bool(effective_route["found"]),
            "explanation": str(effective_route["explanation"]),
            "lines": list(effective_route["lines"]),
            "missing": list(effective_route["missing"]),
            "remaining_inventory": list(effective_route["remaining_inventory"]),
            "mode": str(effective_route["mode"]),
            "craft_steps": int(effective_route["craft_steps"]),
            "uses_existing_target": bool(effective_route["uses_existing_target"]),
            "requires_crafting": bool(effective_route["requires_crafting"]),
            "target_owned_qty": target_owned_qty,
            "already_owned": target_owned_qty > 0,
            "planning_goal": planning_goal,
            "baseline_found": bool(baseline_route["found"]),
            "baseline_mode": str(baseline_route["mode"]),
            "baseline_reason": str(baseline_route["explanation"]),
            "baseline_missing": list(baseline_route["missing"]),
            "one_more_found": bool(one_more_route["found"]),
            "one_more_mode": str(one_more_route["mode"]),
            "one_more_reason": str(one_more_route["explanation"]),
            "one_more_missing": list(one_more_route["missing"]),
            "one_more_craft_steps": int(one_more_route["craft_steps"]),
            "one_more_requires_crafting": bool(one_more_route["requires_crafting"]),
            "owned_satisfies_target": bool(target_owned_qty > 0 and baseline_route["found"] and baseline_route["mode"] == "use_existing_target"),
        }

    def shopping_list(self, targets: List[dict], max_depth: int, stations: Optional[List[str]] = None) -> dict:
        target_counts = Counter({core.normalize(entry["item"]): int(entry["qty"]) for entry in targets if int(entry["qty"]) > 0})
        missing_counts, lines, final_inventory = core.build_shopping_list(
            target_counts,
            self.get_inventory(),
            self.data.groups,
            core.build_recipe_index(self.filtered_recipes(stations)),
            max_depth=max_depth,
        )
        return {
            "targets": _df_records(inventory_ops.inventory_table_df(target_counts, item_label="item")),
            "missing": _df_records(inventory_ops.inventory_table_df(missing_counts)),
            "lines": lines,
            "remaining_inventory": _df_records(inventory_ops.inventory_table_df(final_inventory)),
        }

    def metadata(self) -> dict:
        recipe_table = self.data.recipes_df.assign(
            effects=self.data.recipes_df["result"].apply(lambda result: "; ".join(core.item_meta_for(result, self.data.item_metadata)["effects"])),
            heal=self.data.recipes_df["result"].apply(lambda result: core.item_meta_for(result, self.data.item_metadata)["heal"]),
            stamina=self.data.recipes_df["result"].apply(lambda result: core.item_meta_for(result, self.data.item_metadata)["stamina"]),
            mana=self.data.recipes_df["result"].apply(lambda result: core.item_meta_for(result, self.data.item_metadata)["mana"]),
            sale_value=self.data.recipes_df["result"].apply(lambda result: core.item_meta_for(result, self.data.item_metadata)["sale_value"]),
            buy_value=self.data.recipes_df["result"].apply(lambda result: core.item_meta_for(result, self.data.item_metadata)["buy_value"]),
            weight=self.data.recipes_df["result"].apply(
                lambda result: core.item_meta_for(result, self.data.item_metadata)["weight"]
                or core._inferred_weight(
                    result,
                    core.item_meta_for(result, self.data.item_metadata)["category"] or core.infer_item_category(result, self.data.item_metadata),
                    core.item_meta_for(result, self.data.item_metadata)["weight"],
                )
            ),
            category=self.data.recipes_df["result"].apply(
                lambda result: core.item_meta_for(result, self.data.item_metadata)["category"]
                or core.infer_item_category(result, self.data.item_metadata)
            ),
        ).drop(columns=["result_key"])
        return {
            "ingredients": list(self.data.item_catalog),
            "categories": [{"name": name, "items": items} for name, items in self.data.catalog_by_category.items()],
            "stations": list(self.data.station_options),
            "outward_sync_path": str(outward_sync_inventory_path()),
            "recipe_count": int(len(self.data.recipes_df)),
            "recipes": _df_records(recipe_table),
            "ingredient_groups": [
                {"group": group_name, "members": members, "member_count": len(members)}
                for group_name, members in sorted(self.data.groups.items())
            ],
            "item_stats": _df_records(core.build_metadata_table(self.data.item_metadata, self.data.item_catalog)),
        }
