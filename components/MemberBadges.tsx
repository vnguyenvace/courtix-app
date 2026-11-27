import type { MemberStatus } from "@/lib/types";
import type { T } from "@/lib/i18n";

const same: T = (s) => s;

export function MemberBadges({ s, t = same }: { s: MemberStatus; t?: T }) {
  return (
    <span className="actions">
      {s.membership_status === "active" && <span className="badge ok">{t("Active")}</span>}
      {s.membership_status === "paused" && <span className="badge info">{t("Paused")}</span>}
      {!s.membership_status && !s.is_drop_in_lead && <span className="badge">{t("No package")}</span>}
      {s.is_at_risk && <span className="badge danger">{t("At risk")}</span>}
      {s.is_renewing_soon && <span className="badge warn">{t("Renewing soon")}</span>}
      {s.is_drop_in_lead && <span className="badge info">{t("Drop-in lead")}</span>}
    </span>
  );
}

export function lastVisitText(days: number | null, t: T = same) {
  if (days === null) return t("Never visited");
  if (days === 0) return t("Visited today");
  if (days === 1) return t("Visited yesterday");
  return t("Last visit {n} days ago", { n: days });
}
