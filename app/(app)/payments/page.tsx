import Link from "next/link";
import { requirePermission } from "@/lib/org";
import { Banner, param, type SearchParams } from "@/components/Banner";
import { MarkPaidForm, METHOD_LABELS } from "@/components/Payments";
import { formatMoney, todayIn, zonedToUtc } from "@/lib/time";
import { markUnpaid, recheckSlip, resolveRefund } from "./actions";
import type { Order } from "@/lib/types";

// Payments (Step 3): what members and guests still owe, what was received, and refunds to decide.
// Orders are made by the database for every paid booking, session place and package.

type Row = Order & {
  order_items: { description: string; kind: string; cancelled_at: string | null }[];
  members: { id: string; full_name: string } | null;
};

const TABS = [
  ["due", "To pay"],
  ["paid", "Paid"],
  ["refunds", "Refunds to check"],
] as const;

function when(iso: string, tz: string) {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz,
  });
}

export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, can, userId, location, workLocation } = await requirePermission("payments.record");
  const manager = can("payments.refund");
  const tz = workLocation?.timezone ?? org.timezone;
  const tab = (TABS.find(([k]) => k === param(sp, "tab"))?.[0] ?? "due") as (typeof TABS)[number][0];
  const today = todayIn(tz);
  const dayStart = zonedToUtc(today, "00:00", tz).toISOString();
  const monthStart = zonedToUtc(`${today.slice(0, 8)}01`, "00:00", tz).toISOString();

  const select = "*, order_items(description, kind, cancelled_at), members(id, full_name)";
  // With a location picked: that site's orders plus club-wide ones (packages).
  const locOr = location ? `location_id.eq.${location.id},location_id.is.null` : null;

  const statusFor = { due: ["pending"], paid: ["paid"], refunds: ["refund_due"] }[tab];
  let listQ = supabase.from("orders").select(select).eq("org_id", org.id).in("status", statusFor);
  listQ = tab === "paid" ? listQ.order("paid_at", { ascending: false }).limit(100) : listQ.order("created_at").limit(300);
  let dueQ = supabase.from("orders").select("total").eq("org_id", org.id).eq("status", "pending");
  let todayQ = supabase.from("orders").select("paid_amount").eq("org_id", org.id).not("paid_at", "is", null).gte("paid_at", dayStart);
  let monthQ = supabase.from("orders").select("paid_amount").eq("org_id", org.id).not("paid_at", "is", null).gte("paid_at", monthStart);
  if (locOr) {
    listQ = listQ.or(locOr);
    dueQ = dueQ.or(locOr);
    todayQ = todayQ.or(locOr);
    monthQ = monthQ.or(locOr);
  }

  const [{ data: listData }, { data: dueData }, { data: todayData }, { data: monthData }, { count: refundCount }] = await Promise.all([
    listQ,
    dueQ,
    todayQ,
    monthQ,
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "refund_due"),
  ]);
  const rows = (listData ?? []) as Row[];
  const sum = (xs: { total?: number | null; paid_amount?: number | null }[] | null, k: "total" | "paid_amount") =>
    (xs ?? []).reduce((n, x) => n + Number(x[k] ?? 0), 0);
  const dueTotal = sum(dueData as { total: number }[], "total");
  const todayTotal = sum(todayData as { paid_amount: number }[], "paid_amount");
  const monthTotal = sum(monthData as { paid_amount: number }[], "paid_amount");
  const self = `/payments${tab === "due" ? "" : `?tab=${tab}`}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payments</h1>
          <p className="muted">
            Every paid booking, session place and package{location ? ` at ${location.name}` : ""}. Mark what you&apos;ve
            received; free and package-covered places don&apos;t appear here.
          </p>
        </div>
      </div>
      <Banner sp={sp} />

      <div className="stats">
        <div className="stat">
          <div className="label">To collect</div>
          <div className="value"><span className="unit">{org.currency}</span>{dueTotal.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
          <div className="muted small">{(dueData ?? []).length} unpaid</div>
        </div>
        <div className="stat">
          <div className="label">Received today</div>
          <div className="value"><span className="unit">{org.currency}</span>{todayTotal.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="stat">
          <div className="label">Received this month</div>
          <div className="value"><span className="unit">{org.currency}</span>{monthTotal.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
        </div>
      </div>

      <nav className="tabs" aria-label="Payments">
        {TABS.map(([k, label]) => (
          <Link key={k} href={k === "due" ? "/payments" : `/payments?tab=${k}`} className={tab === k ? "active" : undefined}>
            {label}
            {k === "refunds" && (refundCount ?? 0) > 0 ? ` (${refundCount})` : ""}
          </Link>
        ))}
      </nav>

      <section className="card">
        {rows.length === 0 ? (
          <p className="muted">
            {tab === "due" ? "Nothing to collect." : tab === "paid" ? "No payments recorded yet." : "No refunds to check."}
          </p>
        ) : (
          rows.map((o) => {
            const who = o.members?.full_name ?? o.guest_name ?? "Guest";
            const items = o.order_items.map((i) => i.description + (i.cancelled_at ? " (cancelled)" : "")).join(" · ");
            return (
              <div key={o.id} className="order-row">
                <div className="order-head">
                  <span>
                    {o.members ? <Link href={`/members/${o.members.id}`}><strong>{who}</strong></Link> : <strong>{who}</strong>}
                    {!o.members && <span className="muted small"> · guest{o.guest_phone ? ` · ${o.guest_phone}` : ""}</span>}
                  </span>
                  <span className="order-amount">{formatMoney(tab === "due" ? o.total : o.paid_amount ?? o.total, org.currency)}</span>
                </div>
                <span className="small">{items}</span>
                {tab === "due" && (
                  <>
                    <span className="muted small">
                      Since {when(o.created_at, tz)} ·{" "}
                      <Link href={`/book/pay/${o.id}`} target="_blank">Show PromptPay QR</Link>
                      {o.payer_slip_at && (
                        <>
                          {" · "}
                          <strong style={{ color: "var(--warning)" }}>Slip received</strong>{" "}
                          <Link href={`/payments/slip/${o.id}`} target="_blank">see slip</Link>: check your bank, then mark paid
                        </>
                      )}
                    </span>
                    {o.slip_check && o.slip_check.status !== "verified" && (
                      <div className="small slip-check">
                        Automatic check: {o.slip_check.reasons.join("; ")}
                        {o.slip_check.receiver ? ` (slip: ${o.slip_check.receiver})` : ""}
                        <form action={recheckSlip} className="inline">
                          <input type="hidden" name="order_id" value={o.id} />
                          <input type="hidden" name="return_to" value={self} />
                          <button className="link" data-pending-label="Checking…">Check again</button>
                        </form>
                      </div>
                    )}
                    <MarkPaidForm orderId={o.id} returnTo={self} />
                  </>
                )}
                {tab !== "due" && (
                  <span className="muted small">
                    {METHOD_LABELS[o.method ?? ""] ?? o.method} · {o.paid_at ? when(o.paid_at, tz) : ""}
                    {o.received_by === userId ? " · by you" : ""}
                    {o.note ? ` · ${o.note}` : ""}
                    {o.slip_check?.status === "verified" && o.slip_check.trans_ref ? ` · bank ref ${o.slip_check.trans_ref}` : ""}
                    {o.slip_path && (
                      <>
                        {" · "}
                        <Link href={`/payments/slip/${o.id}`} target="_blank">Slip</Link>
                      </>
                    )}
                  </span>
                )}
                {tab === "paid" && manager && (
                  <form action={markUnpaid}>
                    <input type="hidden" name="order_id" value={o.id} />
                    <input type="hidden" name="return_to" value={self} />
                    <button className="link">Undo payment</button>
                  </form>
                )}
                {tab === "refunds" &&
                  (manager ? (
                    <div className="actions">
                      <span className="small">Paid, then cancelled. Did they get their money back?</span>
                      <form action={resolveRefund}>
                        <input type="hidden" name="order_id" value={o.id} />
                        <input type="hidden" name="return_to" value={self} />
                        <input type="hidden" name="refunded" value="true" />
                        <button>Refunded</button>
                      </form>
                      <form action={resolveRefund}>
                        <input type="hidden" name="order_id" value={o.id} />
                        <input type="hidden" name="return_to" value={self} />
                        <input type="hidden" name="refunded" value="false" />
                        <button className="link">Keep (no refund)</button>
                      </form>
                    </div>
                  ) : (
                    <span className="muted small">An owner, admin or back office decides about refunds.</span>
                  ))}
              </div>
            );
          })
        )}
      </section>
      {tab === "due" && (
        <p className="muted small" style={{ marginTop: 10 }}>
          Bookings and sales from before payments were added (26 Nov 2026) aren&apos;t listed. The oldest 300 are shown.
        </p>
      )}
    </>
  );
}
