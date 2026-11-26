import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { param, type SearchParams } from "@/components/Banner";
import { ClubLogo } from "@/components/ClubLogo";
import { promptPayKind, promptPayPayload } from "@/lib/promptpay";
import { loadPublicClub } from "@/lib/public";
import { formatMoney } from "@/lib/time";
import { sendPayerSlip } from "../../actions";

// Pay page for one unpaid booking or package: a PromptPay QR with the exact amount (scan in any
// Thai banking app; the money goes straight to the club), plus "send your slip". Reached by its
// order id (a payment link); shows only what's being paid for and the amount.

export const metadata: Metadata = { title: "Pay" };

interface PublicOrder {
  id: string;
  status: "pending" | "paid" | "cancelled" | "refund_due" | "refunded";
  total: number;
  currency: string;
  items: string[];
  awaiting_approval: boolean;
  slip_sent: boolean;
  promptpay_id: string | null;
  promptpay_name: string | null;
}

export default async function PayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, slug, club } = await loadPublicClub();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { data } = await supabase.rpc("public_order", { p_slug: slug, p_order: id });
  const o = data as PublicOrder | null;
  if (!o) notFound();

  const canQr = o.status === "pending" && !o.awaiting_approval && !!promptPayKind(o.promptpay_id);
  const qr = canQr
    ? await QRCode.toString(promptPayPayload(o.promptpay_id!, Number(o.total)), { type: "svg", margin: 2, width: 260 })
    : null;
  const error = param(sp, "error");
  const notice = param(sp, "notice");

  return (
    <main className="public pay-page">
      <div className="public-crumb">
        <Link href="/book">← Booking</Link>
        <span className="club">
          <ClubLogo path={club.logo_path} name={club.name} small />
          {club.name}
        </span>
      </div>
      <h1 style={{ marginTop: 12 }}>{o.status === "paid" ? "Paid, thank you" : "Pay"}</h1>
      <p className="muted">{o.items.join(" · ")}</p>
      {error && <div className="banner error" role="alert">{error}</div>}
      {notice && <div className="banner notice" role="status">{notice}</div>}

      <section className="card pay-card">
        <div className="pay-amount">{formatMoney(Number(o.total), o.currency)}</div>
        {o.status === "paid" ? (
          <p>The club has received your payment.</p>
        ) : o.status !== "pending" ? (
          <p>There&apos;s nothing to pay for this any more.</p>
        ) : o.awaiting_approval ? (
          <p>The club still has to confirm your booking. You can pay once it&apos;s confirmed.</p>
        ) : !qr ? (
          <p>Please pay at the club.</p>
        ) : (
          <>
            <div className="pay-qr" role="img" aria-label={`PromptPay QR for ${formatMoney(Number(o.total), o.currency)}`} dangerouslySetInnerHTML={{ __html: qr }} />
            <p className="small">
              Scan with any Thai banking app (PromptPay). It shows <strong>{o.promptpay_name || club.name}</strong> and the
              amount above.
            </p>
            <p className="small">
              <a href={`/book/pay/${o.id}/qr`} download={`${slug}-promptpay.png`} className="button">Save QR image</a>{" "}
              <span className="muted">On this phone? Save it, then choose it in your banking app&apos;s scan screen.</span>
            </p>
          </>
        )}
      </section>

      {o.status === "pending" && !o.awaiting_approval && (
        <section className="card">
          <h2>{o.slip_sent ? "Slip received" : "Paid? Send your slip"}</h2>
          {o.slip_sent ? (
            <p className="small">Thanks. The club will check it and confirm. You can send another if needed.</p>
          ) : (
            <p className="muted small">A screenshot of the transfer helps the club confirm it quickly.</p>
          )}
          <form action={sendPayerSlip} className="form">
            <input type="hidden" name="order_id" value={o.id} />
            <input type="file" name="slip" accept="image/*" required />
            <button className="primary" style={{ justifySelf: "start" }}>Send slip</button>
          </form>
        </section>
      )}
      <p className="muted small public-foot">Booking by Courtix</p>
    </main>
  );
}
