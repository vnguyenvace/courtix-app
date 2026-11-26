import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LineError, linePush } from "@/lib/line";
import { loadLine } from "@/lib/messaging";

// Automatic service messages to members: booking reminders, package ending, waitlist moved up,
// session cancelled. The database queues them (member_notices); this sends them.
//
// Fixed wording per language (not written by the AI each time): these carry times and places,
// so they must always be exactly right, and they stay cheap. Each ends with "just reply": on
// LINE the reply goes to the club's chat, where the assistant answers.

export type NoticeKind = "booking_confirmed" | "booking_reminder" | "package_ending" | "waitlist_moved_up" | "session_cancelled";

export const NOTICE_LABELS: Record<NoticeKind, string> = {
  booking_confirmed: "Booking confirmed",
  booking_reminder: "Booking reminder",
  package_ending: "Package ending",
  waitlist_moved_up: "Waitlist moved up",
  session_cancelled: "Session cancelled",
};

export interface NoticePayload {
  type?: "session" | "court" | "ending" | "last_credit";
  session?: string;
  court?: string;
  location?: string;
  date?: string; // YYYY-MM-DD, local
  start?: string;
  end?: string;
  reason?: string | null;
  package?: string;
  ends_on?: string;
  amount?: number | string; // booking_confirmed: what's due (0 = nothing)
  covered_by?: string | null; // booking_confirmed: their package paid for it
}

/** Club details a notice may need. */
export interface NoticeClub {
  name: string;
  currency: string;
  paymentNote: string | null; // how members pay, in the club's words
}

const LOCALES: Record<string, string> = { en: "en-GB", th: "th-TH", ru: "ru-RU", zh: "zh-CN", de: "de-DE", fr: "fr-FR" };

