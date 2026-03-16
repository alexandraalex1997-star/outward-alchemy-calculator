from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pandas as pd
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.services import load_calculator_data


def make_client() -> TestClient:
    return TestClient(create_app())


def csv_bytes(rows: list[dict]) -> bytes:
    return pd.DataFrame(rows).to_csv(index=False).encode("utf-8")


def exported_csv_bytes(rows: list[dict]) -> bytes:
    headers = ["item", "qty"]
    lines = [
        ",".join(headers),
        *[",".join([f'"{row["item"]}"', f'"{row["qty"]}"']) for row in rows],
    ]
    return "\n".join(lines).encode("utf-8")


def excel_bytes(rows: list[dict]) -> bytes:
    buffer = BytesIO()
    pd.DataFrame(rows).to_excel(buffer, index=False)
    return buffer.getvalue()


def result_map(items: list[dict]) -> dict[str, dict]:
    return {row["result"]: row for row in items}


def item_stat_map(items: list[dict]) -> dict[str, dict]:
    return {row["item"]: row for row in items}


def assert_import_propagation(client: TestClient) -> None:
    inventory = client.get("/api/inventory").json()
    dashboard = client.get("/api/results/dashboard?stations=Alchemy+Kit&max_missing_slots=1").json()
    direct = client.get("/api/results/direct?stations=Alchemy+Kit&limit=50&max_missing_slots=1").json()
    near = client.get("/api/results/near?stations=Alchemy+Kit&limit=50&max_missing_slots=1").json()
    planner = client.post(
        "/api/results/planner",
        json={"target": "Cool Potion", "max_depth": 5, "stations": ["Alchemy Kit"]},
    ).json()
    shopping = client.post(
        "/api/results/shopping-list",
        json={"targets": [{"item": "Cool Potion", "qty": 1}], "max_depth": 5, "stations": ["Alchemy Kit"]},
    ).json()

    assert inventory["items"] == [
        {"item": "Clean Water", "qty": 1},
        {"item": "Gravel Beetle", "qty": 1},
        {"item": "Turmmip", "qty": 1},
    ]
    assert inventory["unique_items"] == 3
    assert inventory["total_quantity"] == 3
    assert dashboard["inventory"] == inventory
    assert dashboard["snapshot"]["inventory_lines"] == 3
    assert dashboard["snapshot"]["direct_crafts"] >= 1
    assert dashboard["snapshot"]["near_crafts"] >= 1
    assert "Cool Potion" == dashboard["best_direct"]["items"][0]["result"]
    assert "Cool Potion" in result_map(direct["items"])
    assert near["count"] >= 1
    assert planner["found"] is True
    assert planner["missing"] == []
    assert shopping["missing"] == []


def assert_inventory_is_exactly(client: TestClient, expected_items: list[dict]) -> None:
    inventory = client.get("/api/inventory").json()

    assert inventory["items"] == expected_items
    assert inventory["unique_items"] == len(expected_items)
    assert inventory["total_quantity"] == sum(row["qty"] for row in expected_items)


def test_recipe_loading_uses_canonical_groups_and_manual_station_label() -> None:
    data = load_calculator_data()

    assert data.groups["water"] == ["Clean Water", "Salt Water", "Rancid Water", "Leyline Water"]
    assert data.groups["bread (any)"] == ["Bread", "Bread Of The Wild", "Toast"]
    assert "bread" not in data.groups
    assert "Manual Crafting" in data.station_options


def test_clean_water_recipe_is_not_a_noop_self_recipe() -> None:
    client = make_client()

    client.post("/api/inventory/items/add", json={"item": "Clean Water", "qty": 2}).raise_for_status()

    direct = client.get("/api/results/direct?stations=Campfire&limit=20").json()
    near = client.get("/api/results/near?stations=Campfire&max_missing_slots=1&limit=20").json()

    assert "Clean Water" not in result_map(direct["items"])
    assert "Clean Water" not in result_map(near["items"])


