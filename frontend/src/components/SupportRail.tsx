import type { ChangeEvent } from "react";

import type { MetadataResponse, Snapshot } from "../types";
import { Panel, SnapshotMetric, classNames } from "./ui";

type RailSectionId = "snapshot" | "planning" | "how" | "bulk" | "data";

export function SupportRail({
  leftCollapsed,
  onToggleRail,
  railSections,
  onToggleSection,
  snapshot,
  metadata,
  selectedStations,
  onToggleStation,
  plannerDepth,
  onPlannerDepthChange,
  nearThreshold,
  onNearThresholdChange,
  stationFilterNote,
  bulkText,
  onBulkTextChange,
  onImportText,
  onBulkFile,
}: {
  leftCollapsed: boolean;
  onToggleRail: () => void;
  railSections: Record<RailSectionId, boolean>;
  onToggleSection: (sectionId: RailSectionId) => void;
  snapshot: Snapshot | null;
  metadata: MetadataResponse | null;
  selectedStations: string[];
  onToggleStation: (station: string) => void;
  plannerDepth: number;
  onPlannerDepthChange: (value: number) => void;
  nearThreshold: number;
  onNearThresholdChange: (value: number) => void;
  stationFilterNote: string;
  bulkText: string;
  onBulkTextChange: (value: string) => void;
  onImportText: () => void;
  onBulkFile: (file: File | null) => void;
}) {
  return (
    <aside className="utility-rail">
      <button
        className="rail-toggle"
        type="button"
        onClick={onToggleRail}
        aria-label={leftCollapsed ? "Expand utility rail" : "Collapse utility rail"}
        title={leftCollapsed ? "Expand support rail" : "Collapse support rail"}
      >
        {leftCollapsed ? ">" : "<"}
      </button>

      {!leftCollapsed ? (
        <div className="rail-scroll">
          <Panel
            title="Snapshot"
            description="Live status summary."
            collapsible
            collapsed={!railSections.snapshot}
            onToggle={() => onToggleSection("snapshot")}
          >
            <div className="snapshot-grid">
              <div className="snapshot-tile">
                <span className="snapshot-tile-label">Inventory lines</span>
                <strong className="snapshot-tile-value">{snapshot?.inventory_lines ?? 0}</strong>
              </div>
              <div className="snapshot-tile">
                <span className="snapshot-tile-label">Known recipes</span>
                <strong className="snapshot-tile-value">{snapshot?.known_recipes ?? 0}</strong>
              </div>
              <div className="snapshot-tile accent">
                <span className="snapshot-tile-label">Direct crafts</span>
                <strong className="snapshot-tile-value">{snapshot?.direct_crafts ?? 0}</strong>
              </div>
              <div className="snapshot-tile">
                <span className="snapshot-tile-label">Near crafts</span>
                <strong className="snapshot-tile-value">{snapshot?.near_crafts ?? 0}</strong>
              </div>
            </div>
            <div className="snapshot-inline-grid">
              <SnapshotMetric label="Best heal" value={snapshot?.best_heal ?? null} />
              <SnapshotMetric label="Best stamina" value={snapshot?.best_stamina ?? null} />
              <SnapshotMetric label="Best mana" value={snapshot?.best_mana ?? null} />
            </div>
          </Panel>

          <Panel
            title="Planning tools"
            description="What changes your results."
            collapsible
            collapsed={!railSections.planning}
            onToggle={() => onToggleSection("planning")}
          >
            <div className="planning-stack">
              <label className="field">
                <div className="field-head">
                  <span>Stations</span>
                  <small>Craft, Near, Plan, Shop</small>
                </div>
                <div className="chip-group">
                  {metadata?.stations.map((station) => {
                    const active = selectedStations.includes(station);
                    return (
                      <button
                        key={station}
                        type="button"
                        className={classNames("chip", active && "active")}
                        onClick={() => onToggleStation(station)}
                      >
                        {station}
                      </button>
                    );
                  })}
                </div>
                <small className="field-note">{stationFilterNote}</small>
              </label>

              <label className="field">
                <div className="field-head">
                  <span>Planner depth</span>
                  <small>Planner recursion</small>
                </div>
                <input type="range" min={1} max={8} value={plannerDepth} onChange={(event) => onPlannerDepthChange(Number(event.target.value))} />
                <strong>{plannerDepth}</strong>
              </label>

              <label className="field">
                <div className="field-head">
                  <span>Near-craft threshold</span>
                  <small>Missing ingredients only</small>
                </div>
                <input
                  type="range"
                  min={1}
                  max={4}
                  value={nearThreshold}
                  onChange={(event) => onNearThresholdChange(Number(event.target.value))}
                />
                <strong>{nearThreshold} missing slot{nearThreshold === 1 ? "" : "s"}</strong>
              </label>
            </div>
          </Panel>

          <Panel title="How this works" collapsible collapsed={!railSections.how} onToggle={() => onToggleSection("how")}>
            <ul className="helper-list">
              <li>One live inventory powers every view.</li>
              <li>Filters and imports stay in sync.</li>
            </ul>
          </Panel>

          <Panel
            title="Bulk add inventory"
            description="Paste text or upload CSV / Excel."
            collapsible
            collapsed={!railSections.bulk}
            onToggle={() => onToggleSection("bulk")}
          >
            <textarea
              className="bulk-text compact-text"
              value={bulkText}
              onChange={(event) => onBulkTextChange(event.target.value)}
              placeholder={"Gravel Beetle,2\nClean Water,4"}
            />
            <div className="inline-actions">
              <button type="button" className="button subtle" onClick={onImportText}>
                Paste text
              </button>
              <label className="button subtle file-button">
                Upload CSV / Excel
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => onBulkFile(event.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          </Panel>

          <Panel title="Data details" collapsible collapsed={!railSections.data} onToggle={() => onToggleSection("data")}>
            <div className="rail-data-grid">
              <SnapshotMetric label="Recipes" value={metadata?.recipe_count ?? 0} />
              <SnapshotMetric label="Categories" value={metadata?.categories.length ?? 0} />
              <SnapshotMetric label="Groups" value={metadata?.ingredient_groups.length ?? 0} />
              <SnapshotMetric label="Stations" value={metadata?.stations.length ?? 0} />
            </div>
          </Panel>
        </div>
      ) : (
        <div className="rail-peek" aria-hidden="true">
          <span>Tools</span>
        </div>
      )}
    </aside>
  );
}
