// Deciding whether a checked transfer slip pays an order (no network here: lib/slipCheck.ts asks
// EasySlip, this decides). Conservative on purpose: any doubt goes to staff, with the reason.

/** What we use from EasySlip's v2 response (data.rawSlip). */
export interface CheckedSlip {
  transRef: string;
  date: string; // ISO 8601
  amount: number;
  receiver: {
    name: { th?: string; en?: string };
    bankAccount?: string | null; // masked, e.g. xxx-x-x1234-x
    proxy?: { type: string; account: string } | null; // PromptPay: MSISDN / NATID / EWALLETID, masked
  };
}

export interface SlipExpectation {
  total: number;
  promptpayId: string | null; // the club's, digits only (0xxxxxxxxx / 13 / 15 digits)
  promptpayName: string | null;
  orderCreatedAt: string;
  now?: Date;
}

export interface SlipDecision {
  ok: boolean;
  reasons: string[]; // why not, in words staff understand
}

const PROXY_FOR: Record<string, string> = { phone: "MSISDN", national_id: "NATID", ewallet: "EWALLETID" };

function kindOf(id: string): "phone" | "national_id" | "ewallet" | null {
  if (/^0\d{9}$/.test(id)) return "phone";
  if (/^\d{13}$/.test(id)) return "national_id";
  if (/^\d{15}$/.test(id)) return "ewallet";
  return null;
}

/**
 * Does a masked number (e.g. "xxx-xxx-5678" or "081-xxx-5678") fit the club's number?
 * Compared from the right; every digit shown must match, and at least 3 must be shown.
 * Thai mobile numbers may come as 0812345678 or 66812345678: compared without that prefix.
 */
export function maskedMatches(masked: string, clubDigits: string): boolean {
  const m = masked.replace(/[^0-9xX*]/g, "").toLowerCase().replace(/\*/g, "x");
  const club = clubDigits.replace(/\D/g, "");
  const strip = (s: string) => (s.startsWith("66") && s.length === 11 ? s.slice(2) : s.startsWith("0") && s.length === 10 ? s.slice(1) : s);
  const a = strip(m);
  const b = strip(club);
  let shown = 0;
  for (let i = 1; i <= Math.min(a.length, b.length); i++) {
    const c = a[a.length - i];
    if (c === "x") continue;
    if (c !== b[b.length - i]) return false;
    shown++;
  }
  return shown >= 3;
}

/** Names compared loosely: case, spaces, punctuation and company words ignored. */
export function namesMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/บริษัท|จำกัด|\(มหาชน\)|บจก\.?|หจก\.?|co\.?,?|ltd\.?|limited|company|inc\.?/g, "")
      .replace(/[^\p{L}\p{N}]/gu, "");
  if (!a || !b) return false;
  const x = norm(a);
  const y = norm(b);
  if (x.length < 3 || y.length < 3) return false;
  if (x === y) return true;
  // "Contains" only for longer names: "ann" must not match "annasmith".
  return Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x));
}

/** Does this slip pay this order? */
export function decideSlip(slip: CheckedSlip, want: SlipExpectation): SlipDecision {
  const reasons: string[] = [];
  const now = want.now ?? new Date();

  // 1. Exactly the amount due (a different amount needs a person: part payment, wrong order...).
  if (Math.round(slip.amount * 100) !== Math.round(want.total * 100)) {
    reasons.push(`amount on the slip is ${slip.amount.toFixed(2)}, not ${want.total.toFixed(2)}`);
  }

  // 2. Sent to the club: its PromptPay number, or a receiver with the club's account name.
  const clubId = (want.promptpayId ?? "").replace(/\D/g, "");
  const kind = clubId ? kindOf(clubId) : null;
  const proxy = slip.receiver.proxy;
  let toClub = false;
  if (proxy && kind) {
    toClub = proxy.type === PROXY_FOR[kind] && maskedMatches(proxy.account, clubId);
    if (!toClub) reasons.push("sent to a different PromptPay than the club's");
    // Only a few digits are visible: when the club gave its account name, the name must match too.
    const name = slip.receiver.name.th || slip.receiver.name.en;
    if (toClub && want.promptpayName && name && !namesMatch(slip.receiver.name.th, want.promptpayName) && !namesMatch(slip.receiver.name.en, want.promptpayName)) {
      toClub = false;
      reasons.push(`receiver "${name}" doesn't match the club's account name "${want.promptpayName}"`);
    }
  } else {
    const name = slip.receiver.name.th || slip.receiver.name.en;
    toClub = namesMatch(name, want.promptpayName);
    if (!toClub) reasons.push(`receiver "${name ?? "unknown"}" doesn't match the club's account name`);
  }

  // 3. When: after the booking (10 minutes' leeway for clocks) and within the last 7 days.
  const paidAt = new Date(slip.date).getTime();
  const created = new Date(want.orderCreatedAt).getTime();
  if (Number.isNaN(paidAt)) reasons.push("transfer date unreadable");
  else {
    if (paidAt < created - 10 * 60_000) reasons.push("transfer was made before this booking");
    if (paidAt > now.getTime() + 10 * 60_000) reasons.push("transfer date is in the future");
    if (paidAt < now.getTime() - 7 * 86_400_000) reasons.push("transfer is more than 7 days old");
  }

  if (!slip.transRef) reasons.push("no transfer reference on the slip");
  return { ok: reasons.length === 0, reasons };
}
