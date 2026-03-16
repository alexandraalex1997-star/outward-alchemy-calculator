import type { FormEvent } from "react";

import type { CategoryGroup, InventoryResponse } from "../types";
import { Panel, StatCard, classNames } from "./ui";

type InventoryCatalogRow = {
  item: string;
  category: string;
  qty: number;
  effects: string;
};

export function InventoryEditor({
  inventory,
  categories,
  ingredientOptions,
  filteredCatalogRows,
  inventoryMap,
  quickAddValue,
  quickQty,
  showOwnedOnly,
  selectedCategories,
  draftQuantities,
  onQuickAddValueChange,
  onQuickQtyChange,
  onQuickAdd,
  onToggleCategory,
  onToggleOwnedOnly,
  onClearInventory,
  onDraftQuantityChange,
  onToggleInventoryItem,
  onApplyInventoryQty,
  onRemoveInventoryItem,
  onDownloadInventoryCsv,
}: {
  inventory: InventoryResponse | null;
  categories: CategoryGroup[];
  ingredientOptions: string[];
  filteredCatalogRows: InventoryCatalogRow[];
  inventoryMap: Map<string, number>;
  quickAddValue: string;
  quickQty: number;
  showOwnedOnly: boolean;
  selectedCategories: string[];
  draftQuantities: Record<string, string>;
  onQuickAddValueChange: (value: string) => void;
  onQuickQtyChange: (value: number) => void;
  onQuickAdd: (event: FormEvent) => void | Promise<void>;
  onToggleCategory: (category: string) => void;
  onToggleOwnedOnly: (value: boolean) => void;
  onClearInventory: () => void;
  onDraftQuantityChange: (item: string, value: string) => void;
  onToggleInventoryItem: (item: string, nextEnabled: boolean, currentQty: number) => void;
  onApplyInventoryQty: (item: string) => void;
  onRemoveInventoryItem: (item: string) => void;
  onDownloadInventoryCsv: () => void;
}) {
  return (
    <Panel
      title="Inventory manager"
      description="Search, add, filter, and edit the live inventory used by every result."
      className="inventory-workspace"
    >
      <section className="inventory-manager-shell">
        <header className="inventory-band inventory-band--summary">
          <div className="inventory-summary-head">
            <div className="inventory-summary-copy">
              <h3>Inventory overview</h3>
              <p>
                {inventory?.items.length
                  ? "Live totals used by the craft, planner, and shopping views."
                  : "Load the latest Outward inventory or add items manually to begin."}
              </p>
            </div>
            <button
              type="button"
              className="button subtle summary-action-button"
              onClick={onDownloadInventoryCsv}
              title="Download the current inventory as CSV"
            >
              Export CSV
            </button>
          </div>
          <div className="inventory-summary-row">
            <StatCard
              className="summary-stat"
              label="Unique items"
              value={inventory?.unique_items ?? 0}
              detail="Different ingredients currently tracked"
            />
            <StatCard
              className="summary-stat"
              label="Total quantity"
              value={inventory?.total_quantity ?? 0}
              detail="Combined stack count across the whole bag"
            />
          </div>
        </header>

        <section className="inventory-band inventory-band--controls">
          <form className="quick-add-row" onSubmit={(event) => void onQuickAdd(event)}>
            <label className="field grow">
              <div className="field-head">
                <span>Find an ingredient</span>
                <small>Start typing to match the known item list</small>
              </div>
              <input
                list="ingredient-options"
                value={quickAddValue}
                onChange={(event) => onQuickAddValueChange(event.target.value)}
                placeholder="Search or paste an item name..."
              />
              <datalist id="ingredient-options">
                {ingredientOptions.map((ingredient) => (
                  <option key={ingredient} value={ingredient} />
                ))}
              </datalist>
            </label>
            <label className="field quantity-field">
              <div className="field-head">
                <span>Quantity</span>
                <small>Whole number</small>
              </div>
              <input
                className="quick-qty-input"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={quickQty}
                onChange={(event) => onQuickQtyChange(Math.max(1, Number(event.target.value) || 1))}
              />
            </label>
            <button type="submit" className="button primary quick-add-button">
              Add
            </button>
          </form>

          <div className="inventory-categories-row">
            <span className="toolbar-label">Categories</span>
            <div className="chip-group category-chip-row">
              {categories.map((category) => {
                const active = selectedCategories.includes(category.name);
                return (
                  <button
                    key={category.name}
                    type="button"
                    className={classNames("chip", active && "active")}
                    onClick={() => onToggleCategory(category.name)}
                  >
                    {category.name}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="inventory-band inventory-band--table">
          <div className="inventory-table-head">
            <div className="inventory-table-copy">
              <strong>Ingredient table</strong>
              <span>Toggle items on quickly, edit quantities, then save or remove the row.</span>
            </div>
            <div className="inventory-table-tools">
              <label className="owned-toggle">
                <input type="checkbox" checked={showOwnedOnly} onChange={(event) => onToggleOwnedOnly(event.target.checked)} />
                <span>Owned only</span>
              </label>
              <button type="button" className="button subtle table-utility-button" onClick={onClearInventory}>
                Clear
              </button>
            </div>
          </div>
          <div className="inventory-table-stats">
            <span>{filteredCatalogRows.length} visible after filters</span>
            <span>{inventory?.items.length ?? 0} currently owned</span>
          </div>

          {filteredCatalogRows.length ? (
            <div className="table-shell ingredient-table-shell">
              <table className="data-table ingredient-table">
                <thead>
                  <tr>
                    <th>In bag</th>
                    <th>Ingredient</th>
                    <th>Category</th>
                    <th>Buffs</th>
                    <th>Qty</th>
                    <th>Save</th>
                    <th>Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCatalogRows.map((row) => {
                    const currentQty = inventoryMap.get(row.item) ?? 0;
                    const draftValue = draftQuantities[row.item] ?? String(currentQty);

                    return (
                      <tr key={row.item} className={classNames("ingredient-row", currentQty > 0 && "owned-row")}>
                        <td>
                          <input
                            type="checkbox"
                            checked={currentQty > 0}
                            aria-label={`Toggle ${row.item} in the inventory`}
                            onChange={(event) => onToggleInventoryItem(row.item, event.target.checked, currentQty)}
                          />
                        </td>
                        <td className="ingredient-name-cell">
                          <span className="table-result-name">{row.item}</span>
                        </td>
                        <td>
                          <span className="table-category-tag">{row.category}</span>
                        </td>
                        <td>
                          <span className="buffs-cell" title={row.effects || "None"}>
                            {row.effects || "None"}
                          </span>
                        </td>
                        <td className="qty-cell">
                          <input
                            className="qty-input qty-cell-input"
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            aria-label={`Quantity for ${row.item}`}
                            value={draftValue}
                            onChange={(event) => onDraftQuantityChange(row.item, event.target.value)}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="button subtle tiny row-action-button row-apply-button"
                            onClick={() => onApplyInventoryQty(row.item)}
                          >
                            Apply
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="button subtle tiny row-action-button row-remove-button"
                            onClick={() => onRemoveInventoryItem(row.item)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state inventory-empty-state">No ingredients match the current search and category filters.</div>
          )}
        </section>

        <footer className="inventory-band inventory-band--footer inventory-foot-stats">
          <StatCard className="inventory-foot-stat" label="Categories shown" value={selectedCategories.length || categories.length} />
          <StatCard className="inventory-foot-stat" label="Visible now" value={filteredCatalogRows.length} />
          <StatCard className="inventory-foot-stat" label="Selected total" value={inventory?.total_quantity ?? 0} />
          <StatCard className="inventory-foot-stat" label="Unique selected" value={inventory?.unique_items ?? 0} />
        </footer>
      </section>
    </Panel>
  );
}
