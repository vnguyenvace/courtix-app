import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { SessionStatusBadge, Spots, levelText } from "@/components/SessionBits";
import { formatLongDay, formatMoney, localTime } from "@/lib/time";
import { cancelRegistration, cancelSession, markAttendance, registerForSession } from "../actions";
import { CATEGORY_LABELS, type MemberStatus, type RosterRow, type SessionOverview } from "@/lib/types";

const STATUS_BADGE: Record<string, string> = {
  booked: "ok",
  attended: "ok",
  waitlisted: "info",
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
  const { supabase, org, multiLocation } = await requireOrg();

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

  const s = sData as SessionOverview;
  const roster = (rData ?? []) as RosterRow[];
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
          <h1>{s.name}</h1>
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
              <RosterList rows={playing} sessionId={s.id} started={started} cancellable={!finished && s.status !== "cancelled"} />
            )}
          </section>

          {waiting.length > 0 && (
            <section className="card">
              <h2>Waitlist ({waiting.length})</h2>
              <p className="muted small">The first person moves up automatically when someone cancels.</p>
              <RosterList rows={waiting} sessionId={s.id} started={false} cancellable />
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
                        {m.full_name}{m.package_name ? ` · ${m.package_name}` : ""}
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
                  Price {formatMoney(s.price, org.currency)}. Package credits and payments come in the next step.
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
}: {
  rows: RosterRow[];
  sessionId: string;
  started: boolean;
  cancellable: boolean;
}) {
  return (
    <ul className="list">
      {rows.map((r) => (
        <li key={r.id} style={{ flexWrap: "wrap" }}>
          <span>
            {r.member_id ? <Link href={`/members/${r.member_id}`}>{r.name}</Link> : r.name}
            <span className="muted small">
              {r.is_guest ? " · guest" : ""}
              {r.skill_level ? ` · ${r.skill_level}` : ""}
              {r.language ? ` · ${r.language.toUpperCase()}` : ""}
              {r.phone ? ` · ${r.phone}` : ""}
            </span>
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
      <button className={`link ${danger ? "danger" : ""}`}>{label}</button>
    </form>
  );
}
