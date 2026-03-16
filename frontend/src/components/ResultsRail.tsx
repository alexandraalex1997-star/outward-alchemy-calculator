import { useState } from "react";
import type { ReactNode } from "react";

import type { DirectResponse, NearResponse } from "../types";
import {
  BestDirectCards,
  NearCraftTable,
} from "./data-views";
import { StatCard, classNames } from "./ui";
type RightRailSectionId = "craftable" | "near";

function ResultsAccordionCard({
  title,
  description,
  open,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={classNames("panel", "rail-card", "accordion-item", open && "is-open")}>
      <button
        type="button"
        className="accordion-trigger"
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
        title={`${open ? "Collapse" : "Expand"} ${title}`}
        onClick={onToggle}
      >
        <span className="accordion-trigger-copy">
          <span className="accordion-title">{title}</span>
          <span className="accordion-description">{description}</span>
        </span>
        <span className={classNames("accordion-icon", open && "open")}>v</span>
      </button>

      {open ? (
        <div className="accordion-panel">
          <div className="rail-card__body">{children}</div>
        </div>
      ) : null}
    </section>
  );
}

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
      <ResultsAccordionCard
        title="Craftable recipes"
        description="Every craftable recipe row you can make right now. Sorting changes order, not inclusion."
        open={openSections.craftable}
        onToggle={() => toggleSection("craftable")}
      >
        <div className="result-panel-stack">
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
        </div>
        <div className="results-preview results-preview--craftable">
          <BestDirectCards
            rows={craftNow?.items ?? []}
            emptyMessage="You can't craft anything directly with the current inventory and station filters."
          />
        </div>
      </ResultsAccordionCard>

      <ResultsAccordionCard
        title="Almost craftable"
        description="Recipes you're closest to finishing with the current inventory and filters."
        open={openSections.near}
        onToggle={() => toggleSection("near")}
      >
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
      </ResultsAccordionCard>
    </aside>
  );
}
