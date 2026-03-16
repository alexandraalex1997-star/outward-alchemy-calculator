import type { ChangeEvent } from "react";

import type { MetadataResponse, Snapshot } from "../types";
import { Panel, SnapshotMetric, classNames } from "./ui";

type RailSectionId = "snapshot" | "planning" | "bulk" | "data";

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
  importStatus,
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
  importStatus: {
    tone: "idle" | "success" | "error";
    title: string;
    detail: string;
    lastLoadedSource: string;
    lastAttemptedSource: string | null;
  };
  onBulkFile: (file: File | null) => void;
}) {
  return (
    <aside className="utility-rail left-column">
      <div className="utility-rail__header">
        <button
          className="rail-toggle"
          type="button"
          onClick={onToggleRail}
          aria-label={leftCollapsed ? "Expand utility rail" : "Collapse utility rail"}
          title={leftCollapsed ? "Expand support rail" : "Collapse support rail"}
        >
          {leftCollapsed ? ">" : "<"}
        </button>
      </div>

      {!leftCollapsed ? (
        <div className="utility-rail__scroll">
          <Panel
            title="Snapshot"
            description="Live status summary."
            className="panel-section accordion-item"
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
                <span className="snapshot-tile-label">Craftable rows</span>
                <strong className="snapshot-tile-value">{snapshot?.direct_crafts ?? 0}</strong>
              </div>
              <div className="snapshot-tile">
                <span className="snapshot-tile-label">Near rows</span>
                <strong className="snapshot-tile-value">{snapshot?.near_crafts ?? 0}</strong>
              </div>
            </div>
            <div className="snapshot-inline-grid">
              <SnapshotMetric label="Top healing" value={snapshot?.best_heal ?? null} />
              <SnapshotMetric label="Top stamina" value={snapshot?.best_stamina ?? null} />
              <SnapshotMetric label="Top mana" value={snapshot?.best_mana ?? null} />
            </div>
          </Panel>

          <Panel
            title="Planning tools"
            description="What changes your results."
            className="panel-section accordion-item"
            collapsible
            collapsed={!railSections.planning}
            onToggle={() => onToggleSection("planning")}
          >
            <div className="planning-tools-layout">
              <section className="planning-group planning-group--stations">
                <div className="planning-group-head">
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
              </section>

              <section className="planning-group planning-group--ranges">
                <div className="planning-group-head planning-group-head--range">
                  <span>Planner controls</span>
                  <small>Route depth and missing slots update results live.</small>
                </div>
                <div className="planning-range-grid">
                  <label className="compact-range-control">
                    <div className="compact-range-head">
                      <span>Route depth</span>
                      <strong className="compact-range-value">{plannerDepth}</strong>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={8}
                      value={plannerDepth}
                      onChange={(event) => onPlannerDepthChange(Number(event.target.value))}
                    />
                  </label>

                  <label className="compact-range-control">
                    <div className="compact-range-head">
                      <span>Missing slots</span>
                      <strong className="compact-range-value">{nearThreshold}</strong>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={4}
                      value={nearThreshold}
                      onChange={(event) => onNearThresholdChange(Number(event.target.value))}
                    />
                  </label>
                </div>
              </section>
              <small className="planning-range-note">Route depth affects planner recursion. Missing slots affects Almost craftable.</small>
            </div>
          </Panel>

          <Panel
            title="Inventory sync"
            description="Best flow: open a mod sync link from the game. Fallback: upload a file yourself."
            className="panel-section accordion-item"
            collapsible
            collapsed={!railSections.bulk}
            onToggle={() => onToggleSection("bulk")}
          >
            <div className="upload-stack sync-stack">
              <div className="sync-callout">
                <span className="sync-recommendation">Recommended</span>
                <p className="sync-helper">Open the browser link from the Outward mod to load inventory automatically in this tab.</p>
              </div>

              <div className={classNames("sync-status-card", `is-${importStatus.tone}`)} aria-live="polite">
                <div className="sync-status-head">
                  <strong>{importStatus.title}</strong>
                  <span className={classNames("sync-status-badge", `is-${importStatus.tone}`)}>
                    {importStatus.tone === "success" ? "Success" : importStatus.tone === "error" ? "Needs attention" : "Ready"}
                  </span>
                </div>
                <p>{importStatus.detail}</p>
                <div className="sync-status-meta">
                  <span>Current source: {importStatus.lastLoadedSource}</span>
                  <span>Last attempt: {importStatus.lastAttemptedSource ?? "None yet"}</span>
                </div>
              </div>

              <div className="sync-fallback">
                <span className="sync-fallback-label">Manual fallback</span>
                <label className="button subtle file-button bulk-upload-button sync-secondary-button">
                  Upload CSV / Excel
                  <input
                    type="file"
                    accept=".csv,.xlsx"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => onBulkFile(event.target.files?.[0] ?? null)}
                    />
                </label>
                <small className="field-note">Use this if the mod did not open the app with a sync link or you want to import a file manually.</small>
              </div>
            </div>
          </Panel>

          <Panel
            title="Data details"
            className="panel-section accordion-item"
            collapsible
            collapsed={!railSections.data}
            onToggle={() => onToggleSection("data")}
          >
            <div className="rail-data-grid">
              <SnapshotMetric label="Recipes" value={metadata?.recipe_count ?? 0} />
              <SnapshotMetric label="Categories" value={metadata?.categories.length ?? 0} />
              <SnapshotMetric label="Groups" value={metadata?.ingredient_groups.length ?? 0} />
              <SnapshotMetric label="Stations" value={metadata?.stations.length ?? 0} />
            </div>
          </Panel>
        </div>
      ) : (
        <div className="utility-rail__scroll utility-rail__scroll--collapsed">
          <div className="rail-peek" aria-hidden="true">
            <span>Tools</span>
          </div>
        </div>
      )}
    </aside>
  );
}
