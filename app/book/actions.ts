"use server";

import { redirect } from "next/navigation";
import { currentHost } from "@/lib/host";
import { createClient } from "@/lib/supabase/server";
import { friendly, str } from "@/lib/form";

// A visitor signs up for a session on the public booking page. All the rules (capacity,
// waitlist, cut-offs, spam limits, consent) live in public_register() in the database.
export async function publicSignUp(form: FormData) {
  const sessionId = str(form, "session_id");
  const path = `/book/s/${sessionId}`;
  const host = await currentHost();
  if (host.kind !== "club") redirect("/");

  // Honeypot: a hidden field people never see. Bots fill it in; pretend it worked.
  if (str(form, "website")) redirect(`${path}?done=booked`);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_register", {
    p_slug: host.slug,
    p_session: sessionId,
    p_name: str(form, "name"),
    p_phone: str(form, "phone"),
    p_contact_ok: form.get("contact_ok") === "on",
    p_marketing: form.get("marketing") === "on",
  });
  if (error) redirect(`${path}?error=${encodeURIComponent(friendly(error))}`);

  const raw = (data as { status?: string } | null)?.status;
  const status = raw === "waitlisted" || raw === "requested" ? raw : "booked";
  redirect(`${path}?done=${status}`);
}
