import "server-only";

// Text messages (sign-in codes for members) through Twilio's Messages API. Optional: on when
// TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and either TWILIO_FROM (a number) or
// TWILIO_MESSAGING_SERVICE_SID are set. A Thai provider (e.g. ThaiBulkSMS) can replace this file.

export function smsConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID),
  );
}

/** to: +66812345678 style. */
export async function sendSms(to: string, text: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const body = new URLSearchParams({ To: to, Body: text });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) body.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
  else body.set("From", process.env.TWILIO_FROM!);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`SMS not sent (${res.status}): ${detail.slice(0, 200)}`);
  }
}
