import { after, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contactApiMessage, runChatTurn, staffApiMessage } from "@/lib/chat";
import { verifyLineSignature } from "@/lib/line";
import { deliverChat, lineDisplayName, loadLine } from "@/lib/messaging";
import { decryptSecret } from "@/lib/secrets";
import { serviceClient } from "@/lib/supabase/service";
import type { Location, MessagingChannel, Org } from "@/lib/types";

// LINE webhook for one club's LINE Official Account: https://courtix.app/api/line/<webhook_key>.
//
// 1. Find the club's channel by the key in the address.
// 2. Check LINE's signature with that club's channel secret. Nothing else happens before this.
// 3. Answer LINE straight away (it expects a quick 200), then, after the response, save each
//    message to Chats, let the assistant answer (same rules as every chat), and send the reply.
//
// Runs as the service identity (nobody is signed in), so every step names the club explicitly.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface LineEvent {
  type: string;
  webhookEventId?: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
}

export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const raw = await request.text();

  let db: SupabaseClient;
  try {
    db = serviceClient();
  } catch {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  const { data } = await db.from("messaging_channels").select("*").eq("webhook_key", key).eq("provider", "line").maybeSingle();
  const channel = data as MessagingChannel | null;
  if (!channel) return NextResponse.json({ error: "Unknown address" }, { status: 404 });

  let secret: string;
  try {
    secret = decryptSecret(channel.secret_enc);
  } catch {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  if (!verifyLineSignature(raw, request.headers.get("x-line-signature"), secret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let events: LineEvent[] = [];
  try {
    events = ((JSON.parse(raw) as { events?: LineEvent[] }).events ?? []).filter(Boolean);
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }
  // LINE's "Verify" button sends no events: just say OK.
  if (!channel.is_enabled || events.length === 0) return NextResponse.json({ ok: true });

  after(() => handleEvents(db, channel, events));
  return NextResponse.json({ ok: true });
}

async function handleEvents(db: SupabaseClient, channel: MessagingChannel, events: LineEvent[]) {
  await db.from("messaging_channels").update({ last_event_at: new Date().toISOString() }).eq("id", channel.id);

  const [{ data: orgData }, { data: locData }] = await Promise.all([
    db.from("orgs").select("*").eq("id", channel.org_id).single(),
    db.from("locations").select("*").eq("org_id", channel.org_id),
  ]);
  const org = orgData as Org | null;
  if (!org) return;
  const locations = (locData ?? []) as Location[];
  const line = await loadLine(db, org.id).catch(() => null);
  if (!line) return;

  // Save every message first, then answer each conversation once (with its newest reply token).
  const toAnswer = new Map<string, string | undefined>();
  for (const e of events) {
    if (e.type !== "message" || e.source?.type !== "user" || !e.source.userId || !e.message) continue;
    const userId = e.source.userId;
    const name = await lineDisplayName(line.token, userId);
    const { data: convId, error } = await db.rpc("chat_open_line_conversation", {
      p_org: org.id,
      p_line_user: userId,
      p_name: name,
      p_location: channel.location_id,
    });
    if (error || !convId) {
      console.error("LINE: couldn't open conversation", error?.message);
      continue;
    }
    const text =
      e.message.type === "text" && e.message.text?.trim()
        ? e.message.text.trim().slice(0, 2000)
        : `(sent a ${e.message.type}, which the assistant can't read)`;
    const { error: msgErr } = await db.from("chat_messages").insert({
      org_id: org.id,
      conversation_id: convId,
      role: "contact",
      body: text,
      api: contactApiMessage(text),
      external_id: e.webhookEventId ?? null,
      created_by: null,
    });
    if (msgErr) {
      if (msgErr.code !== "23505") console.error("LINE: couldn't save message", msgErr.message); // 23505: repeat delivery
      continue;
    }
    await db.from("chat_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId);

    // "LINK ABC234" from a member's invite (member page → LINE invite): link and confirm, no assistant turn.
    if (e.message.type === "text" && /link/i.test(text)) {
      const { data: link } = await db.rpc("line_link_by_code", { p_conversation: convId, p_text: text });
      const res = link as { name?: string; error?: string; language?: string } | null;
      if (res) {
        const reply = linkReply(res, org.name);
        await db.from("chat_messages").insert({
          org_id: org.id,
          conversation_id: convId,
          role: "staff",
          body: reply,
          api: staffApiMessage(reply),
          created_by: null,
        });
        await deliverChat(db, convId as string, e.replyToken);
        toAnswer.delete(convId as string);
        continue;
      }
    }
    toAnswer.set(convId as string, e.replyToken);
  }

  for (const [convId, replyToken] of toAnswer) {
    try {
      await runChatTurn(db, org, locations, convId);
    } catch (e) {
      console.error("LINE: assistant failed", e);
    }
    await deliverChat(db, convId, replyToken);
  }
}

/** The reply to an invite code, in the member's language (English when we don't have theirs). */
function linkReply(res: { name?: string; error?: string; language?: string }, club: string): string {
  const lang = (res.language ?? "en").slice(0, 2);
  const linked: Record<string, string> = {
    en: "Thanks {name}, your LINE is now connected to {club}. Booking confirmations and reminders will come here.",
    th: "ขอบคุณค่ะ คุณ{name} LINE ของคุณเชื่อมต่อกับ {club} แล้ว การยืนยันการจองและการแจ้งเตือนจะส่งมาที่นี่",
    ru: "Спасибо, {name}! Ваш LINE подключён к {club}. Подтверждения бронирований и напоминания будут приходить сюда.",
    zh: "谢谢 {name}，您的 LINE 已连接到 {club}。预订确认和提醒将发送到这里。",
  };
  const other: Record<string, string> = {
    en: "This LINE account is already connected to another member at {club}. Please ask the front desk to help.",
    th: "บัญชี LINE นี้เชื่อมต่อกับสมาชิกคนอื่นของ {club} อยู่แล้ว กรุณาติดต่อเคาน์เตอร์",
    ru: "Этот LINE уже подключён к другому участнику {club}. Пожалуйста, обратитесь на ресепшен.",
    zh: "此 LINE 账号已连接到 {club} 的另一位会员。请联系前台协助。",
  };
  const table = res.error ? other : linked;
  return (table[lang] ?? table.en).replace("{name}", res.name ?? "").replace("{club}", club);
}
