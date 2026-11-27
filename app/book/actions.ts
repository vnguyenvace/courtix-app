"use server";

import { redirect } from "next/navigation";
import { currentHost } from "@/lib/host";
import { createClient } from "@/lib/supabase/server";
import { friendly, str } from "@/lib/form";
import { clearMemberCookie, memberToken, requestMemberCode, setMemberCookie } from "@/lib/memberAuth";
import { loadPublicClub } from "@/lib/public";
import { savePayerSlip } from "@/lib/payerSlip";
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

  const raw = (data as { status?: string; registration_id?: string } | null)?.status;
  const status = raw === "waitlisted" || raw === "requested" ? raw : "booked";
  // Booked with something to pay: offer the PromptPay pay page.
  const pay = status === "booked" ? await orderFor(host.slug, { registration: (data as { registration_id?: string }).registration_id }) : null;
  redirect(`${path}?done=${status}${pay ? `&pay=${pay}` : ""}`);
}

/** The unpaid order for a booking just made (for the pay page), or null. */
async function orderFor(slug: string, ref: { registration?: string; booking?: string }) {
  const { data } = await (await createClient()).rpc("public_order_for", {
    p_slug: slug,
    p_registration: ref.registration ?? null,
    p_booking: ref.booking ?? null,
  });
  return (data as string | null) ?? null;
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
  const r = data as { registration_id: string; status: string; price: number; covered: boolean };
  const pay = r.status === "booked" && Number(r.price) > 0 ? await orderFor(slug, { registration: r.registration_id }) : null;
  redirect(`${path}?done=member&status=${r.status}&price=${r.price}&covered=${r.covered ? 1 : 0}${pay ? `&pay=${pay}` : ""}`);
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
  const pay = price > 0 ? await orderFor(slug, { booking: (data as { booking_id: string }).booking_id }) : null;
  if (pay) go(`/book/pay/${pay}`, "notice", `Court booked. ${formatMoney(price, club.currency)} to pay.`);
  go("/book/me", "notice", "Court booked.");
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

/** A visitor books a court as a guest (rules and spam limits in public_book_court). */
export async function publicBookCourt(form: FormData) {
  const slug = await clubSlug();
  const location = str(form, "location");
  const day = str(form, "day");
  const formPath = `/book/courts/book?court=${encodeURIComponent(str(form, "court_id"))}&start=${encodeURIComponent(str(form, "start"))}&location=${encodeURIComponent(location)}&day=${encodeURIComponent(day)}`;
  const back = `/book/courts?location=${encodeURIComponent(location)}&day=${encodeURIComponent(day)}`;
  // Honeypot: bots fill the hidden field; pretend it worked.
  if (str(form, "website")) go(back, "notice", "Thanks, your booking is in.");

  const { data, error } = await (await createClient()).rpc("public_book_court", {
    p_slug: slug,
    p_court: str(form, "court_id"),
    p_start: str(form, "start"),
    p_name: str(form, "name"),
    p_phone: str(form, "phone"),
    p_contact_ok: form.get("contact_ok") === "on",
    p_marketing: form.get("marketing") === "on",
  });
  if (error) go(formPath, "error", friendly(error));
  const r = data as { booking_id: string; price: number; pending_approval: boolean };
  const { club } = await loadPublicClub();
  if (!r.pending_approval && Number(r.price) > 0) {
    const pay = await orderFor(slug, { booking: r.booking_id });
    if (pay) go(`/book/pay/${pay}`, "notice", `You're booked. ${formatMoney(Number(r.price), club.currency)} to pay: by PromptPay below, or at the club.`);
  }
  const pay = Number(r.price) > 0 ? ` Pay ${formatMoney(Number(r.price), club.currency)} at the club.` : "";
  go(
    back,
    "notice",
    r.pending_approval
      ? "Thanks, the court is held for you. The club will confirm on WhatsApp."
      : `You're booked.${pay} See you on court.`,
  );
}

/** The payer sends their transfer slip from the pay page (saved by the server; see lib/payerSlip.ts). */
export async function sendPayerSlip(form: FormData) {
  const slug = await clubSlug();
  const orderId = str(form, "order_id");
  const path = `/book/pay/${orderId}`;
  if (!/^[0-9a-f-]{36}$/.test(orderId)) redirect("/book");
  const file = form.get("slip");
  if (!(file instanceof File) || file.size === 0) return go(path, "error", "Choose a photo or screenshot of the slip.");
  if (file.size > 4 * 1024 * 1024) return go(path, "error", "That photo is over 4 MB. Try a screenshot.");
  let verified = false;
  try {
    verified = (await savePayerSlip(slug, orderId, Buffer.from(await file.arrayBuffer()))).status === "verified";
  } catch (e) {
    go(path, "error", e instanceof Error ? e.message : "The slip didn't upload. Please try again.");
  }
  go(path, "notice", verified ? "Payment confirmed. Thank you, see you on court." : "Slip sent. The club will check it and confirm.");
}

// ---------------------------------------------------------------- Private lessons

function lessonFormPath(form: FormData) {
  const q = new URLSearchParams({
    coach: str(form, "coach_id"),
    start: str(form, "start"),
    minutes: str(form, "minutes"),
    size: str(form, "group_size"),
    location: str(form, "location"),
  });
  return `/book/lessons/book?${q.toString()}`;
}

/** After a lesson is booked or requested online: the pay page, or a thank-you message. */
async function afterLesson(slug: string, r: { booking_id: string; price: number; pending_approval: boolean }, back: string) {
  const { club } = await loadPublicClub();
  const price = Number(r.price);
  if (r.pending_approval) go(back, "notice", "Thanks, the coach and court are held for you. The club will confirm on WhatsApp.");
  if (price > 0) {
    const pay = await orderFor(slug, { booking: r.booking_id });
    if (pay) go(`/book/pay/${pay}`, "notice", `Lesson booked. ${formatMoney(price, club.currency)} to pay: by PromptPay below, or at the club.`);
  }
  go(back, "notice", `Lesson booked.${price > 0 ? ` Pay ${formatMoney(price, club.currency)} at the club.` : ""} See you on court.`);
}

/** A visitor books (or requests) a lesson as a guest (rules and spam limits in public_book_lesson). */
export async function publicBookLesson(form: FormData) {
  const slug = await clubSlug();
  const back = `/book/lessons?location=${encodeURIComponent(str(form, "location"))}`;
  if (str(form, "website")) go(back, "notice", "Thanks, your lesson request is in.");
  const { data, error } = await (await createClient()).rpc("public_book_lesson", {
    p_slug: slug,
    p_coach: str(form, "coach_id"),
    p_start: str(form, "start"),
    p_minutes: Number(str(form, "minutes")),
    p_group_size: Number(str(form, "group_size")),
    p_location: str(form, "location"),
    p_name: str(form, "name"),
    p_phone: str(form, "phone"),
    p_contact_ok: form.get("contact_ok") === "on",
    p_marketing: form.get("marketing") === "on",
  });
  if (error) go(lessonFormPath(form), "error", friendly(error));
  await afterLesson(slug, data as { booking_id: string; price: number; pending_approval: boolean }, back);
}

/** A signed-in member books (or requests) a lesson. */
export async function memberBookLesson(form: FormData) {
  const slug = await clubSlug();
  const token = await memberToken();
  if (!token) redirect(`/book/me?next=${encodeURIComponent(lessonFormPath(form))}`);
  const { data, error } = await (await createClient()).rpc("member_book_lesson", {
    p_slug: slug,
    p_token: token,
    p_coach: str(form, "coach_id"),
    p_start: str(form, "start"),
    p_minutes: Number(str(form, "minutes")),
    p_group_size: Number(str(form, "group_size")),
    p_location: str(form, "location"),
  });
  if (error) go(lessonFormPath(form), "error", friendly(error));
  await afterLesson(slug, data as { booking_id: string; price: number; pending_approval: boolean }, "/book/me");
}
