import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clubVoice, draftMessage, mapLimit, type FollowupReason } from "@/lib/ai";
import { linePush } from "@/lib/line";
import { loadLine } from "@/lib/messaging";
import type { Org } from "@/lib/types";

// Writing follow-up drafts. Shared by the "Write today's drafts" button (as the signed-in staff
// member) and the morning job (as the service identity), so both follow the same rules.

export interface Candidate {
  member_id: string;
  reason?: FollowupReason;
  language: string;
  context: Record<string, unknown>;
}

/** Drafts messages for a list of candidates and saves them. Returns counts. */
export async function draftAndSave(
  supabase: SupabaseClient,
  org: Org,
  candidates: Candidate[],
  reasonOverride?: FollowupReason,
  sessionId?: string,
) {
  const club = clubVoice(org);
  let saved = 0;
  const errors: string[] = [];

  await mapLimit(candidates, 4, async (c) => {
    const reason = reasonOverride ?? c.reason!;
    try {
      const draft = await draftMessage(reason, c.context, club);
      const { error } = await supabase.from("ai_messages").insert({
        org_id: org.id,
        member_id: c.member_id,
        reason,
        session_id: sessionId ?? null,
        language: c.language,
        body: draft.body,
        context: c.context,
        model: draft.model,
      });
      if (error && error.code !== "23505") errors.push(error.message); // 23505 = an open draft already exists
      if (!error) saved++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Couldn't write a message.");
    }
  });

  return { saved, errors: [...new Set(errors)] };
}

/**
 * Clubs that chose automatic follow-ups (orgs.followup_mode = 'auto'): approve the waiting drafts
 * and send them on LINE to members linked there. The rest stay approved, in Morning → Ready to
 * send. Marketing consent and the cooldown were already checked when the drafts were written.
 * Runs as the service identity (morning job).
 */
export async function autoSendFollowups(db: SupabaseClient, org: Org) {
  const result = { approved: 0, sent: 0, waiting: 0 };
  const { data: approvedRows } = await db
    .from("ai_messages")
    .update({ status: "approved" })
    .eq("org_id", org.id)
    .eq("status", "draft")
    .select("id");
  result.approved = approvedRows?.length ?? 0;

  const line = await loadLine(db, org.id).catch(() => null);
  const { data } = await db
    .from("ai_messages")
    .select("id, body, members(line_user_id)")
    .eq("org_id", org.id)
    .eq("status", "approved");
  for (const m of (data ?? []) as unknown as { id: string; body: string; members: { line_user_id: string | null } | null }[]) {
    const to = m.members?.line_user_id;
    if (!line || !to) {
      result.waiting++;
      continue;
    }
    try {
      await linePush(line.token, to, [m.body]);
      await db.from("ai_messages").update({ status: "sent", sent_at: new Date().toISOString(), channel: "line" }).eq("id", m.id);
      result.sent++;
    } catch {
      result.waiting++;
    }
  }
  return result;
}
