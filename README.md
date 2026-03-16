# Alie's Outward Crafting

A frontend-only Outward crafting helper built with React + TypeScript.

The player-facing app now runs entirely in the browser:

- inventory tracking
- craftable recipes
- almost-craftable results
- planner / one-more route checks
- shopping lists
- recipe database + visibility debug

The old backend runtime is no longer required for normal use. Recipe data is bundled as static JSON, and the browser app does all calculations locally.

## Runtime model

### Normal player runtime

- `frontend/` is the runtime app
- it can be hosted as a static site
- it does **not** need a backend
- it keeps inventory state in browser storage

### Offline tooling

- `tools/scrape_outward_wiki.py`
  - optional one-time / occasional data scrape
- `tools/build_frontend_data.py`
  - turns the shared source data into `frontend/public/data/calculator-data.json`
- `shared/`
  - offline Python data helpers, recipe data, and scrape support

## Main features

- Manual CSV / Excel inventory import
- Browser-side live inventory manager
- Full craftable recipe list with sorting
- Almost-craftable list using the missing-slot threshold
- Planner that answers whether you can make one more copy and what is still needed
- Shopping list builder for multiple targets
- Recipe database with optional visibility debug
- Mod URL sync support for frontend-only inventory loading

## Mod URL sync

Because a static browser app cannot read `Documents\\OutwardCraftSync\\current_inventory.csv` directly, the browser-shareable sync flow is now:

1. The mod exports inventory data.
2. The mod opens the app with a URL payload.
3. The frontend reads that payload on load and populates the same inventory state used by manual imports.

Supported sync params:

- query: `?sync=...`
- query: `?modSync=...`
- query: `?inventory=...`
- hash: `#sync=...`

Preferred format:

- a single base64url JSON payload
- example shape:

```json
{
  "source": "Outward mod",
  "exportedAtUtc": "2026-03-16T12:00:00Z",
  "inventoryType": "bag",
  "items": [
    { "canonicalName": "Star Mushroom", "quantity": 1 },
    { "canonicalName": "Turmmip", "quantity": 1 },
    { "canonicalName": "Clean Water", "quantity": 1 }
  ]
}
```

Why base64url instead of many raw query params:

- easier for the mod to generate
- easier for the frontend to validate
- keeps one clear transport field
- works better with hash-based links

Important limitation:

- browser URL length is **not unlimited**
- hash payloads are usually safer than large raw query strings
- very large inventories can still hit browser or launcher URL limits

## Project layout

```text
.
|- frontend/          Static React app
|- shared/            Offline Python recipe/data helpers
|- tools/             One-time scrape + data-build commands
|- run.cmd            Starts the frontend dev server
|- run_frontend.cmd   Starts the Vite dev server
```

## Quick start

### Requirements

- Node.js 18+
- npm

Optional for offline data tooling:

- Python 3.10+

### Install the frontend

```powershell
cd frontend
npm install
cd ..
```

### Run the app locally

```powershell
.\run.cmd
```

Or:

```powershell
.\run_frontend.cmd
```

Open:

- `http://127.0.0.1:5173`

## Using the app

### Recommended inventory flow

1. Open the app normally or from the Outward mod sync link.
2. If the mod link is valid, the app will load inventory automatically.
3. If you are not using the mod link, use **Upload CSV / Excel**.
4. All crafting results update locally in the browser.

### What the tabs do

- **Craft now**
  - manage inventory and browse all craftable recipe rows
- **Plan a target**
  - see whether you can make one more copy, what is missing, and what steps come next
- **Shopping list**
  - combine multiple targets into one missing-items checklist
- **Missing ingredients**
  - see recipes that are close to craftable under the current threshold
- **Recipe database**
  - search recipe rows and optionally open the visibility debug inspector

## Static build / sharing

Build the static app with:

```powershell
cd frontend
npm run build
```

The output goes to:

- `frontend/dist/`

This is suitable for static hosting such as:

- GitHub Pages
- Netlify
- Cloudflare Pages
- any simple static file host

## Offline data refresh

If you want to refresh the bundled recipe data:

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r tools\requirements.txt
.\.venv\Scripts\python.exe tools\scrape_outward_wiki.py
.\.venv\Scripts\python.exe tools\build_frontend_data.py
```

Normal players do **not** need to run this.

## Tests

Frontend tests:

```powershell
cd frontend
npm test
```

Typecheck:

```powershell
cd frontend
npx tsc --noEmit -p tsconfig.json
```

## Notes

- The player-facing runtime is now frontend-only.
- The old fixed local filesystem sync path is intentionally not used in the static browser build.
- Manual CSV / Excel import still works.
- The bundled data file lives at `frontend/public/data/calculator-data.json`.
- Offline scrape/build tooling stays in Python so the browser app stays simple for players.
