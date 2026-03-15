import type {
  IngredientGroup,
  InventoryItem,
  ItemStat,
  RecipeDatabaseRecord,
  RecipeResult,
} from "../types";
import { Panel, classNames, formatScore } from "./ui";

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

function utilityNote(row: RecipeResult) {
  if (row.effects) return row.effects;
  if (row.category) return row.category;
  return ingredientSummary(row.ingredient_list, row.ingredients);
}

export function BestDirectCards({
  rows,
  emptyMessage = "No direct recommendations are available for the current filters.",
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
          <div className="result-card-header">
            <div>
              <h3>{row.result}</h3>
              <p>{row.station}</p>
            </div>
            <div className="score-badge" title="Real smart-score ranking">
              {formatScore(row.smart_score)}
            </div>
          </div>
          <div className="result-card-meta">
            <span>Yield {row.max_total_output}</span>
            <span>{row.max_crafts} craftable</span>
          </div>
          <p className="result-card-note">{utilityNote(row)}</p>
        </article>
      ))}
    </div>
  );
}

export function CraftResultsTable({
  rows,
  emptyMessage = "No recipes are directly craftable with the current inventory and station filters.",
}: {
  rows: RecipeResult[];
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
            <th>Result</th>
            <th>Score</th>
            <th>Crafts</th>
            <th>Yield</th>
            <th>Station</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.result}-${row.station}-${row.ingredients}`}>
              <td>
                <div className="table-result-name">{row.result}</div>
                <div className="table-note">{utilityNote(row)}</div>
              </td>
              <td>{formatScore(row.smart_score)}</td>
              <td>{row.max_crafts}</td>
              <td>{row.max_total_output}</td>
              <td>{row.station}</td>
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
            <div className="near-card-header">
              <div>
                <h3>{row.result}</h3>
                <p>{row.station}</p>
              </div>
              <span className="near-pill">{slotLabel(row.missing_slots)}</span>
            </div>
            <div className="near-card-blocker-label">Still missing</div>
            <div className="missing-summary">{row.missing_items || "Nothing listed"}</div>
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
            <th>Sale</th>
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
              <td>{row.sale_value}</td>
              <td>{row.effects}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
