"use server";

import { revalidatePath } from "next/cache";
import { requirePlatform } from "@/lib/platform";
import { back, friendly, str } from "@/lib/form";
import { emailConfigured, sendEmail } from "@/lib/email";
import { PLATFORM_ROLES, PLATFORM_ROLE_LABELS, type PlatformRole } from "@/lib/permissions";

const TEAM = "/admin/team";

export async function setTeamMember(form: FormData) {
  const { supabase } = await requirePlatform(["super_admin"]);
  const role = str(form, "role") as PlatformRole;
  if (!PLATFORM_ROLES.includes(role)) back(TEAM, "Choose a role.");
  const email = str(form, "email");
  const { error } = await supabase.rpc("platform_set_staff", { p_email: email, p_role: role });
  if (error) back(TEAM, friendly(error));
  revalidatePath(TEAM);
  back(TEAM, `${email} is now ${PLATFORM_ROLE_LABELS[role]}.`, "notice");
}

export async function removeTeamMember(form: FormData) {
  const { supabase } = await requirePlatform(["super_admin"]);
  const { error } = await supabase.rpc("platform_remove_staff", { p_user: str(form, "user_id") });
  if (error) back(TEAM, friendly(error));
  revalidatePath(TEAM);
  back(TEAM, "Removed from the Courtix team.", "notice");
}

const HELP = "/admin/help";

export async function replyToRequest(form: FormData) {
  const { supabase, host } = await requirePlatform(["super_admin", "support"]);
  const closeOnly = form.get("intent") === "close";
  const reply = closeOnly ? "" : str(form, "reply");
  const close = closeOnly || form.get("close") === "on";
  const { data, error } = await supabase.rpc("platform_reply_support_request", {
    p_request: str(form, "request_id"),
    p_reply: reply,
    p_close: close,
  });
  if (error) back(HELP, friendly(error));

  // Email the reply to whoever asked.
  const to = ((data ?? []) as { email: string | null; club_name: string; club_slug: string }[])[0];
  let emailed = false;
  if (to?.email && reply && emailConfigured()) {
    try {
      await sendEmail(
        to.email,
        `Courtix support replied about ${to.club_name}`,
        [reply, "", `See it in Courtix: ${host.kind === "other" ? "/help" : host.clubUrl(to.club_slug, "/help")}`].join("\n"),
      );
      emailed = true;
    } catch (e) {
      console.error("Help reply email failed", e instanceof Error ? e.message : e);
    }
  }
  revalidatePath(HELP);
  back(HELP, reply ? `Reply saved${emailed ? " and emailed" : ""}${close ? ", request closed" : ""}.` : "Request closed.", "notice");
}

const DEMOS = "/admin/demos";

/** Demo requests from the landing page: status (new / contacted / closed) and a note. */
export async function updateDemoRequest(form: FormData) {
  const { supabase } = await requirePlatform(["super_admin", "support"]);
  const status = str(form, "status");
  if (!["new", "contacted", "closed"].includes(status)) back(DEMOS, "Choose a status.");
  const { error } = await supabase
    .from("demo_requests")
    .update({ status, note: str(form, "note") || null, updated_at: new Date().toISOString() })
    .eq("id", str(form, "id"));
  if (error) back(DEMOS, friendly(error));
  revalidatePath(DEMOS);
  back(DEMOS, "Saved.", "notice");
}
