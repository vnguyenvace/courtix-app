import Link from "next/link";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { canManage, requireOrg } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { SessionStatusBadge, Spots, levelText } from "@/components/SessionBits";
import { formatLongDay, formatMoney, localTime } from "@/lib/time";
import { approveRequest, cancelRegistration, cancelSession, declineRequest, markAttendance, registerForSession } from "../actions";
import { CATEGORY_LABELS, type MemberStatus, type RosterRow, type SessionOverview } from "@/lib/types";
import { MarkPaidForm, METHOD_LABELS } from "@/components/Payments";

const STATUS_BADGE: Record<string, string> = {
  booked: "ok",
  attended: "ok",
  waitlisted: "info",
  requested: "warn",
  no_show: "danger",
  cancelled: "",
};

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, org, multiLocation, role } = await requireOrg();
  const editable = canManage(role);

  const [{ data: sData }, { data: rData }, { data: mData }] = await Promise.all([
    supabase.from("session_overview").select("*").eq("id", id).eq("org_id", org.id).maybeSingle(),
    supabase.from("session_roster").select("*").eq("session_id", id).order("created_at"),
    supabase
      .from("member_status")
      .select("member_id, full_name, membership_status, package_name")
      .eq("org_id", org.id)
      .order("full_name"),
  ]);
  if (!sData) notFound();

  // Which members' packages cover this session (for the sign-up picker). The database
  // decides for real at sign-up (register_for_session); this is only a hint for the desk.
  const day0 = new Date((sData as SessionOverview).starts_at).toLocaleDateString("en-CA", {
    timeZone: (sData as SessionOverview).location_timezone,
  });
  const { data: msData } = await supabase
    .from("memberships")
    .select("member_id, package_type_id, sessions_left, starts_on, ends_on, package_types(kind)")
    .eq("org_id", org.id)
    .eq("status", "active");
  const memberships = (msData ?? []) as unknown as {
    member_id: string;
    package_type_id: string;
    sessions_left: number | null;
    starts_on: string;
    ends_on: string | null;
    package_types: { kind: "time_based" | "class_pack" } | null;
  }[];
  const pkgIds = [...new Set(memberships.map((m) => m.package_type_id))];
  const covers = new Set<string>();
  await Promise.all(
    pkgIds.map(async (pkg) => {
      const { data } = await supabase.rpc("package_covers_session", { p_package: pkg, p_session: id });
      if (data) covers.add(pkg);
    }),
  );
  const coverHint = new Map<string, string>();
  for (const m of memberships) {
    if (!covers.has(m.package_type_id) || m.starts_on > day0 || (m.ends_on && m.ends_on < day0)) continue;
    if (m.package_types?.kind === "time_based") coverHint.set(m.member_id, "covered");
    else if ((m.sessions_left ?? 0) > 0 && coverHint.get(m.member_id) !== "covered") {
      coverHint.set(m.member_id, `uses 1 credit, ${m.sessions_left} left`);
    }
  }

  const s = sData as SessionOverview;

  const roster = (rData ?? []) as RosterRow[];
  // Payment for each paid place (orders are made by the database; Step 3).
  const { data: payData } = roster.length
    ? await supabase
        .from("order_items")
        .select("registration_id, orders(id, status, method)")
        .in("registration_id", roster.map((r) => r.id))
    : { data: [] };
  const payments = new Map(
    ((payData ?? []) as unknown as { registration_id: string; orders: { id: string; status: string; method: string | null } | null }[])
      .filter((p) => p.orders)
      .map((p) => [p.registration_id, p.orders!]),
  );
  const members = (mData ?? []) as Pick<MemberStatus, "member_id" | "full_name" | "membership_status" | "package_name">[];
  const tz = s.location_timezone;
  const day = new Date(s.starts_at).toLocaleDateString("en-CA", { timeZone: tz });
  const endDay = new Date(s.ends_at).toLocaleDateString("en-CA", { timeZone: tz });
  const now = Date.now();
  const started = new Date(s.starts_at).getTime() <= now;
  const finished = new Date(s.ends_at).getTime() <= now;
  const closed = new Date(s.book_by).getTime() <= now;

  const playing = roster.filter((r) => r.status === "booked" || r.status === "attended" || r.status === "no_show");
  const waiting = roster.filter((r) => r.status === "waitlisted");
  const requests = roster.filter((r) => r.status === "requested");
  const cancelled = roster.filter((r) => r.status === "cancelled");
  const signedUp = new Set(roster.filter((r) => r.status !== "cancelled").map((r) => r.member_id));
  const available = members.filter((m) => !signedUp.has(m.member_id));
  const revenue = roster
    .filter((r) => r.status === "booked" || r.status === "attended" || r.status === "no_show")
    .reduce((sum, r) => sum + Number(r.price), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <Link href={`/sessions?from=${day}`} className="small">← Sessions</Link>
          <div className="title-row">
            <h1>{s.name}</h1>
            {editable && s.status !== "cancelled" && !finished && (
              <Link href={`/sessions/${s.id}/edit`} className="button small-button">
                <Pencil size={15} strokeWidth={1.75} aria-hidden />
                Edit
              </Link>
            )}
          </div>
          <p className="muted">
            {multiLocation ? `${s.location_name} · ` : ""}
            {formatLongDay(day)} · {localTime(s.starts_at, tz)}–
            {endDay !== day ? `${formatLongDay(endDay)} ` : ""}
            {localTime(s.ends_at, tz)}
          </p>
          <div className="actions">
            <SessionStatusBadge s={s} />
            <span className="badge">{CATEGORY_LABELS[s.category]}</span>
            <span className="badge">{levelText(s.level_min, s.level_max)}</span>
            {s.min_age && <span className="badge">Age {s.min_age}+</span>}
          </div>
        </div>
        <div className="stat" style={{ minWidth: 200 }}>
          <div className="label">Players</div>
          <Spots s={s} />
          <div className="muted small" style={{ marginTop: 4 }}>
            Minimum {s.min_players} · {formatMoney(s.price, org.currency)} each
          </div>
        </div>
      </div>
      <Banner sp={sp} />
      {s.status === "cancelled" && (
        <div className="banner error">Cancelled{s.cancel_reason ? `: ${s.cancel_reason}` : ""}.</div>
      )}
      {s.notes && <div className="banner notice">{s.notes}</div>}

      <div className="grid grid-2">
        <div className="stack">
          <section className="card">
            <h2>Signed up ({playing.length})</h2>
            {playing.length === 0 ? (
              <p className="muted small">Nobody yet.</p>
            ) : (
              <RosterList rows={playing} sessionId={s.id} started={started} cancellable={!finished && s.status !== "cancelled"} currency={org.currency} payments={payments} />
            )}
          </section>

          {requests.length > 0 && (
            <section className="card">
              <h2>Online requests ({requests.length})</h2>
              <p className="muted small">
                Waiting for you to approve. Approving books them (or waitlists them if the session has filled up).
              </p>
              <ul className="list">
                {requests.map((r) => (
                  <li key={r.id} style={{ flexWrap: "wrap" }}>
                    <span>
                      {r.name}
                      <span className="muted small">{r.phone ? ` · ${r.phone}` : ""}</span>
                    </span>
                    {!finished && s.status !== "cancelled" && (
                      <span className="actions">
                        <Act sessionId={s.id} id={r.id} action={approveRequest} label="Approve" />
                        <Act sessionId={s.id} id={r.id} action={declineRequest} label="Decline" danger />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {waiting.length > 0 && (
            <section className="card">
              <h2>Waitlist ({waiting.length})</h2>
              <p className="muted small">The first person moves up automatically when someone cancels.</p>
              <RosterList rows={waiting} sessionId={s.id} started={false} cancellable currency={org.currency} payments={payments} />
            </section>
          )}

          {cancelled.length > 0 && (
            <details className="card">
              <summary className="small" style={{ cursor: "pointer" }}>Cancelled places ({cancelled.length})</summary>
              <ul className="list" style={{ marginTop: 8 }}>
                {cancelled.map((r) => (
                  <li key={r.id}><span>{r.name}</span><span className="muted small">cancelled</span></li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="stack">
          {s.status !== "cancelled" && finished && (
            <section className="card">
              <h2>This session has finished</h2>
              <p className="muted small">
                It ended at {localTime(s.ends_at, tz)}, so sign-ups and cancellations are closed. Use{" "}
                <Link href={`/sessions?from=${day}`}>Sessions</Link> to find an upcoming one.
              </p>
            </section>
          )}
          {s.status !== "cancelled" && !finished && (
            <section className="card">
              <h2>{s.spots_left === 0 ? "Add to waitlist" : "Sign someone up"}</h2>
              <form action={registerForSession} className="form">
                <input type="hidden" name="session_id" value={s.id} />
                <label>
                  Member
                  <select name="member_id" defaultValue="">
                    <option value="">Guest (enter name below)</option>
                    {available.map((m) => (
                      <option key={m.member_id} value={m.member_id}>
                        {m.full_name}
                        {coverHint.has(m.member_id) ? ` · ${coverHint.get(m.member_id)}` : m.package_name ? ` · ${m.package_name} (not covered)` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-row">
                  <label>
                    Guest name
                    <input name="guest_name" placeholder="Tourist Tom" />
                  </label>
                  <label>
                    Guest phone or WhatsApp
                    <input name="guest_phone" type="tel" placeholder="+66 81 234 5678" />
                  </label>
                </div>
                {closed && (
                  <label className="check">
                    <input type="checkbox" name="allow_late" /> Sign-ups have closed. Add them anyway (desk override)
                  </label>
                )}
                {(s.level_min !== null || s.level_max !== null) && (
                  <label className="check">
                    <input type="checkbox" name="ignore_level" /> Allow even if their level is outside {levelText(s.level_min, s.level_max).toLowerCase()}
                  </label>
                )}
                <p className="muted small">
                  Price {formatMoney(s.price, org.currency)}. Members whose package covers this session pay nothing;
                  session packs use 1 credit.
                </p>
                <button className="primary">{s.spots_left === 0 ? "Add to waitlist" : "Sign up"}</button>
              </form>
            </section>
          )}


          <section className="card">
            <h2>Details</h2>
            <ul className="list">
              <li><span className="muted">Location</span><span>{s.location_name}</span></li>
              <li><span className="muted">Courts</span><span>{s.courts ?? "No court held"}</span></li>
              {s.coach_name && <li><span className="muted">Coach</span><span>{s.coach_name}</span></li>}
              <li>
                <span className="muted">Sign-ups close</span>
                <span>{formatLongDay(new Date(s.book_by).toLocaleDateString("en-CA", { timeZone: tz }))} {localTime(s.book_by, tz)}</span>
              </li>
              <li><span className="muted">Booked value</span><span>{formatMoney(revenue, org.currency)}</span></li>
              <li><span className="muted">From the weekly timetable</span><span>{s.schedule_id ? "Yes" : "No, one-off event"}</span></li>
            </ul>
            {s.description && <p className="small" style={{ marginTop: 12 }}>{s.description}</p>}
          </section>

          {s.status !== "cancelled" && !finished && (
            <section className="card">
              <h2>Cancel this session</h2>
              <p className="muted small">Frees its courts and cancels every place.</p>
              <form action={cancelSession} className="form">
                <input type="hidden" name="session_id" value={s.id} />
                <input name="reason" placeholder="Reason, e.g. heavy rain or coach unwell" />
                <button className="danger">Cancel session</button>
              </form>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function RosterList({
  rows,
  sessionId,
  started,
  cancellable,
  currency,
  payments,
}: {
  rows: RosterRow[];
  sessionId: string;
  started: boolean;
  cancellable: boolean;
  currency: string;
  payments: Map<string, { id: string; status: string; method: string | null }>;
}) {
  return (
    <ul className="list">
      {rows.map((r) => (
        <li key={r.id} style={{ flexWrap: "wrap" }}>
          <span>
            {r.member_id ? <Link href={`/members/${r.member_id}`}>{r.name}</Link> : r.name}
            <span className="muted small">
              {r.is_guest ? " · guest" : ""}
              {r.source === "online" ? " · booked online" : ""}
              {r.skill_level ? ` · ${r.skill_level}` : ""}
              {r.language ? ` · ${r.language.toUpperCase()}` : ""}
              {r.phone ? ` · ${r.phone}` : ""}
            </span>
            <div className="small muted">
              {paymentText(r, currency)}
              {payments.get(r.id)?.status === "paid" && ` · paid (${METHOD_LABELS[payments.get(r.id)!.method ?? ""] ?? "paid"})`}
              {payments.get(r.id)?.status === "refund_due" && " · paid, refund to check (Payments)"}
            </div>
            {payments.get(r.id)?.status === "pending" && (
              <MarkPaidForm orderId={payments.get(r.id)!.id} returnTo={`/sessions/${sessionId}`} compact />
            )}
          </span>
          <span className="actions">
            <span className={`badge ${STATUS_BADGE[r.status] ?? ""}`}>{r.status.replace("_", "-")}</span>
            {started && r.status === "booked" && (
              <>
                <Act sessionId={sessionId} id={r.id} action={markAttendance} extra={{ attended: "true" }} label="Attended" />
                <Act sessionId={sessionId} id={r.id} action={markAttendance} extra={{ attended: "false" }} label="No-show" />
              </>
            )}
            {cancellable && (r.status === "booked" || r.status === "waitlisted") && (
              <Act sessionId={sessionId} id={r.id} action={cancelRegistration} label="Cancel" danger />
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Act({
  sessionId,
  id,
  action,
  label,
  extra = {},
  danger = false,
}: {
  sessionId: string;
  id: string;
  action: (form: FormData) => Promise<void>;
  label: string;
  extra?: Record<string, string>;
  danger?: boolean;
}) {
  return (
    <form action={action} className="inline">
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="registration_id" value={id} />
      {Object.entries(extra).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {danger ? <ConfirmSubmit label={label} confirm={`Yes, ${label.toLowerCase()}`} /> : <button className="link">{label}</button>}
    </form>
  );
}

function paymentText(r: RosterRow, currency: string): string {
  if (r.credit_used) return `1 credit from ${r.covered_by}${r.sessions_left !== null ? ` (${r.sessions_left} left)` : ""}`;
  if (r.covered_by) return `Covered by ${r.covered_by}`;
  if (r.status === "waitlisted" && Number(r.price) === 0) return "Covered by their package when they move up";
  return `Pays ${formatMoney(r.price, currency)}`;
}
