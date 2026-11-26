import { markPaid } from "@/app/(app)/payments/actions";

export const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  transfer: "Bank transfer",
  promptpay: "PromptPay",
  card: "Card",
  other: "Other",
};

/** Mark an order paid: how, and optionally a note and a transfer slip photo. Works without JS. */
export function MarkPaidForm({ orderId, returnTo, compact }: { orderId: string; returnTo: string; compact?: boolean }) {
  return (
    <form action={markPaid} className={compact ? "pay-form compact" : "pay-form"}>
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <select name="method" defaultValue="cash" aria-label="How it was paid">
        {Object.entries(METHOD_LABELS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      {!compact && <input name="note" placeholder="Note (optional)" maxLength={300} aria-label="Note" />}
      {!compact && (
        <label className="slip-input small">
          Slip photo (optional)
          <input type="file" name="slip" accept="image/*" />
        </label>
      )}
      <button className="primary">Mark paid</button>
    </form>
  );
}
