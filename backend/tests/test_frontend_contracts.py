from __future__ import annotations

import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[2]


def test_view_config_maps_tabs_to_expected_logic() -> None:
    config = json.loads((BASE_DIR / "frontend" / "src" / "view-config.json").read_text(encoding="utf-8"))
    mapping = {entry["id"]: entry["logic"] for entry in config}

    assert mapping == {
        "Craft now": "direct",
        "Plan a target": "planner",
        "Shopping list": "shopping",
        "Missing ingredients": "near",
        "Recipe database": "database",
    }
