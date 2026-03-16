from __future__ import annotations

from collections import Counter
from typing import Dict

import pandas as pd

try:
    from .crafting_core import key, normalize
except ImportError:  # pragma: no cover - supports running this module as a standalone script
    from crafting_core import key, normalize


def counts_from_text(raw: str) -> Counter:
    counts = Counter()
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if "," in line:
            item, qty = line.rsplit(",", 1)
        elif "\t" in line:
            item, qty = line.rsplit("\t", 1)
        else:
            item, qty = line, "1"
        item = normalize(item)
        try:
            qty = int(float(qty.strip()))
        except Exception:
            qty = 1
        if item and qty > 0:
            counts[item] += qty
    return counts


def inventory_from_df(df: pd.DataFrame) -> Counter:
    counts = Counter()
    item_col = None
    qty_col = None
    for column in df.columns:
        column_key = key(column)
        if column_key in {"item", "ingredient", "name"} and item_col is None:
            item_col = column
        if column_key in {"qty", "quantity", "count"} and qty_col is None:
            qty_col = column
    if item_col is None:
        item_col = df.columns[0]
    if qty_col is None:
        qty_col = df.columns[1] if len(df.columns) > 1 else None

    for _, row in df.iterrows():
        item = normalize(row[item_col])
        if not item:
            continue
        qty = 1 if qty_col is None else row[qty_col]
        try:
            qty = int(float(qty))
        except Exception:
            qty = 1
        if qty > 0:
            counts[item] += qty
    return counts


def merge_inventory_entry(inventory: Dict[str, int], item_name: str, qty: int) -> Dict[str, int]:
    next_inventory = {
        normalize(name): int(amount)
        for name, amount in inventory.items()
        if normalize(name) and int(amount) > 0
    }
    item_name = normalize(item_name)
    quantity = max(1, int(qty))
    if item_name:
        next_inventory[item_name] = int(next_inventory.get(item_name, 0)) + quantity
    return next_inventory


def inventory_table_df(inventory: Counter, item_label: str = "item") -> pd.DataFrame:
    rows = [{item_label: item_name, "qty": qty} for item_name, qty in sorted(inventory.items())]
    return pd.DataFrame(rows)
