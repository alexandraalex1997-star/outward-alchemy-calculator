import { useState } from "react";
import type { ReactNode } from "react";

import type { DirectResponse, NearResponse } from "../types";
import {
  BestDirectCards,
  CraftResultsTable,
  type CraftResultsColumnVisibility,
  type CraftResultsOptionalColumnId,
  NearCraftTable,
} from "./data-views";
import { StatCard, classNames } from "./ui";
type RightRailSectionId = "best" | "full" | "near";

const CRAFT_RESULTS_OPTIONAL_COLUMNS: { id: CraftResultsOptionalColumnId; label: string }[] = [
  { id: "perCraft", label: "Per craft" },
  { id: "craftsPossible", label: "Crafts possible" },
  { id: "totalMade", label: "Total made" },
];

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
  const [openSections, setOpenSections] = useState<Record<RightRailSectionId, boolean>>({
    best: true,
    full: true,
    near: false,
  });
  const [craftTableColumns, setCraftTableColumns] = useState<CraftResultsColumnVisibility>({
    perCraft: false,
    craftsPossible: false,
    totalMade: false,
  });

  const toggleSection = (sectionId: RightRailSectionId) => {
    setOpenSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  };

  const toggleCraftTableColumn = (columnId: CraftResultsOptionalColumnId) => {
    setCraftTableColumns((current) => ({
      ...current,
      [columnId]: !current[columnId],
    }));
  };

  return (
    <aside className="results-rail right-column">
      <ResultsAccordionCard
        title="Best direct options"
        description="Best things you can make right now from your current bag and stations."
        open={openSections.best}
        onToggle={() => toggleSection("best")}
      >
        <div className="stat-grid two-up compact-grid">
          <StatCard label="Can make now" value={bestDirect?.count ?? 0} />
          <StatCard label="Almost ready" value={bestDirect?.near_count ?? 0} />
        </div>
        <div className="results-preview">
          <BestDirectCards rows={bestDirect?.items ?? []} />
        </div>
      </ResultsAccordionCard>

      {activeSection === "Craft now" ? (
        <ResultsAccordionCard
          title="Full craftable list"
          description="Everything you can make right now with your current inventory and station filters."
          open={openSections.full}
          onToggle={() => toggleSection("full")}
        >
          <div className="result-panel-stack">
            <div className="info-strip compact-info-strip">
              {craftNow?.count ?? 0} recipe{craftNow?.count === 1 ? "" : "s"} ready to craft right now.
            </div>
            <div className="craft-table-controls">
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
              <div className="craft-column-picker">
                <span className="toolbar-label">Optional columns</span>
                <div className="chip-group compact-chip-group">
                  {CRAFT_RESULTS_OPTIONAL_COLUMNS.map((column) => (
                    <button
                      key={column.id}
                      type="button"
                      className={classNames("chip", "table-option-chip", craftTableColumns[column.id] && "active")}
                      onClick={() => toggleCraftTableColumn(column.id)}
                    >
                      {column.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <CraftResultsTable rows={craftNow?.items ?? []} columnVisibility={craftTableColumns} />
        </ResultsAccordionCard>
      ) : null}

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
