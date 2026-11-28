import Link from "next/link";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { canManage, requireOrg } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { SessionStatusBadge, Spots, levelText } from "@/components/SessionBits";
import { formatLongDay, formatMoney, localTime } from "@/lib/time";
import { addDivision, addPriceTier, approveRequest, cancelRegistration, cancelSession, declineRequest, markAttendance, registerForSession, removeDivision, removePriceTier, setEventOptions } from "../actions";
import { CATEGORY_LABELS, type Division, type MemberStatus, type PriceTier, type RosterRow, type SessionOverview } from "@/lib/types";
import { MarkPaidForm, METHOD_LABELS } from "@/components/Payments";
import type { T } from "@/lib/i18n";

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
  const { supabase, org, multiLocation, role, t, locale, can } = await requireOrg();
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
    if (m.package_types?.kind === "time_based") coverHint.set(m.member_id, t("covered"));
    else if ((m.sessions_left ?? 0) > 0 && coverHint.get(m.member_id) !== t("covered")) {
      coverHint.set(m.member_id, t("uses 1 credit, {n} left", { n: m.sessions_left ?? 0 }));
    }
  }

  const s = sData as SessionOverview;
  // Event tickets (Step 4): price tiers, divisions with places taken, the price for the next sign-up.
  const [{ data: tierData }, { data: divData }, { data: priceNow }] = await Promise.all([
    supabase.from("session_price_tiers").select("*").eq("session_id", id).order("price").order("sort_order"),
    supabase.from("session_divisions").select("*").eq("session_id", id).order("sort_order").order("name"),
    supabase.rpc("event_price", { p_session: id, p_spots: 1 }),
  ]);
  const tiers = (tierData ?? []) as PriceTier[];
  const divisions = (divData ?? []) as Division[];
  const current = ((priceNow ?? []) as { tier_id: string | null; price: number; label: string | null }[])[0] ?? null;
  const ticketsEditable = can("club.setup") && s.status !== "cancelled";

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

  const divTaken = new Map<string, number>();
  for (const r of roster) {
    if (r.division_id && (r.status === "booked" || r.status === "attended")) divTaken.set(r.division_id, (divTaken.get(r.division_id) ?? 0) + r.spots);
  }
  const localDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
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
          <Link href={`/sessions?from=${day}`} className="small">← {t("Sessions")}</Link>
          <div className="title-row">
            <h1>{s.name}</h1>
            {editable && s.status !== "cancelled" && !finished && (
              <Link href={`/sessions/${s.id}/edit`} className="button small-button">
                <Pencil size={15} strokeWidth={1.75} aria-hidden />
                {t("Edit")}
              </Link>
            )}
          </div>
          <p className="muted">
            {multiLocation ? `${s.location_name} · ` : ""}
            {formatLongDay(day, locale)} · {localTime(s.starts_at, tz)}–
            {endDay !== day ? `${formatLongDay(endDay, locale)} ` : ""}
            {localTime(s.ends_at, tz)}
          </p>
          <div className="actions">
            <SessionStatusBadge s={s} t={t} />
            <span className="badge">{t(CATEGORY_LABELS[s.category])}</span>
            <span className="badge">{levelText(s.level_min, s.level_max, t)}</span>
            {s.min_age && <span className="badge">{t("age {n}+", { n: s.min_age })}</span>}
          </div>
        </div>
        <div className="stat" style={{ minWidth: 200 }}>
          <div className="label">{t("Players")}</div>
          <Spots s={s} />
          <div className="muted small" style={{ marginTop: 4 }}>
            {t("Minimum {n} · {price} each", { n: s.min_players, price: formatMoney(s.price, org.currency) })}
          </div>
        </div>
      </div>
      <Banner sp={sp} />
      {s.status === "cancelled" && (
        <div className="banner error">{t("Cancelled")}{s.cancel_reason ? `: ${s.cancel_reason}` : ""}.</div>
      )}
      {s.notes && <div className="banner notice">{s.notes}</div>}

      <div className="grid grid-2">
        <div className="stack">
          <section className="card">
            <h2>{t("Signed up")} ({playing.reduce((n, r) => n + r.spots, 0)})</h2>
            {playing.length === 0 ? (
              <p className="muted small">{t("Nobody yet.")}</p>
            ) : (
              <RosterList rows={playing} sessionId={s.id} started={started} cancellable={!finished && s.status !== "cancelled"} currency={org.currency} payments={payments} t={t} />
            )}
          </section>

          {requests.length > 0 && (
            <section className="card">
              <h2>{t("Online requests")} ({requests.length})</h2>
              <p className="muted small">
                {t("Waiting for you to approve. Approving books them (or waitlists them if the session has filled up).")}
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
                        <Act sessionId={s.id} id={r.id} action={approveRequest} label={t("Approve")} t={t} />
                        <Act sessionId={s.id} id={r.id} action={declineRequest} label={t("Decline")} danger t={t} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {waiting.length > 0 && (
            <section className="card">
              <h2>{t("Waitlist")} ({waiting.length})</h2>
              <p className="muted small">{t("The first person moves up automatically when someone cancels.")}</p>
              <RosterList rows={waiting} sessionId={s.id} started={false} cancellable currency={org.currency} payments={payments} t={t} />
            </section>
          )}

          {cancelled.length > 0 && (
            <details className="card">
              <summary className="small" style={{ cursor: "pointer" }}>{t("Cancelled places")} ({cancelled.length})</summary>
              <ul className="list" style={{ marginTop: 8 }}>
                {cancelled.map((r) => (
                  <li key={r.id}><span>{r.name}</span><span className="muted small">{t("cancelled")}</span></li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="stack">
          {s.status !== "cancelled" && finished && (
            <section className="card">
              <h2>{t("This session has finished")}</h2>
              <p className="muted small">
                {t("It ended at {time}, so sign-ups and cancellations are closed.", { time: localTime(s.ends_at, tz) })}{" "}
                <Link href={`/sessions?from=${day}`}>{t("Find an upcoming session")}</Link>
              </p>
            </section>
          )}
          {s.status !== "cancelled" && !finished && (
            <section className="card">
              <h2>{s.spots_left === 0 ? t("Add to waitlist") : t("Sign someone up")}</h2>
              <form action={registerForSession} className="form">
                <input type="hidden" name="session_id" value={s.id} />
                <label>
                  {t("Member")}
                  <select name="member_id" defaultValue="">
                    <option value="">{t("Guest (enter name below)")}</option>
                    {available.map((m) => (
                      <option key={m.member_id} value={m.member_id}>
                        {m.full_name}
                        {coverHint.has(m.member_id) ? ` · ${coverHint.get(m.member_id)}` : m.package_name ? ` · ${m.package_name} (${t("not covered")})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-row">
                  <label>
                    {t("Guest name")}
                    <input name="guest_name" placeholder="Tourist Tom" />
                  </label>
                  <label>
                    {t("Guest phone or WhatsApp")}
                    <input name="guest_phone" type="tel" placeholder="+66 81 234 5678" />
                  </label>
                </div>
                {divisions.length > 0 && (
                  <label>
                    {t("Division")}
                    <select name="division_id" required defaultValue="">
                      <option value="" disabled>{t("Choose a division")}</option>
                      {divisions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} · {t("{n} places left", { n: Math.max(d.max_players - (divTaken.get(d.id) ?? 0), 0) })}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {s.allow_pairs && (
                  <div className="form-row">
                    <label className="check">
                      <input type="checkbox" name="pair" /> {t("Sign up as a pair (2 places, pays for both)")}
                    </label>
                    <label>
                      {t("Partner's name")}
                      <input name="partner_name" maxLength={80} />
                    </label>
                  </div>
                )}
                {closed && (
                  <label className="check">
                    <input type="checkbox" name="allow_late" /> {t("Sign-ups have closed. Add them anyway (desk override)")}
                  </label>
                )}
                {(s.level_min !== null || s.level_max !== null) && (
                  <label className="check">
                    <input type="checkbox" name="ignore_level" /> {t("Allow even if their level is outside {level}", { level: levelText(s.level_min, s.level_max, t) })}
                  </label>
                )}
                <p className="muted small">
                  {current?.price == null
                    ? t("Sold out at every price.")
                    : t("Price {price}. Members whose package covers this session pay nothing; session packs use 1 credit.", {
                        price: `${formatMoney(current.price, org.currency)}${current.label ? ` (${current.label})` : ""}`,
                      })}
                </p>
                <button className="primary">{s.spots_left === 0 ? t("Add to waitlist") : t("Sign up")}</button>
              </form>
            </section>
          )}


          <section className="card">
            <h2>{t("Details")}</h2>
            <ul className="list">
              <li><span className="muted">{t("Location")}</span><span>{s.location_name}</span></li>
              <li><span className="muted">{t("Courts")}</span><span>{s.courts ?? t("No court held")}</span></li>
              {s.coach_name && <li><span className="muted">{t("Coach")}</span><span>{s.coach_name}</span></li>}
              <li>
                <span className="muted">{t("Sign-ups close")}</span>
                <span>{formatLongDay(new Date(s.book_by).toLocaleDateString("en-CA", { timeZone: tz }), locale)} {localTime(s.book_by, tz)}</span>
              </li>
              <li><span className="muted">{t("Booked value")}</span><span>{formatMoney(revenue, org.currency)}</span></li>
              <li><span className="muted">{t("From the weekly timetable")}</span><span>{s.schedule_id ? t("Yes") : t("No, one-off event")}</span></li>
            </ul>
            {s.description && <p className="small" style={{ marginTop: 12 }}>{s.description}</p>}
          </section>

          {(ticketsEditable || tiers.length > 0 || divisions.length > 0 || s.allow_pairs || s.registration_deadline) && (
            <section className="card" id="tickets">
              <h2>{t("Tickets")}</h2>
              <h3 className="small" style={{ marginTop: 4 }}>{t("Prices")}</h3>
              {tiers.length === 0 ? (
                <p className="muted small">{t("One price for everyone: {price}. Add prices for early bird or other tiers.", { price: formatMoney(s.price, org.currency) })}</p>
              ) : (
                <ul className="list small">
                  {tiers.map((p) => (
                    <li key={p.id}>
                      <span>
                        <strong>{p.label}</strong> · {formatMoney(p.price, org.currency)}
                        {p.available_until && ` · ${t("until {date}", { date: `${formatLongDay(localDate(p.available_until), locale)} ${localTime(p.available_until, tz)}` })}`}
                        {p.max_qty && ` · ${t("first {n} places", { n: p.max_qty })}`}
                        {current?.tier_id === p.id && <span className="badge ok" style={{ marginLeft: 6 }}>{t("now")}</span>}
                      </span>
                      {ticketsEditable && (
                        <form action={removePriceTier} className="inline">
                          <input type="hidden" name="session_id" value={s.id} />
                          <input type="hidden" name="tier_id" value={p.id} />
                          <button className="link">{t("Remove")}</button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {ticketsEditable && (
                <details style={{ marginTop: 6 }}>
                  <summary className="small">{t("Add a price")}</summary>
                  <form action={addPriceTier} className="form" style={{ marginTop: 8 }}>
                    <input type="hidden" name="session_id" value={s.id} />
                    <input type="hidden" name="timezone" value={tz} />
                    <div className="form-row">
                      <label>
                        {t("Label")}
                        <input name="label" required maxLength={60} placeholder={t("Early bird")} />
                      </label>
                      <label>
                        {t("Price per person ({currency})", { currency: org.currency })}
                        <input name="price" type="number" min="0" step="1" required />
                      </label>
                    </div>
                    <div className="form-row">
                      <label>
                        {t("Until (optional)")}
                        <input name="until_date" type="date" />
                      </label>
                      <label>
                        {t("Time")}
                        <input name="until_time" type="time" defaultValue="23:59" />
                      </label>
                      <label>
                        {t("Only the first … places (optional)")}
                        <input name="max_qty" type="number" min="1" />
                      </label>
                    </div>
                    <p className="muted small">{t("The cheapest price still open is used at sign-up. People keep the price they signed up at.")}</p>
                    <button>{t("Add price")}</button>
                  </form>
                </details>
              )}

              <h3 className="small" style={{ marginTop: 12 }}>{t("Divisions")}</h3>
              {divisions.length === 0 ? (
                <p className="muted small">{t("No divisions: everyone shares the {n} places.", { n: s.max_players })}</p>
              ) : (
                <ul className="list small">
                  {divisions.map((d) => (
                    <li key={d.id}>
                      <span>
                        <strong>{d.name}</strong> · {t("{taken} of {n} places taken", { taken: divTaken.get(d.id) ?? 0, n: d.max_players })}
                        {(d.level_min !== null || d.level_max !== null) && ` · ${levelText(d.level_min, d.level_max, t)}`}
                      </span>
                      {ticketsEditable && (
                        <form action={removeDivision} className="inline">
                          <input type="hidden" name="session_id" value={s.id} />
                          <input type="hidden" name="division_id" value={d.id} />
                          <button className="link">{t("Remove")}</button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {ticketsEditable && (
                <details style={{ marginTop: 6 }}>
                  <summary className="small">{t("Add a division")}</summary>
                  <form action={addDivision} className="form" style={{ marginTop: 8 }}>
                    <input type="hidden" name="session_id" value={s.id} />
                    <div className="form-row">
                      <label>
                        {t("Name")}
                        <input name="name" required maxLength={60} placeholder={t("Beginner")} />
                      </label>
                      <label>
                        {t("Places")}
                        <input name="max_players" type="number" min="1" required />
                      </label>
                      <label>
                        {t("Level from")}
                        <input name="level_min" type="number" step="0.5" min="1" max="6" placeholder={t("Any")} />
                      </label>
                      <label>
                        {t("Level to")}
                        <input name="level_max" type="number" step="0.5" min="1" max="6" placeholder={t("Any")} />
                      </label>
                    </div>
                    <p className="muted small">{t("Each division fills on its own. The event's total places still apply.")}</p>
                    <button>{t("Add division")}</button>
                  </form>
                </details>
              )}

              <h3 className="small" style={{ marginTop: 12 }}>{t("Pairs and deadline")}</h3>
              {ticketsEditable ? (
                <form action={setEventOptions} className="form">
                  <input type="hidden" name="session_id" value={s.id} />
                  <input type="hidden" name="timezone" value={tz} />
                  <label className="check">
                    <input type="checkbox" name="allow_pairs" defaultChecked={s.allow_pairs} /> {t("Allow pair sign-ups (one person signs up two, and pays for both)")}
                  </label>
                  <div className="form-row">
                    <label>
                      {t("Registration closes (optional)")}
                      <input name="deadline_date" type="date" defaultValue={s.registration_deadline ? localDate(s.registration_deadline) : ""} />
                    </label>
                    <label>
                      {t("Time")}
                      <input name="deadline_time" type="time" defaultValue={s.registration_deadline ? localTime(s.registration_deadline, tz) : "23:59"} />
                    </label>
                  </div>
                  <button>{t("Save")}</button>
                </form>
              ) : (
                <p className="small">
                  {s.allow_pairs ? t("Pairs allowed.") : t("Single sign-ups only.")}{" "}
                  {s.registration_deadline &&
                    t("Registration closes {date}.", { date: `${formatLongDay(localDate(s.registration_deadline), locale)} ${localTime(s.registration_deadline, tz)}` })}
                </p>
              )}
            </section>
          )}

          {s.status !== "cancelled" && !finished && (
            <section className="card">
              <h2>{t("Cancel this session")}</h2>
              <p className="muted small">{t("Frees its courts and cancels every place.")}</p>
              <form action={cancelSession} className="form">
                <input type="hidden" name="session_id" value={s.id} />
                <input name="reason" placeholder={t("Reason, e.g. heavy rain or coach unwell")} />
                <button className="danger">{t("Cancel session")}</button>
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
  t,
}: {
  rows: RosterRow[];
  sessionId: string;
  started: boolean;
  cancellable: boolean;
  currency: string;
  payments: Map<string, { id: string; status: string; method: string | null }>;
  t: T;
}) {
  return (
    <ul className="list">
      {rows.map((r) => (
        <li key={r.id} style={{ flexWrap: "wrap" }}>
          <span>
            {r.member_id ? <Link href={`/members/${r.member_id}`}>{r.name}</Link> : r.name}
            <span className="muted small">
              {r.spots === 2 ? ` · ${t("pair with {name}", { name: r.partner_name ?? "" })}` : ""}
              {r.division_name ? ` · ${r.division_name}` : ""}
              {r.tier_label ? ` · ${r.tier_label}` : ""}
              {r.is_guest ? ` · ${t("guest")}` : ""}
              {r.source === "online" ? ` · ${t("booked online")}` : ""}
              {r.skill_level ? ` · ${r.skill_level}` : ""}
              {r.language ? ` · ${r.language.toUpperCase()}` : ""}
              {r.phone ? ` · ${r.phone}` : ""}
            </span>
            <div className="small muted">
              {paymentText(r, currency, t)}
              {payments.get(r.id)?.status === "paid" && ` · ${t("paid")} (${t(METHOD_LABELS[payments.get(r.id)!.method ?? ""] ?? "paid")})`}
              {payments.get(r.id)?.status === "refund_due" && ` · ${t("paid, refund to check (Payments)")}`}
            </div>
            {payments.get(r.id)?.status === "pending" && (
              <MarkPaidForm orderId={payments.get(r.id)!.id} returnTo={`/sessions/${sessionId}`} compact t={t} />
            )}
          </span>
          <span className="actions">
            <span className={`badge ${STATUS_BADGE[r.status] ?? ""}`}>{t(r.status.replace("_", "-"))}</span>
            {started && r.status === "booked" && (
              <>
                <Act sessionId={sessionId} id={r.id} action={markAttendance} extra={{ attended: "true" }} label={t("Attended")} t={t} />
                <Act sessionId={sessionId} id={r.id} action={markAttendance} extra={{ attended: "false" }} label={t("No-show")} t={t} />
              </>
            )}
            {cancellable && (r.status === "booked" || r.status === "waitlisted") && (
              <Act sessionId={sessionId} id={r.id} action={cancelRegistration} label={t("Cancel")} danger t={t} />
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
  t,
}: {
  sessionId: string;
  id: string;
  action: (form: FormData) => Promise<void>;
  label: string;
  extra?: Record<string, string>;
  danger?: boolean;
  t: T;
}) {
  return (
    <form action={action} className="inline">
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="registration_id" value={id} />
      {Object.entries(extra).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {danger ? <ConfirmSubmit label={label} confirm={t("Yes, {action}", { action: label.toLowerCase() })} /> : <button className="link">{label}</button>}
    </form>
  );
}

function paymentText(r: RosterRow, currency: string, t: T): string {
  if (r.credit_used) return `${t("1 credit from {pkg}", { pkg: r.covered_by ?? "" })}${r.sessions_left !== null ? ` (${t("{n} left", { n: r.sessions_left })})` : ""}`;
  if (r.covered_by) return t("Covered by {pkg}", { pkg: r.covered_by });
  if (r.status === "waitlisted" && Number(r.price) === 0) return t("Covered by their package when they move up");
  return t("Pays {amount}", { amount: formatMoney(r.price, currency) });
}
