# Alie's Outward Crafting

A local React + FastAPI companion app for **Outward** that helps you manage inventory, see what you can craft right now, plan target items, and build shopping lists from the ingredients you already have.

This project is built to be fast, readable, and beginner-friendly. The crafting logic lives in shared Python code, while the UI is a React app that talks to a small FastAPI backend.

## Features

- **One-click Outward inventory sync**
  - Loads the latest exported inventory from:
    - `%USERPROFILE%\Documents\OutwardCraftSync\current_inventory.csv`
  - You can override this with:
    - `OUTWARD_SYNC_INVENTORY_PATH`
- **Manual CSV / Excel import fallback**
  - Import inventory files without changing the sync workflow
- **Live inventory manager**
  - Search, add, edit, remove, filter, and export tracked ingredients
- **Craftable recipes panel**
  - Shows every recipe row you can craft right now
  - Supports sorting by:
    - Smart score
    - Best healing
    - Best stamina
    - Best mana
    - Max crafts
    - Max total output
    - Sale value
    - Result A-Z
- **Almost craftable view**
  - Shows recipes that are close, based on the current missing-slot threshold
- **Planner**
  - Shows the practical next route for one target:
    - direct route
    - recursive route
    - partial route
    - blocked route
  - If the target is already owned, it plans for crafting one more copy
- **Shopping list builder**
  - Combines multiple targets into one missing-items list
- **Recipe database + debug tools**
  - Browse recipe data, grouped ingredients, item metadata, and recipe-surface visibility/debug information

## Tech Stack

- **Frontend:** React + TypeScript + Vite
- **Backend:** FastAPI
- **Shared logic/data:** Python + pandas

## Project Layout

```text
.
|- frontend/        React UI
|- backend/         FastAPI app and tests
|- shared/          Shared crafting logic, inventory helpers, and data tooling
|- run.cmd          Starts backend + frontend in separate terminals
|- run_api.cmd      Starts the FastAPI server
|- run_frontend.cmd Starts the Vite dev server
```

## Quick Start

### Requirements

- Python 3.10+
- Node.js 18+
- npm

### 1. Install backend dependencies

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r backend\requirements.txt
```

### 2. Install frontend dependencies

```powershell
cd frontend
npm install
cd ..
```

### 3. Run the app

You can use the included Windows helper scripts:

```powershell
.\run.cmd
```

Or run each side manually:

```powershell
.\run_api.cmd
.\run_frontend.cmd
```

### 4. Open the app

- Frontend: `http://127.0.0.1:5173`
- Backend API: `http://127.0.0.1:8000`

## Using the App

### Recommended inventory workflow

1. Export your inventory from the Outward mod to:
   - `%USERPROFILE%\Documents\OutwardCraftSync\current_inventory.csv`
2. Open the app
3. Click **Load latest Outward inventory**

If that sync file is missing, you can still use **Upload CSV / Excel** as a manual fallback.

### What the main views do

- **Craft now**
  - Shows all directly craftable recipe rows under the current station filters
- **Plan a target**
  - Plans the next practical route for that target
  - If already owned, it checks whether one more copy can be crafted now (or what is missing)
- **Shopping list**
  - Builds one combined missing-items list for multiple outputs
- **Missing ingredients**
  - Shows recipes close to craftable under the current missing-slot threshold
- **Recipe database**
  - Lets you inspect recipes, ingredient groups, metadata, and visibility/debug details

## Tests

Run the backend and frontend contract tests with:

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests\test_api.py backend\tests\test_core_logic.py backend\tests\test_frontend_contracts.py
```

Build the frontend with:

```powershell
cd frontend
npm run build
```

## Data and Recipe Tooling

The shared crafting logic and local data tooling live in `shared/`.

Useful files:

- `shared/crafting_core.py`
- `shared/inventory_ops.py`
- `shared/outward_wiki_sync.py`
- `shared/data/recipes.csv`
- `shared/data/ingredient_groups.json`
- `shared/data/item_metadata.json`

To refresh recipe/wiki data locally:

```powershell
python shared/outward_wiki_sync.py
```

## Notes

- The app is currently designed for local use.
- The default one-click Outward sync path is resolved on the backend as:
  - `%USERPROFILE%\Documents\OutwardCraftSync\current_inventory.csv`
- You can override it by setting:
  - `OUTWARD_SYNC_INVENTORY_PATH`
- The frontend reads the active sync path from backend metadata, so the path is no longer duplicated in multiple places.

## Status

This is an actively iterated personal project focused on:

- stable crafting logic
- clean inventory workflow
- clearer planner/debug behavior
- practical quality-of-life improvements for actual Outward play
