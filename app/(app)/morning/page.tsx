import Link from "next/link";
import { requireOrg } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { lineShareLink, whatsappLink, whatsappNumber } from "@/lib/ai";
import { NOTICE_LABELS, noticeText, payUrlFor, type NoticeKind, type NoticePayload } from "@/lib/notices";
import { markNoticeDone } from "./actions";
import { addDays, formatLongDay, formatMoney, localTime, todayIn, zonedToUtc } from "@/lib/time";
import { approveAll, approveDraft, dismissDraft, markSent, sendOnLine, sendOnWhatsApp, writeDrafts } from "../followups/actions";
import { REASON_LABELS, type AiMessage, type SessionOverview } from "@/lib/types";

// The owner's morning: today at a glance, then the day's follow-up drafts to approve in one tap,
// then the approved ones ready to send. Phone first.

function MessageCard({ m, mode }: { m: AiMessage; mode: "approve" | "send" | "wait" }) {
  const phone = m.members?.whatsapp ?? m.members?.phone ?? null;
  const prefersLine = m.members?.member_channel === "line";
  const canWhatsApp = Boolean(whatsappNumber(phone));
  return (
    <article className="card morning-msg">
      <div className="actions" style={{ justifyContent: "space-between" }}>
        <Link href={`/members/${m.member_id}`}><strong>{m.members?.full_name ?? "Member"}</strong></Link>
        <span className="badge">{REASON_LABELS[m.reason]}</span>
      </div>
      <form className="form">
        <input type="hidden" name="message_id" value={m.id} />
        <input type="hidden" name="phone" value={phone ?? ""} />
        <input type="hidden" name="return_to" value="/morning" />
        <textarea name="body" defaultValue={m.body} rows={4} readOnly={mode !== "approve"} />
        <div className="actions">
          {mode === "approve" && (
            <>
              <button className="primary" formAction={approveDraft}>Approve</button>
              <button className="link danger" formAction={dismissDraft}>Skip</button>
            </>
          )}
          {mode === "send" && (
            <>
              {prefersLine && <button className="primary" formAction={sendOnLine}>Send on LINE</button>}
              {canWhatsApp && (
                <button className={prefersLine ? undefined : "primary"} formAction={sendOnWhatsApp}>Send on WhatsApp</button>
              )}
              {!prefersLine && <button formAction={sendOnLine}>LINE</button>}
              <button className="link" formAction={markSent}>Mark as sent</button>
            </>
          )}
        </div>
      </form>
    </article>
  );
}

