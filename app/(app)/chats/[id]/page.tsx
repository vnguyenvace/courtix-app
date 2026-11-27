import type { T } from "@/lib/i18n";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { closeChat, handBack, linkMember, sendAsContact, staffReply, takeOver } from "../actions";
import { isPaused } from "@/lib/chat";
import type { ChatConversation, ChatMessage } from "@/lib/types";
import { ASSISTANT_NAME } from "@/lib/assistant";

type Conv = ChatConversation & { members: { id: string; full_name: string } | null };

function time(iso: string, tz: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
}

/** One line in the thread for something that happened: a booking, a refusal, a hand-off. */
function EventLine({ e, t }: { e: Record<string, unknown>; t: T }) {
  const s = (k: string) => (e[k] === null || e[k] === undefined ? "" : String(e[k]));
  if (e.kind === "booked_session") {
    const paidBy = s("covered_by") ? ` · ${t("covered by {pkg}", { pkg: s("covered_by") })}` : " · free";
    return (
      <span className="chat-event ok">
        {s("status") === "waitlisted" ? t("Waitlisted") : t("Booked")}: {s("session")}, {s("when")}
        {paidBy}
      </span>
    );
  }
  if (e.kind === "booked_court") {
    return <span className="chat-event ok">{t("Booked: {s}, {s2}–{s3}", { s: s("court"), s2: s("when"), s3: s("until") })}</span>;
  }
  if (e.kind === "requested_lesson") {
    return (
      <span className="chat-event warn">
        {t("Lesson request, waiting for you to approve on the dashboard: {s}, {s2} {s3}–{s4} · {s5} {s6}", { s: s("coach"), s2: s("day"), s3: s("start"), s4: s("end"), s5: s("currency"), s6: s("price") })}
      </span>
    );
  }
  if (e.kind === "refused") return <span className="chat-event warn">{t("Not booked: {s}", { s: s("reason") })}</span>;
  if (e.kind === "handed_off") return <span className="chat-event warn">{t("Handed to staff: {s}", { s: s("reason") })}</span>;
  return null;
}

