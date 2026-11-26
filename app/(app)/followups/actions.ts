"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, canManage } from "@/lib/org";
import { back, friendly, optStr, str } from "@/lib/form";
import { clubVoice, draftMessage, lineShareLink, whatsappLink, type ClubVoice, type FollowupReason } from "@/lib/ai";
import { draftAndSave as draftAndSaveFor, type Candidate } from "@/lib/followups";
import { loadLine } from "@/lib/messaging";
import { linePush } from "@/lib/line";
import type { Org } from "@/lib/types";

const PAGE = "/followups";
const MORNING = "/morning";

/** The page to go back to: the Morning page sends return_to=/morning. */
function pageOf(form: FormData) {
  return str(form, "return_to") === MORNING ? MORNING : PAGE;
}

function refresh() {
  revalidatePath(PAGE);
  revalidatePath(MORNING);
  revalidatePath("/dashboard");
}

const voiceOf = (org: Org): ClubVoice => clubVoice(org);

/** Drafts for the signed-in staff member's club (RLS applies). */
function draftAndSave(
  ctx: Awaited<ReturnType<typeof requireOrg>>,
  candidates: Candidate[],
  reasonOverride?: FollowupReason,
  sessionId?: string,
) {
  return draftAndSaveFor(ctx.supabase, ctx.org, candidates, reasonOverride, sessionId);
}

export async function writeDrafts(form?: FormData) {
  const ctx = await requireOrg();
  const page = form ? pageOf(form) : PAGE;
  const { data, error } = await ctx.supabase.rpc("followup_candidates", { p_org: ctx.org.id, p_limit: 20 });
  if (error) back(page, friendly(error));

  const candidates = (data ?? []) as Candidate[];
  if (candidates.length === 0) {
    back(page, "Nobody needs a follow-up right now. Everyone flagged already has a draft or was messaged recently.", "notice");
  }

  const { saved, errors } = await draftAndSave(ctx, candidates);
  refresh();
  if (saved === 0 && errors.length) back(page, errors[0]);
  back(
    PAGE,
    `Wrote ${saved} draft${saved === 1 ? "" : "s"}.` + (errors.length ? ` ${errors.length} failed: ${errors[0]}` : ""),
    errors.length ? "error" : "notice",
  );
}

export async function inviteForSession(form: FormData) {
  const ctx = await requireOrg();
  const sessionId = str(form, "session_id");
  const { data, error } = await ctx.supabase.rpc("fill_session_candidates", { p_session: sessionId, p_limit: 6 });
  if (error) back(PAGE, friendly(error));

  const candidates = (data ?? []) as Candidate[];
  if (candidates.length === 0) {
    back(PAGE, "No suitable members to invite to that session (consent, level and recent messages are checked).", "notice");
  }

  const { saved, errors } = await draftAndSave(ctx, candidates, "fill_session", sessionId);
  revalidatePath(PAGE);
  back(
    PAGE,
    `Wrote ${saved} invite${saved === 1 ? "" : "s"}.` + (errors.length ? ` ${errors.length} failed: ${errors[0]}` : ""),
    errors.length ? "error" : "notice",
  );
}

export async function rewriteDraft(form: FormData) {
  const ctx = await requireOrg();
  const id = str(form, "message_id");
  const { data: msg, error } = await ctx.supabase
    .from("ai_messages")
    .select("reason, context, status")
    .eq("id", id)
    .single();
  if (error || !msg) back(PAGE, friendly(error));
  if (msg.status !== "draft") back(PAGE, "Only drafts can be rewritten.");

  try {
    const draft = await draftMessage(msg.reason, msg.context, voiceOf(ctx.org));
    const { error: upErr } = await ctx.supabase
      .from("ai_messages")
      .update({ body: draft.body, model: draft.model })
      .eq("id", id);
    if (upErr) back(PAGE, friendly(upErr));
  } catch (e) {
    back(PAGE, e instanceof Error ? e.message : "Couldn't rewrite the message.");
  }
  revalidatePath(PAGE);
  back(PAGE, "Rewritten.", "notice");
}

export async function saveDraft(form: FormData) {
  const page = pageOf(form);
  const { supabase } = await requireOrg();
  const id = str(form, "message_id");
  const body = str(form, "body");
  if (!body) back(page, "The message can't be empty.");
  const { error } = await supabase.from("ai_messages").update({ body }).eq("id", id).in("status", ["draft", "approved"]);
  if (error) back(page, friendly(error));
  refresh();
  back(page, "Saved.", "notice");
}

/** Saves any edits, marks the message sent, then opens WhatsApp with it filled in. */
export async function sendOnWhatsApp(form: FormData) {
  const page = pageOf(form);
  const { supabase, userId } = await requireOrg();
  const id = str(form, "message_id");
  const body = str(form, "body");
  const phone = optStr(form, "phone");
  if (!body) back(page, "The message can't be empty.");

  const link = whatsappLink(phone, body);
  if (!link) back(page, "This member has no valid phone or WhatsApp number. Add one on their page first.");

  const { error } = await supabase
    .from("ai_messages")
    .update({ body, status: "sent", sent_at: new Date().toISOString(), sent_by: userId, channel: "whatsapp" })
    .eq("id", id)
    .in("status", ["draft", "approved"]);
  if (error) back(page, friendly(error));

  refresh();
  redirect(link);
}

