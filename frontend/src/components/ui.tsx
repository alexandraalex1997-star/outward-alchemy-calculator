import type { ReactNode } from "react";

export function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function formatScore(value: number) {
  return value.toFixed(1);
}

export function Panel({
  title,
  description,
  children,
  className,
  collapsible = false,
  collapsed = false,
  onToggle,
  headerAside,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  headerAside?: ReactNode;
}) {
  return (
    <section className={classNames("panel", collapsible && "collapsible-panel", collapsed && "collapsed", className)}>
      <div className="panel-header-row">
        <header className="panel-header">
          <h2>{title}</h2>
          {description && !(collapsible && collapsed) ? <p>{description}</p> : null}
        </header>
        <div className="panel-header-actions">
          {headerAside}
          {collapsible ? (
            <button
              type="button"
              className="panel-toggle"
              onClick={onToggle}
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
              title={`${collapsed ? "Expand" : "Collapse"} ${title}`}
            >
              <span className={classNames("panel-toggle-icon", !collapsed && "open")}>v</span>
            </button>
          ) : null}
        </div>
      </div>
      {!collapsed ? children : null}
    </section>
  );
}

export function StatCard({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: string | number | null;
  detail?: string;
  className?: string;
}) {
  return (
    <div className={classNames("stat-card", className)}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value ?? "None"}</strong>
      {detail ? <span className="stat-detail">{detail}</span> : null}
    </div>
  );
}

export function SnapshotMetric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string | number | null;
  accent?: boolean;
}) {
  return (
    <div className={classNames("snapshot-metric", accent && "accent")}>
      <span>{label}</span>
      <strong>{value ?? "None"}</strong>
    </div>
  );
}
