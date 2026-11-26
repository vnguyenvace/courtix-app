import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// LINE Messaging API (each club's own LINE Official Account). Plain fetch, server-only.
// LINE_API_BASE is optional, e.g. a local test stub; default https://api.line.me.

const BASE = (process.env.LINE_API_BASE || "https://api.line.me").replace(/\/$/, "");
const MAX_TEXT = 5000; // LINE's limit per text message
const MAX_MESSAGES = 5; // per reply/push call

export class LineError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** LINE signs every webhook request: base64(HMAC-SHA256(channel secret, raw body)). */
export function verifyLineSignature(rawBody: string, signature: string | null, channelSecret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function call<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    let message = detail.slice(0, 200);
    try {
      message = (JSON.parse(detail) as { message?: string }).message ?? message;
    } catch {}
    if (res.status === 401) throw new LineError(401, "LINE rejected the channel access token. Check it in Settings → Messaging.");
    if (res.status === 429) throw new LineError(429, "LINE's monthly message limit or rate limit was reached.");
    throw new LineError(res.status, `LINE error ${res.status}: ${message}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** Who the access token belongs to. Used to check a token when a club connects. */
export function lineBotInfo(token: string) {
  return call<{ userId: string; basicId: string; displayName: string }>(token, "/v2/bot/info");
}

/** A LINE user's display name (only for people who added the club's account). */
export async function lineDisplayName(token: string, userId: string): Promise<string | null> {
  try {
    const p = await call<{ displayName?: string }>(token, `/v2/bot/profile/${encodeURIComponent(userId)}`);
    return p.displayName ?? null;
  } catch {
    return null;
  }
}

function textMessages(texts: string[]) {
  return texts
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, MAX_MESSAGES)
    .map((t) => ({ type: "text", text: t.slice(0, MAX_TEXT) }));
}

/** Free reply to a message the person just sent. The reply token works once, for a short time. */
export function lineReply(token: string, replyToken: string, texts: string[]) {
  return call(token, "/v2/bot/message/reply", { method: "POST", body: { replyToken, messages: textMessages(texts) } });
}

/** Message someone any time. Counts toward the club's monthly LINE message allowance. */
export function linePush(token: string, to: string, texts: string[]) {
  return call(token, "/v2/bot/message/push", { method: "POST", body: { to, messages: textMessages(texts) } });
}
