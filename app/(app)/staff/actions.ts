"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/org";
import { back, friendly, str } from "@/lib/form";
import { currentHost } from "@/lib/host";
import { emailConfigured, sendEmail } from "@/lib/email";
import { INVITE_LINK_COOKIE, ROLE_LABELS, ROLES } from "@/lib/permissions";
import type { StaffRole } from "@/lib/types";

const PAGE = "/staff";

function roleOf(form: FormData): StaffRole {
  const r = str(form, "role") as StaffRole;
  return ROLES.includes(r) ? r : "front_desk";
}

function locationsOf(form: FormData, role: StaffRole): string[] | null {
  // Owners and admins always work at every location.
  if (role === "owner" || role === "manager") return null;
  const ids = form.getAll("location_ids").map(String).filter(Boolean);
  return ids.length ? ids : null;
}

async function shareLink(email: string, token: string, clubName: string, slug: string, role: StaffRole) {
  const host = await currentHost();
  const link = host.kind === "other" ? `/join/${token}` : host.clubUrl(slug, `/join/${token}`);
  let emailed = false;
  if (emailConfigured() && link.startsWith("http")) {
    try {
      await sendEmail(
        email,
        `Join ${clubName} on Courtix`,
        `You've been added to ${clubName} on Courtix as ${ROLE_LABELS[role]}.\n\n` +
          `Open this link to join (it works for 7 days):\n${link}\n\n` +
          `Sign in or create your account with this email address (${email}).`,
      );
      emailed = true;
    } catch (e) {
      console.error("Staff invite email failed", e instanceof Error ? e.message : e);
    }
  }
  (await cookies()).set(INVITE_LINK_COOKIE, JSON.stringify({ email, link, emailed }), {
    path: PAGE,
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
  });
  return emailed;
}

export async function inviteStaff(form: FormData) {
  const { supabase, org } = await requirePermission("staff.manage", PAGE);
  const email = str(form, "email").toLowerCase();
  const role = roleOf(form);
  const { data: token, error } = await supabase.rpc("invite_staff", {
    p_org: org.id,
    p_email: email,
    p_role: role,
    p_location_ids: locationsOf(form, role),
  });
  if (error) back(PAGE, friendly(error));
  const emailed = await shareLink(email, String(token), org.name, org.slug, role);
  revalidatePath(PAGE);
  back(PAGE, emailed ? `Invite emailed to ${email}.` : `Invite ready. Send ${email} the link below.`, "notice");
}

export async function renewInvite(form: FormData) {
  const { supabase, org } = await requirePermission("staff.manage", PAGE);
  const id = str(form, "invite_id");
  const { data: invite } = await supabase.from("staff_invites").select("email, role").eq("id", id).maybeSingle();
  const { data: token, error } = await supabase.rpc("renew_staff_invite", { p_invite: id });
  if (error || !invite) back(PAGE, friendly(error));
  const emailed = await shareLink(invite.email, String(token), org.name, org.slug, invite.role as StaffRole);
  revalidatePath(PAGE);
  back(PAGE, emailed ? `New link emailed to ${invite.email}. The old link no longer works.` : "New link ready. The old link no longer works.", "notice");
}

export async function cancelInvite(form: FormData) {
  const { supabase } = await requirePermission("staff.manage", PAGE);
  const { error } = await supabase.from("staff_invites").delete().eq("id", str(form, "invite_id")).is("accepted_at", null);
  if (error) back(PAGE, friendly(error));
  revalidatePath(PAGE);
  back(PAGE, "Invite cancelled.", "notice");
}

export async function updateStaff(form: FormData) {
  const { supabase, org } = await requirePermission("staff.manage", PAGE);
  const role = roleOf(form);
  const { error } = await supabase
    .from("org_staff")
    .update({ role, location_ids: locationsOf(form, role) })
    .eq("org_id", org.id)
    .eq("user_id", str(form, "user_id"));
  if (error) back(PAGE, friendly(error));
  revalidatePath(PAGE);
  back(PAGE, `Saved. They're now ${ROLE_LABELS[role]}.`, "notice");
}

export async function removeStaff(form: FormData) {
  const { supabase, org, userId } = await requirePermission("staff.manage", PAGE);
  const user = str(form, "user_id");
  const { error } = await supabase.from("org_staff").delete().eq("org_id", org.id).eq("user_id", user);
  if (error) back(PAGE, friendly(error));
  revalidatePath(PAGE);
  if (user === userId) back("/no-access", "You left the club.", "notice");
  back(PAGE, `Removed from ${org.name}. They can't sign in to it any more.`, "notice");
}