function dayName(date: string | undefined, lang: string, withWeekday: boolean) {
  if (!date) return "";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(LOCALES[lang] ?? "en-GB", {
    ...(withWeekday ? { weekday: "long" } : {}),
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

type Texts = {
  confirmed: string; // {what} = session or court name, {money} = what's due or "covered"
  toPay: string;
  covered: string;
  session: string;
  court: string;
  ending: string;
  last: string;
  waitlist: string;
  cancelled: string;
  reason: string; // wraps the cancel reason
};

// {club} {session} {court} {location} {day} (weekday + date) {date} (date only) {start} {end} {package} {reason}
const TEXTS: Record<string, Texts> = {
  en: {
    confirmed: "{club}: you're booked for {what}, {day}, {start}–{end} at {location}. {money}Can't make it? Just reply to this message.",
    toPay: "To pay: {amount}. {how}",
    covered: "Covered by your package. ",
    session: "Reminder from {club}: {session} tomorrow, {day}, {start}–{end} at {location}. See you there. Can't make it? Just reply to this message.",
    court: "Reminder from {club}: you've booked {court} tomorrow, {day}, {start}–{end} at {location}. Plans changed? Just reply to this message.",
    ending: "{club}: your {package} ends on {date}. Want to renew? Just reply to this message.",
    last: "{club}: you have 1 session left on your {package}. Want a new pack? Just reply to this message.",
    waitlist: "Good news from {club}: a place opened up and you're now booked for {session} on {day}, {start}–{end} at {location}. Can't make it any more? Just reply to this message.",
    cancelled: "{club}: sorry, {session} on {day} at {start} has been cancelled{reason}. If you used a session credit, it's back on your package.",
    reason: " ({reason})",
  },
  th: {
    confirmed: "{club}: จองให้แล้วค่ะ {what} {day} เวลา {start}–{end} ที่ {location} {money}ถ้ามาไม่ได้ ตอบกลับข้อความนี้ได้เลยค่ะ",
    toPay: "ยอดที่ต้องชำระ: {amount} {how}",
    covered: "รวมอยู่ในแพ็กเกจของคุณแล้วค่ะ ",
    session: "แจ้งเตือนจาก {club}: พรุ่งนี้คุณมี {session} {day} เวลา {start}–{end} ที่ {location} แล้วเจอกันนะคะ ถ้ามาไม่ได้ ตอบกลับข้อความนี้ได้เลยค่ะ",
    court: "แจ้งเตือนจาก {club}: พรุ่งนี้คุณจอง {court} ไว้ {day} เวลา {start}–{end} ที่ {location} ถ้ามีการเปลี่ยนแปลง ตอบกลับข้อความนี้ได้เลยค่ะ",
    ending: "{club}: แพ็กเกจ {package} ของคุณจะหมดอายุวันที่ {date} ถ้าต้องการต่ออายุ ตอบกลับข้อความนี้ได้เลยค่ะ",
    last: "{club}: แพ็กเกจ {package} ของคุณเหลืออีก 1 ครั้ง ถ้าต้องการซื้อแพ็กเกจใหม่ ตอบกลับข้อความนี้ได้เลยค่ะ",
    waitlist: "ข่าวดีจาก {club}: มีที่ว่างแล้ว ตอนนี้คุณได้ที่ใน {session} {day} เวลา {start}–{end} ที่ {location} ถ้ามาไม่ได้แล้ว ตอบกลับข้อความนี้ได้เลยค่ะ",
    cancelled: "{club}: ขออภัยค่ะ {session} {day} เวลา {start} ถูกยกเลิก{reason} ถ้าคุณใช้เครดิตไปแล้ว เครดิตได้คืนเข้าแพ็กเกจของคุณแล้วค่ะ",
    reason: " (เหตุผล: {reason})",
  },
  ru: {
    confirmed: "{club}: вы записаны: {what}, {day}, {start}–{end}, {location}. {money}Если не сможете, просто ответьте на это сообщение.",
    toPay: "К оплате: {amount}. {how}",
    covered: "Входит в ваш пакет. ",
    session: "Напоминание от {club}: завтра, {day}, {start}–{end} — {session}, {location}. До встречи. Если не сможете прийти, просто ответьте на это сообщение.",
    court: "Напоминание от {club}: завтра, {day}, {start}–{end} у вас забронирован {court}, {location}. Если планы изменились, просто ответьте на это сообщение.",
    ending: "{club}: ваш пакет «{package}» заканчивается {date}. Чтобы продлить, просто ответьте на это сообщение.",
    last: "{club}: в вашем пакете «{package}» осталось 1 занятие. Если хотите новый пакет, просто ответьте на это сообщение.",
    waitlist: "Хорошие новости от {club}: освободилось место, и вы записаны на {session}, {day}, {start}–{end}, {location}. Если уже не сможете, просто ответьте на это сообщение.",
    cancelled: "{club}: к сожалению, {session} {day} в {start} отменено{reason}. Если вы использовали занятие из пакета, оно возвращено.",
    reason: " (причина: {reason})",
  },
  zh: {
    confirmed: "{club}：已为您预订{what}，时间：{day} {start}–{end}，地点：{location}。{money}如无法参加，请直接回复本消息。",
    toPay: "应付金额：{amount}。{how}",
    covered: "已包含在您的课程包中。",
    session: "{club}提醒您：明天（{day}）{start}–{end}有{session}，地点：{location}。如不能参加，请直接回复本消息。",
    court: "{club}提醒您：您预订了明天（{day}）{start}–{end}的{court}，地点：{location}。如有变动，请直接回复本消息。",
    ending: "{club}：您的「{package}」将于{date}到期。如需续订，请直接回复本消息。",
    last: "{club}：您的「{package}」只剩1次。如需购买新的课程包，请直接回复本消息。",
    waitlist: "{club}好消息：有空位了，您已成功报名{session}，时间：{day} {start}–{end}，地点：{location}。如无法参加，请直接回复本消息。",
    cancelled: "{club}：很抱歉，{day} {start}的{session}已取消{reason}。如您使用了课程包次数，已退回到您的课程包。",
    reason: "（原因：{reason}）",
  },
  de: {
    confirmed: "{club}: Du bist gebucht: {what}, {day}, {start}–{end} in {location}. {money}Falls du nicht kannst, antworte einfach auf diese Nachricht.",
    toPay: "Zu zahlen: {amount}. {how}",
    covered: "In deinem Paket enthalten. ",
    session: "Erinnerung von {club}: morgen, {day}, {start}–{end}: {session} in {location}. Bis dann. Falls du nicht kommen kannst, antworte einfach auf diese Nachricht.",
    court: "Erinnerung von {club}: Du hast morgen, {day}, {start}–{end} {court} in {location} gebucht. Falls sich etwas ändert, antworte einfach auf diese Nachricht.",
    ending: "{club}: Dein Paket „{package}“ läuft am {date} ab. Zum Verlängern antworte einfach auf diese Nachricht.",
    last: "{club}: In deinem Paket „{package}“ ist noch 1 Einheit übrig. Für ein neues Paket antworte einfach auf diese Nachricht.",
    waitlist: "Gute Nachricht von {club}: Ein Platz ist frei geworden, du bist jetzt für {session} am {day}, {start}–{end} in {location} angemeldet. Falls du nicht mehr kannst, antworte einfach auf diese Nachricht.",
    cancelled: "{club}: Leider fällt {session} am {day} um {start} aus{reason}. Falls du eine Einheit aus deinem Paket genutzt hast, ist sie wieder gutgeschrieben.",
    reason: " (Grund: {reason})",
  },
  fr: {
    confirmed: "{club} : c'est réservé : {what}, {day}, {start}–{end}, à {location}. {money}Si vous ne pouvez pas venir, répondez simplement à ce message.",
    toPay: "À régler : {amount}. {how}",
    covered: "Inclus dans votre forfait. ",
    session: "Rappel de {club} : demain, {day}, {start}–{end} : {session} à {location}. À bientôt. Si vous ne pouvez pas venir, répondez simplement à ce message.",
    court: "Rappel de {club} : vous avez réservé {court} demain, {day}, {start}–{end}, à {location}. En cas de changement, répondez simplement à ce message.",
    ending: "{club} : votre forfait « {package} » se termine le {date}. Pour le renouveler, répondez simplement à ce message.",
    last: "{club} : il vous reste 1 séance sur votre forfait « {package} ». Pour un nouveau forfait, répondez simplement à ce message.",
    waitlist: "Bonne nouvelle de {club} : une place s'est libérée, vous êtes inscrit(e) à {session} le {day}, {start}–{end}, à {location}. Si vous ne pouvez plus venir, répondez simplement à ce message.",
    cancelled: "{club} : désolé, {session} du {day} à {start} est annulé(e){reason}. Si vous aviez utilisé une séance de votre forfait, elle vous a été rendue.",
    reason: " (raison : {reason})",
  },
};

/** The message for one notice, in the member's language (English if we don't have theirs). */
export function noticeText(kind: NoticeKind, p: NoticePayload, language: string, clubInfo: NoticeClub | string): string {
  const club: NoticeClub = typeof clubInfo === "string" ? { name: clubInfo, currency: "THB", paymentNote: null } : clubInfo;
  const lang = TEXTS[language] ? language : "en";
  const t = TEXTS[lang];
  const amount = Number(p.amount ?? 0);
  const money =
    kind !== "booking_confirmed"
      ? ""
      : amount > 0
        ? `${t.toPay.replace("{amount}", `${club.currency} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`).replace("{how}", club.paymentNote ? `${club.paymentNote.trim()} ` : "")}`.replace(/\s*$/, " ")
        : p.covered_by
          ? t.covered
          : "";
  const template =
    kind === "booking_confirmed"
      ? t.confirmed
      : kind === "booking_reminder"
      ? p.type === "court" ? t.court : t.session
      : kind === "package_ending"
        ? p.type === "last_credit" ? t.last : t.ending
        : kind === "waitlist_moved_up"
          ? t.waitlist
          : t.cancelled;
  const values: Record<string, string> = {
    club: club.name,
    what: p.type === "court" ? p.court ?? "" : p.session ?? "",
    money,
    session: p.session ?? "",
    court: p.court ?? "",
    location: p.location ?? "",
    day: dayName(p.date, lang, true),
    date: dayName(p.ends_on ?? p.date, lang, false),
    start: p.start ?? "",
    end: p.end ?? "",
    package: p.package ?? "",
    reason: p.reason ? t.reason.replace("{reason}", p.reason) : "",
  };
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
}

interface PendingRow {
  id: string;
  kind: NoticeKind;
  payload: NoticePayload;
  members: { language: string; line_user_id: string | null; notices_opt_out: boolean } | null;
}

/**
 * Sends a club's waiting notices. Members linked on LINE get them on LINE (push); the rest are
 * marked "manual" and listed on the Morning page for a one-tap send. Never throws: a failure
 * is saved on the notice. Works with the staff client (after a change at the desk) or the
 * service client (evening and morning jobs).
 */
export async function sendPendingNotices(
  supabase: SupabaseClient,
  orgId: string,
  limit = 200,
): Promise<{ sent: number; manual: number; failed: number }> {
  const result = { sent: 0, manual: 0, failed: 0 };
  try {
    const [{ data: org }, { data: rows }] = await Promise.all([
      supabase.from("orgs").select("name, currency, payment_note").eq("id", orgId).single(),
      supabase
        .from("member_notices")
        .select("id, kind, payload, members(language, line_user_id, notices_opt_out)")
        .eq("org_id", orgId)
        .eq("status", "pending")
        .order("created_at")
        .limit(limit),
    ]);
    const pending = (rows ?? []) as unknown as PendingRow[];
    if (!pending.length) return result;
    const line = await loadLine(supabase, orgId).catch(() => null);
    let lineBlocked: string | null = null; // e.g. monthly limit reached: stop trying for this run

    for (const n of pending) {
      const m = n.members;
      if (!m || m.notices_opt_out) {
        await supabase.from("member_notices").update({ status: "skipped" }).eq("id", n.id);
        continue;
      }
      if (!line || !m.line_user_id || lineBlocked) {
        await supabase
          .from("member_notices")
          .update({ status: "manual", error: lineBlocked })
          .eq("id", n.id);
        result.manual++;
        continue;
      }
      try {
        const club: NoticeClub = { name: org?.name ?? "", currency: org?.currency ?? "THB", paymentNote: org?.payment_note ?? null };
        await linePush(line.token, m.line_user_id, [noticeText(n.kind, n.payload, m.language, club)]);
        await supabase
          .from("member_notices")
          .update({ status: "sent", channel: "line", sent_at: new Date().toISOString(), error: null })
          .eq("id", n.id);
        result.sent++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (e instanceof LineError && (e.status === 429 || e.status === 401)) lineBlocked = message;
        // Not sent automatically: list it for staff instead.
        await supabase.from("member_notices").update({ status: "manual", error: message.slice(0, 300) }).eq("id", n.id);
        result.failed++;
      }
    }
  } catch (e) {
    console.error("Notices: couldn't send", e);
  }
  return result;
}
