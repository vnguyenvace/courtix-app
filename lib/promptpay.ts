// PromptPay QR (Thai QR Payment, EMVCo merchant-presented format). Any Thai banking app can scan
// it and pay the club's PromptPay account directly: no payment provider, no fee, no money passes
// through Courtix. Plain functions (no server-only): used by pages and messages.
//
// Payload: 00 format, 01 static (11) / with amount (12), 29 PromptPay account (AID + mobile,
// national/tax ID or e-wallet ID), 58 country, 53 currency (764 = THB), 54 amount, 63 CRC-16.

const AID = "A000000677010111";

function field(id: string, value: string) {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, start 0xFFFF), as Thai QR requires. */
function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * The kind of PromptPay ID: a Thai mobile number (10 digits, starting with 0), a national ID or
 * tax ID (13 digits), or an e-wallet ID (15 digits). null if it isn't one of these.
 */
export function promptPayKind(id: string | null | undefined): "phone" | "national_id" | "ewallet" | null {
  const d = (id ?? "").replace(/\D/g, "");
  if (/^0\d{9}$/.test(d) || /^66\d{9}$/.test(d)) return "phone";
  if (/^\d{13}$/.test(d)) return "national_id";
  if (/^\d{15}$/.test(d)) return "ewallet";
  return null;
}

/** The text inside the QR. amount in baht (omit for a QR the payer types the amount into). */
export function promptPayPayload(id: string, amount?: number | null): string {
  const d = id.replace(/\D/g, "");
  const kind = promptPayKind(d);
  if (!kind) throw new Error("Not a PromptPay ID");
  const account =
    kind === "phone"
      ? field("01", `0066${d.replace(/^(66|0)/, "")}`.padStart(13, "0"))
      : kind === "national_id"
        ? field("02", d)
        : field("03", d);
  const withAmount = amount != null && amount > 0;
  const body =
    field("00", "01") +
    field("01", withAmount ? "12" : "11") +
    field("29", field("00", AID) + account) +
    field("58", "TH") +
    field("53", "764") +
    (withAmount ? field("54", amount.toFixed(2)) : "") +
    "6304";
  return body + crc16(body);
}
