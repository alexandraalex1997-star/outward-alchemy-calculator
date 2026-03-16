from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Dict, List

import pandas as pd


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "shared" / "data"
OUTPUT_PATH = ROOT_DIR / "frontend" / "public" / "data" / "calculator-data.json"

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from shared import crafting_core as core


def _load_recipes() -> pd.DataFrame:
    path = DATA_DIR / "recipes.csv"
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
    path = DATA_DIR / "ingredient_groups.json"
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {core.key(group_name): [core.normalize(item) for item in members] for group_name, members in payload.items()}


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


def _records(frame: pd.DataFrame) -> List[dict]:
    if frame.empty:
        return []
    clean = frame.where(pd.notnull(frame), None)
    return clean.to_dict(orient="records")


def build_frontend_data() -> dict:
    recipes_df = _load_recipes()
    groups = core.sanitize_groups(recipes_df, _load_raw_groups())
    recipes_df = core.prune_invalid_recipes(recipes_df, groups)
    item_metadata = _load_item_metadata()
    item_catalog = core.build_item_catalog(recipes_df, groups, item_metadata)
    catalog_by_category = core.build_catalog_by_category(item_catalog, item_metadata)
    station_options = sorted(recipes_df["station"].dropna().unique().tolist())

    recipe_table = recipes_df.assign(
        effects=recipes_df["result"].apply(lambda result: "; ".join(core.item_meta_for(result, item_metadata)["effects"])),
        heal=recipes_df["result"].apply(lambda result: core.item_meta_for(result, item_metadata)["heal"]),
        stamina=recipes_df["result"].apply(lambda result: core.item_meta_for(result, item_metadata)["stamina"]),
        mana=recipes_df["result"].apply(lambda result: core.item_meta_for(result, item_metadata)["mana"]),
        sale_value=recipes_df["result"].apply(lambda result: core.item_meta_for(result, item_metadata)["sale_value"]),
        buy_value=recipes_df["result"].apply(lambda result: core.item_meta_for(result, item_metadata)["buy_value"]),
        weight=recipes_df["result"].apply(
            lambda result: core.item_meta_for(result, item_metadata)["weight"]
            or core._inferred_weight(
                result,
                core.item_meta_for(result, item_metadata)["category"] or core.infer_item_category(result, item_metadata),
                core.item_meta_for(result, item_metadata)["weight"],
            )
        ),
        category=recipes_df["result"].apply(
            lambda result: core.item_meta_for(result, item_metadata)["category"]
            or core.infer_item_category(result, item_metadata)
        ),
    ).drop(columns=["result_key"])

    return {
        "ingredients": list(item_catalog),
        "categories": [{"name": name, "items": items} for name, items in catalog_by_category.items()],
        "stations": list(station_options),
        "recipe_count": int(len(recipes_df)),
        "recipes": _records(recipe_table),
        "ingredient_groups": [
            {"group": group_name, "members": members, "member_count": len(members)}
            for group_name, members in sorted(groups.items())
        ],
        "item_stats": _records(core.build_metadata_table(item_metadata, item_catalog)),
    }


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = build_frontend_data()
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
