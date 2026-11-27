import Link from "next/link";
import { approveRequest, declineRequest } from "../sessions/actions";
import { requireOrg, canManage } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { lastVisitText } from "@/components/MemberBadges";
import { formatDate, formatMoney, localTime, todayIn, addDays, zonedToUtc } from "@/lib/time";
import { addDemoData, checkIn } from "../actions";
import { SessionStatusBadge } from "@/components/SessionBits";
import type { BookingRow, Dashboard, LocationDashboard, MemberStatus, SessionOverview } from "@/lib/types";
import { decideCourtRequest } from "../actions";

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, role, can, location, locations, multiLocation } = await requireOrg();
  const money = can("reports.view");
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

  // Sign-ups from the public booking page in the last 3 days (still live places).
  const { data: onlineData } = await supabase
    .from("session_roster")
    .select("id, session_id, name, phone, status, created_at")
    .eq("org_id", org.id)
    .eq("source", "online")
    .in("status", ["booked", "waitlisted", "requested"])
    // Open requests stay until someone deals with them; others show for 3 days.
    .or(`status.eq.requested,created_at.gte.${new Date(Date.now() - 3 * 86_400_000).toISOString()}`)
    .order("created_at", { ascending: false })
    .limit(8);
  // Money (Step 3): received today / this month and still to collect. Shown next to the figures
  // owners already know, which keep their meaning (Julian, 26 Nov 2026).
  const moneyTz = location?.timezone ?? org.timezone;
  const moneyToday = todayIn(moneyTz);
  const locOr = location ? `location_id.eq.${location.id},location_id.is.null` : null;
  let recQ = supabase.from("orders").select("paid_amount, paid_at").eq("org_id", org.id).not("paid_at", "is", null)
    .gte("paid_at", zonedToUtc(`${moneyToday.slice(0, 8)}01`, "00:00", moneyTz).toISOString());
  let dueQ = supabase.from("orders").select("total").eq("org_id", org.id).eq("status", "pending");
  if (locOr) {
    recQ = recQ.or(locOr);
    dueQ = dueQ.or(locOr);
  }
  const [{ data: recData }, { data: dueData }] = await Promise.all([recQ, dueQ]);
  const dayStartMs = zonedToUtc(moneyToday, "00:00", moneyTz).getTime();
  const received = (recData ?? []) as { paid_amount: number; paid_at: string }[];
  const receivedMonth = received.reduce((n, o) => n + Number(o.paid_amount ?? 0), 0);
  const receivedToday = received.filter((o) => new Date(o.paid_at).getTime() >= dayStartMs).reduce((n, o) => n + Number(o.paid_amount ?? 0), 0);
  const unpaid = ((dueData ?? []) as { total: number }[]).reduce((n, o) => n + Number(o.total ?? 0), 0);
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

  // Follow-ups waiting for an owner/manager to approve (Morning page).
  const { count: toApprove } =
    org.followup_mode === "approve" && can("followups.manage")
      ? await supabase.from("ai_messages").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "draft")
      : { count: 0 };
  // Chats Claude handed to staff (Chats page).
  const { count: chatsWaiting } = await supabase
    .from("chat_conversations")
    .select("id", { count: "exact", head: true })
    .eq("org_id", org.id)
    .eq("status", "staff");
  // Online court bookings by visitors: waiting for approval, or from the last 3 days.
  const { data: courtOnlineData } = await supabase
    .from("bookings")
    .select("id, source, guest_name, guest_phone, pending_approval, during, price, created_at, coach_id, group_size, coaches(name), members(full_name), courts(name, location_id, locations(timezone))")
    .eq("org_id", org.id)
    .in("source", ["online", "chat"])
    .eq("status", "confirmed")
    // Requests waiting for a decision (booking page or chat), and online bookings from the last 3 days.
    .or(`pending_approval.eq.true,and(source.eq.online,created_at.gte.${new Date(Date.now() - 3 * 86_400_000).toISOString()})`)
    .order("created_at", { ascending: false })
    .limit(20);
  const onlineCourts = (courtOnlineData ?? []) as unknown as {
    id: string;
    source: "online" | "chat";
    guest_name: string | null;
    guest_phone: string | null;
    pending_approval: boolean;
    coach_id: string | null;
    group_size: number | null;
    coaches: { name: string } | null;
    members: { full_name: string } | null;
    during: string;
    price: number;
    courts: { name: string; location_id: string; locations: { timezone: string } | null } | null;
  }[];
  const online = (onlineData ?? []) as { id: string; session_id: string; name: string; phone: string | null; status: string; created_at: string }[];
  const { data: onlineSessions } = online.length
    ? await supabase
        .from("session_overview")
        .select("id, name, starts_at, location_timezone")
        .in("id", [...new Set(online.map((o) => o.session_id))])
    : { data: [] };
  const sessionInfo = new Map(
    ((onlineSessions ?? []) as Pick<SessionOverview, "id" | "name" | "starts_at" | "location_timezone">[]).map((x) => [x.id, x]),
  );

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
          {can("members.edit") && <Link className="button" href="/members/new">Add member</Link>}
          {can("bookings.manage") && (
            <Link className="button primary" href={location ? `/bookings?at=${location.id}` : "/bookings"}>Book a court</Link>
          )}
        </div>
      </div>
      <Banner sp={sp} />
      {(toApprove ?? 0) > 0 && (
        <div className="banner notice">
          {toApprove === 1 ? "1 follow-up is" : `${toApprove} follow-ups are`} waiting for your approval.{" "}
          <Link href="/morning">Open Morning</Link>
        </div>
      )}
      {(chatsWaiting ?? 0) > 0 && (
        <div className="banner warn">
          {chatsWaiting === 1 ? "1 chat is" : `${chatsWaiting} chats are`} waiting for a person.{" "}
          <Link href="/chats">Open chats</Link>
        </div>
      )}

      {all.length === 0 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h2>Start with some members</h2>
          <p className="muted">Add your first member, or load sample data to see how the dashboard works.</p>
          <div className="actions" style={{ marginTop: 10 }}>
            {can("members.edit") && <Link className="button primary" href="/members/new">Add member</Link>}
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
        {money && (
          <>
            <Stat label="Package sales this month" unit={org.currency} value={Number(d.package_sales_this_month ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} />
            <Stat label="Received today" unit={org.currency} value={fmt(receivedToday)} />
            <Stat label="Received this month" unit={org.currency} value={fmt(receivedMonth)} />
          </>
        )}
        {can("payments.record") && (
          <Link href="/payments" className="stat stat-link">
            <div className="label">Unpaid</div>
            <div className="value"><span className="unit">{org.currency}</span>{fmt(unpaid)}</div>
          </Link>
        )}
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
                {money && <th>Revenue, 30 days</th>}
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
                  {money && <td>{formatMoney(Number(l.session_revenue_30d) + Number(l.court_revenue_30d), org.currency)}</td>}
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
            <h2 style={{ margin: 0 }}>Online sign-ups</h2>
            <Link href="/settings" className="small">Booking page →</Link>
          </div>
          <p className="muted small">
            From your public booking page, and lesson requests from chat. They pay at the club.
            {org.online_signups === "approve" ? " Requests wait for you to approve them." : ""}
          </p>
          {onlineCourts.length > 0 && (
            <ul className="list" style={{ marginBottom: 8 }}>
              {onlineCourts.map((b) => {
                // tstzrange text, e.g. ["2026-11-28 03:00:00+00","2026-11-28 04:00:00+00")
                const start = (b.during.match(/[\[(]"?([^",]+)"?,/)?.[1] ?? "").replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
                const tz = b.courts?.locations?.timezone ?? org.timezone;
                return (
                  <li key={b.id}>
                    <span>
                      {b.guest_name ?? b.members?.full_name ?? "Member"}
                      <span className="muted small">
                        {b.guest_phone ? ` · ${b.guest_phone}` : ""}
                        {b.source === "chat" ? " · via chat" : ""}
                      </span>
                      <div className="small">
                        {b.coach_id
                          ? `Lesson with ${b.coaches?.name ?? "coach"}${b.group_size && b.group_size > 1 ? ` (${b.group_size} people)` : ""}, ${b.courts?.name ?? "court"}`
                          : (b.courts?.name ?? "Court")}{" "}
                        <span className="muted">
                          {start && new Date(start).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz })}{" "}
                          {start && localTime(start, tz)} · {formatMoney(b.price, org.currency)} at the club
                        </span>
                      </div>
                    </span>
                    {b.pending_approval ? (
                      <span className="actions">
                        <form action={decideCourtRequest} className="inline">
                          <input type="hidden" name="booking_id" value={b.id} />
                          <input type="hidden" name="approve" value="true" />
                          <button className="primary">Approve</button>
                        </form>
                        <form action={decideCourtRequest} className="inline">
                          <input type="hidden" name="booking_id" value={b.id} />
                          <input type="hidden" name="approve" value="false" />
                          <button className="link danger">Decline</button>
                        </form>
                      </span>
                    ) : (
                      <span className="badge ok">{b.coach_id ? "lesson" : "court"}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {online.length === 0 ? (
            onlineCourts.length === 0 && <p className="muted small">None yet. Share your booking page link or QR code (Settings).</p>
          ) : (
            <ul className="list">
              {online.map((o) => {
                const si = sessionInfo.get(o.session_id);
                return (
                  <li key={o.id}>
                    <span>
                      {o.name}
                      <span className="muted small">{o.phone ? ` · ${o.phone}` : ""}</span>
                      {si && (
                        <div className="small">
                          <Link href={`/sessions/${o.session_id}`}>{si.name}</Link>{" "}
                          <span className="muted">
                            {new Date(si.starts_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: si.location_timezone })}{" "}
                            {localTime(si.starts_at, si.location_timezone)}
                          </span>
                        </div>
                      )}
                    </span>
                    {o.status === "requested" ? (
                      <span className="actions">
                        <form action={approveRequest} className="inline">
                          <input type="hidden" name="registration_id" value={o.id} />
                          <input type="hidden" name="session_id" value={o.session_id} />
                          <input type="hidden" name="back_to" value="/dashboard" />
                          <button className="primary">Approve</button>
                        </form>
                        <form action={declineRequest} className="inline">
                          <input type="hidden" name="registration_id" value={o.id} />
                          <input type="hidden" name="session_id" value={o.session_id} />
                          <input type="hidden" name="back_to" value="/dashboard" />
                          <button className="link danger">Decline</button>
                        </form>
                      </span>
                    ) : (
                      <span className={`badge ${o.status === "waitlisted" ? "info" : "ok"}`}>{o.status}</span>
                    )}
                  </li>
                );
              })}
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
