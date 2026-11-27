"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { back, str } from "@/lib/form";

export async function signIn(form: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: str(form, "email"),
    password: str(form, "password"),
  });
  if (error) back("/login", "Email or password is wrong.");
  redirect("/dashboard");
}

export async function signUp(form: FormData) {
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";
  const { data, error } = await supabase.auth.signUp({
    email: str(form, "email"),
    password: str(form, "password"),
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) back("/login", error.message);
  // If email confirmation is on, there's no session yet.
  if (!data.session) back("/login", "Check your email to confirm your account, then sign in.", "notice");
  redirect("/onboarding");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // On a club's address this is its public front page; on the main site "/" leads to /login.
  redirect("/");
}

/** Forgot password: email a link that signs them in and opens "Choose a new password". */
export async function requestPasswordReset(form: FormData) {
  const email = str(form, "email");
  if (!email.includes("@")) back("/login/forgot", "Enter the email you sign in with.");
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/account/password?reset=1")}`,
  });
  // Too many requests is worth saying; anything else gets the same answer, so nobody can
  // find out which emails have an account.
  if (error && error.status === 429) back("/login/forgot", "Too many reset emails just now. Wait a few minutes and try again.");
  back("/login", "If an account uses that email, we've sent a link to choose a new password. It works once, in this browser.", "notice");
}

/** Signed in (or arriving from the reset email): set a new password. */
export async function changePassword(form: FormData) {
  const path = "/account/password" + (str(form, "reset") ? "?reset=1" : "");
  const password = String(form.get("password") ?? "");
  if (password.length < 8) back(path, "Use at least 8 characters.");
  if (password !== String(form.get("confirm") ?? "")) back(path, "The two passwords don't match.");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    back(path, error.code === "same_password" ? "That's your current password. Choose a new one." : error.message);
  }
  back("/dashboard", "Password changed.", "notice");
}
