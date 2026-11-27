import Link from "next/link";
import { requireOrg, canManage } from "@/lib/org";
import { Banner, param, type SearchParams } from "@/components/Banner";
import { SessionStatusBadge, Spots, levelText } from "@/components/SessionBits";
import { addDays, formatLongDay, formatMoney, isValidDate, localTime, todayIn, zonedToUtc } from "@/lib/time";
import { generateSessions, loadRaccoonDemo, runMinimumCheck } from "./actions";
import { CATEGORY_LABELS, type SessionCategory, type SessionOverview } from "@/lib/types";

const FILTERS: { key: string; label: string; categories?: SessionCategory[] }[] = [
  { key: "all", label: "All" },
  { key: "open_play", label: "Open play", categories: ["open_play", "match_play"] },
  { key: "clinic", label: "Clinics", categories: ["clinic"] },
  { key: "events", label: "Camps and events", categories: ["camp", "tournament", "course", "other"] },
];

export default async function SessionsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, role, location, workLocation, multiLocation, t, locale } = await requireOrg();
  const tz = (location ?? workLocation).timezone;
  const today = todayIn(tz);
  const requested = param(sp, "from");
  const from = isValidDate(requested) ? requested : today;
  const filterKey = param(sp, "show") ?? "all";
  const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];
  const showCancelled = param(sp, "cancelled") === "1";

  let query = supabase
    .from("session_overview")
    .select("*")
    .eq("org_id", org.id)
    .gte("starts_at", zonedToUtc(from, "00:00", tz).toISOString())
    .lt("starts_at", zonedToUtc(addDays(from, 7), "00:00", tz).toISOString())
    .order("starts_at");
  if (filter.categories) query = query.in("category", filter.categories);
  if (location) query = query.eq("location_id", location.id);
  if (!showCancelled) query = query.neq("status", "cancelled");

  const [{ data, error }, { count: typeCount }] = await Promise.all([
    query,
    supabase.from("session_types").select("id", { count: "exact", head: true }).eq("org_id", org.id),
  ]);
  const sessions = (data ?? []) as SessionOverview[];
  const manager = canManage(role);
  const here = `/sessions?from=${from}&show=${filter.key}${showCancelled ? "&cancelled=1" : ""}`;

  // Group by the club's local date.
  const byDay = new Map<string, SessionOverview[]>();
  for (let i = 0; i < 7; i++) byDay.set(addDays(from, i), []);
  for (const s of sessions) {
    const day = new Date(s.starts_at).toLocaleDateString("en-CA", { timeZone: s.location_timezone });
    byDay.get(day)?.push(s);
  }

  const link = (changes: Record<string, string>) => {
    const p = new URLSearchParams({ from, show: filter.key, ...(showCancelled ? { cancelled: "1" } : {}), ...changes });
    if (p.get("cancelled") === "0") p.delete("cancelled");
    return `/sessions?${p.toString()}`;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Sessions")}</h1>
          <p className="muted">
            {multiLocation ? `${location ? location.name : t("All locations")} · ` : ""}
            {t("Open play, clinics, camps and events people sign up for.")}
          </p>
        </div>
        <div className="actions">
          {manager && <Link className="button" href="/sessions/setup">{t("Timetable setup")}</Link>}
          {manager && <Link className="button primary" href="/sessions/new">{t("New event")}</Link>}
        </div>
      </div>
      <Banner sp={sp} />
      {error && <div className="banner error">{error.message}</div>}

      {typeCount === 0 && manager && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h2>{t("Set up your timetable")}</h2>
          <p className="muted">
            {t("Add your session types and weekly times in Timetable setup, or load Raccoon Pickleball's published timetable (open play, adult and kids clinics, match play, Coach Kimo camps) to try things out.")}
          </p>
          <div className="actions" style={{ marginTop: 10 }}>
            <Link className="button primary" href="/sessions/setup">{t("Set up timetable")}</Link>
            <form action={loadRaccoonDemo} className="inline">
              <button>{t("Load Raccoon demo timetable")}</button>
            </form>
          </div>
        </div>
      )}

      <div className="actions" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div className="actions">
          <Link className="button" href={link({ from: addDays(from, -7) })} aria-label={t("Previous week")}>←</Link>
          <span className="small">{formatLongDay(from, locale)} – {formatLongDay(addDays(from, 6), locale)}</span>
          <Link className="button" href={link({ from: addDays(from, 7) })} aria-label={t("Next week")}>→</Link>
          {from !== today && <Link className="button" href={link({ from: today })}>{t("This week")}</Link>}
        </div>
        <div className="actions">
          {FILTERS.map((f) => (
            <Link key={f.key} href={link({ show: f.key })} className={`badge ${f.key === filter.key ? "ok" : ""}`}>
              {t(f.label)}
            </Link>
          ))}
          <Link href={link({ cancelled: showCancelled ? "0" : "1" })} className="badge">
            {showCancelled ? t("Hide cancelled") : t("Show cancelled")}
          </Link>
        </div>
      </div>

      <div className="stack">
        {[...byDay.entries()].map(([day, list]) => (
          <section key={day} className="card">
            <h3>
              {formatLongDay(day, locale)}
              {day === today && <span className="badge ok" style={{ marginLeft: 8 }}>{t("Today")}</span>}
            </h3>
            {list.length === 0 ? (
              <p className="muted small">{t("Nothing scheduled.")}</p>
            ) : (
              <div className="table-wrap">
                <table className="session-table">
                  <tbody>
                    {list.map((s) => (
                      <tr key={s.id} style={s.status === "cancelled" ? { opacity: 0.55 } : undefined}>
                        <td style={{ width: 110, whiteSpace: "nowrap" }}>
                          <strong>{localTime(s.starts_at, s.location_timezone)}</strong>
                          <span className="muted small">–{localTime(s.ends_at, s.location_timezone)}</span>
                        </td>
                        <td>
                          <Link href={`/sessions/${s.id}`}>{s.name}</Link>
                          <div className="muted small">
                            {multiLocation && !location ? `${s.location_name} · ` : ""}
                            {t(CATEGORY_LABELS[s.category])} · {levelText(s.level_min, s.level_max, t)}
                            {s.min_age ? ` · ${t("age {n}+", { n: s.min_age })}` : ""}
                            {s.courts ? ` · ${s.courts}` : ""}
                            {s.coach_name ? ` · ${s.coach_name}` : ""}
                          </div>
                        </td>
                        <td style={{ width: 110 }}>{formatMoney(s.price, org.currency)}</td>
                        <td style={{ width: 90 }}><Spots s={s} /></td>
                        <td style={{ width: 150, textAlign: "right" }}><SessionStatusBadge s={s} t={t} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3>{t("Housekeeping")}</h3>
        <p className="muted small">
          {t("The timetable fills the next 2 weeks by itself every hour. The go / no-go check doesn't run by itself yet (it will once players get automatic WhatsApp notices), so run it here a few hours before sessions.")}
        </p>
        <div className="actions" style={{ marginTop: 8 }}>
          {manager && (
            <form action={generateSessions} className="inline">
              <input type="hidden" name="return_to" value={here} />
              <button>{t("Fill the next 2 weeks from the timetable")}</button>
            </form>
          )}
          <form action={runMinimumCheck} className="inline">
            <input type="hidden" name="return_to" value={here} />
            <button>{t("Run go / no-go check")}</button>
          </form>
        </div>
      </div>
    </>
  );
}
