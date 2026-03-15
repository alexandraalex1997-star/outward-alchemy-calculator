from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class InventoryItem(BaseModel):
    item: str
    qty: int = Field(ge=0)


class AddInventoryItemRequest(BaseModel):
    item: str
    qty: int = Field(default=1, ge=1)


class SetInventoryItemRequest(BaseModel):
    qty: int = Field(ge=0)


class ReplaceInventoryRequest(BaseModel):
    items: List[InventoryItem]


class TextImportRequest(BaseModel):
    text: str = ""


class PlannerRequest(BaseModel):
    target: str
    max_depth: int = Field(default=5, ge=1, le=8)
    stations: Optional[List[str]] = None


class ShoppingTarget(BaseModel):
    item: str
    qty: int = Field(default=1, ge=1)


class ShoppingListRequest(BaseModel):
    targets: List[ShoppingTarget]
    max_depth: int = Field(default=5, ge=1, le=8)
    stations: Optional[List[str]] = None


class InventoryResponse(BaseModel):
    items: List[InventoryItem]
    unique_items: int
    total_quantity: int


class SnapshotResponse(BaseModel):
    inventory_lines: int
    known_recipes: int
    direct_crafts: int
    near_crafts: int
    best_heal: Optional[str]
    best_stamina: Optional[str]
    best_mana: Optional[str]
