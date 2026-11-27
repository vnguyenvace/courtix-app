import type { SessionOverview } from "@/lib/types";
import type { T } from "@/lib/i18n";

const same: T = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s);

export function levelText(min: number | null, max: number | null, t: T = same) {
  if (min === null && max === null) return t("All levels");
  if (min !== null && max !== null) return t("Level {min}–{max}", { min, max });
  if (min !== null) return t("Level {min}+", { min });
  return t("Up to level {max}", { max: max ?? "" });
}

/** Status of a session: cancelled, confirmed, needs players, full. */
export function SessionStatusBadge({ s, t = same }: { s: SessionOverview; t?: T }) {
  if (s.status === "cancelled") return <span className="badge danger">{t("Cancelled")}</span>;
  if (s.spots_left === 0) return <span className="badge info">{t("Full")}{s.waitlisted ? ` · ${t("{n} waiting", { n: s.waitlisted })}` : ""}</span>;
  if (s.status === "confirmed") return <span className="badge ok">{t("Confirmed")}</span>;
  if (!s.min_reached) return <span className="badge warn">{t("Needs {n} more", { n: s.min_players - s.booked })}</span>;
  return <span className="badge ok">{t("On")}</span>;
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
