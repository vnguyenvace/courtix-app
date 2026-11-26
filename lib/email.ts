import "server-only";

// Email (sign-in codes for members) through Resend's API. Optional: on when RESEND_API_KEY and
// EMAIL_FROM (e.g. "Courtix <no-reply@courtix.app>", a domain verified in Resend) are set.

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Email not sent (${res.status}): ${detail.slice(0, 200)}`);
  }
}
