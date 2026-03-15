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

function recipeSummary(row: RecipeResult) {
  return ingredientSummary(row.ingredient_list, row.ingredients);
}

function utilityNote(row: RecipeResult) {
  if (row.effects) return row.effects;
  if (row.category) return row.category;
  return "";
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
            <div className="result-card-main">
              <div className="result-card-header">
                <div className="result-card-title-block">
                  <h3>{row.result}</h3>
                  <p>{row.station}</p>
                </div>
                <div className="score-badge" title="Real smart-score ranking">
                  {formatScore(row.smart_score)}
                </div>
              </div>
              <div className="result-card-meta">
                <span>Crafts possible {row.max_crafts}</span>
                <span>Total made {row.max_total_output}</span>
              </div>
              <div className="result-card-recipe">
                <span>Recipe</span>
                <strong>{recipeSummary(row)}</strong>
              </div>
              {utilityNote(row) ? <p className="result-card-note">{utilityNote(row)}</p> : null}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function CraftResultsTable({
  rows,
  emptyMessage = "You can't craft anything directly with the current inventory and station filters.",
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
            <th>Smart score</th>
            <th>Crafts possible</th>
            <th>Total made</th>
            <th>Station</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.result}-${row.station}-${row.ingredients}`}>
              <td>
                <div className="table-result-name">{row.result}</div>
                <div className="table-note">
                  <strong>Recipe:</strong> {recipeSummary(row)}
                </div>
                {utilityNote(row) ? <div className="table-note">{utilityNote(row)}</div> : null}
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
            <div className="near-card-grid">
              <div className="near-card-main">
                <div className="near-card-header">
                  <div className="near-card-title-block">
                    <h3>{row.result}</h3>
                    <p>{row.station}</p>
                  </div>
                  <span className="near-pill">{slotLabel(row.missing_slots)}</span>
                </div>
                <div className="near-card-blocker-label">Still missing</div>
                <div className="missing-summary">{row.missing_items || "Nothing listed"}</div>
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