export default async function ChatPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, org, workLocation, t, locale } = await requirePermission("chats.reply");
  const tz = workLocation?.timezone ?? org.timezone;

  const [{ data: convData }, { data: msgData }] = await Promise.all([
    supabase.from("chat_conversations").select("*, members(id, full_name)").eq("id", id).maybeSingle(),
    supabase.from("chat_messages").select("*").eq("conversation_id", id).order("created_at").order("id"),
  ]);
  const conv = convData as Conv | null;
  if (!conv) notFound();
  // LINE gives no phone number: staff say which member it is (once; it's remembered).
  const needsLink = conv.channel === "line" && !conv.members;
  const { data: memberData } = needsLink
    ? await supabase.from("members").select("id, full_name").eq("org_id", org.id).is("line_user_id", null).order("full_name")
    : { data: [] };
  const linkable = (memberData ?? []) as { id: string; full_name: string }[];
  const live = conv.channel !== "test";
  // A person is answering: the assistant stays quiet until this time ("infinity" = until handed back).
  const pausedUntil = conv.assistant_paused_until;
  const paused = isPaused(pausedUntil);
  const msgs = (msgData ?? []) as ChatMessage[];
  const name = conv.members?.full_name ?? conv.contact_name ?? conv.contact_phone ?? t("LINE user");
  const isTest = conv.channel === "test";
  const closed = conv.status === "closed";

  return (
    <>
      <div className="page-head">
        <div>
          <p className="small"><Link href="/chats">{t("← Chats")}</Link></p>
          <h1>{name}</h1>
          <p className="muted">
            {conv.members ? <Link href={`/members/${conv.members.id}`}>{t("Member")}</Link> : t("Visitor")}
            {conv.contact_phone ? ` · ${conv.contact_phone}` : ""}
            {isTest ? (" " + t("· test chat")) : ` · ${conv.channel === "line" ? "LINE" : "WhatsApp"}`}
            {conv.channel === "line" && conv.contact_name && conv.members ? ` · ${t("LINE name: {name}", { name: conv.contact_name })}` : ""}
          </p>
        </div>
        <div className="actions">
          {conv.status === "bot" && <span className="badge ok">{t("{ASSISTANT_NAME} is answering", { ASSISTANT_NAME: ASSISTANT_NAME })}</span>}
          {conv.status === "staff" && <span className="badge warn">{t("Needs staff")}</span>}
          {paused && !closed && <span className="badge">{t("Assistant paused")}</span>}
          {closed && <span className="badge">{t("Closed")}</span>}
        </div>
      </div>
      <Banner sp={sp} />
      {conv.status === "staff" && conv.handoff_reason && (
        <div className="banner warn">
          {t("Why it came to you: {handoff_reason}.", { handoff_reason: conv.handoff_reason })}
          {paused ? "" : t("{assistant} keeps answering their other questions meanwhile.", { assistant: ASSISTANT_NAME })}
        </div>
      )}
      {paused && !closed && (
        <div className="banner info">
          {pausedUntil === "infinity"
            ? t("You took this chat over: {assistant} stays quiet until you hand it back.", { assistant: ASSISTANT_NAME })
            : t("A person replied, so {assistant} stays quiet until {time}, then answers again.", { assistant: ASSISTANT_NAME, time: time(pausedUntil!, tz) })}
        </div>
      )}

      <div className="grid grid-2">
        <section className="card">
          <div className="chat-thread">
            {msgs.map((m) => {
              const items = m.event
                ? m.event.kind === "tools"
                  ? ((m.event.items as Record<string, unknown>[]) ?? [])
                  : [m.event]
                : [];
              return (
                <div key={m.id} style={{ display: "contents" }}>
                  {m.body && (
                    <div className={`bubble ${m.role === "contact" ? "contact" : m.role}`}>
                      <span className="who">
                        {m.role === "contact" ? name : m.role === "assistant" ? ASSISTANT_NAME : t("Staff")} · {time(m.created_at, tz)}
                      </span>
                      {m.body}
                      {live && (m.role === "assistant" || m.role === "staff") && (
                        <span className={`delivery ${m.delivery_error && !m.delivered_at ? "failed" : ""}`}>
                          {m.delivered_at ? t("Sent on LINE") : m.delivery_error ? t("Not sent: {error}", { error: m.delivery_error }) : "Sending…"}
                        </span>
                      )}
                    </div>
                  )}
                  {items.map((e, i) => <EventLine key={`${m.id}-${i}`} e={e} t={t} />)}
                </div>
              );
            })}
            {msgs.length === 0 && <p className="muted small">{t("No messages yet.")}</p>}
            <span id="latest" />
          </div>
        </section>

        <div className="stack">
          {needsLink && (
            <section className="card">
              <h2>{t("Who is this?")}</h2>
              <p className="muted small">
                {t("LINE doesn't share phone numbers. If {name} is a member, pick them: the assistant then knows their package and bookings (and can book with it), and recognises them next time.", { name: name })}
              </p>
              <form action={linkMember} className="form">
                <input type="hidden" name="conversation_id" value={conv.id} />
                <select name="member_id" defaultValue="" required>
                  <option value="" disabled>{t("Choose a member")}</option>
                  {linkable.map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name}</option>
                  ))}
                </select>
                <button style={{ justifySelf: "start" }}>{t("Link to member")}</button>
              </form>
            </section>
          )}

          {isTest && !closed && (
            <section className="card">
              <h2>{t("Write as {name}", { name: name })}</h2>
              <form action={sendAsContact} className="form">
                <input type="hidden" name="conversation_id" value={conv.id} />
                <textarea name="message" rows={3} required placeholder={t("Yes please, book me in")} />
                <button className="primary" style={{ justifySelf: "start" }}>{t("Send as the member")}</button>
                {paused && (
                  <span className="muted small">{t("The assistant is paused here, so it won't answer this until the pause ends.")}</span>
                )}
              </form>
            </section>
          )}

          {!closed && (
            <section className="card">
              <h2>{t("Reply as staff")}</h2>
              <form action={staffReply} className="form">
                <input type="hidden" name="conversation_id" value={conv.id} />
                <textarea name="message" rows={3} required />
                <button style={{ justifySelf: "start" }}>{conv.channel === "line" ? t("Send on LINE") : t("Add reply")}</button>
                <span className="muted small">
                  {isTest ? t("Test chat: nothing is sent anywhere.") : conv.channel === "line" ? t("Sent on LINE straight away.") : t("WhatsApp isn't connected yet: send it from your phone too.")}{" "}
                  {t("Replying pauses the assistant here for 30 minutes.")}
                </span>
              </form>
            </section>
          )}

          {!closed && (
            <section className="card">
              <h2>{t("Who answers")}</h2>
              <div className="actions">
                {conv.status === "bot" && !paused ? (
                  <form action={takeOver}>
                    <input type="hidden" name="conversation_id" value={conv.id} />
                    <button>{t("Take over from the assistant")}</button>
                  </form>
                ) : (
                  <form action={handBack}>
                    <input type="hidden" name="conversation_id" value={conv.id} />
                    <button className="primary">{conv.status === "staff" ? t("Done: hand back to the assistant") : t("Hand back to the assistant")}</button>
                  </form>
                )}
                <form action={closeChat}>
                  <input type="hidden" name="conversation_id" value={conv.id} />
                  <button>{t("Close chat")}</button>
                </form>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
