import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { MemberBadges, lastVisitText } from "@/components/MemberBadges";
import { MemberFields } from "@/components/MemberFields";
import { addDays, formatDate, formatMoney, localTime, todayIn } from "@/lib/time";
import {
  cancelMembership,
  checkIn,
  pauseMembership,
  sellPackage,
  setBookingStatus,
  updateMember,
} from "../../actions";
import type { BookingRow, Member, MemberStatus, Membership, PackageType } from "@/lib/types";

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, org, locations } = await requireOrg();
  const today = todayIn(org.timezone);

  const [member, status, memberships, packages, checkIns, bookings] = await Promise.all([
    supabase.from("members").select("*").eq("id", id).eq("org_id", org.id).maybeSingle(),
    supabase.from("member_status").select("*").eq("member_id", id).maybeSingle(),
    supabase
      .from("memberships")
      .select("*, package_types(name)")
      .eq("member_id", id)
      .order("starts_on", { ascending: false }),
    supabase.from("package_types").select("*").eq("org_id", org.id).eq("is_active", true).order("price"),
    supabase
      .from("check_ins")
      .select("id, checked_in_at, source, location_id")
      .eq("member_id", id)
      .order("checked_in_at", { ascending: false })
      .limit(10),
    supabase
      .from("booking_calendar")
      .select("*")
      .eq("member_id", id)
      .order("start_at", { ascending: false })
      .limit(10),
  ]);

  if (!member.data) notFound();
  const m = member.data as Member;
  const s = status.data as MemberStatus | null;
  const ms = (memberships.data ?? []) as Membership[];
  const pkgs = (packages.data ?? []) as PackageType[];
  const visits = (checkIns.data ?? []) as { id: string; checked_in_at: string; source: string; location_id: string | null }[];
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const books = (bookings.data ?? []) as BookingRow[];
  const current = ms.find((x) => x.status === "active");
  const path = `/members/${m.id}`;

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/members" className="small">← Members</Link>
          <h1>{m.full_name}</h1>
          <p className="muted">
            {s ? lastVisitText(s.days_since_visit) : ""} · Member since {formatDate(m.created_at)}
          </p>
          {s && <MemberBadges s={s} />}
        </div>
        <div className="actions">
          <form action={checkIn} className="inline">
            <input type="hidden" name="member_id" value={m.id} />
            <button className="primary">Check in now</button>
          </form>
          <Link className="button" href={`/bookings?date=${today}`}>Book a court</Link>
        </div>
      </div>
      <Banner sp={sp} />

      <div className="grid grid-2">
        <div className="stack">
          <section className="card">
            <h2>Packages</h2>
            {ms.length === 0 ? (
              <p className="muted small">No packages yet.</p>
            ) : (
              <ul className="list">
                {ms.map((x) => (
                  <li key={x.id} style={{ flexWrap: "wrap" }}>
                    <span>
                      <strong>{x.package_types?.name}</strong>
                      <div className="muted small">
                        {formatDate(x.starts_on)} – {x.ends_on ? formatDate(x.ends_on) : "no end date"}
                        {x.sessions_left !== null && ` · ${x.sessions_left} sessions left`}
                        {" · "}{formatMoney(x.price_paid, org.currency)}
                        {x.status === "paused" && ` · paused until ${formatDate(x.paused_until)}`}
                      </div>
                    </span>
                    <span className="actions">
                      <span className={`badge ${x.status === "active" ? "ok" : x.status === "paused" ? "info" : ""}`}>
                        {x.status}
                      </span>
                      {x.status === "active" && (
                        <form action={cancelMembership} className="inline">
                          <input type="hidden" name="member_id" value={m.id} />
                          <input type="hidden" name="membership_id" value={x.id} />
                          <button className="link danger">Cancel</button>
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>Sell a package</h2>
            <form action={sellPackage} className="form">
              <input type="hidden" name="member_id" value={m.id} />
              <label>
                Package
                <select name="package_id" required>
                  {pkgs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {formatMoney(p.price, org.currency)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-row">
                <label>
                  Starts on
                  <input
                    type="date"
                    name="starts_on"
                    defaultValue={current?.ends_on && current.ends_on >= today ? addDays(current.ends_on, 1) : today}
                  />
                </label>
                <label>
                  Price paid (leave blank for list price)
                  <input type="number" name="price" min="0" step="1" placeholder="List price" />
                </label>
              </div>
              <button className="primary">Sell package</button>
            </form>
          </section>

          {current && (
            <section className="card">
              <h2>Pause instead of cancel</h2>
              <p className="muted small">
                For members leaving Phuket for a while. The end date moves out by the pause length.
              </p>
              <form action={pauseMembership} className="form">
                <input type="hidden" name="member_id" value={m.id} />
                <input type="hidden" name="membership_id" value={current.id} />
                <div className="form-row">
                  <label>
                    From
                    <input type="date" name="paused_from" required defaultValue={today} />
                  </label>
                  <label>
                    Until
                    <input type="date" name="paused_until" required />
                  </label>
                </div>
                <button>Pause membership</button>
              </form>
            </section>
          )}

          <section className="card">
            <h2>Recent bookings</h2>
            {books.length === 0 ? (
              <p className="muted small">No bookings yet.</p>
            ) : (
              <ul className="list">
                {books.map((b) => (
                  <li key={b.id}>
                    <span>
                      {formatDate(new Date(b.start_at).toLocaleDateString("en-CA", { timeZone: org.timezone }))}{" "}
                      {localTime(b.start_at, org.timezone)} · {b.court_name}{locations.length > 1 ? `, ${b.location_name}` : ""}
                    </span>
                    <span className="actions">
                      <span className={`badge ${b.status === "confirmed" ? "ok" : b.status === "no_show" ? "danger" : ""}`}>
                        {b.status.replace("_", "-")}
                      </span>
                      {b.status === "confirmed" && new Date(b.end_at) > new Date() && (
                        <form action={setBookingStatus} className="inline">
                          <input type="hidden" name="booking_id" value={b.id} />
                          <input type="hidden" name="status" value="cancelled" />
                          <input type="hidden" name="return_to" value={path} />
                          <button className="link danger">Cancel</button>
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>Recent visits</h2>
            {visits.length === 0 ? (
              <p className="muted small">No visits yet.</p>
            ) : (
              <ul className="list">
                {visits.map((v) => (
                  <li key={v.id}>
                    <span>{new Date(v.checked_in_at).toLocaleString("en-GB", { timeZone: org.timezone, dateStyle: "medium", timeStyle: "short" })}</span>
                    <span className="muted small">{locations.length > 1 && v.location_id ? `${locName.get(v.location_id)} · ` : ""}{v.source}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="card">
          <h2>Details</h2>
          <form action={updateMember} className="form">
            <input type="hidden" name="member_id" value={m.id} />
            <MemberFields m={m} locations={locations} />
            <p className="muted small">
              LINE: {m.line_user_id ? "connected" : "not connected yet (links when they message the club's LINE account)"}
            </p>
            <button className="primary">Save details</button>
          </form>
        </section>
      </div>
    </>
  );
}
