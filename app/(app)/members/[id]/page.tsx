import Link from "next/link";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
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
import { MarkPaidForm, METHOD_LABELS } from "@/components/Payments";
import type { Order } from "@/lib/types";

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, org, locations, t, locale } = await requireOrg();
  const today = todayIn(org.timezone);

  const [member, status, memberships, packages, checkIns, bookings, orderData] = await Promise.all([
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
    // Payments (Step 3): what they owe, and what they paid lately.
    supabase
      .from("orders")
      .select("id, status, total, paid_amount, method, paid_at, created_at, order_items(description, cancelled_at)")
      .eq("member_id", id)
      .in("status", ["pending", "paid", "refund_due"])
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  if (!member.data) notFound();
  const m = member.data as Member;
  const s = status.data as MemberStatus | null;
  const ms = (memberships.data ?? []) as Membership[];
  const pkgs = (packages.data ?? []) as PackageType[];
  const visits = (checkIns.data ?? []) as { id: string; checked_in_at: string; source: string; location_id: string | null }[];
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const orders = (orderData.data ?? []) as unknown as (Pick<Order, "id" | "status" | "total" | "paid_amount" | "method" | "paid_at" | "created_at"> & {
    order_items: { description: string; cancelled_at: string | null }[];
  })[];
  const books = (bookings.data ?? []) as BookingRow[];
  const current = ms.find((x) => x.status === "active");
  const path = `/members/${m.id}`;

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/members" className="small">← {t("Members")}</Link>
          <h1>{m.full_name}</h1>
          <p className="muted">
            {s ? lastVisitText(s.days_since_visit, t) : ""} · {t("Member since {date}", { date: formatDate(m.created_at, locale) })}
          </p>
          {s && <MemberBadges s={s} t={t} />}
        </div>
        <div className="actions">
          <form action={checkIn} className="inline">
            <input type="hidden" name="member_id" value={m.id} />
            <button className="primary">{t("Check in now")}</button>
          </form>
          <Link className="button" href={`/bookings?date=${today}`}>{t("Book a court")}</Link>
        </div>
      </div>
      <Banner sp={sp} />

      <div className="grid grid-2">
        <div className="stack">
          <section className="card">
            <h2>{t("Packages")}</h2>
            {ms.length === 0 ? (
              <p className="muted small">{t("No packages yet.")}</p>
            ) : (
              <ul className="list">
                {ms.map((x) => (
                  <li key={x.id} style={{ flexWrap: "wrap" }}>
                    <span>
                      <strong>{x.package_types?.name}</strong>
                      <div className="muted small">
                        {formatDate(x.starts_on, locale)} – {x.ends_on ? formatDate(x.ends_on, locale) : t("no end date")}
                        {x.sessions_left !== null && ` · ${t("{n} sessions left", { n: x.sessions_left })}`}
                        {" · "}{formatMoney(x.price_paid, org.currency)}
                        {x.status === "paused" && ` · ${t("paused until {date}", { date: formatDate(x.paused_until, locale) })}`}
                      </div>
                    </span>
                    <span className="actions">
                      <span className={`badge ${x.status === "active" ? "ok" : x.status === "paused" ? "info" : ""}`}>
                        {t(x.status)}
                      </span>
                      {x.status === "active" && (
                        <form action={cancelMembership} className="inline">
                          <input type="hidden" name="member_id" value={m.id} />
                          <input type="hidden" name="membership_id" value={x.id} />
                          <ConfirmSubmit label={t("Cancel")} confirm={t("Yes, cancel package")} />
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>{t("Sell a package")}</h2>
            <form action={sellPackage} className="form">
              <input type="hidden" name="member_id" value={m.id} />
              <label>
                {t("Package")}
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
                  {t("Starts on")}
                  <input
                    type="date"
                    name="starts_on"
                    defaultValue={current?.ends_on && current.ends_on >= today ? addDays(current.ends_on, 1) : today}
                  />
                </label>
                <label>
                  {t("Price paid (leave blank for list price)")}
                  <input type="number" name="price" min="0" step="1" placeholder={t("List price")} />
                </label>
              </div>
              <label>
                {t("Payment")}
                <select name="paid_with" defaultValue="">
                  <option value="">{t("Not paid yet (pay later)")}</option>
                  {Object.entries(METHOD_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{t("Paid now: {method}", { method: t(v) })}</option>
                  ))}
                </select>
              </label>
              <button className="primary">{t("Sell package")}</button>
            </form>
          </section>

          <section className="card">
            <h2>{t("Payments")}</h2>
            {orders.length === 0 ? (
              <p className="muted small">{t("Nothing to pay, no payments yet.")}</p>
            ) : (
              orders.map((o) => (
                <div key={o.id} className="order-row">
                  <div className="order-head">
                    <span className="small">{o.order_items.map((i) => i.description).join(" · ")}</span>
                    <span className="order-amount">{formatMoney(o.status === "pending" ? o.total : o.paid_amount ?? o.total, org.currency)}</span>
                  </div>
                  {o.status === "pending" ? (
                    <MarkPaidForm orderId={o.id} returnTo={`/members/${m.id}`} compact t={t} />
                  ) : (
                    <span className="muted small">
                      {o.status === "refund_due" ? t("Paid, then cancelled: refund to check (Payments)") : `${t("Paid")} · ${t(METHOD_LABELS[o.method ?? ""] ?? o.method ?? "")}`}
                      {o.paid_at ? ` · ${new Date(o.paid_at).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: org.timezone })}` : ""}
                    </span>
                  )}
                </div>
              ))
            )}
          </section>

          {current && (
            <section className="card">
              <h2>{t("Pause instead of cancel")}</h2>
              <p className="muted small">
                {t("For members leaving Phuket for a while. The end date moves out by the pause length.")}
              </p>
              <form action={pauseMembership} className="form">
                <input type="hidden" name="member_id" value={m.id} />
                <input type="hidden" name="membership_id" value={current.id} />
                <div className="form-row">
                  <label>
                    {t("From")}
                    <input type="date" name="paused_from" required defaultValue={today} />
                  </label>
                  <label>
                    {t("Until")}
                    <input type="date" name="paused_until" required />
                  </label>
                </div>
                <button>{t("Pause membership")}</button>
              </form>
            </section>
          )}

          <section className="card">
            <h2>{t("Recent bookings")}</h2>
            {books.length === 0 ? (
              <p className="muted small">{t("No bookings yet.")}</p>
            ) : (
              <ul className="list">
                {books.map((b) => (
                  <li key={b.id}>
                    <span>
                      {formatDate(new Date(b.start_at).toLocaleDateString("en-CA", { timeZone: org.timezone }), locale)}{" "}
                      {localTime(b.start_at, org.timezone)} · {b.court_name}{locations.length > 1 ? `, ${b.location_name}` : ""}
                    </span>
                    <span className="actions">
                      <span className={`badge ${b.status === "confirmed" ? "ok" : b.status === "no_show" ? "danger" : ""}`}>
                        {t(b.status.replace("_", "-"))}
                      </span>
                      {b.status === "confirmed" && new Date(b.end_at) > new Date() && (
                        <form action={setBookingStatus} className="inline">
                          <input type="hidden" name="booking_id" value={b.id} />
                          <input type="hidden" name="status" value="cancelled" />
                          <input type="hidden" name="return_to" value={path} />
                          <ConfirmSubmit label={t("Cancel")} confirm={t("Yes, cancel booking")} />
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>{t("Recent visits")}</h2>
            {visits.length === 0 ? (
              <p className="muted small">{t("No visits yet.")}</p>
            ) : (
              <ul className="list">
                {visits.map((v) => (
                  <li key={v.id}>
                    <span>{new Date(v.checked_in_at).toLocaleString(locale, { timeZone: org.timezone, dateStyle: "medium", timeStyle: "short" })}</span>
                    <span className="muted small">{locations.length > 1 && v.location_id ? `${locName.get(v.location_id)} · ` : ""}{t(v.source)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="card">
          <h2>{t("Details")}</h2>
          <form action={updateMember} className="form">
            <input type="hidden" name="member_id" value={m.id} />
            <MemberFields m={m} locations={locations} t={t} />
            <p className="small">
              {m.line_user_id ? (
                <span className="badge ok">{t("Linked on LINE")}</span>
              ) : (
                <>
                  <span className="badge">{t("Not linked on LINE")}</span>{" "}
                  <span className="muted">
                    {t("When they message the club's LINE, open that chat in Chats and use \"Link to member\". Then they get reminders and sign-in codes on LINE.")}{" "}
                    <Link href="/chats">{t("Chats")}</Link>
                  </span>
                </>
              )}
            </p>
            <button className="primary">{t("Save details")}</button>
          </form>
        </section>
      </div>
    </>
  );
}