/** Opens LINE with the message filled in; staff pick the member's chat there. */
export async function sendOnLine(form: FormData) {
  const page = pageOf(form);
  const { supabase, userId, org, role } = await requireOrg();
  const id = str(form, "message_id");
  const body = str(form, "body");
  if (!body) back(page, "The message can't be empty.");

  // Member linked on LINE and the club's LINE connected: send it directly (one tap, no share screen).
  const { data: msg } = await supabase
    .from("ai_messages")
    .select("org_id, status, body, members(line_user_id)")
    .eq("id", id)
    .single();
  const memberRel = msg?.members as unknown as { line_user_id: string | null } | { line_user_id: string | null }[] | null;
  const lineUser = (Array.isArray(memberRel) ? memberRel[0] : memberRel)?.line_user_id ?? null;
  if (lineUser && msg) {
    const line = await loadLine(supabase, msg.org_id).catch(() => null);
    if (line) {
      // Check before anything leaves: same rule the database enforces when it's marked sent.
      if (msg.status !== "draft" && msg.status !== "approved") back(page, "This message was already sent or dismissed.");
      if (org.followup_mode === "approve" && !canManage(role)) {
        if (msg.status !== "approved") back(page, "An owner or manager needs to approve this message before it goes out");
        if (body !== msg.body) back(page, "This message was approved as it is. Ask an owner or manager to change it");
      }
      try {
        await linePush(line.token, lineUser, [body]);
      } catch (e) {
        back(page, `Not sent on LINE: ${e instanceof Error ? e.message : "LINE error"}`);
      }
      const { error: markErr } = await supabase
        .from("ai_messages")
        .update({ body, status: "sent", sent_at: new Date().toISOString(), sent_by: userId, channel: "line" })
        .eq("id", id);
      if (markErr) back(page, `Sent on LINE, but not marked as sent: ${friendly(markErr)}`);
      refresh();
      back(page, "Sent on LINE.", "notice");
    }
  }

  const { error } = await supabase
    .from("ai_messages")
    .update({ body, status: "sent", sent_at: new Date().toISOString(), sent_by: userId, channel: "line" })
    .eq("id", id)
    .in("status", ["draft", "approved"]);
  if (error) back(page, friendly(error));

  refresh();
  redirect(lineShareLink(body));
}

export async function markSent(form: FormData) {
  const page = pageOf(form);
  const { supabase, userId } = await requireOrg();
  const { error } = await supabase
    .from("ai_messages")
    .update({
      body: str(form, "body") || undefined,
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_by: userId,
      channel: str(form, "channel") || "other",
    })
    .eq("id", str(form, "message_id"))
    .in("status", ["draft", "approved"]);
  if (error) back(page, friendly(error));
  refresh();
  back(page, "Marked as sent.", "notice");
}

export async function dismissDraft(form: FormData) {
  const page = pageOf(form);
  const { supabase } = await requireOrg();
  const { error } = await supabase
    .from("ai_messages")
    .update({ status: "dismissed" })
    .eq("id", str(form, "message_id"))
    .in("status", ["draft", "approved"]);
  if (error) back(page, friendly(error));
  refresh();
  back(page, "Dismissed. They'll come up again next time they're flagged.", "notice");
}

export async function dismissAll() {
  const { supabase, org, role } = await requireOrg();
  if (!canManage(role)) back(PAGE, "Only owners and managers can clear all drafts.");
  const { error } = await supabase
    .from("ai_messages")
    .update({ status: "dismissed" })
    .eq("org_id", org.id)
    .eq("status", "draft");
  if (error) back(PAGE, friendly(error));
  revalidatePath(PAGE);
  back(PAGE, "All drafts cleared.", "notice");
}

/** Owner/manager: approve one message (with any edits). The database checks the role. */
export async function approveDraft(form: FormData) {
  const { supabase, role } = await requireOrg();
  const page = pageOf(form);
  if (!canManage(role)) back(page, "Only an owner or manager can approve messages.");
  const body = str(form, "body");
  if (!body) back(page, "The message can't be empty.");
  const { error } = await supabase
    .from("ai_messages")
    .update({ body, status: "approved" })
    .eq("id", str(form, "message_id"))
    .eq("status", "draft");
  if (error) back(page, friendly(error));
  refresh();
  back(page, "Approved. It's ready to send.", "notice");
}

/** Owner/manager: approve every waiting draft as it is. */
export async function approveAll(form: FormData) {
  const { supabase, org, role } = await requireOrg();
  const page = pageOf(form);
  if (!canManage(role)) back(page, "Only an owner or manager can approve messages.");
  const { data, error } = await supabase.rpc("approve_all_drafts", { p_org: org.id });
  if (error) back(page, friendly(error));
  refresh();
  const n = Number(data ?? 0);
  back(page, n === 0 ? "Nothing was waiting." : `Approved ${n} message${n === 1 ? "" : "s"}. They're ready to send.`, "notice");
}

export async function saveVoice(form: FormData) {
  const { supabase, org, role } = await requireOrg();
  if (!canManage(role)) back(PAGE, "Only owners and managers can change how messages sound.");
  const days = Number(str(form, "followup_cooldown_days"));
  const { error } = await supabase
    .from("orgs")
    .update({
      ai_voice: str(form, "ai_voice") || org.ai_voice,
      ai_sign_off: optStr(form, "ai_sign_off"),
      ai_offers: optStr(form, "ai_offers"),
      followup_cooldown_days: Number.isFinite(days) && days >= 1 && days <= 60 ? days : org.followup_cooldown_days,
      followup_mode: (["desk", "auto"].includes(str(form, "followup_mode")) ? str(form, "followup_mode") : "approve") as "approve" | "desk" | "auto",
      morning_drafts: form.get("morning_drafts") === "on",
    })
    .eq("id", org.id);
  if (error) back(PAGE, friendly(error));
  refresh();
  back(PAGE, "Message settings saved. New drafts will use them.", "notice");
}
