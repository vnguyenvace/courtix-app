"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/org";
import { back, friendly, str } from "@/lib/form";
import { contactApiMessage, runChatTurn, staffApiMessage } from "@/lib/chat";
import { deliverChat } from "@/lib/messaging";
import { ASSISTANT_NAME } from "@/lib/assistant";

// Chats: conversations with members, answered by Claude, handed to staff when needed.
// Until WhatsApp is connected, staff try it with a test chat where they play the member.

const MAX_MESSAGE = 2000;
// After a staff reply the assistant stays quiet this long, so two voices don't overlap.
const STAFF_PAUSE_MINUTES = 30;

function afterTurn(id: string, r: { replied: boolean; handedOff: boolean; error?: string }) {
  revalidatePath("/chats");
  revalidatePath(`/chats/${id}`);
  if (r.error) back(`/chats/${id}`, `The assistant couldn't answer, so the chat went to staff. (${r.error})`);
  // Handed off: the page itself says why, in the "Why it came to you" banner.
  redirect(`/chats/${id}#latest`);
}

export async function startTestChat(form: FormData) {
  const { supabase, org, locations, workLocation, multiLocation } = await requireOrg();
  const message = str(form, "message").slice(0, MAX_MESSAGE);
  if (!message) back("/chats", "Type the first message, as the member would.");
  const { data: id, error } = await supabase.rpc("chat_open_conversation", {
    p_org: org.id,
    p_channel: "test",
    // Either a member picked from the list (their phone) or a visitor's number typed in.
    p_phone: str(form, "phone") || str(form, "member_phone"),
    p_name: str(form, "name") || null,
    p_location: multiLocation ? workLocation?.id ?? null : null,
  });
  if (error || !id) back("/chats", friendly(error));
  const { error: msgErr } = await supabase.from("chat_messages").insert({
    org_id: org.id,
    conversation_id: id,
    role: "contact",
    body: message,
    api: contactApiMessage(message),
  });
  if (msgErr) back("/chats", friendly(msgErr));
  afterTurn(id, await runChatTurn(supabase, org, locations, id));
}

/** Test chats only: type the member's next message. */
export async function sendAsContact(form: FormData) {
  const { supabase, org, locations } = await requireOrg();
  const id = str(form, "conversation_id");
  const message = str(form, "message").slice(0, MAX_MESSAGE);
  if (!message) back(`/chats/${id}`, "Type a message first.");
  const { data: conv } = await supabase.from("chat_conversations").select("channel, status").eq("id", id).single();
  if (!conv) back("/chats", "That chat no longer exists.");
  if (conv.channel !== "test") back(`/chats/${id}`, "Only test chats let you write as the member.");
  if (conv.status === "closed") back(`/chats/${id}`, "This chat is closed. Start a new test chat.");
  const { error } = await supabase.from("chat_messages").insert({
    org_id: org.id,
    conversation_id: id,
    role: "contact",
    body: message,
    api: contactApiMessage(message),
  });
  if (error) back(`/chats/${id}`, friendly(error));
  await supabase.from("chat_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", id);
  afterTurn(id, await runChatTurn(supabase, org, locations, id));
}

/** A person at the club answers. Claude stays quiet in this chat until it's handed back. */
export async function staffReply(form: FormData) {
  const { supabase, org } = await requireOrg();
  const id = str(form, "conversation_id");
  const message = str(form, "message").slice(0, MAX_MESSAGE);
  if (!message) back(`/chats/${id}`, "Type a reply first.");
  const { error } = await supabase.from("chat_messages").insert({
    org_id: org.id,
    conversation_id: id,
    role: "staff",
    body: message,
    api: staffApiMessage(message),
  });
  if (error) back(`/chats/${id}`, friendly(error));
  await supabase
    .from("chat_conversations")
    .update({
      status: "staff",
      last_message_at: new Date().toISOString(),
      assistant_paused_until: new Date(Date.now() + STAFF_PAUSE_MINUTES * 60_000).toISOString(),
    })
    .eq("id", id)
    .neq("status", "closed");
  // LINE chats: send it now (push). Test chats: nothing is sent anywhere.
  const out = await deliverChat(supabase, id);
  revalidatePath("/chats");
  revalidatePath(`/chats/${id}`);
  if (out.error) back(`/chats/${id}`, `Saved, but not sent: ${out.error}`);
  if (out.sent) back(`/chats/${id}`, "Sent on LINE.", "notice");
  redirect(`/chats/${id}#latest`);
}

export async function takeOver(form: FormData) {
  const { supabase } = await requireOrg();
  const id = str(form, "conversation_id");
  const { error } = await supabase.rpc("chat_hand_off", { p_conversation: id, p_reason: "Taken over by staff" });
  if (error) back(`/chats/${id}`, friendly(error));
  // Paused until someone hands it back.
  await supabase.from("chat_conversations").update({ assistant_paused_until: "infinity" }).eq("id", id);
  revalidatePath("/chats");
  back(`/chats/${id}`, "You're handling this chat. The assistant won't answer until you hand it back.", "notice");
}

export async function handBack(form: FormData) {
  const { supabase, org, locations } = await requireOrg();
  const id = str(form, "conversation_id");
  const { error } = await supabase
    .from("chat_conversations")
    .update({ status: "bot", handoff_reason: null, handed_off_at: null, assistant_paused_until: null })
    .eq("id", id)
    .neq("status", "closed");
  if (error) back(`/chats/${id}`, friendly(error));
  // If the member wrote while staff had the chat, the assistant answers that now.
  const r = await runChatTurn(supabase, org, locations, id);
  await deliverChat(supabase, id);
  revalidatePath("/chats");
  if (r.replied || r.handedOff || r.error) afterTurn(id, r);
  back(`/chats/${id}`, `${ASSISTANT_NAME} is answering this chat again.`, "notice");
}

export async function closeChat(form: FormData) {
  const { supabase } = await requireOrg();
  const id = str(form, "conversation_id");
  const { error } = await supabase.from("chat_conversations").update({ status: "closed" }).eq("id", id);
  if (error) back(`/chats/${id}`, friendly(error));
  revalidatePath("/chats");
  back("/chats", "Chat closed.", "notice");
}

/** LINE chats: say which member this is. Saved on the member, so later chats are recognised. */
export async function linkMember(form: FormData) {
  const { supabase } = await requireOrg();
  const id = str(form, "conversation_id");
  const memberId = str(form, "member_id");
  if (!memberId) back(`/chats/${id}`, "Pick the member first.");
  const { error } = await supabase.rpc("chat_link_member", { p_conversation: id, p_member: memberId });
  if (error) back(`/chats/${id}`, friendly(error));
  revalidatePath("/chats");
  revalidatePath(`/chats/${id}`);
  back(`/chats/${id}`, "Linked. The assistant now knows their package and bookings, and recognises them next time.", "notice");
}
