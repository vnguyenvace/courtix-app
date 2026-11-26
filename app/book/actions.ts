"use server";

import { redirect } from "next/navigation";
import { currentHost } from "@/lib/host";
import { createClient } from "@/lib/supabase/server";
import { friendly, str } from "@/lib/form";
import { clearMemberCookie, memberToken, requestMemberCode, setMemberCookie } from "@/lib/memberAuth";
import { loadPublicClub } from "@/lib/public";
import { formatMoney } from "@/lib/time";

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

// ---------------------------------------------------------------- Members (sign in with a code)

async function clubSlug() {
  const host = await currentHost();
  if (host.kind !== "club") redirect("/");
  return host.slug;
}

const go = (path: string, kind: "error" | "notice", message: string) =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);

/** Sends a sign-in code. Same answer whether or not the number or email belongs to a member. */
export async function requestCode(form: FormData) {
  const slug = await clubSlug();
  const contact = str(form, "contact").slice(0, 120);
  if (!contact) go("/book/me", "error", "Enter your phone number or email.");
  await requestMemberCode(slug, contact);
  // Keep where they came from (e.g. a session page), so signing in takes them back there.
  const next = str(form, "next");
  const nextQs = /^\/book(\/[\w/-]*)?$/.test(next) ? `&next=${encodeURIComponent(next)}` : "";
  redirect(`/book/me?step=code&contact=${encodeURIComponent(contact)}${nextQs}`);
}

export async function verifyCode(form: FormData) {
  const slug = await clubSlug();
  const contact = str(form, "contact").slice(0, 120);
  const nextField = str(form, "next");
  const safeNext = /^\/book(\/[\w/-]*)?$/.test(nextField) ? nextField : "";
  // A wrong code keeps them on the code step, still remembering where to go afterwards.
  const back = `/book/me?step=code&contact=${encodeURIComponent(contact)}${safeNext ? `&next=${encodeURIComponent(safeNext)}` : ""}`;
  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc("member_verify_code", {
    p_slug: slug,
    p_contact: contact,
    p_code: str(form, "code"),
  });
  if (error || !token) go(back, "error", error ? friendly(error) : "That code is wrong or has expired. Ask for a new one");
  await setMemberCookie(token as string);
  redirect(safeNext || "/book/me");
}

export async function memberSignOut() {
  const slug = await clubSlug();
  const token = await memberToken();
  if (token) await (await createClient()).rpc("member_sign_out", { p_slug: slug, p_token: token });
  await clearMemberCookie();
  redirect("/book");
}

/** Book a session place with the member's package (or drop-in price, paid at the club). */
export async function memberBookSession(form: FormData) {
  const slug = await clubSlug();
  const sessionId = str(form, "session_id");
  const path = `/book/s/${sessionId}`;
  const token = await memberToken();
  if (!token) redirect(`/book/me?next=${encodeURIComponent(path)}`);
  const { data, error } = await (await createClient()).rpc("member_book_session", {
    p_slug: slug,
    p_token: token,
    p_session: sessionId,
  });
  if (error) go(path, "error", friendly(error));
  const r = data as { status: string; price: number; covered: boolean };
  redirect(`${path}?done=member&status=${r.status}&price=${r.price}&covered=${r.covered ? 1 : 0}`);
}

export async function memberBookCourt(form: FormData) {
  const slug = await clubSlug();
  const back = `/book/courts?location=${encodeURIComponent(str(form, "location"))}&day=${encodeURIComponent(str(form, "day"))}`;
  const token = await memberToken();
  if (!token) redirect(`/book/me?next=/book/courts`);
  const { data, error } = await (await createClient()).rpc("member_book_court", {
    p_slug: slug,
    p_token: token,
    p_court: str(form, "court_id"),
    p_start: str(form, "start"),
  });
  if (error) go(back, "error", friendly(error));
  const price = Number((data as { price: number }).price);
  const { club } = await loadPublicClub();
  go("/book/me", "notice", price > 0 ? `Court booked. Please pay ${formatMoney(price, club.currency)} at the club.` : "Court booked.");
}

export async function memberCancel(form: FormData) {
  const slug = await clubSlug();
  const token = await memberToken();
  if (!token) redirect("/book/me");
  const { error } = await (await createClient()).rpc("member_cancel", {
    p_slug: slug,
    p_token: token,
    p_kind: str(form, "kind") === "court" ? "court" : "session",
    p_id: str(form, "id"),
  });
  if (error) go("/book/me", "error", friendly(error));
  go("/book/me", "notice", "Cancelled.");
}
