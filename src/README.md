# Outward Crafting Helper v2

This pack is meant to replace manual copy-pasting from the wiki.

It gives you three things:

1. `outward_wiki_sync.py` — pulls recipe data from the official Outward wiki into local files.
2. `app.py` — a Streamlit crafting helper that can compare your inventory against recipes.
3. `outward_crafting_template.xlsx` — a workbook for storing inventory, browsing recipes, and keeping everything organized.

## What changed in v2

Compared to the first version, this one adds:

- direct craftability checks
- near-craftable recipe detection
- a multi-step planner for one target item at a time
- shopping-list planning for a whole target build
- smarter ranking for useful-looking crafts
- item effect / recovery / sale-value metadata for recipe ranking
- cleaner workbook structure
- CSV/Excel inventory import support
- extra in-app help text and UI polish

## Best way to use it

### Option A — easiest workflow

1. Refresh the wiki data:
```bash
python outward_wiki_sync.py
```

2. Start the helper:
```bash
streamlit run app.py
```

3. Paste your inventory or upload a CSV/XLSX.

4. Use:
- **Craft now** to see what is immediately possible
- **Plan a target** to see whether a recipe can be reached through intermediate crafting
- **Shopping list** to estimate the minimum missing ingredients for a full build
- **Missing ingredients** to see what you are close to making

## Customizing item stats

The ranking views use `data/item_metadata.json`.

You can edit that file any time to adjust:

- healing values
- stamina values
- mana values
- sale values
- short effect / buff notes

## Install packages

```bash
pip install requests beautifulsoup4 pandas openpyxl streamlit
```

## Files created by the sync script

After a successful pull, you should have:

- `data/recipes.csv`
- `data/ingredient_groups.json`
- `outward_crafting.xlsx`

The app will use those files automatically when they exist.
If they do not exist yet, it falls back to bundled sample data so you can still test the UI.

## Inventory format

Simple CSV example:

```text
item,qty
Wheat,8
Clean Water,4
Salt,3
Egg,2
Krimp Nut,2
Purpkin,2
```

You can also paste lines like:

```text
Wheat,8
Clean Water,4
Salt,3
```

## Limits to know about

- The planner is intentionally practical, not perfect. It is designed to answer “can I make this from what I have, possibly through intermediate crafts?”
- It does not try to optimize every possible recipe branch globally.
- If the wiki changes its table structure, the sync parser may need small adjustments.

## Why an app is better than raw Excel formulas

A spreadsheet is fine for inventory storage and filtering, but Outward has generic ingredient categories like `Water`, `Vegetable`, `Meat`, `Egg`, and similar grouped ingredients. That makes pure-formula logic messy fast.

So the clean split is:
- Excel for storage and review
- the app for exact crafting logic
