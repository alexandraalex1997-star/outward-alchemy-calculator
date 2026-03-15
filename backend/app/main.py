from __future__ import annotations

from typing import List, Optional

from fastapi import FastAPI, File, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .schemas import (
    AddInventoryItemRequest,
    PlannerRequest,
    ReplaceInventoryRequest,
    SetInventoryItemRequest,
    ShoppingListRequest,
    TextImportRequest,
)
from .services import CalculatorService, InventoryStore, load_calculator_data


def create_app() -> FastAPI:
    app = FastAPI(title="Outward Crafting API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.service = CalculatorService(load_calculator_data(), InventoryStore())

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/inventory")
    def get_inventory() -> dict:
        return app.state.service.get_inventory_response()

    @app.post("/api/inventory/items/add")
    def add_inventory_item(payload: AddInventoryItemRequest) -> dict:
        return app.state.service.add_inventory_item(payload.item, payload.qty)

    @app.put("/api/inventory/items/{item_name:path}")
    def set_inventory_item(item_name: str, payload: SetInventoryItemRequest) -> dict:
        return app.state.service.set_inventory_item(item_name, payload.qty)

    @app.put("/api/inventory/replace")
    def replace_inventory(payload: ReplaceInventoryRequest) -> dict:
        return app.state.service.replace_inventory([item.model_dump() for item in payload.items])

    @app.post("/api/inventory/import/text")
    def import_inventory_text(payload: TextImportRequest) -> dict:
        return app.state.service.import_text_inventory(payload.text)

    @app.post("/api/inventory/import/csv")
    async def import_inventory_csv(file: UploadFile = File(...)) -> dict:
        return app.state.service.import_csv_inventory(await file.read())

    @app.post("/api/inventory/import/excel")
    async def import_inventory_excel(file: UploadFile = File(...)) -> dict:
        return app.state.service.import_excel_inventory(await file.read())

    @app.get("/api/results/overview")
    def results_overview(
        stations: Optional[List[str]] = Query(default=None),
        max_missing_slots: int = Query(default=2, ge=1, le=4),
    ) -> dict:
        return app.state.service.overview(stations, max_missing_slots=max_missing_slots)

    @app.get("/api/results/direct")
    def results_direct(
        sort_mode: str = Query(default="Smart score"),
        stations: Optional[List[str]] = Query(default=None),
        limit: Optional[int] = Query(default=None),
        max_missing_slots: int = Query(default=2, ge=1, le=4),
    ) -> dict:
        return app.state.service.direct_crafts(
            stations=stations,
            sort_mode=sort_mode,
            limit=limit,
            max_missing_slots=max_missing_slots,
        )

    @app.get("/api/results/near")
    def results_near(
        stations: Optional[List[str]] = Query(default=None),
        limit: Optional[int] = Query(default=None),
        max_missing_slots: int = Query(default=2, ge=1, le=4),
    ) -> dict:
        return app.state.service.near_crafts(stations=stations, limit=limit, max_missing_slots=max_missing_slots)

    @app.post("/api/results/planner")
    def results_planner(payload: PlannerRequest) -> dict:
        return app.state.service.planner(payload.target, payload.max_depth, payload.stations)

    @app.post("/api/results/shopping-list")
    def results_shopping_list(payload: ShoppingListRequest) -> dict:
        return app.state.service.shopping_list(
            [target.model_dump() for target in payload.targets],
            payload.max_depth,
            payload.stations,
        )

    @app.get("/api/metadata")
    def metadata() -> dict:
        return app.state.service.metadata()

    return app


app = create_app()
