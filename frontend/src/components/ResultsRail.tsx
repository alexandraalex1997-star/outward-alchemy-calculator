import { useState } from "react";

import type { DirectResponse, NearResponse } from "../types";
import { BestDirectCards, NearCraftTable } from "./data-views";
import { Panel, StatCard, classNames } from "./ui";

type RightRailSectionId = "craftable" | "near";

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
  const [openSections, setOpenSections] = useState<Record<RightRailSectionId, boolean>>({
    craftable: true,
    near: true,
  });

  const toggleSection = (sectionId: RightRailSectionId) => {
    setOpenSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  };

  return (
    <aside className="results-rail right-column">
      <Panel
        title="Craftable overview"
        description="Craftable recipes and almost-craftable recipes in one right-rail workspace."
        className="results-workspace"
      >
        <div className="results-workspace-body">
          <section
            className={classNames(
              "results-workspace-section",
              "results-workspace-section--craftable",
              !openSections.craftable && "is-collapsed",
            )}
          >
            <div className="results-section-head">
              <div className="results-section-copy">
                <h3>Craftable recipes</h3>
                <p>Every craftable recipe row you can make right now. Sorting changes order, not inclusion.</p>
              </div>
              <button
                type="button"
                className="results-section-toggle"
                aria-expanded={openSections.craftable}
                aria-label={`${openSections.craftable ? "Collapse" : "Expand"} Craftable recipes`}
                onClick={() => toggleSection("craftable")}
              >
                {openSections.craftable ? "v" : "^"}
              </button>
            </div>
            {openSections.craftable ? (
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
            ) : null}
          </section>

          <section
            className={classNames(
              "results-workspace-section",
              "results-workspace-section--near",
              !openSections.near && "is-collapsed",
            )}
          >
            <div className="results-section-head">
              <div className="results-section-copy">
                <h3>Almost craftable</h3>
                <p>Recipes you're closest to finishing with the current inventory and filters.</p>
              </div>
              <button
                type="button"
                className="results-section-toggle"
                aria-expanded={openSections.near}
                aria-label={`${openSections.near ? "Collapse" : "Expand"} Almost craftable`}
                onClick={() => toggleSection("near")}
              >
                {openSections.near ? "v" : "^"}
              </button>
            </div>
            {openSections.near ? (
              <div className="results-section-content">
                <div className="stat-grid two-up compact-grid">
                  <StatCard label="Almost ready" value={near?.count ?? 0} />
                  <StatCard label="Recipes checked" value={near?.known_recipes ?? 0} />
                </div>
                <div className="results-preview">
                  <NearCraftTable
                    compact
                    rows={near?.items ?? []}
                    emptyMessage="No recipes are currently inside the selected near-craft threshold."
                  />
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </Panel>
    </aside>
  );
}
