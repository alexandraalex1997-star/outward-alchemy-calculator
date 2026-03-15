import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { DirectResponse, NearResponse } from "../types";
import { BestDirectCards, CraftResultsTable, NearCraftTable } from "./data-views";
import { StatCard, classNames } from "./ui";

const BEST_DIRECT_PREVIEW = 5;
const NEAR_PREVIEW = 6;
type RightRailSectionId = "best" | "full" | "near";

function previewLabel(total: number, shown: number) {
  const remaining = Math.max(total - shown, 0);
  return remaining > 0 ? `Show ${remaining} more` : "Show more";
}

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
  const [bestExpanded, setBestExpanded] = useState(false);
  const [nearExpanded, setNearExpanded] = useState(false);
  const [openSections, setOpenSections] = useState<Record<RightRailSectionId, boolean>>({
    best: true,
    full: true,
    near: true,
  });

  const bestRows = useMemo(() => {
    const rows = bestDirect?.items ?? [];
    return bestExpanded ? rows : rows.slice(0, BEST_DIRECT_PREVIEW);
  }, [bestDirect?.items, bestExpanded]);

  const nearRows = useMemo(() => {
    const rows = near?.items ?? [];
    return nearExpanded ? rows : rows.slice(0, NEAR_PREVIEW);
  }, [near?.items, nearExpanded]);

  const toggleSection = (sectionId: RightRailSectionId) => {
    setOpenSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
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
        <div className={classNames("results-preview", bestExpanded && "expanded")}>
          <BestDirectCards rows={bestRows} />
        </div>
        {(bestDirect?.items.length ?? 0) > BEST_DIRECT_PREVIEW ? (
          <button type="button" className="results-toggle button subtle" onClick={() => setBestExpanded((value) => !value)}>
            {bestExpanded ? "Show less" : previewLabel(bestDirect?.items.length ?? 0, BEST_DIRECT_PREVIEW)}
          </button>
        ) : null}
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
      </ResultsAccordionCard>
    </aside>
  );
}
