import type { T } from "@/lib/i18n";
import Link from "next/link";
import { requirePermission } from "@/lib/org";
import { Banner, param, type SearchParams } from "@/components/Banner";
import { CopyButton } from "@/components/CopyButton";
import { aiConfigured, whatsappNumber } from "@/lib/ai";
import { formatMoney, localTime } from "@/lib/time";
import { LANGUAGES } from "@/components/MemberFields";
import {
  approveDraft,
  dismissAll,
  dismissDraft,
  inviteForSession,
  markSent,
  rewriteDraft,
  saveDraft,
  saveVoice,
  sendOnLine,
  sendOnWhatsApp,
  writeDrafts,
} from "./actions";
import {
  REASON_LABELS,
  type AiFollowupStats,
  type AiMessage,
  type FollowupReason,
  type SessionOverview,
} from "@/lib/types";
import { ASSISTANT_NAME } from "@/lib/assistant";

const REASON_BADGE: Record<FollowupReason, string> = {
  renewal: "warn",
  at_risk: "danger",
  drop_in_lead: "info",
  fill_session: "ok",
};

function languageName(code: string, t: T) {
  const label = LANGUAGES.find((l) => l.code === code)?.label;
  return label ? t(label) : code.toUpperCase();
}

/** One line telling staff why this person is getting a message. */
function whyLine(m: AiMessage, t: T) {
  const c = m.context ?? {};
  const parts: string[] = [];
  if (m.reason === "fill_session" && c.session) {
    parts.push(`${c.session.name}, ${c.session.when}`, t("needs {n} more", { n: c.session.players_still_needed }));
    if (c.session.location) parts.push(c.session.location);
  } else {
    if (c.package) parts.push(c.package);
    if (c.sessions_left != null) parts.push(t("{n} sessions left", { n: c.sessions_left }));
    else if (c.package_ends) parts.push(t("ends {date}", { date: c.package_ends }));
    if (c.never_visited) parts.push(t("never visited"));
    else if (c.days_since_last_visit != null) parts.push(t("last visit {n} days ago", { n: c.days_since_last_visit }));
  }
  if (c.usual_play_time) parts.push(t("usually {time}", { time: c.usual_play_time }));
  return parts.join(" · ");
}

