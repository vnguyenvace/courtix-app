import Link from "next/link";
import { requireOrg, canManage } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { lastVisitText } from "@/components/MemberBadges";
import { formatDate, formatMoney, localTime, todayIn, addDays, zonedToUtc } from "@/lib/time";
import { addDemoData, checkIn } from "../actions";
import { SessionStatusBadge } from "@/components/SessionBits";
import type { BookingRow, Dashboard, LocationDashboard, MemberStatus, SessionOverview } from "@/lib/types";

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, role, location, locations, multiLocation } = await requireOrg();
  const tz = location?.timezone ?? org.timezone;
  const tzOf = new Map(locations.map((l) => [l.id, l.timezone]));
  const today = todayIn(tz);

  const dayStart = zonedToUtc(today, "00:00", tz).toISOString();
  const dayEnd = zonedToUtc(addDays(today, 1), "00:00", tz).toISOString();

  let bookingQuery = supabase
    .from("booking_calendar")
    .select("*")
    .eq("org_id", org.id)
    .eq("status", "confirmed")
    .is("session_id", null)
    .gte("start_at", dayStart)
    .lt("start_at", dayEnd)
    .order("start_at");
  let sessionQuery = supabase
    .from("session_overview")
    .select("*")
    .eq("org_id", org.id)
    .gte("starts_at", dayStart)
    .lt("starts_at", dayEnd)
    .order("starts_at");
  if (location) {
    bookingQuery = bookingQuery.eq("location_id", location.id);
    sessionQuery = sessionQuery.eq("location_id", location.id);
  }

  const [{ data: dash }, { data: statuses }, { data: todays }, { data: sessionData }, { data: locData }] = await Promise.all([
    supabase.from("org_dashboard").select("*").eq("org_id", org.id).maybeSingle(),
    supabase.from("member_status").select("*").eq("org_id", org.id),
    bookingQuery,
    sessionQuery,
    multiLocation
      ? supabase.from("location_dashboard").select("*").eq("org_id", org.id).eq("is_active", true).order("sort_order").order("name")
      : Promise.resolve({ data: [] }),
  ]);
  const byLocation = (locData ?? []) as LocationDashboard[];
  const here = location ? byLocation.find((l) => l.location_id === location.id) : undefined;

  const d = (dash ?? {}) as Partial<Dashboard>;
  const all = (statuses ?? []) as MemberStatus[];
  const atRisk = all.filter((s) => s.is_at_risk).sort((a, b) => (b.days_since_visit ?? 999) - (a.days_since_visit ?? 999));
  const renewing = all.filter((s) => s.is_renewing_soon).sort((a, b) => (a.days_to_expiry ?? 99) - (b.days_to_expiry ?? 99));
  const leads = all.filter((s) => s.is_drop_in_lead);
  const bookingsToday = (todays ?? []) as BookingRow[];
  const sessionsToday = (sessionData ?? []) as SessionOverview[];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            {org.name}
            {multiLocation ? ` · ${location ? location.name : "All locations"}` : ""} · {formatDate(today)}
          </p>
        </div>
        <div className="actions">
          <Link className="button" href="/members/new">Add member</Link>
          <Link className="button primary" href={location ? `/bookings?at=${location.id}` : "/bookings"}>Book a court</Link>
        </div>
      </div>
      <Banner sp={sp} />

      {all.length === 0 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h2>Start with some members</h2>
          <p className="muted">Add your first member, or load sample data to see how the dashboard works.</p>
          <div className="actions" style={{ marginTop: 10 }}>
            <Link className="button primary" href="/members/new">Add member</Link>
            {canManage(role) && (
              <form action={addDemoData} className="inline">
                <button>Load sample members</button>
              </form>
            )}
          </div>
        </div>
      )}

      <div className="stats">
        <Stat label="Active members" value={d.active_members ?? 0} />
        <Stat label="At risk" value={d.at_risk ?? 0} />
        <Stat label="Renewing soon" value={d.renewing_soon ?? 0} />
        <Stat label="Drop-in leads" value={d.drop_in_leads ?? 0} />
        <Stat label="Sessions today" value={here ? here.sessions_today : d.sessions_today ?? 0} />
        <Stat label="Court bookings today" value={here ? here.bookings_today : d.bookings_today ?? 0} />
        <Stat label="Package sales this month" unit={org.currency} value={Number(d.package_sales_this_month ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} />
      </div>

      {multiLocation && byLocation.length > 0 && (
        <section className="card table-wrap" style={{ marginBottom: 18 }}>
          <h2>By location</h2>
          <table>
            <thead>
              <tr>
                <th>Location</th>
                <th>Sessions today</th>
                <th>Court bookings today</th>
                <th>Players, 30 days</th>
                <th>Visits, 30 days</th>
                <th>Sessions filled</th>
                <th>Revenue, 30 days</th>
              </tr>
            </thead>
            <tbody>
              {byLocation.map((l) => (
                <tr key={l.location_id} style={location && l.location_id !== location.id ? { opacity: 0.6 } : undefined}>
                  <td>
                    <strong>{l.name}</strong>
                    <div className="muted small">{l.courts} courts · {l.home_members} home members</div>
                  </td>
                  <td>{l.sessions_today}</td>
                  <td>{l.bookings_today}</td>
                  <td>{l.players_30d}</td>
                  <td>{l.visits_30d}</td>
                  <td>{l.session_fill_pct_30d === null ? "—" : `${l.session_fill_pct_30d}%`}</td>
                  <td>{formatMoney(Number(l.session_revenue_30d) + Number(l.court_revenue_30d), org.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 8 }}>
            Members and packages are club-wide, so the member numbers above count everyone. Revenue here is sessions and
            court hire played at each site; package sales are counted once for the club.
          </p>
        </section>
      )}

      <div className="grid grid-2">
        <section className="card">
          <div className="actions" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>At risk</h2>
            <Link href="/followups" className="small">Draft messages →</Link>
          </div>
          <p className="muted small">
            Active members with no visit for {org.at_risk_days}+ days and nothing booked.
          </p>
          <PeopleList
            rows={atRisk}
            empty="Nobody at risk right now."
            detail={(s) => `${lastVisitText(s.days_since_visit)} · ${s.package_name ?? ""}`}
          />
        </section>

        <section className="card">
          <div className="actions" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>Renewing soon</h2>
            <Link href="/followups" className="small">Draft messages →</Link>
          </div>
          <p className="muted small">
            Packages ending in the next {org.renewal_window_days} days, or class packs with 2 or fewer sessions.
          </p>
          <PeopleList
            rows={renewing}
            empty="No renewals coming up."
            detail={(s) =>
              s.sessions_left !== null
                ? `${s.sessions_left} sessions left · ${s.package_name}`
                : `Ends ${formatDate(s.ends_on)} (${s.days_to_expiry === 0 ? "today" : s.days_to_expiry === 1 ? "tomorrow" : `in ${s.days_to_expiry} days`})`
            }
          />
        </section>

        <section className="card">
          <h2>Sessions today</h2>
          {sessionsToday.length === 0 ? (
            <p className="muted small">
              No sessions today. <Link href="/sessions">Set up your timetable.</Link>
            </p>
          ) : (
            <ul className="list">
              {sessionsToday.map((s) => (
                <li key={s.id}>
                  <span>
                    <strong>{localTime(s.starts_at, s.location_timezone)}</strong>{" "}
                    <Link href={`/sessions/${s.id}`}>{s.name}</Link>
                    {multiLocation && !location ? <span className="muted small"> · {s.location_name}</span> : null}
                    <span className="muted small"> · {s.booked}/{s.max_players}</span>
                  </span>
                  <SessionStatusBadge s={s} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Court bookings today</h2>
          {bookingsToday.length === 0 ? (
            <p className="muted small">No bookings today.</p>
          ) : (
            <ul className="list">
              {bookingsToday.map((b) => (
                <li key={b.id}>
                  <span>
                    <strong>{localTime(b.start_at, tzOf.get(b.location_id) ?? tz)}</strong> · {b.court_name}
                    {multiLocation && !location ? <span className="muted small"> · {b.location_name}</span> : null}
                  </span>
                  <span className="actions">
                    {b.member_name ?? b.guest_name ?? b.kind.replace("_", " ")}
                    {b.member_id && (
                      <form action={checkIn} className="inline">
                        <input type="hidden" name="member_id" value={b.member_id} />
                        <input type="hidden" name="return_to" value="/dashboard" />
                        <button className="link">Check in</button>
                      </form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="actions" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>Drop-in leads</h2>
            <Link href="/followups" className="small">Draft messages →</Link>
          </div>
          <p className="muted small">Played at least once but never bought a package.</p>
          <PeopleList rows={leads} empty="No leads yet." detail={(s) => lastVisitText(s.days_since_visit)} />
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, unit }: { label: string; value: number | string; unit?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">
        {unit && <span className="unit">{unit}</span>}
        {value}
      </div>
    </div>
  );
}

function PeopleList({
  rows,
  empty,
  detail,
}: {
  rows: MemberStatus[];
  empty: string;
  detail: (s: MemberStatus) => string;
}) {
  if (rows.length === 0) return <p className="muted small">{empty}</p>;
  return (
    <ul className="list">
      {rows.slice(0, 8).map((s) => (
        <li key={s.member_id}>
          <span>
            <Link href={`/members/${s.member_id}`}>{s.full_name}</Link>
            <span className="muted small"> · {s.language.toUpperCase()}</span>
          </span>
          <span className="muted small">{detail(s)}</span>
        </li>
      ))}
      {rows.length > 8 && <li className="muted small">and {rows.length - 8} more</li>}
    </ul>
  );
}