def test_duplicate_inventory_additions_aggregate_and_drive_direct_results() -> None:
    client = make_client()

    client.post("/api/inventory/items/add", json={"item": "Clean Water", "qty": 1}).raise_for_status()
    client.post("/api/inventory/items/add", json={"item": "Clean Water", "qty": 1}).raise_for_status()
    client.post("/api/inventory/items/add", json={"item": "Gravel Beetle", "qty": 2}).raise_for_status()

    inventory = client.get("/api/inventory").json()
    direct = client.get("/api/results/direct?stations=Alchemy+Kit&limit=20").json()
    cool_potion = result_map(direct["items"])["Cool Potion"]

    assert inventory["items"] == [{"item": "Clean Water", "qty": 2}, {"item": "Gravel Beetle", "qty": 2}]
    assert inventory["total_quantity"] == 4
    assert cool_potion["max_crafts"] == 2
    assert cool_potion["max_total_output"] == 6


def test_csv_import_updates_canonical_inventory_and_results() -> None:
    client = make_client()

    response = client.post(
        "/api/inventory/import/csv",
        files={
            "file": (
                "inventory.csv",
                csv_bytes([{"item": "Clean Water", "qty": 2}, {"item": "Gravel Beetle", "qty": 2}]),
                "text/csv",
            )
        },
    )
    response.raise_for_status()

    inventory = client.get("/api/inventory").json()
    direct = client.get("/api/results/direct?stations=Alchemy+Kit&limit=20").json()

    assert inventory["items"] == [{"item": "Clean Water", "qty": 2}, {"item": "Gravel Beetle", "qty": 2}]
    assert result_map(direct["items"])["Cool Potion"]["max_crafts"] == 2


def test_fixed_path_csv_import_reuses_the_csv_import_logic(monkeypatch, tmp_path: Path) -> None:
    client = make_client()

    outward_sync_csv = tmp_path / "current_inventory.csv"
    outward_sync_csv.write_bytes(csv_bytes([{"item": "Clean Water", "qty": 2}, {"item": "Gravel Beetle", "qty": 2}]))
    monkeypatch.setattr("backend.app.services.OUTWARD_SYNC_INVENTORY_PATH", outward_sync_csv)

    response = client.post("/api/inventory/import/outward-sync")
    response.raise_for_status()

    inventory = client.get("/api/inventory").json()
    direct = client.get("/api/results/direct?stations=Alchemy+Kit&limit=20").json()

    assert inventory["items"] == [{"item": "Clean Water", "qty": 2}, {"item": "Gravel Beetle", "qty": 2}]
    assert result_map(direct["items"])["Cool Potion"]["max_crafts"] == 2


def test_fixed_path_csv_import_returns_friendly_not_found_message(monkeypatch, tmp_path: Path) -> None:
    client = make_client()

    outward_sync_csv = tmp_path / "missing_inventory.csv"
    monkeypatch.setattr("backend.app.services.OUTWARD_SYNC_INVENTORY_PATH", outward_sync_csv)

    response = client.post("/api/inventory/import/outward-sync")

    assert response.status_code == 404
    assert response.json()["detail"] == (
        f"Latest Outward inventory file not found at {outward_sync_csv}. "
        "Export your inventory from the mod and try again."
    )


def test_fixed_path_csv_import_returns_friendly_failure_message(monkeypatch, tmp_path: Path) -> None:
    client = make_client()

    outward_sync_csv = tmp_path / "current_inventory.csv"
    outward_sync_csv.write_bytes(csv_bytes([{"item": "Clean Water", "qty": 2}]))
    monkeypatch.setattr("backend.app.services.OUTWARD_SYNC_INVENTORY_PATH", outward_sync_csv)

    def broken_import_csv_file(self, path: Path) -> dict:
        raise ValueError("bad csv")

    monkeypatch.setattr("backend.app.services.CalculatorService.import_csv_inventory_file", broken_import_csv_file)

    response = client.post("/api/inventory/import/outward-sync")

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Latest Outward inventory import failed. The file was found, but it could not be imported."
    )