export default async function FollowupsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, can, t, locale } = await requirePermission("followups.send");
  // Approving and how messages sound: owner, admin, marketing. How they go out: owner and admin.
  const manager = can("followups.manage");
  const clubSettings = can("settings.manage");
  const show = (param(sp, "show") ?? "all") as FollowupReason | "all";

  let draftQuery = supabase
    .from("ai_messages")
    .select("*, members(full_name, phone, whatsapp, member_channel)")
    .eq("org_id", org.id)
    .in("status", ["draft", "approved"])
    .order("created_at", { ascending: false });
  if (show !== "all") draftQuery = draftQuery.eq("reason", show);

  const [{ data: dData }, { data: sentData }, { data: outcomeData }, { data: statsData }, { data: needData }] =
    await Promise.all([
      draftQuery,
      supabase
        .from("ai_messages")
        .select("*, members(full_name, phone, whatsapp, member_channel)")
        .eq("org_id", org.id)
        .eq("status", "sent")
        .order("sent_at", { ascending: false })
        .limit(15),
      supabase.from("ai_message_outcomes").select("id, came_in, signed_up, package_revenue").eq("org_id", org.id),
      supabase.from("ai_followup_stats").select("*").eq("org_id", org.id).maybeSingle(),
      supabase.from("sessions_needing_players").select("*").eq("org_id", org.id).order("starts_at").limit(8),
    ]);

  const drafts = (dData ?? []) as AiMessage[];
  const sent = (sentData ?? []) as AiMessage[];
  const outcomes = new Map(
    ((outcomeData ?? []) as { id: string; came_in: boolean; signed_up: boolean; package_revenue: number }[]).map((o) => [
      o.id,
      o,
    ]),
  );
  const stats = (statsData ?? {}) as Partial<AiFollowupStats>;
  const needPlayers = (needData ?? []) as SessionOverview[];
  const connected = aiConfigured();
  const approvalOn = org.followup_mode === "approve";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("AI follow-ups")}</h1>
          <p className="muted">
            {t("Personal messages for members who are drifting away, renewing soon, or tried a session but never joined. You check each one before it goes.")}
          </p>
        </div>
        <form action={writeDrafts}>
          <button className="primary" data-pending-label={t("Writing drafts…")}>{t("Write today's drafts")}</button>
        </form>
      </div>
      <Banner sp={sp} />
      {!connected && (
        <div className="banner error">
          {t("The AI assistant isn't connected yet, so drafts use simple English templates. Add {key} to {file} and restart the app for personal messages in each member's language.", { key: "ANTHROPIC_API_KEY", file: ".env.local" })}
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <div className="label">{t("Drafts waiting")}</div>
          <div className="value">{stats.drafts_waiting ?? 0}</div>
        </div>
        <div className="stat">
          <div className="label">{t("Sent, last 30 days")}</div>
          <div className="value">{stats.sent_30d ?? 0}</div>
        </div>
        <div className="stat">
          <div className="label">{t("Came back or booked")}</div>
          <div className="value">
            {stats.responded_30d ?? 0}
            {stats.sent_30d ? (
              <span className="muted small"> ({Math.round(((stats.responded_30d ?? 0) / stats.sent_30d) * 100)}%)</span>
            ) : null}
          </div>
        </div>
        <div className="stat">
          <div className="label">{t("Packages bought after a message")}</div>
          <div className="value">{formatMoney(stats.package_revenue_30d, org.currency)}</div>
        </div>
      </div>

      {needPlayers.length > 0 && (
        <section className="card" style={{ marginBottom: 18 }}>
          <h2>{t("Sessions short of players")}</h2>
          <p className="muted small">
            {t("These may be cancelled at the go / no-go check. Invite members whose level and history fit.")}
          </p>
          <ul className="list">
            {needPlayers.map((s) => (
              <li key={s.id}>
                <span>
                  <Link href={`/sessions/${s.id}`}>{s.name}</Link>
                  <span className="muted small">
                    {" "}
                    · {new Date(s.starts_at).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: s.location_timezone })}{" "}
                    {localTime(s.starts_at, s.location_timezone)} · {s.location_name} · {s.booked} of {s.min_players} needed
                  </span>
                </span>
                <form action={inviteForSession} className="inline">
                  <input type="hidden" name="session_id" value={s.id} />
                  <button>{t("Draft invites")}</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="actions" style={{ marginBottom: 12, justifyContent: "space-between" }}>
        <div className="actions">
          {(["all", "renewal", "at_risk", "drop_in_lead", "fill_session"] as const).map((k) => (
            <Link key={k} href={`/followups?show=${k}`} className={`badge ${k === show ? "ok" : ""}`}>
              {k === "all" ? t("All drafts") : t(REASON_LABELS[k])}
            </Link>
          ))}
        </div>
        {manager && drafts.length > 0 && (
          <form action={dismissAll}>
            <button className="link danger">{t("Clear all drafts")}</button>
          </form>
        )}
      </div>

      <div className="stack">
        {drafts.length === 0 ? (
          <div className="card">
            <p className="muted">
              {t("No drafts waiting. Click \"{button}\" to check who needs a message.", { button: t("Write today's drafts") })}
            </p>
          </div>
        ) : (
          drafts.map((m) => {
            const phone = m.members?.whatsapp ?? m.members?.phone ?? null;
            const canWhatsApp = Boolean(whatsappNumber(phone));
            const prefersLine = m.members?.member_channel === "line";
            const boxId = `body-${m.id}`;
            const approved = m.status === "approved";
            // Morning approval: desk staff send only what an owner, admin or marketing approved (the database enforces it).
            const canSend = !approvalOn || approved || manager;
            const canEdit = manager || !approved || !approvalOn;
            return (
              <article key={m.id} id={`m-${m.id}`} className="card">
                <div className="actions" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                  <span className="actions">
                    <Link href={`/members/${m.member_id}`}>
                      <strong>{m.members?.full_name ?? t("Member")}</strong>
                    </Link>
                    <span className={`badge ${REASON_BADGE[m.reason]}`}>{t(REASON_LABELS[m.reason])}</span>
                    <span className="badge">{languageName(m.language, t)}</span>
                    {approved && <span className="badge ok">{t("Approved")}</span>}
                  </span>
                  <span className="muted small">{phone ?? t("No phone number")}</span>
                </div>
                <p className="muted small">{whyLine(m, t)}</p>
                <form className="form">
                  <input type="hidden" name="message_id" value={m.id} />
                  <input type="hidden" name="phone" value={phone ?? ""} />
                  <textarea id={boxId} name="body" defaultValue={m.body} rows={5} style={{ minHeight: 110 }} readOnly={!canEdit} />
                  <div className="actions" style={{ justifyContent: "space-between" }}>
                    {!canSend ? (
                      <span className="muted small">
                        {t("Waiting for approval")} (<Link href="/morning">{t("Morning")}</Link>)
                      </span>
                    ) : (
                    <span className="actions">
                      {manager && approvalOn && !approved && (
                        <button className="primary" formAction={approveDraft}>{t("Approve")}</button>
                      )}
                      {prefersLine && (
                        <button className="primary" formAction={sendOnLine}>{t("Send on LINE")}</button>
                      )}
                      {canWhatsApp ? (
                        <button className={prefersLine ? undefined : "primary"} formAction={sendOnWhatsApp}>
                          {t("Send on WhatsApp")}
                        </button>
                      ) : (
                        !prefersLine && (
                          <Link className="button" href={`/members/${m.member_id}`}>{t("Add phone number")}</Link>
                        )
                      )}
                      {!prefersLine && <button formAction={sendOnLine}>{t("Send on LINE")}</button>}
                      <CopyButton targetId={boxId} />
                      <button formAction={markSent}>{t("Mark as sent")}</button>
                      {canEdit && <button formAction={saveDraft}>{t("Save edit")}</button>}
                    </span>
                    )}
                    <span className="actions">
                      {!approved && (
                        <button className="link" formAction={rewriteDraft} data-pending-label={t("Rewriting…")}>{t("Rewrite")}</button>
                      )}
                      <button className="link danger" formAction={dismissDraft}>{t("Dismiss")}</button>
                    </span>
                  </div>
                  <span className="muted small">
                    {m.model ? t("Written by {assistant}", { assistant: ASSISTANT_NAME }) : t("Template (AI assistant not connected)")}
                    {" · "}{t("Usually messaged on {channel}. LINE opens with the message filled in; pick their chat there.", { channel: prefersLine ? "LINE" : "WhatsApp" })}
                  </span>
                </form>
              </article>
            );
          })
        )}
      </div>

      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <section className="card">
          <h2>{t("Recently sent")}</h2>
          {sent.length === 0 ? (
            <p className="muted small">{t("Nothing sent yet.")}</p>
          ) : (
            <ul className="list">
              {sent.map((m) => {
                const o = outcomes.get(m.id);
                const noResponse = !o?.package_revenue && !o?.signed_up && !o?.came_in;
                const result = o?.package_revenue
                  ? t("Bought a package ({amount})", { amount: formatMoney(o.package_revenue, org.currency) })
                  : o?.signed_up
                    ? t("Signed up for a session")
                    : o?.came_in
                      ? t("Came back")
                      : t("No response yet");
                return (
                  <li key={m.id}>
                    <span>
                      <Link href={`/members/${m.member_id}`}>{m.members?.full_name}</Link>
                      <span className="muted small"> · {t(REASON_LABELS[m.reason])} · {new Date(m.sent_at!).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: org.timezone })}</span>
                    </span>
                    <span className={`badge ${noResponse ? "" : "ok"}`}>{result}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>{t("How messages sound")}</h2>
          <form action={saveVoice} className="form">
            <fieldset disabled={!manager} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
              <label>
                {t("Tone")}
                <textarea name="ai_voice" defaultValue={org.ai_voice} rows={2} />
              </label>
              <label>
                {t("Sign off as")}
                <input name="ai_sign_off" defaultValue={org.ai_sign_off ?? ""} placeholder={t("Nong at Raccoon Pickleball")} />
              </label>
              <label>
                {t("Offers the AI may mention (it never invents others)")}
                <textarea
                  name="ai_offers"
                  defaultValue={org.ai_offers ?? ""}
                  rows={3}
                  placeholder={t("Renew before your package ends and get a free can of balls. Members can pause for the low season instead of cancelling.")}
                />
              </label>
              <fieldset disabled={!clubSettings} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
              <label>
                {t("Don't message the same person for the same reason within (days)")}
                <input type="number" name="followup_cooldown_days" min={1} max={60} defaultValue={org.followup_cooldown_days} />
              </label>
              <label>
                {t("Before messages go out")}
                <select name="followup_mode" defaultValue={org.followup_mode}>
                  <option value="approve">{t("An owner, admin or marketing approves them (Morning page)")}</option>
                  <option value="desk">{t("Anyone at the desk may send them")}</option>
                  <option value="auto">{t("Send them automatically each morning (members on LINE)")}</option>
                </select>
              </label>
              <label className="check">
                <input type="checkbox" name="morning_drafts" defaultChecked={org.morning_drafts} />
                {t("Write drafts automatically every morning")}
              </label>
              {!clubSettings && <p className="muted small">{t("The owner or an admin decides how messages go out.")}</p>}
              </fieldset>
              <button>{t("Save message settings")}</button>
            </fieldset>
          </form>
          <p className="muted small" style={{ marginTop: 10 }}>
            {connected ? t("Written by {assistant}.", { assistant: ASSISTANT_NAME }) : t("Templates in use until the AI assistant is connected.")}{" "}{t("Only members who agreed to receive messages are included.")}
          </p>
        </section>
      </div>
    </>
  );
}
