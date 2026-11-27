import Link from "next/link";
import { requirePermission } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { CopyButton } from "@/components/CopyButton";
import { aiConfigured, whatsappNumber } from "@/lib/ai";
import { formatMoney, localTime } from "@/lib/time";
import {
  dismissInquiryReply,
  draftInquiryReply,
  markInquirySent,
  rewriteInquiryReply,
  saveInquiryReply,
  sendInquiryOnLine,
  sendInquiryOnWhatsApp,
} from "./actions";
import type { InquiryReply, SessionOverview } from "@/lib/types";
import { ASSISTANT_NAME } from "@/lib/assistant";

function shortDay(iso: string, tz: string) {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz });
}

export default async function RepliesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, location, locations, multiLocation, t, locale } = await requirePermission("chats.reply");
  const ai = aiConfigured();

  const soon = new Date(Date.now() + 3 * 86400000).toISOString();
  let sessionsQuery = supabase
    .from("session_overview")
    .select("*")
    .eq("org_id", org.id)
    .neq("status", "cancelled")
    .gt("starts_at", new Date().toISOString())
    .lt("starts_at", soon)
    .order("starts_at")
    .limit(40);
  if (location) sessionsQuery = sessionsQuery.eq("location_id", location.id);

  const [{ data: draftData }, { data: sentData }, { data: memberData }, { data: sessionData }, { data: packageData }] =
    await Promise.all([
      supabase
        .from("inquiry_replies")
        .select("*, members(full_name, phone, whatsapp, member_channel)")
        .eq("org_id", org.id)
        .eq("status", "draft")
        .order("created_at", { ascending: false }),
      supabase
        .from("inquiry_replies")
        .select("*, members(full_name, phone, whatsapp, member_channel)")
        .eq("org_id", org.id)
        .eq("status", "sent")
        .order("sent_at", { ascending: false })
        .limit(10),
      supabase.from("members").select("id, full_name").eq("org_id", org.id).order("full_name"),
      sessionsQuery,
      supabase.from("package_types").select("name, price").eq("org_id", org.id).eq("is_active", true).order("price"),
    ]);

  const drafts = (draftData ?? []) as InquiryReply[];
  const sent = (sentData ?? []) as InquiryReply[];
  const members = (memberData ?? []) as { id: string; full_name: string }[];
  const sessions = (sessionData ?? []) as SessionOverview[];
  const packages = (packageData ?? []) as { name: string; price: number }[];
  const activeLocations = locations.filter((l) => l.is_active);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Reply helper")}</h1>
          <p className="muted">
            {t("Paste a message from WhatsApp, LINE or anywhere. {ASSISTANT_NAME} drafts an answer from your real sessions, spots and prices. You check it and send it.", { ASSISTANT_NAME: ASSISTANT_NAME })}
          </p>
        </div>
      </div>
      <Banner sp={sp} />

      {!ai && (
        <div className="card" style={{ marginBottom: 14 }}>
          <p className="small">
            {t("The AI assistant isn't connected yet, so replies can't be drafted. Add {key} to {file} and restart the app. Until then, the sessions and prices below help you answer by hand.", { key: "ANTHROPIC_API_KEY", file: ".env.local" })}
          </p>
        </div>
      )}

      <section className="card" style={{ marginBottom: 18 }}>
        <h2>{t("New message")}</h2>
        <form action={draftInquiryReply} className="form">
          <label>
            {t("Message you received")}
            <textarea
              name="incoming"
              required
              rows={4}
              maxLength={4000}
              placeholder={t("Hi, do you have open play tomorrow evening? How much is it?")}
            />
          </label>
          <div className="form-row">
            <label>
              {t("From")}
              <select name="member_id" defaultValue="">
                <option value="">{t("Visitor or unknown (enter below)")}</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name}</option>
                ))}
              </select>
            </label>
            <label>
              {t("Visitor name")}
              <input name="contact_name" placeholder={t("Kenji")} />
            </label>
            <label>
              {t("Visitor WhatsApp")}
              <input name="contact_phone" type="tel" placeholder="+81 90 1234 5678" />
            </label>
            {multiLocation && (
              <label>
                {t("About")}
                <select name="location_id" defaultValue={location?.id ?? ""}>
                  <option value="">{t("Any location")}</option>
                  {activeLocations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="muted small">
            {t("Pick the member if you know them: the assistant then knows their package and what they've booked.")}
          </p>
          <div className="actions">
            <button className="primary" disabled={!ai} data-pending-label={t("Drafting…")}>{t("Draft a reply")}</button>
          </div>
        </form>
      </section>

      <div className="stack">
        {drafts.map((r) => {
          const phone = r.members ? (r.members.whatsapp ?? r.members.phone) : r.contact_phone;
          const canWhatsApp = Boolean(whatsappNumber(phone));
          // Members: their channel setting. Visitors: WhatsApp if we have a number, else LINE.
          const prefersLine = r.members ? r.members.member_channel === "line" : !canWhatsApp;
          const who = r.members?.full_name ?? r.contact_name ?? t("Unknown sender");
          const boxId = `reply-${r.id}`;
          return (
            <article key={r.id} id={`r-${r.id}`} className="card">
              <div className="actions" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                <span className="actions">
                  {r.member_id ? (
                    <Link href={`/members/${r.member_id}`}><strong>{who}</strong></Link>
                  ) : (
                    <strong>{who}</strong>
                  )}
                  <span className="badge">{r.member_id ? t("Member") : t("Visitor")}</span>
                </span>
                <span className="muted small">{phone ?? t("No phone number")}</span>
              </div>
              <blockquote
                className="small"
                style={{ margin: "6px 0 10px", padding: "6px 10px", borderLeft: "3px solid var(--border)", whiteSpace: "pre-wrap" }}
              >
                {r.incoming}
              </blockquote>
              <form className="form">
                <input type="hidden" name="reply_id" value={r.id} />
                <input type="hidden" name="phone" value={phone ?? ""} />
                <textarea id={boxId} name="reply" defaultValue={r.reply} rows={5} style={{ minHeight: 110 }} />
                <div className="actions" style={{ justifyContent: "space-between" }}>
                  <span className="actions">
                    {prefersLine && <button className="primary" formAction={sendInquiryOnLine}>{t("Send on LINE")}</button>}
                    {canWhatsApp && (
                      <button className={prefersLine ? undefined : "primary"} formAction={sendInquiryOnWhatsApp}>
                        {t("Send on WhatsApp")}
                      </button>
                    )}
                    {!prefersLine && <button formAction={sendInquiryOnLine}>{t("Send on LINE")}</button>}
                    <CopyButton targetId={boxId} />
                    <button formAction={markInquirySent}>{t("Mark as sent")}</button>
                    <button formAction={saveInquiryReply}>{t("Save edit")}</button>
                  </span>
                  <span className="actions">
                    <button className="link" formAction={rewriteInquiryReply} data-pending-label={t("Rewriting…")}>{t("Rewrite")}</button>
                    <button className="link danger" formAction={dismissInquiryReply}>{t("Dismiss")}</button>
                  </span>
                </div>
                <span className="muted small">
                  {r.model ? t("Written by {assistant}", { assistant: ASSISTANT_NAME }) : t("Written by hand")}{" "}{t("· The assistant never books anything: if they say yes, sign them up on the session page.")}
                </span>
              </form>
            </article>
          );
        })}
      </div>

      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <section className="card">
          <h2>{t("Next 3 days")}</h2>
          <p className="muted small">{t("What the assistant sees when it answers (it looks 7 days ahead). Tap a session to sign someone up.")}</p>
          {sessions.length === 0 ? (
            <p className="muted small">{t("No sessions in the next 3 days.")}</p>
          ) : (
            <ul className="list">
              {sessions.map((s) => (
                <li key={s.id}>
                  <span>
                    <Link href={`/sessions/${s.id}`}>{s.name}</Link>
                    <span className="muted small">
                      {" "}
                      · {shortDay(s.starts_at, s.location_timezone)} {localTime(s.starts_at, s.location_timezone)}
                      {multiLocation && !location ? ` · ${s.location_name}` : ""}
                    </span>
                  </span>
                  <span className="small" style={{ whiteSpace: "nowrap" }}>
                    {formatMoney(s.price, org.currency)} ·{" "}
                    {s.spots_left > 0 ? `${s.spots_left} left` : <span className="badge warn">{t("Full")}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {packages.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>{t("Packages")}</h3>
              <ul className="list">
                {packages.map((p) => (
                  <li key={p.name}>
                    <span>{p.name}</span>
                    <span className="small">{formatMoney(p.price, org.currency)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="card">
          <h2>{t("Recently sent")}</h2>
          {sent.length === 0 ? (
            <p className="muted small">{t("Nothing sent yet.")}</p>
          ) : (
            <ul className="list">
              {sent.map((r) => (
                <li key={r.id} style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                  <span className="small">
                    <strong>{r.members?.full_name ?? r.contact_name ?? t("Unknown sender")}</strong>
                    <span className="muted"> · {r.channel === "other" ? "sent" : `on ${r.channel === "line" ? "LINE" : "WhatsApp"}`}</span>
                  </span>
                  <span className="muted small">{r.reply.length > 120 ? r.reply.slice(0, 120) + "…" : r.reply}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
