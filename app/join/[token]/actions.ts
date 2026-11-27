"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { back, friendly, str } from "@/lib/form";
import { currentHost } from "@/lib/host";
import { ORG_COOKIE } from "@/lib/org";

// Joining a club's staff from an invite link (/join/<token>). The database checks the link and
// that the signed-in email is the invited one (accept_staff_invite).

function pathOf(token: string) {
  return `/join/${encodeURIComponent(token)}`;
}

async function accept(token: string): Promise<never> {
  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("accept_staff_invite", { p_token: token });
  if (error) back(pathOf(token), friendly(error));
  const { data: info } = await supabase.rpc("staff_invite_info", { p_token: token });
  const slug = ((info ?? [])[0] as { club_slug: string } | undefined)?.club_slug;
  (await cookies()).set(ORG_COOKIE, String(orgId), { path: "/", httpOnly: true, sameSite: "lax" });
  const host = await currentHost();
  const welcome = "/dashboard?notice=" + encodeURIComponent("Welcome to the team.");
  redirect(host.kind === "other" || !slug ? welcome : host.clubUrl(slug, welcome));
}

export async function joinClub(form: FormData) {
  await accept(str(form, "token"));
}

export async function joinSignIn(form: FormData) {
  const token = str(form, "token");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: str(form, "email"), password: str(form, "password") });
  if (error) back(pathOf(token), "Email or password is wrong. New to Courtix? Create your account instead.");
  await accept(token);
}

export async function joinSignUp(form: FormData) {
  const token = str(form, "token");
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";
  const { data, error } = await supabase.auth.signUp({
    email: str(form, "email"),
    password: str(form, "password"),
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(pathOf(token))}` },
  });
  if (error) back(pathOf(token), error.message);
  // With email confirmation on there's no session yet: the email link brings them back here.
  if (!data.session) back(pathOf(token), "Check your email and tap the link to confirm your account. It brings you back here to join.", "notice");
  await accept(token);
}

export async function joinSignOut(form: FormData) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(pathOf(str(form, "token")));
}
