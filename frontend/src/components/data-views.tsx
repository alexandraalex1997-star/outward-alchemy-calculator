import type {
  IngredientGroup,
  InventoryItem,
  ItemStat,
  RecipeDatabaseRecord,
  RecipeResult,
} from "../types";
import { Panel, classNames, formatScore } from "./ui";

export type CraftResultsOptionalColumnId = "perCraft" | "craftsPossible" | "totalMade";

export type CraftResultsColumnVisibility = Record<CraftResultsOptionalColumnId, boolean>;

function displayGroupName(group: string) {
  return group
    .split(" ")
    .map((token) => (token.startsWith("(") ? token : token.charAt(0).toUpperCase() + token.slice(1)))
    .join(" ")
    .replace("(any)", "(Any)");
}

function slotLabel(count: number) {
  return `${count} slot${count === 1 ? "" : "s"} missing`;
}

function ingredientSummary(tokens: string[] | undefined, fallback: string) {
  const orderedTokens = (tokens ?? []).map((token) => token.trim()).filter(Boolean);
  return orderedTokens.length ? orderedTokens.join(", ") : fallback;
}

function recipeSummary(row: RecipeResult) {
  return ingredientSummary(row.ingredient_list, row.ingredients);
}

function effectSummary(row: RecipeResult) {
  return row.effects?.trim() || "";
}

