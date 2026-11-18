import { sessionState, type PublicSession } from "@/lib/public";

/** Spots left / full / closed, for the public booking page. */
export function StateBadge({ s }: { s: PublicSession }) {
  const state = sessionState(s);
  if (state === "not_open") return <span className="badge">Opens soon</span>;
  if (state === "closed") return <span className="badge">Closed</span>;
  if (state === "full") return <span className="badge info">Full · waitlist</span>;
  return (
    <span className={`badge ${s.spots_left <= 2 ? "warn" : "ok"}`}>
      {s.spots_left} {s.spots_left === 1 ? "spot" : "spots"} left
    </span>
  );
}
