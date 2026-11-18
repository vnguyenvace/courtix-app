"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, canManage } from "@/lib/org";
import { back, friendly, optStr, str } from "@/lib/form";
import { clubVoice, draftMessage, lineShareLink, mapLimit, whatsappLink, type ClubVoice, type FollowupReason } from "@/lib/ai";
import type { Org } from "@/lib/types";

const PAGE = "/followups";

const voiceOf = (org: Org): ClubVoice => clubVoice(org);

interface Candidate {
  member_id: string;
  reason?: FollowupReason;
  language: string;
  context: Record<string, unknown>;
}

/** Drafts messages for a list of candidates and saves them. Returns counts. */
async function draftAndSave(
  ctx: Awaited<ReturnType<typeof requireOrg>>,
  candidates: Candidate[],
  reasonOverride?: FollowupReason,
  sessionId?: string,
) {
  const club = voiceOf(ctx.org);
  let saved = 0;
  const errors: string[] = [];

  await mapLimit(candidates, 4, async (c) => {
    const reason = reasonOverride ?? c.reason!;
    try {
      const draft = await draftMessage(reason, c.context, club);
      const { error } = await ctx.supabase.from("ai_messages").insert({
        org_id: ctx.org.id,
        member_id: c.member_id,
        reason,
        session_id: sessionId ?? null,
        language: c.language,
        body: draft.body,
        context: c.context,
        model: draft.model,
      });
      if (error && error.code !== "23505") errors.push(friendly(error)); // 23505 = draft already exists
      if (!error) saved++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Couldn't write a message.");
    }
  });

  return { saved, errors: [...new Set(errors)] };
}

export async function writeDrafts() {
  const ctx = await requireOrg();
  const { data, error } = await ctx.supabase.rpc("followup_candidates", { p_org: ctx.org.id, p_limit: 20 });
  if (error) back(PAGE, friendly(error));

  const candidates = (data ?? []) as Candidate[];
  if (candidates.length === 0) {
    back(PAGE, "Nobody needs a follow-up right now. Everyone flagged already has a draft or was messaged recently.", "notice");
  }

  const { saved, errors } = await draftAndSave(ctx, candidates);
  revalidatePath(PAGE);
  if (saved === 0 && errors.length) back(PAGE, errors[0]);
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
  const { supabase } = await requireOrg();
  const id = str(form, "message_id");
  const body = str(form, "body");
  if (!body) back(PAGE, "The message can't be empty.");
  const { error } = await supabase.from("ai_messages").update({ body }).eq("id", id).eq("status", "draft");
  if (error) back(PAGE, friendly(error));
  revalidatePath(PAGE);
  back(PAGE, "Saved.", "notice");
}

/** Saves any edits, marks the message sent, then opens WhatsApp with it filled in. */
export async function sendOnWhatsApp(form: FormData) {
  const { supabase, userId } = await requireOrg();
  const id = str(form, "message_id");
  const body = str(form, "body");
  const phone = optStr(form, "phone");
  if (!body) back(PAGE, "The message can't be empty.");

  const link = whatsappLink(phone, body);
  if (!link) back(PAGE, "This member has no valid phone or WhatsApp number. Add one on their page first.");

  const { error } = await supabase
    .from("ai_messages")
    .update({ body, status: "sent", sent_at: new Date().toISOString(), sent_by: userId, channel: "whatsapp" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) back(PAGE, friendly(error));

  revalidatePath(PAGE);
  redirect(link);
}

/** Opens LINE with the message filled in; staff pick the member's chat there. */
export async function sendOnLine(form: FormData) {
  const { supabase, userId } = await requireOrg();
  const id = str(form, "message_id");
  const body = str(form, "body");
  if (!body) back(PAGE, "The message can't be empty.");

  const { error } = await supabase
    .from("ai_messages")
    .update({ body, status: "sent", sent_at: new Date().toISOString(), sent_by: userId, channel: "line" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) back(PAGE, friendly(error));

  revalidatePath(PAGE);
  redirect(lineShareLink(body));
}

export async function markSent(form: FormData) {
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
    .eq("status", "draft");
  if (error) back(PAGE, friendly(error));
  revalidatePath(PAGE);
  back(PAGE, "Marked as sent.", "notice");
}

export async function dismissDraft(form: FormData) {
  const { supabase } = await requireOrg();
  const { error } = await supabase
    .from("ai_messages")
    .update({ status: "dismissed" })
    .eq("id", str(form, "message_id"))
    .eq("status", "draft");
  if (error) back(PAGE, friendly(error));
  revalidatePath(PAGE);
  back(PAGE, "Dismissed. They'll come up again next time they're flagged.", "notice");
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
    })
    .eq("id", org.id);
  if (error) back(PAGE, friendly(error));
  revalidatePath(PAGE);
  back(PAGE, "Message settings saved. New drafts will use them.", "notice");
}