export function BestDirectCards({
  rows,
  emptyMessage = "There are no direct craft picks for the current filters.",
}: {
  rows: RecipeResult[];
  emptyMessage?: string;
}) {
  if (!rows.length) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="result-card-list">
      {rows.map((row) => (
        <article key={`${row.result}-${row.station}-${row.ingredients}`} className="result-card">
          <div className="result-card-grid">
            <div className="result-card-content result-card-content--compact">
              <div className="result-card-topline">
                <div className="result-card-header-cluster">
                  <div className="result-card-title-block">
                    <h3>{row.result}</h3>
                  </div>
                  <div className="result-card-meta result-card-meta--inline">
                    <span className="result-card-pill">{row.station}</span>
                    <span className="result-card-pill">Crafts {row.max_crafts}</span>
                    <span className="result-card-pill">Total {row.max_total_output}</span>
                  </div>
                </div>
                <div className="result-card-side">
                  <div className="score-badge" title="Real smart-score ranking">
                    {formatScore(row.smart_score)}
                  </div>
                </div>
              </div>
              <div className="result-card-detail-grid">
                <div className="result-card-detail">
                  <span className="result-card-detail-label">Recipe</span>
                  <strong className="result-card-detail-value" title={recipeSummary(row)}>
                    {recipeSummary(row)}
                  </strong>
                </div>
                <div className="result-card-detail">
                  <span className="result-card-detail-label">Buffs</span>
                  <span
                    className="result-card-detail-value result-card-detail-note"
                    title={effectSummary(row) || "No buffs"}
                  >
                    {effectSummary(row) || "No buffs"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function CraftResultsTable({
  rows,
  columnVisibility,
  emptyMessage = "You can't craft anything directly with the current inventory and station filters.",
}: {
  rows: RecipeResult[];
  columnVisibility: CraftResultsColumnVisibility;
  emptyMessage?: string;
}) {
  if (!rows.length) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="table-shell craft-table-shell">
      <table className="data-table craft-table">
        <thead>
          <tr>
            <th className="cell-result">Result</th>
            <th className="cell-recipe">Recipe</th>
            <th className="cell-buffs">Buffs</th>
            <th className="cell-score">Smart score</th>
            <th className="cell-station">Station</th>
            {columnVisibility.perCraft ? <th className="cell-numeric">Per craft</th> : null}
            {columnVisibility.craftsPossible ? <th className="cell-numeric">Crafts possible</th> : null}
            {columnVisibility.totalMade ? <th className="cell-numeric">Total made</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.result}-${row.station}-${row.ingredients}`}>
              <td className="cell-result">
                <div className="table-result-name">{row.result}</div>
              </td>
              <td className="cell-recipe">
                <span className="table-clamp" title={recipeSummary(row)}>
                  {recipeSummary(row)}
                </span>
              </td>
              <td className="cell-buffs">
                <span className="table-clamp" title={effectSummary(row) || "None"}>
                  {effectSummary(row) || "None"}
                </span>
              </td>
              <td className="cell-score">{formatScore(row.smart_score)}</td>
              <td className="cell-station">{row.station}</td>
              {columnVisibility.perCraft ? <td className="cell-numeric">{row.result_qty_per_craft}</td> : null}
              {columnVisibility.craftsPossible ? <td className="cell-numeric">{row.max_crafts}</td> : null}
              {columnVisibility.totalMade ? <td className="cell-numeric">{row.max_total_output}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function NearCraftTable({
  rows,
  emptyMessage = "Nothing falls inside the current near-craft threshold.",
  compact = false,
}: {
  rows: RecipeResult[];
  emptyMessage?: string;
  compact?: boolean;
}) {
  if (!rows.length) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  if (compact) {
    return (
      <div className="near-card-list">
        {rows.map((row) => (
          <article key={`${row.result}-${row.station}-${row.ingredients}`} className="near-card">
            <div className="near-card-grid">
              <div className="near-card-content near-card-content--compact">
                <div className="near-card-topline">
                  <div className="result-card-header-cluster">
                    <div className="near-card-title-block">
                      <h3>{row.result}</h3>
                    </div>
                    <div className="result-card-meta result-card-meta--inline">
                      <span className="result-card-pill">{row.station}</span>
                      <span className="result-card-pill">{slotLabel(row.missing_slots)}</span>
                    </div>
                  </div>
                  <div className="near-card-side">
                    <span className="near-pill">Missing</span>
                  </div>
                </div>
                <div className="near-card-detail">
                  <span className="near-card-detail-label">Recipe</span>
                  <span className="result-card-detail-value" title={recipeSummary(row)}>
                    {recipeSummary(row)}
                  </span>
                </div>
                <div className="near-card-detail">
                  <span className="near-card-detail-label">Still missing</span>
                  <div className="missing-summary">{row.missing_items || "Nothing listed"}</div>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className={classNames("table-shell", "near-table-shell")}>
      <table className="data-table near-table">
        <thead>
          <tr>
            <th>Recipe</th>
            <th>Still missing</th>
            <th>Station</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.result}-${row.station}-${row.ingredients}`}>
              <td>
                <div className="near-result-name">{row.result}</div>
                <div className="table-note">{ingredientSummary(row.ingredient_list, row.ingredients)}</div>
              </td>
              <td>
                <div className="missing-summary">{row.missing_items || "Nothing listed"}</div>
                <div className="table-note">{slotLabel(row.missing_slots)}</div>
              </td>
              <td>{row.station}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InventoryList({
  title,
  items,
  emptyMessage,
}: {
  title: string;
  items: InventoryItem[];
  emptyMessage: string;
}) {
  return (
    <Panel title={title} className="sub-panel">
      <div className="mini-table">
        {items.length ? (
          items.map((item) => (
            <div key={item.item}>
              {item.item} x{item.qty}
            </div>
          ))
        ) : (
          <div>{emptyMessage}</div>
        )}
      </div>
    </Panel>
  );
}

export function DatabaseTable({
  rows,
}: {
  rows: RecipeDatabaseRecord[];
}) {
  if (!rows.length) {
    return <div className="empty-state">No recipes match the current database filters.</div>;
  }

  return (
    <div className="table-shell recipe-database-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>Result</th>
            <th>Qty</th>
            <th>Station</th>
            <th>Ingredients</th>
            <th>Effects</th>
            <th>Category</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((recipe) => (
            <tr key={`${recipe.recipe_id}-${recipe.result}-${recipe.station}`}>
              <td>{recipe.result}</td>
              <td>{recipe.result_qty}</td>
              <td>{recipe.station}</td>
              <td>{ingredientSummary(recipe.ingredient_list, recipe.ingredients)}</td>
              <td>{recipe.effects}</td>
              <td>{recipe.category || "Uncategorized"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IngredientGroupsTable({
  groups,
}: {
  groups: IngredientGroup[];
}) {
  if (!groups.length) {
    return <div className="empty-state">No ingredient groups were loaded.</div>;
  }

  return (
    <div className="table-shell secondary-table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Members</th>
            <th>Count</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.group}>
              <td>{displayGroupName(group.group)}</td>
              <td>{group.members.join(", ")}</td>
              <td>{group.member_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ItemStatsTable({
  rows,
}: {
  rows: ItemStat[];
}) {
  if (!rows.length) {
    return <div className="empty-state">No item metadata matches the current search.</div>;
  }

  return (
    <div className="table-shell secondary-table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Category</th>
            <th>Heal</th>
            <th>Stamina</th>
            <th>Mana</th>
            <th>Weight</th>
            <th>Sale</th>
            <th>Buy</th>
            <th>Effects</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.item}>
              <td>{row.item}</td>
              <td>{row.category || "Uncategorized"}</td>
              <td>{row.heal}</td>
              <td>{row.stamina}</td>
              <td>{row.mana}</td>
              <td>{row.weight}</td>
              <td>{row.sale_value}</td>
              <td>{row.buy_value}</td>
              <td>{row.effects}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
