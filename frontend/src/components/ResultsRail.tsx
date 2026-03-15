import type { DirectResponse, NearResponse } from "../types";
import { BestDirectCards, CraftResultsTable, NearCraftTable } from "./data-views";
import { Panel, StatCard } from "./ui";

export function ResultsRail({
  activeSection,
  bestDirect,
  craftNow,
  near,
  sortMode,
  onSortModeChange,
  sortOptions,
}: {
  activeSection: string;
  bestDirect: DirectResponse | null;
  craftNow: DirectResponse | null;
  near: NearResponse | null;
  sortMode: string;
  onSortModeChange: (value: string) => void;
  sortOptions: readonly string[];
}) {
  return (
    <aside className="results-rail">
      <Panel title="Best direct options" description="Live shortlist from the current stations and ranking.">
        <div className="stat-grid two-up compact-grid">
          <StatCard label="Direct crafts" value={bestDirect?.count ?? 0} />
          <StatCard label="Near crafts" value={bestDirect?.near_count ?? 0} />
        </div>
        <BestDirectCards rows={bestDirect?.items ?? []} />
      </Panel>

      {activeSection === "Craft now" ? (
        <Panel
          title="Full craftable list"
          description="Every direct craft from the current inventory, sorted by the live ranking."
          headerAside={
            <label className="panel-select panel-select-compact">
              <span>Sort</span>
              <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value)}>
                {sortOptions.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </label>
          }
        >
          <div className="stat-grid two-up compact-grid">
            <StatCard label="Craftable recipes" value={craftNow?.count ?? 0} />
            <StatCard label="Top pick" value={bestDirect?.items?.[0]?.result ?? null} />
          </div>
          <CraftResultsTable rows={craftNow?.items ?? []} />
        </Panel>
      ) : null}

      <Panel title="Almost craftable" description="Closest valid recipes under the current threshold.">
        <div className="stat-grid two-up compact-grid">
          <StatCard label="Near crafts" value={near?.count ?? 0} />
          <StatCard label="Known recipes" value={near?.known_recipes ?? 0} />
        </div>
        <NearCraftTable
          compact
          rows={near?.items ?? []}
          emptyMessage="No recipes are currently inside the selected near-craft threshold."
        />
      </Panel>
    </aside>
  );
}
