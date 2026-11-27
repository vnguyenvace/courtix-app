import type { T } from "@/lib/i18n";
import Link from "next/link";
import { requirePermission } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { aiConfigured } from "@/lib/ai";
import { startTestChat } from "./actions";
import type { ChatConversation } from "@/lib/types";
import { ASSISTANT_NAME } from "@/lib/assistant";

type Row = ChatConversation & { members: { full_name: string } | null };

function when(iso: string, tz: string) {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz,
  });
}

function ChatList({ rows, tz, empty, t }: { rows: Row[]; tz: string; empty: string; t: T }) {
  if (!rows.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="chat-list">
      {rows.map((c) => (
        <li key={c.id}>
          <Link href={`/chats/${c.id}`} className="chat-row">
            <span className="chat-row-main">
              <strong>{c.members?.full_name ?? c.contact_name ?? c.contact_phone ?? t("LINE user")}</strong>
              <span className="muted small">
                {c.members ? t("Member") : t("Visitor")}
                {c.contact_phone ? ` · ${c.contact_phone}` : ""}
                {c.channel === "test" ? (" " + t("· test chat")) : ` · ${c.channel === "line" ? "LINE" : "WhatsApp"}`}
              </span>
              {c.status === "staff" && c.handoff_reason && <span className="small">{c.handoff_reason}</span>}
            </span>
            <span className="muted small chat-row-side">{when(c.last_message_at, tz)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function ChatsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, workLocation, t, locale } = await requirePermission("chats.reply");
  const tz = workLocation?.timezone ?? org.timezone;
  const ai = aiConfigured();

  const [{ data: openData }, { data: closedData }, { data: memberData }] = await Promise.all([
    supabase
      .from("chat_conversations")
      .select("*, members(full_name)")
      .eq("org_id", org.id)
      .neq("status", "closed")
      .order("last_message_at", { ascending: false })
      .limit(100),
    supabase
      .from("chat_conversations")
      .select("*, members(full_name)")
      .eq("org_id", org.id)
      .eq("status", "closed")
      .order("last_message_at", { ascending: false })
      .limit(10),
    supabase.from("members").select("id, full_name, phone").eq("org_id", org.id).not("phone", "is", null).order("full_name"),
  ]);
  const open = (openData ?? []) as Row[];
  const waiting = open.filter((c) => c.status === "staff");
  const withAssistant = open.filter((c) => c.status === "bot");
  const closed = (closedData ?? []) as Row[];
  const members = (memberData ?? []) as { id: string; full_name: string; phone: string }[];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Chats")}</h1>
          <p className="muted">
            {org.chat_mode === "book"
              ? t("{assistant} answers members and visitors and books free or package-covered places. Anything else comes to you here.", { assistant: ASSISTANT_NAME })
              : t("{assistant} answers members and visitors. Anything else comes to you here.", { assistant: ASSISTANT_NAME })}
          </p>
        </div>
      </div>
      <Banner sp={sp} />

      {!ai && (
        <div className="banner warn">
          {t("The AI assistant isn't connected (no ANTHROPIC_API_KEY), so every chat comes straight to staff.")}
        </div>
      )}

      <div className="grid grid-2">
        <div className="stack">
          <section className="card">
            <h2>{t("Waiting for you")}{" "}{waiting.length > 0 && <span className="badge warn">{waiting.length}</span>}</h2>
            <ChatList t={t} rows={waiting} tz={tz} empty={t("Nothing waiting. The assistant hands chats here when someone needs a person.")} />
          </section>
          <section className="card">
            <h2>{t("{ASSISTANT_NAME} is answering", { ASSISTANT_NAME: ASSISTANT_NAME })}</h2>
            <ChatList t={t} rows={withAssistant} tz={tz} empty={t("No open chats.")} />
          </section>
          {closed.length > 0 && (
            <section className="card">
              <h2>{t("Recently closed")}</h2>
              <ChatList t={t} rows={closed} tz={tz} empty="" />
            </section>
          )}
        </div>

        <div className="stack">
          <section className="card">
            <h2>{t("Try it: test chat")}</h2>
            <p className="muted small">
              {t("Play a member or a visitor here to see how {ASSISTANT_NAME} answers and books. Real chats come in from your LINE account once it's connected (Settings → Messaging). Bookings it makes are real (they appear on the sessions and courts), so cancel them afterwards.", { ASSISTANT_NAME: ASSISTANT_NAME })}
            </p>
            <form action={startTestChat} className="form">
              <label>
                {t("Chat as")}
                <select name="member_phone" defaultValue="">
                  <option value="">{t("A visitor (enter a number below)")}</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.phone}>{m.full_name} · {m.phone}</option>
                  ))}
                </select>
              </label>
              <div className="form-row">
                <label>
                  {t("Visitor's number")}
                  <input name="phone" type="tel" placeholder="+44 7700 900123" />
                </label>
                <label>
                  {t("Visitor's name")}
                  <input name="name" placeholder={t("Tom")} />
                </label>
              </div>
              <label>
                {t("First message")}
                <textarea name="message" rows={3} required placeholder={t("Hi, is there open play tomorrow evening? Can you book me in?")} />
              </label>
              <button className="primary" style={{ justifySelf: "start" }}>{t("Start chat")}</button>
            </form>
          </section>
          <section className="card">
            <h2>{t("What the assistant may do")}</h2>
            <p className="small">
              {org.chat_mode === "book"
                ? t("Answer questions and book places that are free or covered by the member's package. Paid places, refunds, complaints and private coaching come to you.")
                : t("Answer questions only. Every booking comes to you.")}
            </p>
            <Link href="/settings#chat" className="small">{t("Change in settings")}</Link>
          </section>
        </div>
      </div>
    </>
  );
}
