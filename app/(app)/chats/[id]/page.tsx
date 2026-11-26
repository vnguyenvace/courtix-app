import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { closeChat, handBack, sendAsContact, staffReply, takeOver } from "../actions";
import type { ChatConversation, ChatMessage } from "@/lib/types";

type Conv = ChatConversation & { members: { id: string; full_name: string } | null };

function time(iso: string, tz: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
}

/** One line in the thread for something that happened: a booking, a refusal, a hand-off. */
function EventLine({ e }: { e: Record<string, unknown> }) {
  const s = (k: string) => (e[k] === null || e[k] === undefined ? "" : String(e[k]));
  if (e.kind === "booked_session") {
    const paidBy = s("covered_by") ? ` · covered by ${s("covered_by")}` : " · free";
    return (
      <span className="chat-event ok">
        {s("status") === "waitlisted" ? "Waitlisted" : "Booked"}: {s("session")}, {s("when")}
        {paidBy}
      </span>
    );
  }
  if (e.kind === "booked_court") {
    return <span className="chat-event ok">Booked: {s("court")}, {s("when")}–{s("until")}</span>;
  }
  if (e.kind === "refused") return <span className="chat-event warn">Not booked: {s("reason")}</span>;
  if (e.kind === "handed_off") return <span className="chat-event warn">Handed to staff: {s("reason")}</span>;
  return null;
}

export default async function ChatPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, org, workLocation } = await requireOrg();
  const tz = workLocation?.timezone ?? org.timezone;

  const [{ data: convData }, { data: msgData }] = await Promise.all([
    supabase.from("chat_conversations").select("*, members(id, full_name)").eq("id", id).maybeSingle(),
    supabase.from("chat_messages").select("*").eq("conversation_id", id).order("created_at").order("id"),
  ]);
  const conv = convData as Conv | null;
  if (!conv) notFound();
  const msgs = (msgData ?? []) as ChatMessage[];
  const name = conv.members?.full_name ?? conv.contact_name ?? conv.contact_phone;
  const isTest = conv.channel === "test";
  const closed = conv.status === "closed";

  return (
    <>
      <div className="page-head">
        <div>
          <p className="small"><Link href="/chats">← Chats</Link></p>
          <h1>{name}</h1>
          <p className="muted">
            {conv.members ? <Link href={`/members/${conv.members.id}`}>Member</Link> : "Visitor"} · {conv.contact_phone}
            {isTest ? " · test chat" : ` · ${conv.channel === "line" ? "LINE" : "WhatsApp"}`}
          </p>
        </div>
        <div className="actions">
          {conv.status === "bot" && <span className="badge ok">Claude is answering</span>}
          {conv.status === "staff" && <span className="badge warn">Waiting for staff</span>}
          {closed && <span className="badge">Closed</span>}
        </div>
      </div>
      <Banner sp={sp} />
      {conv.status === "staff" && conv.handoff_reason && (
        <div className="banner warn">Why it came to you: {conv.handoff_reason}</div>
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
                        {m.role === "contact" ? name : m.role === "assistant" ? "Claude" : "Staff"} · {time(m.created_at, tz)}
                      </span>
                      {m.body}
                    </div>
                  )}
                  {items.map((e, i) => <EventLine key={`${m.id}-${i}`} e={e} />)}
                </div>
              );
            })}
            {msgs.length === 0 && <p className="muted small">No messages yet.</p>}
            <span id="latest" />
          </div>
        </section>

        <div className="stack">
          {isTest && !closed && (
            <section className="card">
              <h2>Write as {name}</h2>
              <form action={sendAsContact} className="form">
                <input type="hidden" name="conversation_id" value={conv.id} />
                <textarea name="message" rows={3} required placeholder="Yes please, book me in" />
                <button className="primary" style={{ justifySelf: "start" }}>Send as the member</button>
                {conv.status === "staff" && (
                  <span className="muted small">Staff are handling this chat, so Claude won&apos;t answer until you hand it back.</span>
                )}
              </form>
            </section>
          )}

          {!closed && (
            <section className="card">
              <h2>Reply as staff</h2>
              <form action={staffReply} className="form">
                <input type="hidden" name="conversation_id" value={conv.id} />
                <textarea name="message" rows={3} required />
                <button style={{ justifySelf: "start" }}>Add reply</button>
                <span className="muted small">
                  {isTest
                    ? "Test chat: nothing is sent anywhere."
                    : "WhatsApp isn't connected yet: send it from your phone too."}{" "}
                  Replying takes the chat over from Claude.
                </span>
              </form>
            </section>
          )}

          {!closed && (
            <section className="card">
              <h2>Who answers</h2>
              <div className="actions">
                {conv.status === "bot" ? (
                  <form action={takeOver}>
                    <input type="hidden" name="conversation_id" value={conv.id} />
                    <button>Take over from Claude</button>
                  </form>
                ) : (
                  <form action={handBack}>
                    <input type="hidden" name="conversation_id" value={conv.id} />
                    <button className="primary">Hand back to Claude</button>
                  </form>
                )}
                <form action={closeChat}>
                  <input type="hidden" name="conversation_id" value={conv.id} />
                  <button>Close chat</button>
                </form>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
