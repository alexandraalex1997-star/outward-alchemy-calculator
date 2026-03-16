# Data tooling

This folder now contains the shared crafting/data layer for the current React + FastAPI app.

## Main files

- `crafting_core.py`
  Core recipe logic, ranking helpers, planner logic, shopping-list helpers, and metadata-table builders.

- `inventory_ops.py`
  Inventory parsing and table helpers used by tests and data tooling.

- `outward_wiki_sync.py`
  Pulls recipe and metadata source data into local project files.

- `data/recipes.csv`
  Current recipe dataset used by the backend service layer.

- `data/ingredient_groups.json`
  Canonical grouped-ingredient definitions.

- `data/item_metadata.json`
  Manual item metadata overrides and curated item stats/effects.

## Current app architecture

- Frontend: React in `frontend/`
- API: FastAPI in `backend/app/`
- Shared crafting/data logic: this `shared/` folder

## Refreshing data

To refresh local recipe/wiki data, run:

```bash
python shared/outward_wiki_sync.py
```

## Notes

- The old legacy Streamlit UI files were removed because the project now uses the React + FastAPI app exclusively.
