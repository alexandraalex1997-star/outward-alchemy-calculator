import { useMemo, useState } from "react";

import type { DirectResponse, NearResponse } from "../types";
import { BestDirectCards, CraftResultsTable, NearCraftTable } from "./data-views";
import { Panel, StatCard, classNames } from "./ui";

const BEST_DIRECT_PREVIEW = 5;
const NEAR_PREVIEW = 6;

function previewLabel(total: number, shown: number) {
  const remaining = Math.max(total - shown, 0);
  return remaining > 0 ? `Show ${remaining} more` : "Show more";
}

export function ResultsRail({
  activeSection,
  bestDirect,
  craftNow,
  near,
  sortMode,
  sortModes,
  onSortModeChange,
}: {
  activeSection: string;
  bestDirect: DirectResponse | null;
  craftNow: DirectResponse | null;
  near: NearResponse | null;
  sortMode: string;
  sortModes: readonly string[];
  onSortModeChange: (value: string) => void;
}) {
  const [bestExpanded, setBestExpanded] = useState(false);
  const [nearExpanded, setNearExpanded] = useState(false);

  const bestRows = useMemo(() => {
    const rows = bestDirect?.items ?? [];
    return bestExpanded ? rows : rows.slice(0, BEST_DIRECT_PREVIEW);
  }, [bestDirect?.items, bestExpanded]);

  const nearRows = useMemo(() => {
    const rows = near?.items ?? [];
    return nearExpanded ? rows : rows.slice(0, NEAR_PREVIEW);
  }, [near?.items, nearExpanded]);

  return (
    <aside className="results-rail">
      <Panel title="Best direct options" description="Best things you can make right now from your current bag and stations.">
        <div className="stat-grid two-up compact-grid">
          <StatCard label="Can make now" value={bestDirect?.count ?? 0} />
          <StatCard label="Almost ready" value={bestDirect?.near_count ?? 0} />
        </div>
        <div className={classNames("results-preview", bestExpanded && "expanded")}>
          <BestDirectCards rows={bestRows} />
        </div>
        {(bestDirect?.items.length ?? 0) > BEST_DIRECT_PREVIEW ? (
          <button type="button" className="results-toggle button subtle" onClick={() => setBestExpanded((value) => !value)}>
            {bestExpanded ? "Show less" : previewLabel(bestDirect?.items.length ?? 0, BEST_DIRECT_PREVIEW)}
          </button>
        ) : null}
      </Panel>

      {activeSection === "Craft now" ? (
        <Panel title="Full craftable list" description="Everything you can make right now with your current inventory and station filters.">
          <div className="result-panel-stack">
            <div className="info-strip compact-info-strip">
              {craftNow?.count ?? 0} recipe{craftNow?.count === 1 ? "" : "s"} ready to craft right now.
            </div>
            <label className="panel-select panel-select-compact">
              <span>Sort full list</span>
              <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value)}>
                {sortModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <CraftResultsTable rows={craftNow?.items ?? []} />
        </Panel>
      ) : null}

      <Panel title="Almost craftable" description="Recipes you're closest to finishing with the current inventory and filters.">
        <div className="stat-grid two-up compact-grid">
          <StatCard label="Almost ready" value={near?.count ?? 0} />
          <StatCard label="Recipes checked" value={near?.known_recipes ?? 0} />
        </div>
        <div className={classNames("results-preview", nearExpanded && "expanded")}>
          <NearCraftTable
            compact
            rows={nearRows}
            emptyMessage="No recipes are currently inside the selected near-craft threshold."
          />
        </div>
        {(near?.items.length ?? 0) > NEAR_PREVIEW ? (
          <button type="button" className="results-toggle button subtle" onClick={() => setNearExpanded((value) => !value)}>
            {nearExpanded ? "Show less" : previewLabel(near?.items.length ?? 0, NEAR_PREVIEW)}
          </button>
        ) : null}
      </Panel>
    </aside>
  );
}
