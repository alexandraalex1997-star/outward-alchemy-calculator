from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import pandas as pd

from src import crafting_core as core
from src import inventory_ops


BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "src" / "data"


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
    path = DATA_DIR / "item_metadata.json"
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    out: Dict[str, dict] = {}
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


def load_calculator_data() -> CalculatorData:
    recipes_df = _load_recipes()
    raw_groups = _load_raw_groups()
    groups = core.sanitize_groups(recipes_df, raw_groups)
    item_metadata = _load_item_metadata()
    recipe_index = core.build_recipe_index(recipes_df)
    item_catalog = core.build_item_catalog(recipes_df, groups)
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
        self.inventory_store.merge_items(imported)
        return self.get_inventory_response()

    def import_csv_inventory(self, file_bytes: bytes) -> dict:
        imported = inventory_ops.inventory_from_df(pd.read_csv(BytesIO(file_bytes)))
        self.inventory_store.merge_items(imported)
        return self.get_inventory_response()

    def import_excel_inventory(self, file_bytes: bytes) -> dict:
        imported = inventory_ops.inventory_from_df(pd.read_excel(BytesIO(file_bytes)))
        self.inventory_store.merge_items(imported)
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

    def result_frames(
        self,
        stations: Optional[List[str]] = None,
        max_missing_slots: int = 2,
    ) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        filtered = self.filtered_recipes(stations)
        inventory = self.get_inventory()
        results = core.build_direct_results(filtered, inventory, self.data.groups, self.data.item_metadata)
        craftable = results[results["max_crafts"] > 0].copy()
        near = results[(results["max_crafts"] == 0) & (results["missing_slots"] <= max_missing_slots)].copy()
        return filtered, craftable, near

    def overview(self, stations: Optional[List[str]] = None, max_missing_slots: int = 2) -> dict:
        inventory = self.get_inventory()
        inventory_df = inventory_ops.inventory_table_df(inventory)
        filtered, craftable, near = self.result_frames(stations, max_missing_slots=max_missing_slots)
        top_heal = craftable.sort_values(["healing_total", "result"], ascending=[False, True]).head(1)
        top_stamina = craftable.sort_values(["stamina_total", "result"], ascending=[False, True]).head(1)
        top_mana = craftable.sort_values(["mana_total", "result"], ascending=[False, True]).head(1)
        return {
            "inventory": self.get_inventory_response(),
            "inventory_table": _df_records(inventory_df),
            "snapshot": {
                "inventory_lines": len(inventory_df),
                "known_recipes": len(filtered),
                "direct_crafts": len(craftable),
                "near_crafts": len(near),
                "best_heal": top_heal.iloc[0]["result"] if not top_heal.empty and top_heal.iloc[0]["healing_total"] > 0 else None,
                "best_stamina": top_stamina.iloc[0]["result"] if not top_stamina.empty and top_stamina.iloc[0]["stamina_total"] > 0 else None,
                "best_mana": top_mana.iloc[0]["result"] if not top_mana.empty and top_mana.iloc[0]["mana_total"] > 0 else None,
            },
        }

    def direct_crafts(
        self,
        stations: Optional[List[str]] = None,
        sort_mode: str = "Smart score",
        limit: Optional[int] = None,
        max_missing_slots: int = 2,
    ) -> dict:
        _, craftable, near = self.result_frames(stations, max_missing_slots=max_missing_slots)
        ordered = order_craftable_results(craftable, sort_mode) if not craftable.empty else craftable
        if limit is not None:
            ordered = ordered.head(limit)
        return {
            "sort_mode": sort_mode,
            "count": len(craftable),
            "near_count": len(near),
            "items": _df_records(ordered),
        }

    def near_crafts(
        self,
        stations: Optional[List[str]] = None,
        limit: Optional[int] = None,
        max_missing_slots: int = 2,
    ) -> dict:
        filtered, _, near = self.result_frames(stations, max_missing_slots=max_missing_slots)
        ordered = near.sort_values(["missing_slots", "result"]) if not near.empty else near
        if limit is not None:
            ordered = ordered.head(limit)
        return {
            "count": len(near),
            "known_recipes": len(filtered),
            "items": _df_records(ordered),
        }

    def planner(self, target: str, max_depth: int, stations: Optional[List[str]] = None) -> dict:
        base_inventory = self.get_inventory()
        working_inventory = Counter(base_inventory)
        filtered = self.filtered_recipes(stations)
        recipe_index = core.build_recipe_index(filtered)
        target_key = core.key(target)
        missing_counts, plan = core.shopping_item_plan(
            target,
            working_inventory,
            self.data.groups,
            recipe_index,
            depth=0,
            max_depth=max_depth,
            stack=tuple(),
        )
        found = not missing_counts
        remaining_inventory = working_inventory if found else base_inventory
        if found:
            explanation = "A plan was found using the current inventory, planner depth, and station filters."
        elif target_key in self.data.recipe_index and target_key not in recipe_index:
            explanation = "No recipe for this target is available within the current station filters."
        else:
            explanation = "No complete plan was found. The planner is showing the closest branch and its missing leaves."
        return {
            "target": core.normalize(target),
            "found": found,
            "explanation": explanation,
            "lines": core.format_plan_lines(plan),
            "missing": _df_records(inventory_ops.inventory_table_df(missing_counts)),
            "remaining_inventory": _df_records(inventory_ops.inventory_table_df(remaining_inventory)),
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
            category=self.data.recipes_df["result"].apply(lambda result: core.item_meta_for(result, self.data.item_metadata)["category"]),
        ).drop(columns=["result_key"])
        return {
            "ingredients": list(self.data.item_catalog),
            "categories": [{"name": name, "items": items} for name, items in self.data.catalog_by_category.items()],
            "stations": list(self.data.station_options),
            "recipe_count": int(len(self.data.recipes_df)),
            "recipes": _df_records(recipe_table),
            "ingredient_groups": [
                {"group": group_name, "members": members, "member_count": len(members)}
                for group_name, members in sorted(self.data.groups.items())
            ],
            "item_stats": _df_records(core.build_metadata_table(self.data.item_metadata)),
        }
