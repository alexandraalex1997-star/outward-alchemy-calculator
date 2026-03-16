# Shared Offline Data Helpers

This folder is no longer part of the normal player runtime.

It exists for offline data work only:

- recipe parsing helpers
- grouped-ingredient logic
- metadata helpers
- scrape support

## Main files

- `crafting_core.py`
  - recipe normalization, craftability helpers, planner helpers, smart scoring
- `inventory_ops.py`
  - inventory parsing helpers for offline tools
- `outward_wiki_sync.py`
  - scrape/update source data from the community wikis
- `data/recipes.csv`
  - recipe source data consumed by the offline data builder
- `data/ingredient_groups.json`
  - grouped ingredient definitions
- `data/item_metadata.json`
  - curated item stats/effects and overrides

## How it is used now

1. `tools/scrape_outward_wiki.py` optionally refreshes source data.
2. `tools/build_frontend_data.py` converts that source data into static JSON for the frontend.
3. The frontend consumes the generated JSON at runtime.

## Player runtime note

The browser app does not import these Python files directly.
