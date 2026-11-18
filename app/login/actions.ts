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
  redirect("/login");
}
