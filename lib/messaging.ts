import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/secrets";
import { lineDisplayName, linePush, lineReply } from "@/lib/line";
import type { ChatConversation, MessagingChannel } from "@/lib/types";

// Sending chat messages out on the club's own LINE account (WhatsApp later, same shape).
// Works with the signed-in staff client (staff replies) and the service client (webhook).

export interface LineConnection {
  channel: MessagingChannel;
  token: string;
}

/** The club's LINE connection with the access token decrypted, or null if not connected / off. */
export async function loadLine(supabase: SupabaseClient, orgId: string): Promise<LineConnection | null> {
  const { data } = await supabase
    .from("messaging_channels")
    .select("*")
    .eq("org_id", orgId)
    .eq("provider", "line")
    .is("location_id", null)
    .maybeSingle();
  const channel = data as MessagingChannel | null;
  if (!channel || !channel.is_enabled) return null;
  return { channel, token: decryptSecret(channel.token_enc) };
}

export { lineDisplayName };

/**
 * Sends everything the assistant or staff wrote in this conversation that hasn't gone out yet.
 * With a reply token (the person just wrote), it tries LINE's free reply first, then push.
 * Returns how many messages went out; failures are saved on the messages for staff to see.
 */
export async function deliverChat(
  supabase: SupabaseClient,
  conversationId: string,
  replyToken?: string,
): Promise<{ sent: number; error?: string }> {
  const { data: convData } = await supabase.from("chat_conversations").select("*").eq("id", conversationId).single();
  const conv = convData as ChatConversation | null;
  if (!conv || conv.channel !== "line" || !conv.line_user_id) return { sent: 0 };

  const { data: pending } = await supabase
    .from("chat_messages")
    .select("id, body")
    .eq("conversation_id", conv.id)
    .in("role", ["assistant", "staff"])
    .not("body", "is", null)
    .is("delivered_at", null)
    .order("created_at")
    .order("id");
  const rows = (pending ?? []) as { id: string; body: string }[];
  if (!rows.length) return { sent: 0 };

  let error: string | undefined;
  try {
    const line = await loadLine(supabase, conv.org_id);
    if (!line) throw new Error("LINE isn't connected (Settings → Messaging), so this wasn't sent.");
    // LINE takes up to 5 messages per call.
    for (let i = 0; i < rows.length; i += 5) {
      const batch = rows.slice(i, i + 5);
      const texts = batch.map((r) => r.body);
      let done = false;
      if (replyToken && i === 0) {
        try {
          await lineReply(line.token, replyToken, texts);
          done = true;
        } catch {
          // The reply token expired (the answer took too long) or was used: push instead.
        }
      }
      if (!done) await linePush(line.token, conv.line_user_id, texts);
      await supabase
        .from("chat_messages")
        .update({ delivered_at: new Date().toISOString(), delivery_error: null })
        .in("id", batch.map((r) => r.id));
    }
    return { sent: rows.length };
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    await supabase
      .from("chat_messages")
      .update({ delivery_error: error.slice(0, 300) })
      .in("id", rows.map((r) => r.id))
      .is("delivered_at", null);
    // Make sure a person sees it.
    await supabase.rpc("chat_hand_off", { p_conversation: conv.id, p_reason: `Couldn't send on LINE: ${error}`.slice(0, 280) });
    return { sent: 0, error };
  }
}
