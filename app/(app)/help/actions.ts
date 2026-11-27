"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/org";
import { currentHost } from "@/lib/host";
import { back, friendly, num, optStr, str } from "@/lib/form";
import { emailConfigured, sendEmail } from "@/lib/email";

const PATH = "/help";

export async function askForHelp(form: FormData) {
  const { supabase, org, email, can } = await requireOrg();
  const message = str(form, "message");
  const contact = optStr(form, "contact");
  const allow = can("staff.manage") && form.get("allow") === "on" ? (num(form, "hours") ?? 24) : null;

  const { data: id, error } = await supabase.rpc("request_support", {
    p_org: org.id,
    p_message: message,
    p_contact: contact,
    p_allow_hours: allow,
  });
  if (error) back(PATH, friendly(error));

  // Tell the Courtix team. The request is saved either way; the admin page lists it.
  if (emailConfigured()) {
    const { data: team } = await supabase.rpc("support_request_notify_list", { p_request: id });
    const host = await currentHost();
    const to = ((team ?? []) as { email: string }[]).map((t) => t.email);
    const text = [
      `${org.name} (${org.slug}) asked for help.`,
      "",
      message,
      "",
      `From: ${email ?? "club staff"}${contact ? ` · reach them on: ${contact}` : ""}`,
      allow ? `Support access: allowed for ${allow} hours.` : "Support access: not allowed yet. Ask the owner if you need to look.",
      "",
      `Answer it: ${host.kind === "other" ? "/admin/help" : host.rootUrl("/admin/help")}`,
    ].join("\n");
    await Promise.all(
      to.map((addr) =>
        sendEmail(addr, `Help request from ${org.name}`, text).catch((e) =>
          console.error("Help request email failed", e instanceof Error ? e.message : e),
        ),
      ),
    );
  }

  revalidatePath(PATH);
  back(PATH, "Sent to Courtix support. We'll reply here and by email.", "notice");
}

export async function closeRequest(form: FormData) {
  const { supabase } = await requireOrg();
  const { error } = await supabase.rpc("close_support_request", { p_request: str(form, "request_id") });
  if (error) back(PATH, friendly(error));
  revalidatePath(PATH);
  back(PATH, "Marked as solved.", "notice");
}
