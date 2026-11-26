import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clubVoice, draftMessage, mapLimit, type FollowupReason } from "@/lib/ai";
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