export default async function MorningPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, can, location, workLocation } = await requireOrg();
  const manager = can("followups.manage");
  const tz = workLocation?.timezone ?? org.timezone;
  const today = todayIn(tz);
  const dayStart = zonedToUtc(today, "00:00", tz).toISOString();
  const dayEnd = zonedToUtc(addDays(today, 1), "00:00", tz).toISOString();
  const yesterdayStart = zonedToUtc(addDays(today, -1), "00:00", tz).toISOString();

  let sessionsQ = supabase
    .from("session_overview")
    .select("*")
    .eq("org_id", org.id)
    .neq("status", "cancelled")
    .gte("starts_at", dayStart)
    .lt("starts_at", dayEnd)
    .order("starts_at");
  let courtsQ = supabase
    .from("booking_calendar")
    .select("id", { count: "exact", head: true })
    .eq("org_id", org.id)
    .eq("status", "confirmed")
    .in("kind", ["member", "drop_in"])
    .gte("start_at", dayStart)
    .lt("start_at", dayEnd);
  if (location) {
    sessionsQ = sessionsQ.eq("location_id", location.id);
    courtsQ = courtsQ.eq("location_id", location.id);
  }
  const messageSelect = "*, members(full_name, phone, whatsapp, member_channel)";

  const [
    { data: sessionData },
    { count: courtCount },
    { data: salesData },
    { count: chatsWaiting },
    { count: requestsWaiting },
    { data: draftData },
    { data: approvedData },
  ] = await Promise.all([
    sessionsQ,
    courtsQ,
    supabase.from("memberships").select("price_paid").eq("org_id", org.id).gte("created_at", yesterdayStart).lt("created_at", dayStart),
    supabase.from("chat_conversations").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "staff"),
    supabase.from("session_registrations").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "requested"),
    supabase.from("ai_messages").select(messageSelect).eq("org_id", org.id).eq("status", "draft").order("created_at"),
    supabase.from("ai_messages").select(messageSelect).eq("org_id", org.id).eq("status", "approved").order("approved_at"),
  ]);
  // Automatic notices: what went out in the last day, and what needs sending by hand.
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [{ count: autoSent }, { data: manualData }] = await Promise.all([
    supabase.from("member_notices").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "sent").gte("sent_at", since),
    supabase
      .from("member_notices")
      .select("id, kind, dedupe_key, payload, error, created_at, members(id, full_name, language, phone, whatsapp, member_channel)")
      .eq("org_id", org.id)
      .in("status", ["manual", "failed"])
      .gte("created_at", new Date(Date.now() - 3 * 24 * 3600_000).toISOString())
      .order("created_at"),
  ]);
  type ManualNotice = {
    id: string;
    kind: NoticeKind;
    dedupe_key: string;
    payload: NoticePayload;
    error: string | null;
    members: { id: string; full_name: string; language: string; phone: string | null; whatsapp: string | null; member_channel: string | null } | null;
  };
  const manual = (manualData ?? []) as unknown as ManualNotice[];
  // Booking confirmations with something to pay get the PromptPay pay link.
  const payUrls = new Map(
    await Promise.all(
      manual.map(async (n) => [n.id, await payUrlFor(supabase, { slug: org.slug, promptpay_id: org.promptpay_id }, n)] as const),
    ),
  );
  const sessions = (sessionData ?? []) as SessionOverview[];
  const short = sessions.filter((s) => s.booked < s.min_players);
  const sales = (salesData ?? []) as { price_paid: number | null }[];
  const salesTotal = sales.reduce((sum, m) => sum + Number(m.price_paid ?? 0), 0);
  const drafts = (draftData ?? []) as AiMessage[];
  const approved = (approvedData ?? []) as AiMessage[];
  const approvalOn = org.followup_mode === "approve";

  return (
    <div className="morning">
      <div className="page-head">
        <div>
          <h1>Good morning</h1>
          <p className="muted">{formatLongDay(today)} · {location?.name ?? org.name}</p>
        </div>
      </div>
      <Banner sp={sp} />

      <div className="stats">
        <div className="stat">
          <div className="label">Sessions today</div>
          <div className="value">{sessions.length}</div>
          {short.length > 0 && <div className="small" style={{ color: "var(--warning)" }}>{short.length} short of players</div>}
        </div>
        <div className="stat">
          <div className="label">Court bookings today</div>
          <div className="value">{courtCount ?? 0}</div>
        </div>
        <div className="stat">
          <div className="label">Packages sold yesterday</div>
          <div className="value">{sales.length}</div>
          {sales.length > 0 && <div className="muted small">{formatMoney(salesTotal, org.currency)}</div>}
        </div>
      </div>

      {((chatsWaiting ?? 0) > 0 || (requestsWaiting ?? 0) > 0) && (
        <div className="banner warn">
          Waiting for you:{" "}
          {(chatsWaiting ?? 0) > 0 && <Link href="/chats">{chatsWaiting} chat{chatsWaiting === 1 ? "" : "s"}</Link>}
          {(chatsWaiting ?? 0) > 0 && (requestsWaiting ?? 0) > 0 && " · "}
          {(requestsWaiting ?? 0) > 0 && (
            <Link href="/dashboard">{requestsWaiting} online sign-up request{requestsWaiting === 1 ? "" : "s"}</Link>
          )}
        </div>
      )}

      {sessions.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2>Today</h2>
          <ul className="list">
            {sessions.map((s) => (
              <li key={s.id}>
                <span>
                  <Link href={`/sessions/${s.id}`}>{localTime(s.starts_at, s.location_timezone)} {s.name}</Link>
                  {!location && sessions.some((x) => x.location_id !== s.location_id) && (
                    <span className="muted small"> · {s.location_name}</span>
                  )}
                </span>
                <span className={`badge ${s.booked < s.min_players ? "warn" : ""}`}>
                  {s.booked}/{s.max_players}
                  {s.booked < s.min_players ? ` · needs ${s.min_players - s.booked}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="morning-section">
        <div className="actions" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Follow-ups to approve</h2>
          {manager && approvalOn && drafts.length > 1 && (
            <form action={approveAll}>
              <input type="hidden" name="return_to" value="/morning" />
              <button className="primary" data-pending-label="Approving…">Approve all {drafts.length}</button>
            </form>
          )}
        </div>
        {drafts.length === 0 ? (
          <div className="card">
            <p className="muted small">
              Nothing waiting.{" "}
              {org.morning_drafts
                ? "Drafts are written automatically each morning for members who need a message."
                : "Automatic morning drafts are off (AI follow-ups → message settings)."}
            </p>
            {manager && (
              <form action={writeDrafts}>
                <input type="hidden" name="return_to" value="/morning" />
                <button data-pending-label="Writing drafts…">Write drafts now</button>
              </form>
            )}
          </div>
        ) : !approvalOn ? (
          <p className="muted small">
            {org.followup_mode === "auto"
              ? "Your club sends follow-ups automatically each morning. Members not on LINE wait below in Ready to send."
              : "Your club lets the desk send drafts without approval."}{" "}
            They&apos;re also on <Link href="/followups">AI follow-ups</Link>.
          </p>
        ) : manager ? (
          <div className="stack">
            {drafts.map((m) => <MessageCard key={m.id} m={m} mode="approve" />)}
          </div>
        ) : (
          <div className="card">
            <p className="small">
              {drafts.length} draft{drafts.length === 1 ? " is" : "s are"} waiting for an owner, admin or marketing to approve.
            </p>
          </div>
        )}
      </section>

      <section className="morning-section">
        <h2>Automatic messages</h2>
        <p className="muted small">
          {autoSent ?? 0} sent by themselves on LINE in the last 24 hours (reminders, waitlist and cancellation notices,
          packages ending).{" "}
          <Link href="/settings#notices">Settings</Link>
        </p>
        {manual.length > 0 && (
          <>
            <p className="small">These members aren&apos;t on LINE yet, so send these by hand:</p>
            <div className="stack">
              {manual.map((n) => {
                const m = n.members;
                const text = noticeText(n.kind, { ...n.payload, pay_url: payUrls.get(n.id) ?? null }, m?.language ?? "en", { name: org.name, currency: org.currency, paymentNote: org.payment_note });
                const wa = whatsappLink(m?.whatsapp ?? m?.phone, text);
                return (
                  <article key={n.id} className="card morning-msg">
                    <div className="actions" style={{ justifyContent: "space-between" }}>
                      {m ? <Link href={`/members/${m.id}`}><strong>{m.full_name}</strong></Link> : <strong>Member</strong>}
                      <span className="badge">{NOTICE_LABELS[n.kind]}</span>
                    </div>
                    <p className="small" style={{ whiteSpace: "pre-wrap" }}>{text}</p>
                    {n.error && <p className="small" style={{ color: "var(--danger)" }}>LINE: {n.error}</p>}
                    <div className="actions">
                      {wa && <a className="button primary" href={wa}>Send on WhatsApp</a>}
                      <a className="button" href={lineShareLink(text)}>LINE</a>
                      <form action={markNoticeDone}>
                        <input type="hidden" name="notice_id" value={n.id} />
                        <button className="link">Mark as sent</button>
                      </form>
                      <form action={markNoticeDone}>
                        <input type="hidden" name="notice_id" value={n.id} />
                        <input type="hidden" name="skip" value="true" />
                        <button className="link danger">Skip</button>
                      </form>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section className="morning-section">
        <h2>Ready to send</h2>
        {approved.length === 0 ? (
          <p className="muted small">Approved messages appear here for anyone at the club to send.</p>
        ) : (
          <>
            <p className="muted small">
              Approved. Tap to open WhatsApp or LINE with the message filled in. (Once WhatsApp is connected, these go out by
              themselves.)
            </p>
            <div className="stack">
              {approved.map((m) => <MessageCard key={m.id} m={m} mode="send" />)}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
