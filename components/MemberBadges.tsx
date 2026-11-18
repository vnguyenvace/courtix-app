import type { MemberStatus } from "@/lib/types";

export function MemberBadges({ s }: { s: MemberStatus }) {
  return (
    <span className="actions">
      {s.membership_status === "active" && <span className="badge ok">Active</span>}
      {s.membership_status === "paused" && <span className="badge info">Paused</span>}
      {!s.membership_status && !s.is_drop_in_lead && <span className="badge">No package</span>}
      {s.is_at_risk && <span className="badge danger">At risk</span>}
      {s.is_renewing_soon && <span className="badge warn">Renewing soon</span>}
      {s.is_drop_in_lead && <span className="badge info">Drop-in lead</span>}
    </span>
  );
}

export function lastVisitText(days: number | null) {
  if (days === null) return "Never visited";
  if (days === 0) return "Visited today";
  if (days === 1) return "Visited yesterday";
  return `Last visit ${days} days ago`;
}
