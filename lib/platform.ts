import "server-only";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentHost } from "@/lib/host";
import type { PlatformRole } from "@/lib/permissions";
import { getI18n } from "@/lib/i18n/server";

/**
 * The Courtix admin area (courtix.app/admin): signed-in members of the Courtix team only.
 * Everyone else gets "not found", so the area isn't advertised. The database checks the role
 * again in every platform_* function.
 */
export async function requirePlatform(roles?: PlatformRole[]) {
  const host = await currentHost();
  if (host.kind === "club") redirect(host.rootUrl("/admin"));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: role } = await supabase.rpc("platform_role");
  if (!role || (roles && !roles.includes(role as PlatformRole))) notFound();
  return { ...(await getI18n()), supabase, userId: user.id, email: user.email ?? null, role: role as PlatformRole, host };
}
