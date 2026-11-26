import "server-only";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { emailConfigured, sendEmail } from "@/lib/email";
import { linePush } from "@/lib/line";
import { loadLine } from "@/lib/messaging";
import { sendSms, smsConfigured } from "@/lib/sms";
import { serviceClient } from "@/lib/supabase/service";

// Members sign in on the public booking page with a one-time code (see
// supabase/migrations/20261126070000_member_sign_in.sql for the database side).
//
// This file only SENDS codes. It needs the club's LINE key or the SMS / email provider, so it
// runs as the service identity, like the LINE webhook: it looks up one club by its slug, one
// member by phone or email, and writes one code row (hash only). Checking the code and every
// member action happen in security-definer database functions that take the sign-in token.

export const MEMBER_COOKIE = "courtix_member";
const COOKIE_DAYS = 90;
const MAX_CODES_PER_MEMBER = 3; // per 15 minutes
const MAX_CODES_PER_CLUB = 200; // per hour

/** The sign-in token from this browser's cookie (club subdomain only), or null. */
export async function memberToken(): Promise<string | null> {
  return (await cookies()).get(MEMBER_COOKIE)?.value ?? null;
}

export async function setMemberCookie(token: string) {
  (await cookies()).set(MEMBER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_DAYS * 24 * 3600,
  });
}

export async function clearMemberCookie() {
  (await cookies()).delete(MEMBER_COOKIE);
}

/** Digits with country code; Thai 08x... becomes 668x... (same as phone_key() in the database). */
export function phoneKey(value: string | null | undefined): string | null {
  const d = (value ?? "").replace(/\D/g, "");
  if (!d) return null;
  return /^0\d{8,9}$/.test(d) ? `66${d.slice(1)}` : d;
}

const CODE_TEXT: Record<string, string> = {
  en: "{code} is your {club} sign-in code. It works for 10 minutes. Didn't ask for it? Just ignore this message.",
  th: "{code} คือรหัสเข้าสู่ระบบ {club} ของคุณ ใช้ได้ภายใน 10 นาที ถ้าคุณไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไรค่ะ",
  ru: "{code} — ваш код для входа в {club}. Он действует 10 минут. Если вы его не запрашивали, просто проигнорируйте это сообщение.",
  zh: "{code} 是您的{club}登录验证码，10分钟内有效。如非本人操作，请忽略本消息。",
  de: "{code} ist dein Anmeldecode für {club}. Er gilt 10 Minuten. Nicht angefordert? Dann ignoriere diese Nachricht einfach.",
  fr: "{code} est votre code de connexion {club}. Il est valable 10 minutes. Vous ne l'avez pas demandé ? Ignorez simplement ce message.",
};

interface MemberRow {
  id: string;
  language: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  line_user_id: string | null;
}

/**
 * Sends a sign-in code to the member with this phone number or email at this club, by LINE,
 * SMS or email (in that order, whichever works). Says nothing about whether a member was found:
 * the page shows the same answer either way.
 */
export async function requestMemberCode(slug: string, contact: string): Promise<void> {
  // Why no code went out is logged for Courtix support (no phone numbers or emails in the log):
  // the page itself says the same thing either way, so members can't be looked up.
  const skip = (reason: string) => console.info(`Member sign-in (${slug}): no code sent: ${reason}`);
  const db = serviceClient();
  const raw = contact.trim();
  const isEmail = raw.includes("@");
  const key = isEmail ? null : phoneKey(raw);
  if (!isEmail && (!key || key.length < 8 || key.length > 15)) return skip("not a phone number or email");

  const { data: org } = await db.from("orgs").select("id, name, public_booking").eq("slug", slug).maybeSingle();
  if (!org?.public_booking) return skip("club not found or online booking is off");

  // Find exactly one member (a number shared by two members can't sign in: ambiguous).
  let q = db.from("members").select("id, language, phone, whatsapp, email, line_user_id").eq("org_id", org.id);
  q = isEmail ? q.ilike("email", raw.replace(/[%_\\]/g, "")) : q.or("phone.not.is.null,whatsapp.not.is.null");
  const { data } = await q.limit(5000);
  const matches = ((data ?? []) as MemberRow[]).filter((m) =>
    isEmail ? m.email?.toLowerCase() === raw.toLowerCase() : phoneKey(m.phone) === key || phoneKey(m.whatsapp) === key,
  );
  if (matches.length !== 1) return skip(matches.length ? "more than one member has this number or email" : "no member has this number or email");
  const member = matches[0];

  // Limits: a few codes per member, and a ceiling per club.
  const since15 = new Date(Date.now() - 15 * 60_000).toISOString();
  const sinceHour = new Date(Date.now() - 3600_000).toISOString();
  const [{ count: mine }, { count: club }] = await Promise.all([
    db.from("member_login_codes").select("id", { count: "exact", head: true }).eq("member_id", member.id).gte("created_at", since15),
    db.from("member_login_codes").select("id", { count: "exact", head: true }).eq("org_id", org.id).gte("created_at", sinceHour),
  ]);
  if ((mine ?? 0) >= MAX_CODES_PER_MEMBER || (club ?? 0) >= MAX_CODES_PER_CLUB) return skip("too many codes asked for (wait 15 minutes)");

  // Channel: LINE (free, if they're linked), then SMS, then email.
  const line = member.line_user_id ? await loadLine(db, org.id).catch(() => null) : null;
  const phone = phoneKey(member.phone) ?? phoneKey(member.whatsapp);
  const channel: "line" | "sms" | "email" | null =
    line && member.line_user_id ? "line" : smsConfigured() && phone ? "sms" : emailConfigured() && member.email ? "email" : null;
  if (!channel) {
    return skip(
      `member ${member.id} has no way to get a code: ${member.line_user_id ? "club LINE not connected or off" : "not linked on LINE"}` +
        `, SMS ${smsConfigured() ? (phone ? "on" : "on but no phone") : "not set up"}, email ${emailConfigured() ? (member.email ? "on" : "on but no email") : "not set up"}`,
    );
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const id = randomUUID();
  const { error } = await db.from("member_login_codes").insert({
    id,
    org_id: org.id,
    member_id: member.id,
    channel,
    code_hash: createHash("sha256").update(`${id}:${code}`).digest("hex"),
  });
  if (error) return skip(`couldn't save the code: ${error.message}`);

  const text = (CODE_TEXT[member.language] ?? CODE_TEXT.en).replace("{code}", code).replace("{club}", org.name);
  try {
    if (channel === "line") await linePush(line!.token, member.line_user_id!, [text]);
    else if (channel === "sms") await sendSms(`+${phone}`, text);
    else await sendEmail(member.email!, `${code} is your ${org.name} sign-in code`, text);
    console.info(`Member sign-in (${slug}): code sent by ${channel}`);
  } catch (e) {
    console.error("Member sign-in: code not sent", e);
  }
}
