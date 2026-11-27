"use server";

import { revalidatePath } from "next/cache";
import { requirePlatform } from "@/lib/platform";
import { back, friendly, str } from "@/lib/form";
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