def test_excel_import_updates_canonical_inventory_and_results() -> None:
    client = make_client()

    response = client.post(
        "/api/inventory/import/excel",
        files={
            "file": (
                "inventory.xlsx",
                excel_bytes([{"item": "Clean Water", "qty": 2}, {"item": "Gravel Beetle", "qty": 2}]),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    response.raise_for_status()

    inventory = client.get("/api/inventory").json()
    direct = client.get("/api/results/direct?stations=Alchemy+Kit&limit=20").json()

    assert inventory["items"] == [{"item": "Clean Water", "qty": 2}, {"item": "Gravel Beetle", "qty": 2}]
    assert result_map(direct["items"])["Cool Potion"]["max_crafts"] == 2


def test_csv_import_propagates_to_dashboard_direct_near_planner_and_shopping() -> None:
    client = make_client()

    response = client.post(
        "/api/inventory/import/csv",
        files={
            "file": (
                "inventory.csv",
                csv_bytes(
                    [
                        {"item": "Clean Water", "qty": 1},
                        {"item": "Gravel Beetle", "qty": 1},
                        {"item": "Turmmip", "qty": 1},
                    ]
                ),
                "text/csv",
            )
        },
    )
    response.raise_for_status()

    assert_import_propagation(client)


def test_exported_csv_round_trips_back_into_the_same_canonical_inventory_state() -> None:
    client = make_client()

    client.post("/api/inventory/items/add", json={"item": "Greasy Fern", "qty": 4}).raise_for_status()
    client.post("/api/inventory/items/add", json={"item": "Thick Oil", "qty": 2}).raise_for_status()

    exported_rows = [
        {"item": "Clean Water", "qty": 1},
        {"item": "Gravel Beetle", "qty": 1},
        {"item": "Turmmip", "qty": 1},
    ]

    response = client.post(
        "/api/inventory/import/csv",
        files={
            "file": (
                "outward_inventory.csv",
                exported_csv_bytes(exported_rows),
                "text/csv",
            )
        },
    )
    response.raise_for_status()

    assert_inventory_is_exactly(client, exported_rows)
    assert_import_propagation(client)


def test_text_import_propagates_to_dashboard_direct_near_planner_and_shopping() -> None:
    client = make_client()

    response = client.post(
        "/api/inventory/import/text",
        json={"text": "Clean Water,1\nGravel Beetle,1\nTurmmip,1"},
    )
    response.raise_for_status()

    assert_import_propagation(client)


def test_excel_import_propagates_to_dashboard_direct_near_planner_and_shopping() -> None:
    client = make_client()

    response = client.post(
        "/api/inventory/import/excel",
        files={
            "file": (
                "inventory.xlsx",
                excel_bytes(
                    [
                        {"item": "Clean Water", "qty": 1},
                        {"item": "Gravel Beetle", "qty": 1},
                        {"item": "Turmmip", "qty": 1},
                    ]
                ),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    response.raise_for_status()

    assert_import_propagation(client)


def test_edits_and_removals_update_planner_and_shopping_against_same_inventory() -> None:
    client = make_client()

    client.post("/api/inventory/items/add", json={"item": "Clean Water", "qty": 1}).raise_for_status()
    client.post("/api/inventory/items/add", json={"item": "Gravel Beetle", "qty": 1}).raise_for_status()

    planner_before = client.post("/api/results/planner", json={"target": "Cool Potion", "max_depth": 5}).json()
    shopping_before = client.post(
        "/api/results/shopping-list",
        json={"targets": [{"item": "Mineral Tea", "qty": 1}], "max_depth": 5},
    ).json()

    client.put("/api/inventory/items/Clean%20Water", json={"qty": 0}).raise_for_status()

    planner_after = client.post("/api/results/planner", json={"target": "Cool Potion", "max_depth": 5}).json()
    shopping_after = client.post(
        "/api/results/shopping-list",
        json={"targets": [{"item": "Mineral Tea", "qty": 1}], "max_depth": 5},
    ).json()

    assert planner_before["found"] is True
    assert shopping_before["missing"] == []
    assert planner_after["found"] is False
    assert planner_after["missing"] == [{"item": "Clean Water", "qty": 1}]
    assert shopping_after["missing"] == [{"item": "Clean Water", "qty": 1}]


def test_station_filters_apply_to_direct_planner_and_shopping_logic() -> None:
    client = make_client()

    client.post("/api/inventory/items/add", json={"item": "Clean Water", "qty": 1}).raise_for_status()
    client.post("/api/inventory/items/add", json={"item": "Gravel Beetle", "qty": 1}).raise_for_status()

    direct_alchemy = client.get("/api/results/direct?stations=Alchemy+Kit&limit=20").json()
    direct_cooking = client.get("/api/results/direct?stations=Cooking+Pot&limit=20").json()
    planner_cooking = client.post(
        "/api/results/planner",
        json={"target": "Cool Potion", "max_depth": 5, "stations": ["Cooking Pot"]},
    ).json()
    shopping_cooking = client.post(
        "/api/results/shopping-list",
        json={"targets": [{"item": "Cool Potion", "qty": 1}], "max_depth": 5, "stations": ["Cooking Pot"]},
    ).json()

    near_client = make_client()
    near_client.post("/api/inventory/items/add", json={"item": "Gravel Beetle", "qty": 1}).raise_for_status()
    near_alchemy = near_client.get("/api/results/near?stations=Alchemy+Kit&max_missing_slots=1&limit=20").json()
    near_cooking = near_client.get("/api/results/near?stations=Cooking+Pot&max_missing_slots=1&limit=20").json()

    assert "Cool Potion" in result_map(direct_alchemy["items"])
    assert "Cool Potion" not in result_map(direct_cooking["items"])
    assert "Mineral Tea" in result_map(direct_cooking["items"])
    assert any(row["result"] == "Cool Potion" for row in near_alchemy["items"])
    assert all(row["result"] != "Cool Potion" for row in near_cooking["items"])
    assert planner_cooking["found"] is False
    assert planner_cooking["missing"] == [{"item": "Cool Potion", "qty": 1}]
    assert shopping_cooking["missing"] == [{"item": "Cool Potion", "qty": 1}]


def test_missing_threshold_query_changes_near_results() -> None:
    client = make_client()

    client.post("/api/inventory/items/add", json={"item": "Gravel Beetle", "qty": 1}).raise_for_status()

    near_one = client.get("/api/results/near?max_missing_slots=1").json()
    near_two = client.get("/api/results/near?max_missing_slots=2").json()
    near_three = client.get("/api/results/near?max_missing_slots=3").json()

    assert near_two["count"] >= near_one["count"]
    assert any(row["result"] == "Cool Potion" for row in near_one["items"])
    assert not any(row["result"] == "Life Potion" for row in near_one["items"])
    assert any(row["result"] == "Life Potion" for row in near_two["items"])
    assert any(row["result"] == "Stoneflesh Elixir" for row in near_three["items"])


def test_dashboard_endpoint_returns_shared_panel_payload() -> None:
    client = make_client()

    client.post("/api/inventory/items/add", json={"item": "Clean Water", "qty": 1}).raise_for_status()
    client.post("/api/inventory/items/add", json={"item": "Gravel Beetle", "qty": 1}).raise_for_status()

    dashboard = client.get("/api/results/dashboard?stations=Alchemy+Kit&max_missing_slots=1").json()

    assert dashboard["inventory"]["items"] == [{"item": "Clean Water", "qty": 1}, {"item": "Gravel Beetle", "qty": 1}]
    assert "snapshot" in dashboard
    assert dashboard["best_direct"]["items"]
    assert dashboard["near"]["items"]


def test_startup_routes_do_not_raise_500_on_normal_render() -> None:
    client = make_client()

    metadata = client.get("/api/metadata")
    dashboard = client.get("/api/results/dashboard?max_missing_slots=2")
    direct = client.get("/api/results/direct?sort_mode=Smart%20score&max_missing_slots=2")

    assert metadata.status_code == 200
    assert dashboard.status_code == 200
    assert direct.status_code == 200


def test_exported_csv_round_trip_with_realistic_inventory_mix_keeps_results_routes_alive() -> None:
    client = make_client()

    ration_items = client.app.state.service.data.groups["ration ingredient"][:24]
    exported_rows = [{"item": item_name, "qty": 1} for item_name in ration_items]
    exported_rows.extend(
        [
            {"item": "Salt", "qty": 20},
            {"item": "Clean Water", "qty": 4},
            {"item": "Gravel Beetle", "qty": 2},
            {"item": "Turmmip", "qty": 2},
        ]
    )

    response = client.post(
        "/api/inventory/import/csv",
        files={
            "file": (
                "outward_inventory.csv",
                exported_csv_bytes(exported_rows),
                "text/csv",
            )
        },
    )
    response.raise_for_status()

    dashboard = client.get("/api/results/dashboard?stations=Cooking+Pot&stations=Alchemy+Kit&stations=Manual+Crafting&max_missing_slots=2")
    direct = client.get("/api/results/direct?stations=Cooking+Pot&stations=Alchemy+Kit&stations=Manual+Crafting&sort_mode=Smart%20score")
    near = client.get("/api/results/near?stations=Cooking+Pot&stations=Alchemy+Kit&stations=Manual+Crafting&max_missing_slots=2")

    assert dashboard.status_code == 200
    assert direct.status_code == 200
    assert near.status_code == 200
    assert dashboard.json()["inventory"]["unique_items"] == len(exported_rows)
    assert any(row["result"] == "Travel Ration" for row in direct.json()["items"])


def test_near_results_include_missing_summary_fields() -> None:
    client = make_client()

    client.post("/api/inventory/items/add", json={"item": "Gravel Beetle", "qty": 1}).raise_for_status()

    near = client.get("/api/results/near?stations=Alchemy+Kit&max_missing_slots=1&limit=20").json()
    cool_potion = result_map(near["items"])["Cool Potion"]

    assert cool_potion["missing_items"] == "Any Water"
    assert cool_potion["station"] == "Alchemy Kit"


def test_metadata_exposes_recipe_database_groups_and_item_stats() -> None:
    client = make_client()

    metadata = client.get("/api/metadata").json()

    assert metadata["recipes"]
    assert metadata["ingredient_groups"]
    assert metadata["item_stats"]
    stats = item_stat_map(metadata["item_stats"])
    assert "Clean Water" in stats
    assert stats["Clean Water"]["category"] == "Cooking ingredients"
    assert stats["Clean Water"]["effects"] == ""


def test_verified_item_metadata_fields_are_exposed_in_item_stats() -> None:
    client = make_client()

    metadata = client.get("/api/metadata").json()
    stats = item_stat_map(metadata["item_stats"])

    assert stats["Astral Potion"]["buy_value"] == 25
    assert stats["Astral Potion"]["weight"] == 0.5
    assert "Restores 20 Burnt Mana" in stats["Astral Potion"]["effects"]
    assert stats["Great Astral Potion"]["mana"] == 100
    assert "Health Recovery 3" in stats["Meat Stew"]["effects"]
    assert "Health Recovery 1" in stats["Miner's Omelet"]["effects"]
    assert "Stamina Recovery 3" in stats["Miner's Omelet"]["effects"]
    assert "Mana Recovery 3" in stats["Turmmip Potage"]["effects"]


def test_live_snapshot_and_best_direct_match_player_useful_outputs_for_sample_inventory() -> None:
    client = make_client()

    client.put(
        "/api/inventory/replace",
        json={
            "items": [
                {"item": "Raw Meat", "qty": 1},
                {"item": "Gaberries", "qty": 1},
                {"item": "Salt", "qty": 2},
                {"item": "Bird Egg", "qty": 2},
                {"item": "Common Mushroom", "qty": 1},
                {"item": "Gravel Beetle", "qty": 1},
                {"item": "Blood Mushroom", "qty": 1},
                {"item": "Star Mushroom", "qty": 1},
                {"item": "Turmmip", "qty": 3},
                {"item": "Clean Water", "qty": 2},
            ]
        },
    ).raise_for_status()

    dashboard = client.get("/api/results/dashboard?stations=Alchemy+Kit&stations=Cooking+Pot&max_missing_slots=2").json()
    direct = client.get("/api/results/direct?stations=Alchemy+Kit&stations=Cooking+Pot&sort_mode=Smart%20score").json()

    assert dashboard["snapshot"]["best_heal"] == "Miner's Omelet"
    assert dashboard["snapshot"]["best_stamina"] == "Miner's Omelet"
    assert dashboard["snapshot"]["best_mana"] == "Astral Potion"
    assert direct["items"][0]["result"] == "Astral Potion"
    assert any(row["result"] == "Miner's Omelet" for row in direct["items"][:6])


def test_dashboard_best_direct_matches_the_top_smart_score_slice_of_direct_results() -> None:
    client = make_client()

    client.put(
        "/api/inventory/replace",
        json={
            "items": [
                {"item": "Raw Meat", "qty": 1},
                {"item": "Gaberries", "qty": 1},
                {"item": "Salt", "qty": 2},
                {"item": "Bird Egg", "qty": 2},
                {"item": "Common Mushroom", "qty": 1},
                {"item": "Gravel Beetle", "qty": 1},
                {"item": "Blood Mushroom", "qty": 1},
                {"item": "Star Mushroom", "qty": 1},
                {"item": "Turmmip", "qty": 3},
                {"item": "Clean Water", "qty": 2},
            ]
        },
    ).raise_for_status()

    dashboard = client.get("/api/results/dashboard?stations=Alchemy+Kit&stations=Cooking+Pot&max_missing_slots=2").json()
    direct = client.get("/api/results/direct?stations=Alchemy+Kit&stations=Cooking+Pot&sort_mode=Smart%20score&limit=100").json()

    shortlist_limit = dashboard["best_direct"]["shortlist_limit"]

    assert dashboard["best_direct"]["count"] == direct["count"]
    assert dashboard["best_direct"]["items"] == direct["items"][:shortlist_limit]
    assert any(row["result"] == "Astral Potion" for row in dashboard["best_direct"]["items"])


def test_recipe_debug_reports_consistent_astral_potion_visibility_across_surfaces() -> None:
    client = make_client()

    client.put(
        "/api/inventory/replace",
        json={
            "items": [
                {"item": "Star Mushroom", "qty": 1},
                {"item": "Turmmip", "qty": 1},
                {"item": "Clean Water", "qty": 1},
            ]
        },
    ).raise_for_status()

    debug = client.get(
        "/api/results/recipe-debug?result=Astral%20Potion&stations=Alchemy+Kit&max_missing_slots=2&planner_depth=5"
    ).json()
    direct = client.get("/api/results/direct?stations=Alchemy+Kit&sort_mode=Smart%20score&limit=50").json()
    dashboard = client.get("/api/results/dashboard?stations=Alchemy+Kit&max_missing_slots=2").json()
    planner = client.post(
        "/api/results/planner",
        json={"target": "Astral Potion", "max_depth": 5, "stations": ["Alchemy Kit"]},
    ).json()

    assert debug["craftable_now"] is True
    assert debug["craftable_panel"] is True
    assert debug["planner_found"] is True
    assert debug["smart_score"] is not None
    assert debug["recipe_database_rows"] >= 1
    assert debug["craftable_recipe_rows"] >= 1
    assert debug["evaluated_rows"]
    assert any(position["sort_mode"] == "Smart score" and position["rank"] == 1 for position in debug["sort_positions"])
    assert any(row["result"] == "Astral Potion" for row in direct["items"])
    assert any(row["result"] == "Astral Potion" for row in dashboard["best_direct"]["items"])
    assert planner["found"] is True


def test_planner_and_debug_explain_when_the_target_is_already_owned_but_not_directly_craftable() -> None:
    client = make_client()

    client.put(
        "/api/inventory/replace",
        json={"items": [{"item": "Astral Potion", "qty": 1}]},
    ).raise_for_status()

    planner = client.post(
        "/api/results/planner",
        json={"target": "Astral Potion", "max_depth": 5, "stations": ["Alchemy Kit"]},
    ).json()
    direct = client.get("/api/results/direct?stations=Alchemy+Kit&sort_mode=Smart%20score&limit=50").json()
    debug = client.get(
        "/api/results/recipe-debug?result=Astral%20Potion&stations=Alchemy+Kit&max_missing_slots=2&planner_depth=5"
    ).json()

    assert planner["found"] is True
    assert planner["mode"] == "use_existing_target"
    assert planner["uses_existing_target"] is True
    assert planner["craft_steps"] == 0
    assert planner["explanation"].startswith("The target is already in your bag.")
    assert not any(row["result"] == "Astral Potion" for row in direct["items"])
    assert debug["target_owned_qty"] == 1
    assert debug["craftable_now"] is False
    assert debug["craftable_panel"] is False
    assert "already own this result" in debug["craftable_panel_reason"]
    assert debug["planner_found"] is True
    assert debug["planner_mode"] == "use_existing_target"
    assert "already in your bag" in debug["planner_alignment_reason"]


def test_recipe_debug_reports_full_craftable_inclusion_and_sort_rank_for_lower_ranked_results() -> None:
    client = make_client()

    metadata = client.get("/api/metadata").json()
    all_items = [{"item": item_name, "qty": 3} for item_name in metadata["ingredients"]]
    client.put("/api/inventory/replace", json={"items": all_items}).raise_for_status()

    debug = client.get(
        "/api/results/recipe-debug?result=Cooking%20Pot&stations=Manual%20Crafting&stations=Alchemy%20Kit&stations=Campfire&stations=Cooking%20Pot&max_missing_slots=4&planner_depth=5"
    ).json()
    direct = client.get(
        "/api/results/direct?stations=Manual%20Crafting&stations=Alchemy%20Kit&stations=Campfire&stations=Cooking%20Pot&sort_mode=Smart%20score&limit=500"
    ).json()

    assert debug["craftable_now"] is True
    assert debug["craftable_panel"] is True
    assert debug["craftable_sort_reason"].startswith("The best matching craftable row is ranked #")
    assert any(position["sort_mode"] == "Smart score" and position["rank"] and position["rank"] > 1 for position in debug["sort_positions"])
    assert any(row["result"] == "Cooking Pot" for row in direct["items"])


def test_direct_sorting_changes_order_but_not_full_craftable_inclusion() -> None:
    client = make_client()

    client.put(
        "/api/inventory/replace",
        json={
            "items": [
                {"item": "Raw Meat", "qty": 1},
                {"item": "Gaberries", "qty": 1},
                {"item": "Salt", "qty": 2},
                {"item": "Bird Egg", "qty": 2},
                {"item": "Common Mushroom", "qty": 1},
                {"item": "Gravel Beetle", "qty": 1},
                {"item": "Blood Mushroom", "qty": 1},
                {"item": "Star Mushroom", "qty": 1},
                {"item": "Turmmip", "qty": 3},
                {"item": "Clean Water", "qty": 2},
            ]
        },
    ).raise_for_status()

    smart = client.get("/api/results/direct?stations=Alchemy+Kit&stations=Cooking+Pot&sort_mode=Smart%20score&limit=100").json()
    mana = client.get("/api/results/direct?stations=Alchemy+Kit&stations=Cooking+Pot&sort_mode=Best%20mana&limit=100").json()

    assert smart["count"] == mana["count"]
    assert {row["result"] for row in smart["items"]} == {row["result"] for row in mana["items"]}
    assert [row["result"] for row in smart["items"][:5]] != [row["result"] for row in mana["items"][:5]]


def test_near_endpoint_threshold_changes_real_recipe_output_for_same_inventory() -> None:
    client = make_client()

    client.put(
        "/api/inventory/replace",
        json={"items": [{"item": "Gravel Beetle", "qty": 1}]},
    ).raise_for_status()

    near_one = client.get("/api/results/near?stations=Alchemy+Kit&max_missing_slots=1&limit=50").json()
    near_two = client.get("/api/results/near?stations=Alchemy+Kit&max_missing_slots=2&limit=50").json()
    near_three = client.get("/api/results/near?stations=Alchemy+Kit&max_missing_slots=3&limit=50").json()

    assert [row["result"] for row in near_one["items"]] == ["Cool Potion"]
    assert [row["result"] for row in near_two["items"]] == ["Cool Potion", "Life Potion", "Rage Potion"]
    assert [row["result"] for row in near_three["items"]] == ["Cool Potion", "Life Potion", "Rage Potion", "Stoneflesh Elixir"]


def test_recipe_debug_shows_near_threshold_changes_for_two_missing_slots() -> None:
    client = make_client()

    client.post("/api/inventory/items/add", json={"item": "Gravel Beetle", "qty": 1}).raise_for_status()

    debug_one = client.get(
        "/api/results/recipe-debug?result=Life%20Potion&stations=Alchemy+Kit&max_missing_slots=1&planner_depth=5"
    ).json()
    debug_two = client.get(
        "/api/results/recipe-debug?result=Life%20Potion&stations=Alchemy+Kit&max_missing_slots=2&planner_depth=5"
    ).json()

    assert debug_one["near_craft"] is False
    assert debug_two["near_craft"] is True
    assert "above the current threshold of 1" in debug_one["near_reason"]


def test_inventory_can_grow_past_46_unique_entries_and_duplicates_still_aggregate() -> None:
    client = make_client()

    metadata = client.get("/api/metadata").json()
    unique_items = metadata["ingredients"][:60]

    for item_name in unique_items:
        client.post("/api/inventory/items/add", json={"item": item_name, "qty": 1}).raise_for_status()

    inventory = client.get("/api/inventory").json()

    assert inventory["unique_items"] == 60
    assert inventory["total_quantity"] == 60

    client.post("/api/inventory/items/add", json={"item": unique_items[0], "qty": 2}).raise_for_status()
    inventory_after_duplicate = client.get("/api/inventory").json()

    assert inventory_after_duplicate["unique_items"] == 60
    assert inventory_after_duplicate["total_quantity"] == 62
    assert any(row == {"item": unique_items[0], "qty": 3} for row in inventory_after_duplicate["items"])


def test_luxury_tent_is_searchable_has_metadata_and_counts_as_an_advanced_tent() -> None:
    client = make_client()

    metadata = client.get("/api/metadata").json()
    searchable_items = set(metadata["ingredients"])
    item_stats = item_stat_map(metadata["item_stats"])

    assert {"Simple Tent", "Luxury Tent", "Mage Tent", "Fur Tent", "Camouflaged Tent", "Plant Tent"} <= searchable_items
    assert "Luxury Tent" in item_stats
    assert item_stats["Luxury Tent"]["category"] == "Deployable"
    assert item_stats["Luxury Tent"]["weight"] == 6.0
    assert "Faster Health recovery from Rest" in item_stats["Luxury Tent"]["effects"]

    client.post("/api/inventory/items/add", json={"item": "Luxury Tent", "qty": 1}).raise_for_status()
    client.post("/api/inventory/items/add", json={"item": "Obsidian Shard", "qty": 1}).raise_for_status()
    client.post("/api/inventory/items/add", json={"item": "Seared Root", "qty": 1}).raise_for_status()
    client.post("/api/inventory/items/add", json={"item": "Predator Bones", "qty": 1}).raise_for_status()

    direct = client.get("/api/results/direct?stations=Manual+Crafting&limit=100").json()

    assert "Fire Totemic Lodge" in result_map(direct["items"])
