import { useState } from "react";

import type { DirectResponse, NearResponse } from "../types";
import { BestDirectCards, NearCraftTable } from "./data-views";
import { Panel, StatCard, classNames } from "./ui";

export function ResultsRail({
  craftNow,
  near,
  sortMode,
  sortModes,
  onSortModeChange,
}: {
  craftNow: DirectResponse | null;
  near: NearResponse | null;
  sortMode: string;
  sortModes: readonly string[];
  onSortModeChange: (value: string) => void;
}) {
  const [isCraftableOpen, setIsCraftableOpen] = useState(true);
  const [isNearOpen, setIsNearOpen] = useState(true);

  const toggleCraftable = () => {
    setIsCraftableOpen(!isCraftableOpen);
  };

  const toggleNear = () => {
    setIsNearOpen(!isNearOpen);
  };

  return (
    <aside className="results-rail right-column">
      <Panel
        title="Craftable recipes"
        description="Every craftable recipe row you can make right now."
        collapsible
        collapsed={!isCraftableOpen}
        onToggle={toggleCraftable}
      >
        <div className="results-section-content">
          <div className="stat-grid two-up compact-grid">
            <StatCard label="Can make now" value={craftNow?.count ?? 0} />
            <StatCard label="Almost ready" value={craftNow?.near_count ?? 0} />
          </div>
          <div className="craftable-card-toolbar">
            <label className="panel-select panel-select-compact">
              <span>Sort craftable recipes</span>
              <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value)}>
                {sortModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </label>
            <div className="info-strip compact-info-strip">
              Showing all {craftNow?.count ?? 0} craftable recipe row{craftNow?.count === 1 ? "" : "s"} in {sortMode} order.
            </div>
          </div>
          <div className="results-preview results-preview--craftable">
            <BestDirectCards
              rows={craftNow?.items ?? []}
              emptyMessage="You can't craft anything directly with the current inventory and station filters."
            />
          </div>
        </div>
      </Panel>
      <Panel
        title="Almost craftable"
        description="Recipes you're closest to finishing with the current inventory and filters."
        collapsible
        collapsed={!isNearOpen}
        onToggle={toggleNear}
      >
        <div className="results-section-content">
          <div className="stat-grid two-up compact-grid">
            <StatCard label="Almost ready" value={near?.count ?? 0} />
            <StatCard label="Recipes checked" value={near?.known_recipes ?? 0} />
          </div>
          <div className="info-strip compact-info-strip">
            Showing all {near?.count ?? 0} almost craftable recipe row{near?.count === 1 ? "" : "s"} in {sortMode} order.
          </div>
          <div className="results-preview results-preview--near">
            <NearCraftTable
              compact
              rows={near?.items ?? []}
              emptyMessage="No recipes are currently available."
            />
          </div>
        </div>
      </Panel>
    </aside>
  );
}