"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/org";
import { back, friendly, optStr, str } from "@/lib/form";
import { clubVoice, draftReply, lineShareLink, whatsappLink } from "@/lib/ai";

const PAGE = "/replies";

// Claude only drafts. Staff read every reply and send it themselves (CLAUDE.md).

/** Who sent the message, in words Claude can use to address them. */
function senderLabel(facts: Record<string, any>, contactName: string | null): string | null {
  if (facts.member?.first_name) return `${facts.member.first_name}, a member of the club`;
  if (contactName) return `${contactName}, not a member`;
  return null;
}

async function factsFor(
  supabase: Awaited<ReturnType<typeof requireOrg>>["supabase"],
  orgId: string,
  locationId: string | null,
  memberId: string | null,
) {
  const { data, error } = await supabase.rpc("inquiry_context", {
    p_org: orgId,
    p_location: locationId,
    p_member: memberId,
    p_days: 7,
  });
  if (error) back(PAGE, friendly(error));
  return (data ?? {}) as Record<string, any>;
}

export async function draftInquiryReply(form: FormData) {
  const { supabase, org, location } = await requireOrg();
  const incoming = str(form, "incoming");
  if (!incoming) back(PAGE, "Paste the message you received.");
  if (incoming.length > 4000) back(PAGE, "That message is too long. Paste just the part that needs an answer.");

  const memberId = optStr(form, "member_id");
  const locationId = optStr(form, "location_id") ?? location?.id ?? null;
  const contactName = memberId ? null : optStr(form, "contact_name");
  const contactPhone = memberId ? null : optStr(form, "contact_phone");

  const facts = await factsFor(supabase, org.id, locationId, memberId);

  let draft;
  try {
    draft = await draftReply(incoming, facts, senderLabel(facts, contactName), clubVoice(org));
  } catch (e) {
    back(PAGE, e instanceof Error ? e.message : "Claude couldn't draft a reply. Try again.");
  }
  if (!draft) {
    back(
      PAGE,
      "Claude isn't connected yet, so it can't draft replies. Add ANTHROPIC_API_KEY to .env.local and restart the app. " +
        "Meanwhile, the sessions and prices below are what it would use.",
    );
  }

  const { data, error } = await supabase
    .from("inquiry_replies")
    .insert({
      org_id: org.id,
      location_id: locationId,
      member_id: memberId,
      contact_name: contactName,
      contact_phone: contactPhone,
      incoming,
      reply: draft.body,
      context: facts,
      model: draft.model,
    })
    .select("id")
    .single();
  if (error) back(PAGE, friendly(error));

  revalidatePath(PAGE);
  redirect(`${PAGE}?notice=${encodeURIComponent("Reply drafted. Check it before you send it.")}#r-${data.id}`);
}

export async function rewriteInquiryReply(form: FormData) {
  const { supabase, org } = await requireOrg();
  const id = str(form, "reply_id");
  const { data: row, error } = await supabase
    .from("inquiry_replies")
    .select("incoming, member_id, location_id, contact_name")
    .eq("id", id)
    .single();
  if (error || !row) back(PAGE, friendly(error));

  // Fresh facts: spots and times may have changed since the first draft.
  const facts = await factsFor(supabase, org.id, row.location_id, row.member_id);
  let draft;
  try {
    draft = await draftReply(row.incoming, facts, senderLabel(facts, row.contact_name), clubVoice(org));
  } catch (e) {
    back(PAGE, e instanceof Error ? e.message : "Claude couldn't draft a reply. Try again.");
  }
  if (!draft) back(PAGE, "Claude isn't connected yet. Add ANTHROPIC_API_KEY to .env.local and restart the app.");

  const { error: upError } = await supabase
    .from("inquiry_replies")
    .update({ reply: draft.body, model: draft.model, context: facts })
    .eq("id", id)
    .eq("status", "draft");
  if (upError) back(PAGE, friendly(upError));

  revalidatePath(PAGE);
  redirect(`${PAGE}?notice=${encodeURIComponent("Rewritten.")}#r-${id}`);
}

async function finish(form: FormData, channel: "whatsapp" | "line" | "other") {
  const { supabase, userId } = await requireOrg();
  const id = str(form, "reply_id");
  const reply = str(form, "reply");
  if (!reply) back(PAGE, "The reply can't be empty.");
  const { error } = await supabase
    .from("inquiry_replies")
    .update({ reply, status: "sent", channel, sent_at: new Date().toISOString(), sent_by: userId })
    .eq("id", id)
    .eq("status", "draft");
  if (error) back(PAGE, friendly(error));
  revalidatePath(PAGE);
  return reply;
}

export async function sendInquiryOnWhatsApp(form: FormData) {
  const link = whatsappLink(optStr(form, "phone"), str(form, "reply"));
  if (!link) back(PAGE, "There's no valid WhatsApp number for this person. Use Send on LINE or Copy instead.");
  await finish(form, "whatsapp");
  redirect(link);
}

/** Opens LINE with the reply filled in; staff pick the person's chat there. */
export async function sendInquiryOnLine(form: FormData) {
  const reply = await finish(form, "line");
  redirect(lineShareLink(reply));
}

export async function markInquirySent(form: FormData) {
  await finish(form, "other");
  back(PAGE, "Marked as sent.", "notice");
}

export async function saveInquiryReply(form: FormData) {
  const { supabase } = await requireOrg();
  const id = str(form, "reply_id");
  const reply = str(form, "reply");
  if (!reply) back(PAGE, "The reply can't be empty.");
  const { error } = await supabase.from("inquiry_replies").update({ reply }).eq("id", id).eq("status", "draft");
  if (error) back(PAGE, friendly(error));
  revalidatePath(PAGE);
  redirect(`${PAGE}?notice=${encodeURIComponent("Saved.")}#r-${id}`);
}

export async function dismissInquiryReply(form: FormData) {
  const { supabase } = await requireOrg();
  const { error } = await supabase
    .from("inquiry_replies")
    .update({ status: "dismissed" })
    .eq("id", str(form, "reply_id"))
    .eq("status", "draft");
  if (error) back(PAGE, friendly(error));
  revalidatePath(PAGE);
  back(PAGE, "Dismissed.", "notice");
}
