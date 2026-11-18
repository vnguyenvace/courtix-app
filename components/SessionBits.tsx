import type { SessionOverview } from "@/lib/types";

export function levelText(min: number | null, max: number | null) {
  if (min === null && max === null) return "All levels";
  if (min !== null && max !== null) return `Level ${min}–${max}`;
  if (min !== null) return `Level ${min}+`;
  return `Up to level ${max}`;
}

/** Status of a session: cancelled, confirmed, needs players, full. */
export function SessionStatusBadge({ s }: { s: SessionOverview }) {
  if (s.status === "cancelled") return <span className="badge danger">Cancelled</span>;
  if (s.spots_left === 0) return <span className="badge info">Full{s.waitlisted ? ` · ${s.waitlisted} waiting` : ""}</span>;
  if (s.status === "confirmed") return <span className="badge ok">Confirmed</span>;
  if (!s.min_reached) return <span className="badge warn">Needs {s.min_players - s.booked} more</span>;
  return <span className="badge ok">On</span>;
}

/** "5 / 16" with a thin fill bar. */
export function Spots({ s }: { s: SessionOverview }) {
  const pct = Math.min(100, Math.round((s.booked / Math.max(1, s.max_players)) * 100));
  return (
    <span style={{ display: "inline-grid", gap: 3, minWidth: 70 }}>
      <span className="small">
        {s.booked} / {s.max_players}
      </span>
      <span style={{ height: 4, borderRadius: 2, background: "var(--surface-2)", overflow: "hidden" }}>
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${pct}%`,
            background: s.min_reached ? "var(--accent)" : "var(--warning)",
          }}
        />
      </span>
    </span>
  );
}
