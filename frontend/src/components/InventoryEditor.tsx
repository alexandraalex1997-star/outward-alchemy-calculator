import type { FormEvent } from "react";

import type { CategoryGroup, InventoryResponse } from "../types";
import { Panel, StatCard, classNames } from "./ui";

type InventoryCatalogRow = {
  item: string;
  category: string;
  qty: number;
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
      title="Inventory input"
      description="Search, add, filter, and edit the live inventory behind every result."
      className="inventory-workspace"
    >
      <div className="inventory-summary-bar">
        <div className="inventory-summary-copy">
          <h3>Inventory overview</h3>
          <p>{inventory?.items.length ? "Live totals from the canonical inventory." : "Add items below or import a list to begin."}</p>
        </div>
        <div className="inventory-summary-row">
          <StatCard className="summary-stat" label="Unique items" value={inventory?.unique_items ?? 0} />
          <StatCard className="summary-stat" label="Total quantity" value={inventory?.total_quantity ?? 0} />
          <button type="button" className="button subtle summary-action-button" onClick={onDownloadInventoryCsv}>
            CSV
          </button>
        </div>
      </div>

      <div className="inventory-editor">
        <form className="quick-add-row control-strip" onSubmit={(event) => void onQuickAdd(event)}>
          <label className="field grow">
            <span>Search items</span>
            <input
              list="ingredient-options"
              value={quickAddValue}
              onChange={(event) => onQuickAddValueChange(event.target.value)}
              placeholder="Start typing an ingredient..."
            />
            <datalist id="ingredient-options">
              {ingredientOptions.map((ingredient) => (
                <option key={ingredient} value={ingredient} />
              ))}
            </datalist>
          </label>
          <label className="field quantity-field">
            <span>Qty</span>
            <input
              type="number"
              min={1}
              value={quickQty}
              onChange={(event) => onQuickQtyChange(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
          <button type="submit" className="button primary">
            Add
          </button>
        </form>

        <div className="toolbar-row control-strip toolbar-strip">
          <div className="toolbar-categories">
            <span className="toolbar-label">Categories</span>
            <div className="chip-group">
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
          <label className="owned-toggle">
            <input type="checkbox" checked={showOwnedOnly} onChange={(event) => onToggleOwnedOnly(event.target.checked)} />
            <span>Owned only</span>
          </label>
          <button type="button" className="button subtle" onClick={onClearInventory}>
            Clear
          </button>
        </div>

        {filteredCatalogRows.length ? (
          <>
            <div className="inventory-table-head">
              <div className="inventory-table-copy">
                <strong>Ingredient table</strong>
                <span>Edit qty, then Apply. Remove clears the item.</span>
              </div>
              <div className="inventory-table-stats">
                <span>{filteredCatalogRows.length} visible</span>
                <span>{inventory?.items.length ?? 0} owned</span>
              </div>
            </div>

            <div className="table-shell ingredient-table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Have it</th>
                    <th>Ingredient</th>
                    <th>Category</th>
                    <th>Qty</th>
                    <th>Apply</th>
                    <th>Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCatalogRows.map((row) => {
                    const currentQty = inventoryMap.get(row.item) ?? 0;
                    const draftValue = draftQuantities[row.item] ?? String(currentQty);

                    return (
                      <tr key={row.item}>
                        <td>
                          <input
                            type="checkbox"
                            checked={currentQty > 0}
                            onChange={(event) => onToggleInventoryItem(row.item, event.target.checked, currentQty)}
                          />
                        </td>
                        <td>{row.item}</td>
                        <td>{row.category}</td>
                        <td>
                          <input
                            className="qty-input"
                            type="number"
                            min={0}
                            value={draftValue}
                            onChange={(event) => onDraftQuantityChange(row.item, event.target.value)}
                          />
                        </td>
                        <td>
                          <button type="button" className="button subtle tiny" onClick={() => onApplyInventoryQty(row.item)}>
                            Apply
                          </button>
                        </td>
                        <td>
                          <button type="button" className="button subtle tiny" onClick={() => onRemoveInventoryItem(row.item)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="empty-state">No ingredients match the current search and category filters.</div>
        )}
      </div>

      <div className="inventory-foot-stats">
        <StatCard label="Categories shown" value={selectedCategories.length || categories.length} />
        <StatCard label="Visible now" value={filteredCatalogRows.length} />
        <StatCard label="Selected total" value={inventory?.total_quantity ?? 0} />
        <StatCard label="Unique selected" value={inventory?.unique_items ?? 0} />
      </div>
    </Panel>
  );
}
