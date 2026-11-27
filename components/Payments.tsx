import { markPaid } from "@/app/(app)/payments/actions";
import type { T } from "@/lib/i18n";

const same: T = (s) => s;

export const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  transfer: "Bank transfer",
  promptpay: "PromptPay",
  card: "Card",
  other: "Other",
};

/** Mark an order paid: how, and optionally a note and a transfer slip photo. Works without JS. */
export function MarkPaidForm({ orderId, returnTo, compact, t = same }: { orderId: string; returnTo: string; compact?: boolean; t?: T }) {
  return (
    <form action={markPaid} className={compact ? "pay-form compact" : "pay-form"}>
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <select name="method" defaultValue="cash" aria-label={t("How it was paid")}>
        {Object.entries(METHOD_LABELS).map(([k, v]) => (
          <option key={k} value={k}>{t(v)}</option>
        ))}
      </select>
      {!compact && <input name="note" placeholder={t("Note (optional)")} maxLength={300} aria-label={t("Note")} />}
      {!compact && (
        <label className="slip-input small">
          {t("Slip photo (optional)")}
          <input type="file" name="slip" accept="image/*" />
        </label>
      )}
      <button className="primary">{t("Mark paid")}</button>
    </form>
  );
}
