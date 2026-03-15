from __future__ import annotations

from collections import Counter

import pandas as pd

from backend.app.services import CalculatorData, CalculatorService, InventoryStore
from src import crafting_core as core


def recipes_df(rows: list[dict]) -> pd.DataFrame:
    frame = pd.DataFrame(rows)
    for column in ["recipe_id", "recipe_page", "section", "result", "station", "ingredients"]:
        frame[column] = frame[column].fillna("").astype(str).map(core.normalize)
    frame["station"] = frame["station"].map(core.normalize_station)
    frame["result_qty"] = frame["result_qty"].fillna(1).astype(int)
    frame["ingredient_list"] = frame["ingredients"].apply(
        lambda raw: [core.normalize(token) for token in str(raw).split("|") if core.normalize(token)]
    )
    frame["result_key"] = frame["result"].map(core.key)
    return frame


def make_service(
    rows: list[dict],
    raw_groups: dict[str, list[str]] | None = None,
    item_metadata: dict[str, dict] | None = None,
) -> CalculatorService:
    frame = recipes_df(rows)
    raw_groups = raw_groups or {}
    normalized_groups = {core.key(group): [core.normalize(item) for item in members] for group, members in raw_groups.items()}
    groups = core.sanitize_groups(frame, normalized_groups)
    frame = core.prune_invalid_recipes(frame, groups)
    normalized_metadata: dict[str, dict] = {}
    for item_name, meta in (item_metadata or {}).items():
        effects = meta.get("effects", [])
        if isinstance(effects, str):
            effects = [effects]
        normalized_metadata[core.key(item_name)] = {
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
    item_catalog = core.build_item_catalog(frame, groups, normalized_metadata)
    data = CalculatorData(
        recipes_df=frame,
        groups=groups,
        item_metadata=normalized_metadata,
        recipe_index=core.build_recipe_index(frame),
        item_catalog=item_catalog,
        catalog_by_category=core.build_catalog_by_category(item_catalog, normalized_metadata),
        station_options=sorted(frame["station"].unique().tolist()),
    )
    return CalculatorService(data, InventoryStore())


def result_row(results: pd.DataFrame, name: str) -> pd.Series:
    return results.loc[results["result"] == name].iloc[0]


def test_direct_craftability_handles_repeated_exact_ingredients_and_result_quantity() -> None:
    frame = recipes_df(
        [
            {
                "recipe_id": "test-1",
                "recipe_page": "Unit",
                "section": "Exact",
                "result": "Resin Paste",
                "result_qty": 2,
                "station": "Cooking Pot",
                "ingredients": "Resin|Resin",
            }
        ]
    )

    results = core.build_direct_results(frame, Counter({"Resin": 5}), groups={}, metadata={})
    paste = result_row(results, "Resin Paste")

    assert paste["max_crafts"] == 2
    assert paste["max_total_output"] == 4


def test_direct_craftability_handles_repeated_group_tokens_without_illegal_reuse() -> None:
    frame = recipes_df(
        [
            {
                "recipe_id": "test-2",
                "recipe_page": "Unit",
                "section": "Groups",
                "result": "Sea Stock",
                "result_qty": 1,
                "station": "Cooking Pot",
                "ingredients": "Fish|Fish",
            }
        ]
    )
    groups = core.sanitize_groups(frame, {"fish": core.CANONICAL_GROUPS["fish"]})

    craftable = core.build_direct_results(frame, Counter({"Raw Salmon": 1, "Raw Rainbow Trout": 1}), groups, {})
    near = core.build_direct_results(frame, Counter({"Raw Salmon": 1}), groups, {})

    assert result_row(craftable, "Sea Stock")["max_crafts"] == 1
    assert result_row(near, "Sea Stock")["max_crafts"] == 0
    assert result_row(near, "Sea Stock")["missing_slots"] == 1


def test_max_crafts_counts_only_complete_crafts() -> None:
    assert core.max_crafts_for_recipe(["Resin", "Resin"], Counter({"Resin": 5}), {}, "Resin Paste", 2) == 2


def test_max_crafts_handles_large_repeated_group_tokens_without_solver_blowups() -> None:
    groups = {
        "ration ingredient": [f"Ration Item {index}" for index in range(1, 33)],
    }
    inventory = Counter({f"Ration Item {index}": 1 for index in range(1, 25)})
    inventory["Salt"] = 20

    max_crafts = core.max_crafts_for_recipe(
        ["Ration Ingredient", "Ration Ingredient", "Salt"],
        inventory,
        groups,
        "Travel Ration",
        1,
    )

    assert max_crafts == 12


def test_near_craft_missing_slots_are_slot_based_not_set_based() -> None:
    groups = {"fish": core.CANONICAL_GROUPS["fish"]}
    missing_slots, missing = core.count_missing_slots(
        ["Fish", "Fish", "Salt"],
        Counter({"Raw Salmon": 1, "Salt": 1}),
        groups,
        "Sea Stock",
        1,
    )

    assert missing_slots == 1
    assert len(missing) == 1
    assert missing[0] == "Any Fish"


def test_clean_water_recipe_blocks_noop_self_craft_but_accepts_dirty_water_inputs() -> None:
    frame = recipes_df(
        [
            {
                "recipe_id": "clean-water",
                "recipe_page": "Unit",
                "section": "Campfire",
                "result": "Clean Water",
                "result_qty": 1,
                "station": "Campfire",
                "ingredients": "Water",
            }
        ]
    )
    groups = core.sanitize_groups(frame, {"water": core.CANONICAL_GROUPS["water"]})

    clean_only = core.build_direct_results(frame, Counter({"Clean Water": 2}), groups, {})
    dirty_water = core.build_direct_results(frame, Counter({"Salt Water": 2}), groups, {})

    assert result_row(clean_only, "Clean Water")["max_crafts"] == 0
    assert result_row(clean_only, "Clean Water")["missing_slots"] == 1
    assert result_row(dirty_water, "Clean Water")["max_crafts"] == 2


def test_invalid_noop_self_recipe_is_pruned_by_guardrail() -> None:
    frame = recipes_df(
        [
            {
                "recipe_id": "noop",
                "recipe_page": "Unit",
                "section": "Broken",
                "result": "Torch",
                "result_qty": 1,
                "station": "Manual Crafting",
                "ingredients": "Torch",
            }
        ]
    )

    pruned = core.prune_invalid_recipes(frame, groups={})

    assert pruned.empty


def test_smart_score_prefers_useful_results_over_generic_bulk_output() -> None:
    service = make_service(
        [
            {
                "recipe_id": "tea",
                "recipe_page": "Unit",
                "section": "Ranking",
                "result": "Battle Tea",
                "result_qty": 1,
                "station": "Cooking Pot",
                "ingredients": "Leaf|Water",
            },
            {
                "recipe_id": "mash",
                "recipe_page": "Unit",
                "section": "Ranking",
                "result": "Mystery Mash",
                "result_qty": 4,
                "station": "Campfire",
                "ingredients": "Leaf",
            },
        ],
        item_metadata={
            "Battle Tea": {
                "stamina": 22,
                "sale_value": 9,
                "effects": ["Useful stamina drink"],
                "category": "Tea",
            }
        },
    )
    service.replace_inventory([{"item": "Leaf", "qty": 2}, {"item": "Clean Water", "qty": 1}])

    ranked = service.direct_crafts(sort_mode="Smart score", stations=["Campfire", "Cooking Pot"])["items"]

    assert [row["result"] for row in ranked[:2]] == ["Battle Tea", "Mystery Mash"]


def test_smart_score_degrades_gracefully_when_metadata_is_missing() -> None:
    service = make_service(
        [
            {
                "recipe_id": "efficient",
                "recipe_page": "Unit",
                "section": "Ranking",
                "result": "Trail Mix",
                "result_qty": 3,
                "station": "Manual Crafting",
                "ingredients": "Seed",
            },
            {
                "recipe_id": "clunky",
                "recipe_page": "Unit",
                "section": "Ranking",
                "result": "Slug Pile",
                "result_qty": 1,
                "station": "Alchemy Kit",
                "ingredients": "Seed|Dust|Leaf",
            },
        ],
    )
    service.replace_inventory([{"item": "Seed", "qty": 3}, {"item": "Dust", "qty": 1}, {"item": "Leaf", "qty": 1}])

    ranked = service.direct_crafts(sort_mode="Smart score")["items"]

    assert [row["result"] for row in ranked[:2]] == ["Trail Mix", "Slug Pile"]
    assert ranked[0]["smart_score"] > ranked[1]["smart_score"]


def test_smart_score_rewards_buffs_and_survival_utility() -> None:
    service = make_service(
        [
            {
                "recipe_id": "weather",
                "recipe_page": "Unit",
                "section": "Ranking",
                "result": "Weather Defense Potion",
                "result_qty": 1,
                "station": "Alchemy Kit",
                "ingredients": "Leaf|Water",
            },
            {
                "recipe_id": "filler",
                "recipe_page": "Unit",
                "section": "Ranking",
                "result": "Camp Slush",
                "result_qty": 3,
                "station": "Campfire",
                "ingredients": "Leaf",
            },
        ],
        item_metadata={
            "Weather Defense Potion": {
                "sale_value": 14,
                "effects": ["Weather resistance support", "Applies defensive buff"],
                "category": "Potion",
            }
        },
    )
    service.replace_inventory([{"item": "Leaf", "qty": 2}, {"item": "Clean Water", "qty": 1}])

    ranked = service.direct_crafts(sort_mode="Smart score", stations=["Alchemy Kit", "Campfire"])["items"]

    assert [row["result"] for row in ranked[:2]] == ["Weather Defense Potion", "Camp Slush"]


def test_smart_score_penalizes_heavy_low_utility_results_when_weight_is_a_burden() -> None:
    service = make_service(
        [
            {
                "recipe_id": "tonic",
                "recipe_page": "Unit",
                "section": "Ranking",
                "result": "Trail Tonic",
                "result_qty": 1,
                "station": "Alchemy Kit",
                "ingredients": "Leaf|Water",
            },
            {
                "recipe_id": "idol",
                "recipe_page": "Unit",
                "section": "Ranking",
                "result": "Burden Idol",
                "result_qty": 1,
                "station": "Manual Crafting",
                "ingredients": "Leaf|Dust",
            },
        ],
        item_metadata={
            "Trail Tonic": {
                "sale_value": 8,
                "buy_value": 24,
                "weight": 0.5,
                "effects": ["Restores 15 Burnt Stamina", "Cold Weather Def Up"],
                "category": "Potion",
            },
            "Burden Idol": {
                "sale_value": 8,
                "buy_value": 24,
                "weight": 8.0,
                "effects": ["Heavy camp decoration"],
                "category": "Deployable",
            },
        },
    )
    service.replace_inventory([{"item": "Leaf", "qty": 2}, {"item": "Dust", "qty": 1}, {"item": "Clean Water", "qty": 1}])

    ranked = service.direct_crafts(sort_mode="Smart score", stations=["Alchemy Kit", "Manual Crafting"])["items"]

    assert [row["result"] for row in ranked[:2]] == ["Trail Tonic", "Burden Idol"]


def test_smart_score_allows_strong_deployable_utility_to_justify_weight() -> None:
    service = make_service(
        [
            {
                "recipe_id": "lodge",
                "recipe_page": "Unit",
                "section": "Ranking",
                "result": "Mage Tent",
                "result_qty": 1,
                "station": "Manual Crafting",
                "ingredients": "Cloth|Thread",
            },
            {
                "recipe_id": "snack",
                "recipe_page": "Unit",
                "section": "Ranking",
                "result": "Filler Snack",
                "result_qty": 2,
                "station": "Campfire",
                "ingredients": "Cloth",
            },
        ],
        item_metadata={
            "Mage Tent": {
                "sale_value": 30,
                "buy_value": 100,
                "weight": 3.0,
                "effects": ["Reduces burnt Mana from sleeping by half", "-15% Mana costs"],
                "category": "Deployable",
            },
            "Filler Snack": {
                "sale_value": 3,
                "buy_value": 10,
                "weight": 0.5,
                "effects": ["Plain filler food"],
                "category": "Food",
            },
        },
    )
    service.replace_inventory([{"item": "Cloth", "qty": 1}, {"item": "Thread", "qty": 1}])

    ranked = service.direct_crafts(sort_mode="Smart score", stations=["Manual Crafting", "Campfire"])["items"]

    assert [row["result"] for row in ranked[:2]] == ["Mage Tent", "Filler Snack"]


def test_snapshot_best_stat_fields_use_per_craft_recovery_not_inventory_volume() -> None:
    service = make_service(
        [
            {
                "recipe_id": "rations",
                "recipe_page": "Unit",
                "section": "Snapshot",
                "result": "Travel Ration",
                "result_qty": 3,
                "station": "Manual Crafting",
                "ingredients": "Ration A|Ration B|Salt",
            },
            {
                "recipe_id": "omelet",
                "recipe_page": "Unit",
                "section": "Snapshot",
                "result": "Miner's Omelet",
                "result_qty": 3,
                "station": "Cooking Pot",
                "ingredients": "Bird Egg|Bird Egg|Common Mushroom",
            },
            {
                "recipe_id": "astral",
                "recipe_page": "Unit",
                "section": "Snapshot",
                "result": "Astral Potion",
                "result_qty": 1,
                "station": "Alchemy Kit",
                "ingredients": "Star Mushroom|Turmmip|Clean Water",
            },
        ],
        item_metadata={
            "Travel Ration": {
                "heal": 10,
                "stamina": 10,
                "sale_value": 8,
                "category": "Food",
            },
            "Miner's Omelet": {
                "heal": 16,
                "stamina": 18,
                "sale_value": 12,
                "category": "Food",
            },
            "Astral Potion": {
                "mana": 30,
                "sale_value": 24,
                "category": "Potion",
            },
        },
    )
    service.replace_inventory(
        [
            {"item": "Ration A", "qty": 8},
            {"item": "Ration B", "qty": 8},
            {"item": "Salt", "qty": 8},
            {"item": "Bird Egg", "qty": 2},
            {"item": "Common Mushroom", "qty": 1},
            {"item": "Star Mushroom", "qty": 1},
            {"item": "Turmmip", "qty": 1},
            {"item": "Clean Water", "qty": 1},
        ]
    )

    snapshot = service.dashboard(stations=["Manual Crafting", "Cooking Pot", "Alchemy Kit"])["snapshot"]

    assert snapshot["best_heal"] == "Miner's Omelet"
    assert snapshot["best_stamina"] == "Miner's Omelet"
    assert snapshot["best_mana"] == "Astral Potion"


def test_planner_success_path_crafts_intermediates() -> None:
    service = make_service(
        [
            {
                "recipe_id": "base",
                "recipe_page": "Unit",
                "section": "Planner",
                "result": "Potion Base",
                "result_qty": 1,
                "station": "Alchemy Kit",
                "ingredients": "Water|Leaf",
            },
            {
                "recipe_id": "target",
                "recipe_page": "Unit",
                "section": "Planner",
                "result": "Field Elixir",
                "result_qty": 1,
                "station": "Alchemy Kit",
                "ingredients": "Potion Base|Dust",
            },
        ],
        raw_groups={"water": core.CANONICAL_GROUPS["water"]},
    )
    service.replace_inventory(
        [
            {"item": "Clean Water", "qty": 1},
            {"item": "Leaf", "qty": 1},
            {"item": "Dust", "qty": 1},
        ]
    )

    planner = service.planner("Field Elixir", max_depth=4, stations=["Alchemy Kit"])

    assert planner["found"] is True
    assert any("Craft Potion Base" in line for line in planner["lines"])
    assert planner["missing"] == []


def test_planner_failure_path_reports_clear_missing_leaves() -> None:
    service = make_service(
        [
            {
                "recipe_id": "base",
                "recipe_page": "Unit",
                "section": "Planner",
                "result": "Potion Base",
                "result_qty": 1,
                "station": "Alchemy Kit",
                "ingredients": "Water|Leaf",
            },
            {
                "recipe_id": "target",
                "recipe_page": "Unit",
                "section": "Planner",
                "result": "Field Elixir",
                "result_qty": 1,
                "station": "Alchemy Kit",
                "ingredients": "Potion Base|Dust",
            },
        ],
        raw_groups={"water": core.CANONICAL_GROUPS["water"]},
    )
    service.replace_inventory(
        [
            {"item": "Clean Water", "qty": 1},
            {"item": "Leaf", "qty": 1},
        ]
    )

    planner = service.planner("Field Elixir", max_depth=4, stations=["Alchemy Kit"])

    assert planner["found"] is False
    assert planner["missing"] == [{"item": "Dust", "qty": 1}]
    assert any("Missing ingredient to buy or farm: Dust" in line for line in planner["lines"])


def test_shopping_list_aggregates_targets_and_reuses_intermediates() -> None:
    service = make_service(
        [
            {
                "recipe_id": "base",
                "recipe_page": "Unit",
                "section": "Shopping",
                "result": "Potion Base",
                "result_qty": 1,
                "station": "Alchemy Kit",
                "ingredients": "Water|Leaf",
            },
            {
                "recipe_id": "elixir",
                "recipe_page": "Unit",
                "section": "Shopping",
                "result": "Field Elixir",
                "result_qty": 1,
                "station": "Alchemy Kit",
                "ingredients": "Potion Base|Dust",
            },
            {
                "recipe_id": "tonic",
                "recipe_page": "Unit",
                "section": "Shopping",
                "result": "Field Tonic",
                "result_qty": 1,
                "station": "Alchemy Kit",
                "ingredients": "Potion Base|Berry",
            },
        ],
        raw_groups={"water": core.CANONICAL_GROUPS["water"]},
    )
    service.replace_inventory(
        [
            {"item": "Clean Water", "qty": 2},
            {"item": "Leaf", "qty": 2},
            {"item": "Dust", "qty": 1},
        ]
    )

    shopping = service.shopping_list(
        [{"item": "Field Elixir", "qty": 1}, {"item": "Field Tonic", "qty": 1}],
        max_depth=4,
        stations=["Alchemy Kit"],
    )

    assert shopping["missing"] == [{"item": "Berry", "qty": 1}]


def test_planner_depth_changes_what_the_planner_can_reach() -> None:
    service = make_service(
        [
            {
                "recipe_id": "stage-1",
                "recipe_page": "Unit",
                "section": "Depth",
                "result": "Stage One",
                "result_qty": 1,
                "station": "Alchemy Kit",
                "ingredients": "Leaf",
            },
            {
                "recipe_id": "stage-2",
                "recipe_page": "Unit",
                "section": "Depth",
                "result": "Stage Two",
                "result_qty": 1,
                "station": "Alchemy Kit",
                "ingredients": "Stage One",
            },
            {
                "recipe_id": "target",
                "recipe_page": "Unit",
                "section": "Depth",
                "result": "Deep Elixir",
                "result_qty": 1,
                "station": "Alchemy Kit",
                "ingredients": "Stage Two",
            },
        ]
    )
    service.replace_inventory([{"item": "Leaf", "qty": 1}])

    shallow = service.planner("Deep Elixir", max_depth=2, stations=["Alchemy Kit"])
    deep = service.planner("Deep Elixir", max_depth=3, stations=["Alchemy Kit"])

    assert shallow["found"] is False
    assert deep["found"] is True


def test_near_craft_filter_requires_at_least_one_matched_slot() -> None:
    service = make_service(
        [
            {
                "recipe_id": "one-off",
                "recipe_page": "Unit",
                "section": "Near",
                "result": "Solo Meal",
                "result_qty": 1,
                "station": "Cooking Pot",
                "ingredients": "Meat",
            },
            {
                "recipe_id": "almost",
                "recipe_page": "Unit",
                "section": "Near",
                "result": "Useful Stew",
                "result_qty": 1,
                "station": "Cooking Pot",
                "ingredients": "Meat|Salt",
            },
        ],
        raw_groups={"meat": core.CANONICAL_GROUPS["meat"]},
    )
    service.replace_inventory([{"item": "Salt", "qty": 1}])

    _, _, near = service.result_frames(stations=["Cooking Pot"], max_missing_slots=1)

    assert "Useful Stew" in set(near["result"])
    assert "Solo Meal" not in set(near["result"])
