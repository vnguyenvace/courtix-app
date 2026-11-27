"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, canManage } from "@/lib/org";
import { back, friendly, num, optStr, str } from "@/lib/form";
import { isValidDate, zonedToUtc } from "@/lib/time";
import { normalizeHex } from "@/lib/brand";
import { detectColors, LOGO_MAX_BYTES, LOGO_TYPES, normalizeLogo } from "@/lib/logo";
import { encryptSecret, secretsConfigured } from "@/lib/secrets";
import { promptPayKind } from "@/lib/promptpay";
import { LineError, lineBotInfo } from "@/lib/line";
import { sendPendingNotices } from "@/lib/notices";
import { staffApiMessage } from "@/lib/chat";
import { deliverChat } from "@/lib/messaging";
import { formatMoney } from "@/lib/time";
import type { BookingKind, MessageChannel } from "@/lib/types";
import { ASSISTANT_NAME } from "@/lib/assistant";

// Every action checks the club from the session. Row-level security in the
// database is the real guard; these checks just give nicer messages.

// ---------------------------------------------------------------- Members

function channelOf(form: FormData): MessageChannel | null {
  const v = str(form, "preferred_channel");
  return v === "whatsapp" || v === "line" ? v : null;
}

export async function createMember(form: FormData) {
  const { supabase, org } = await requireOrg();
  const fullName = str(form, "full_name");
  if (!fullName) back("/members/new", "Enter the member's name.");

  const consent = form.get("marketing_consent") === "on";
  const { data, error } = await supabase
    .from("members")
    .insert({
      org_id: org.id,
      full_name: fullName,
      phone: optStr(form, "phone"),
      email: optStr(form, "email"),
      whatsapp: optStr(form, "whatsapp"),
      language: str(form, "language") || org.default_language,
      preferred_channel: channelOf(form),
      skill_level: num(form, "skill_level"),
      usual_play_time: optStr(form, "usual_play_time"),
      notes: optStr(form, "notes"),
      marketing_consent: consent,
      notices_opt_out: form.get("notices_opt_out") === "on",
      consent_at: consent ? new Date().toISOString() : null,
      home_location_id: optStr(form, "home_location_id"),
    })
    .select("id")
    .single();

  if (error) back("/members/new", friendly(error));

  const packageId = str(form, "package_id");
  if (packageId) {
    const { error: sellError } = await supabase.rpc("sell_membership", {
      p_member: data.id,
      p_package: packageId,
    });
    if (sellError) back(`/members/${data.id}`, "Member added, but the package failed: " + friendly(sellError));
  }

  revalidatePath("/members");
  redirect(`/members/${data.id}?notice=${encodeURIComponent("Member added.")}`);
}

export async function updateMember(form: FormData) {
  const { supabase } = await requireOrg();
  const id = str(form, "member_id");
  const path = `/members/${id}`;
  const consent = form.get("marketing_consent") === "on";

  const { data: current } = await supabase
    .from("members")
    .select("marketing_consent")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("members")
    .update({
      full_name: str(form, "full_name"),
      phone: optStr(form, "phone"),
      email: optStr(form, "email"),
      whatsapp: optStr(form, "whatsapp"),
      language: str(form, "language"),
      preferred_channel: channelOf(form),
      skill_level: num(form, "skill_level"),
      usual_play_time: optStr(form, "usual_play_time"),
      notes: optStr(form, "notes"),
      marketing_consent: consent,
      notices_opt_out: form.get("notices_opt_out") === "on",
      home_location_id: optStr(form, "home_location_id"),
      ...(consent && !current?.marketing_consent ? { consent_at: new Date().toISOString() } : {}),
      ...(!consent ? { consent_at: null } : {}),
    })
    .eq("id", id);

  if (error) back(path, friendly(error));
  revalidatePath(path);
  back(path, "Saved.", "notice");
}

export async function checkIn(form: FormData) {
  const { supabase, org, workLocation } = await requireOrg();
  const memberId = str(form, "member_id");
  const returnTo = str(form, "return_to") || `/members/${memberId}`;

  // Recorded at the location picked in the sidebar (or the form's own location).
  const { error } = await supabase
    .from("check_ins")
    .insert({ org_id: org.id, member_id: memberId, source: "desk", location_id: optStr(form, "location_id") ?? workLocation.id });

  if (error) back(returnTo, friendly(error));
  revalidatePath("/dashboard");
  back(returnTo, "Checked in.", "notice");
}

// ---------------------------------------------------------------- Packages

export async function sellPackage(form: FormData) {
  const { supabase } = await requireOrg();
  const memberId = str(form, "member_id");
  const path = `/members/${memberId}`;
  const startsOn = str(form, "starts_on");
  const price = num(form, "price");

  const { data: membershipId, error } = await supabase.rpc("sell_membership", {
    p_member: memberId,
    p_package: str(form, "package_id"),
    p_starts_on: isValidDate(startsOn) ? startsOn : null,
    p_price: price,
  });
  if (error) back(path, friendly(error));

  // Paid on the spot: record it on the order the sale just made.
  const paidWith = str(form, "paid_with");
  if (paidWith && membershipId) {
    const { data: item } = await supabase.from("order_items").select("order_id").eq("membership_id", membershipId).maybeSingle();
    if (item) {
      const { error: payErr } = await supabase.rpc("mark_order_paid", { p_order: item.order_id, p_method: paidWith });
      if (payErr) back(path, `Package sold, but the payment wasn't recorded: ${friendly(payErr)}`);
    }
  }
  revalidatePath(path);
  revalidatePath("/payments");
  back(path, paidWith ? "Package sold and paid." : "Package sold. It's on the list to pay (Payments).", "notice");
}

export async function pauseMembership(form: FormData) {
  const { supabase } = await requireOrg();
  const path = `/members/${str(form, "member_id")}`;
  const from = str(form, "paused_from");
  const until = str(form, "paused_until");
  if (!isValidDate(from) || !isValidDate(until)) back(path, "Choose both pause dates.");

  const { error } = await supabase.rpc("pause_membership", {
    p_membership: str(form, "membership_id"),
    p_from: from,
    p_until: until,
  });

  if (error) back(path, friendly(error));
  revalidatePath(path);
  back(path, "Membership paused. The end date has moved out by the pause length.", "notice");
}

export async function cancelMembership(form: FormData) {
  const { supabase } = await requireOrg();
  const path = `/members/${str(form, "member_id")}`;
  const { error } = await supabase
    .from("memberships")
    .update({ status: "cancelled" })
    .eq("id", str(form, "membership_id"));
  if (error) back(path, friendly(error));
  revalidatePath(path);
  back(path, "Membership cancelled.", "notice");
}

// ---------------------------------------------------------------- Bookings

export async function createBooking(form: FormData) {
  const { supabase, org, locations, workLocation } = await requireOrg();
  const date = str(form, "date");
  const time = str(form, "time");
  const { data: court } = await supabase.from("courts").select("location_id").eq("id", str(form, "court_id")).maybeSingle();
  const loc = locations.find((l) => l.id === court?.location_id) ?? workLocation;
  const path = `/bookings?at=${loc.id}&date=${date}`;
  const formPath = `/bookings/new?court=${str(form, "court_id")}&date=${date}&time=${time}`;

  if (!isValidDate(date) || !/^\d{2}:\d{2}$/.test(time)) back(path, "Pick a valid date and time.");

  const memberId = optStr(form, "member_id");
  const guestName = optStr(form, "guest_name");
  const kind = (optStr(form, "kind") as BookingKind | null) ?? null;

  if (!memberId && !guestName && (kind === null || kind === "member" || kind === "drop_in")) {
    back(formPath, "Choose a member or enter a guest name.");
  }

  const start = zonedToUtc(date, time, loc.timezone);
  const { error } = await supabase.rpc("create_booking", {
    p_court: str(form, "court_id"),
    p_start: start.toISOString(),
    p_member: memberId,
    p_guest_name: guestName,
    p_kind: kind,
    p_minutes: num(form, "minutes"),
    p_notes: optStr(form, "notes"),
  });

  if (error) back(formPath, friendly(error));
  await sendPendingNotices(supabase, org.id); // the member's booking confirmation
  revalidatePath("/bookings");
  revalidatePath("/payments");
  back(path, "Court booked.", "notice");
}

export async function setBookingStatus(form: FormData) {
  const { supabase, org } = await requireOrg();
  const status = str(form, "status");
  const returnTo = str(form, "return_to") || "/bookings";
  if (!["cancelled", "no_show", "completed"].includes(status)) back(returnTo, "Unknown status.");

  const { data: booking, error } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", str(form, "booking_id"))
    .select("location_id")
    .maybeSingle();
  if (error) back(returnTo, friendly(error));
  if (!booking) back(returnTo, "You can only change bookings at your own location.");

  // Turning up counts as a visit for retention tracking.
  if (status === "completed") {
    const memberId = optStr(form, "member_id");
    if (memberId) {
      await supabase
        .from("check_ins")
        .insert({ org_id: org.id, member_id: memberId, source: "booking", location_id: booking.location_id });
    }
  }

  revalidatePath("/bookings");
  const labels: Record<string, string> = {
    cancelled: "Booking cancelled. The slot is free again.",
    no_show: "Marked as a no-show.",
    completed: "Marked as played and checked in.",
  };
  back(returnTo, labels[status], "notice");
}

// ---------------------------------------------------------------- Settings

async function requireManager() {
  const ctx = await requireOrg();
  if (!canManage(ctx.role)) back("/settings", "Only the owner or an admin can change settings.");
  return ctx;
}

export async function updateClub(form: FormData) {
  const { supabase, org } = await requireManager();
  const { error } = await supabase
    .from("orgs")
    .update({
      name: str(form, "name"),
      currency: str(form, "currency") || org.currency,
      default_language: str(form, "default_language") || org.default_language,
      booking_advance_days: num(form, "booking_advance_days") ?? org.booking_advance_days,
      max_active_bookings: num(form, "max_active_bookings") ?? org.max_active_bookings,
      at_risk_days: num(form, "at_risk_days") ?? org.at_risk_days,
      renewal_window_days: num(form, "renewal_window_days") ?? org.renewal_window_days,
      late_cancel_hours: num(form, "late_cancel_hours") ?? org.late_cancel_hours,
    })
    .eq("id", org.id);
  if (error) back("/settings", friendly(error));
  revalidatePath("/", "layout");
  back("/settings", "Club settings saved.", "notice");
}

// Online sign-ups: take the spot straight away, or wait for staff approval.
export async function setOnlineSignupMode(form: FormData) {
  const { supabase, org } = await requireManager();
  const mode = str(form, "mode") === "approve" ? "approve" : "instant";
  const { error } = await supabase.from("orgs").update({ online_signups: mode }).eq("id", org.id);
  if (error) back("/settings", friendly(error));
  revalidatePath("/settings");
  back(
    "/settings",
    mode === "approve"
      ? "Online sign-ups now wait for approval. You'll find them on the dashboard and on each session."
      : "Online sign-ups now take the spot straight away.",
    "notice",
  );
}

// Chat: Claude answers only, or answers and books free / package-covered places.
export async function setChatMode(form: FormData) {
  const { supabase, org } = await requireManager();
  const mode = str(form, "mode") === "answer" ? "answer" : "book";
  const { error } = await supabase.from("orgs").update({ chat_mode: mode }).eq("id", org.id);
  if (error) back("/settings#chat", friendly(error));
  revalidatePath("/", "layout");
  back(
    "/settings#chat",
    mode === "book"
      ? `${ASSISTANT_NAME} now answers chats and books free or package-covered places.`
      : `${ASSISTANT_NAME} now answers chats only. Bookings come to you.`,
    "notice",
  );
}

// ---------------------------------------------------------------- Messaging (the club's own LINE account)

const MESSAGING = "/settings#messaging";

/** Connect (or reconnect) the club's LINE Official Account. The token is checked with LINE first. */
export async function connectLine(form: FormData) {
  const { supabase, org } = await requireManager();
  if (!secretsConfigured()) back(MESSAGING, "Courtix isn't set up to store LINE keys yet (CHANNEL_SECRETS_KEY). Ask Courtix support.");
  const secret = str(form, "channel_secret").replace(/\s+/g, "");
  const token = str(form, "access_token").replace(/\s+/g, "");
  if (!/^[0-9a-f]{32}$/i.test(secret)) back(MESSAGING, "The channel secret is 32 letters and numbers (LINE Developers → Basic settings).");
  if (token.length < 100) back(MESSAGING, "Paste the whole channel access token (LINE Developers → Messaging API → Issue).");

  let info: Awaited<ReturnType<typeof lineBotInfo>>;
  try {
    info = await lineBotInfo(token);
  } catch (e) {
    back(MESSAGING, e instanceof LineError ? e.message : "Couldn't reach LINE to check the token. Try again.");
  }

  const row = {
    secret_enc: encryptSecret(secret),
    token_enc: encryptSecret(token),
    account_name: info.displayName ?? null,
    account_id: info.basicId ?? null,
    is_enabled: true,
    updated_at: new Date().toISOString(),
  };
  const { data: existing } = await supabase
    .from("messaging_channels")
    .select("id")
    .eq("org_id", org.id)
    .eq("provider", "line")
    .is("location_id", null)
    .maybeSingle();
  const { error } = existing
    ? await supabase.from("messaging_channels").update(row).eq("id", existing.id)
    : await supabase.from("messaging_channels").insert({ org_id: org.id, provider: "line", ...row });
  if (error) back(MESSAGING, friendly(error));
  revalidatePath("/settings");
  back(MESSAGING, `Connected to ${info.displayName ?? "your LINE account"}. Now paste the webhook address into LINE (step 3).`, "notice");
}

export async function setLineEnabled(form: FormData) {
  const { supabase, org } = await requireManager();
  const on = str(form, "on") === "true";
  const { error } = await supabase
    .from("messaging_channels")
    .update({ is_enabled: on, updated_at: new Date().toISOString() })
    .eq("org_id", org.id)
    .eq("provider", "line");
  if (error) back(MESSAGING, friendly(error));
  revalidatePath("/settings");
  back(MESSAGING, on ? "LINE chats are on." : "LINE chats are off. Messages to your LINE account are ignored here.", "notice");
}

export async function disconnectLine() {
  const { supabase, org } = await requireManager();
  const { error } = await supabase.from("messaging_channels").delete().eq("org_id", org.id).eq("provider", "line");
  if (error) back(MESSAGING, friendly(error));
  revalidatePath("/settings");
  back(MESSAGING, "LINE disconnected and its keys deleted. Remove the webhook address in LINE Developers too.", "notice");
}

// Automatic service messages: which kinds the club sends (lib/notices.ts).
const NOTICE_KINDS = ["booking_confirmed", "booking_reminder", "package_ending", "waitlist_moved_up", "session_cancelled"];

export async function saveAutoNotices(form: FormData) {
  const { supabase, org } = await requireManager();
  const kinds = NOTICE_KINDS.filter((k) => form.get(k) === "on");
  const { error } = await supabase
    .from("orgs")
    .update({ auto_notices: kinds, payment_note: str(form, "payment_note").slice(0, 300) || null })
    .eq("id", org.id);
  if (error) back("/settings#notices", friendly(error));
  revalidatePath("/settings");
  back("/settings#notices", kinds.length ? "Automatic messages saved." : "Automatic messages are off.", "notice");
}

// The public booking page (<slug>.courtix.app/book) on or off.
export async function setPublicBooking(form: FormData) {
  const { supabase, org } = await requireManager();
  const on = str(form, "on") === "true";
  const { error } = await supabase.from("orgs").update({ public_booking: on }).eq("id", org.id);
  if (error) back("/settings", friendly(error));
  revalidatePath("/settings");
  back("/settings", on ? "Online booking is on." : "Online booking is off. The page now says to book by WhatsApp.", "notice");
}

// ---------------------------------------------------------------- Branding (logo and colours)

// The logo goes to Storage as the signed-in owner/manager (storage RLS checks the club folder),
// re-encoded as PNG. Colours are picked from it unless the owner unticks "Pick colours".
export async function uploadLogo(form: FormData) {
  const { supabase, org } = await requireManager();
  const file = form.get("logo");
  if (!(file instanceof File) || file.size === 0) back("/settings#branding", "Choose a logo file first.");
  if (file.size > LOGO_MAX_BYTES) back("/settings#branding", "That file is over 4 MB. Try a smaller logo.");
  if (file.type && !LOGO_TYPES.includes(file.type)) {
    back("/settings#branding", "Use a PNG, JPG, WebP, GIF or SVG image.");
  }

  let png: Buffer;
  let colors: Awaited<ReturnType<typeof detectColors>>;
  try {
    png = await normalizeLogo(Buffer.from(await file.arrayBuffer()));
    colors = await detectColors(png);
  } catch {
    back("/settings#branding", "That file couldn't be read as an image. Try a PNG or JPG.");
  }

  const path = `${org.id}/logo-${Date.now()}.png`;
  const { error: upErr } = await supabase.storage
    .from("club-logos")
    .upload(path, png, { contentType: "image/png", cacheControl: "31536000", upsert: false });
  if (upErr) back("/settings#branding", friendly(upErr));

  const pick = form.get("pick_colors") === "on";
  const { error } = await supabase
    .from("orgs")
    .update({
      logo_path: path,
      brand_palette: colors.palette,
      ...(pick && colors.primary ? { brand_primary: colors.primary, brand_secondary: colors.secondary } : {}),
    })
    .eq("id", org.id);
  if (error) {
    await supabase.storage.from("club-logos").remove([path]);
    back("/settings#branding", friendly(error));
  }
  // The old file isn't needed any more (each upload gets a new name, so phones don't show a cached old logo).
  if (org.logo_path && org.logo_path !== path) await supabase.storage.from("club-logos").remove([org.logo_path]);

  revalidatePath("/", "layout");
  back(
    "/settings#branding",
    pick && colors.primary
      ? "Logo saved, and your booking page now uses colours from it. Change them below if you like."
      : "Logo saved.",
    "notice",
  );
}

export async function saveBrandColors(form: FormData) {
  const { supabase, org } = await requireManager();
  const reset = str(form, "reset") === "true";
  const primary = reset ? null : normalizeHex(str(form, "brand_primary"));
  const secondary = reset ? null : normalizeHex(str(form, "brand_secondary"));
  if (!reset && !primary) back("/settings#branding", "Pick a main colour.");
  const { error } = await supabase
    .from("orgs")
    .update({ brand_primary: primary, brand_secondary: secondary })
    .eq("id", org.id);
  if (error) back("/settings#branding", friendly(error));
  revalidatePath("/", "layout");
  back("/settings#branding", reset ? "Back to the standard Courtix colours." : "Colours saved.", "notice");
}

export async function removeLogo() {
  const { supabase, org } = await requireManager();
  if (!org.logo_path) back("/settings#branding", "There's no logo to remove.");
  const { error } = await supabase.from("orgs").update({ logo_path: null, brand_palette: [] }).eq("id", org.id);
  if (error) back("/settings#branding", friendly(error));
  await supabase.storage.from("club-logos").remove([org.logo_path]);
  revalidatePath("/", "layout");
  back("/settings#branding", "Logo removed. Your colours stay until you change them.", "notice");
}

export async function addCourt(form: FormData) {
  const { supabase, org, workLocation } = await requireManager();
  const name = str(form, "name");
  if (!name) back("/settings", "Enter a court name.");
  const locationId = optStr(form, "location_id") ?? workLocation.id;
  const { count } = await supabase.from("courts").select("id", { count: "exact", head: true }).eq("location_id", locationId);
  const { error } = await supabase.from("courts").insert({
    org_id: org.id,
    location_id: locationId,
    name,
    is_covered: form.get("is_covered") === "on",
    sort_order: (count ?? 0) + 1,
  });
  if (error) back("/settings", friendly(error));
  revalidatePath("/settings");
  back("/settings", "Court added.", "notice");
}

export async function toggleCourt(form: FormData) {
  const { supabase } = await requireManager();
  const { error } = await supabase
    .from("courts")
    .update({ is_active: str(form, "is_active") === "true" })
    .eq("id", str(form, "court_id"));
  if (error) back("/settings", friendly(error));
  revalidatePath("/settings");
  back("/settings", "Court updated.", "notice");
}

export async function addPackage(form: FormData) {
  const { supabase, org } = await requireManager();
  const kind = str(form, "kind") === "class_pack" ? "class_pack" : "time_based";
  const { error } = await supabase.from("package_types").insert({
    org_id: org.id,
    name: str(form, "name"),
    kind,
    duration_days: kind === "time_based" ? num(form, "duration_days") : null,
    sessions: kind === "class_pack" ? num(form, "sessions") : null,
    price: num(form, "price") ?? 0,
    max_active_bookings: num(form, "max_active_bookings"),
    priority_days: num(form, "priority_days") ?? 0,
    // None ticked means valid at every location.
    location_ids: form.getAll("location_ids").length ? form.getAll("location_ids").map(String) : null,
  });
  if (error) back("/settings", friendly(error));
  revalidatePath("/settings");
  back("/settings", "Package added.", "notice");
}

export async function togglePackage(form: FormData) {
  const { supabase } = await requireManager();
  const { error } = await supabase
    .from("package_types")
    .update({ is_active: str(form, "is_active") === "true" })
    .eq("id", str(form, "package_id"));
  if (error) back("/settings", friendly(error));
  revalidatePath("/settings");
  back("/settings", "Package updated.", "notice");
}

// ---------------------------------------------------------------------------
// Which sessions a package covers (package_coverage). Managers only (RLS too).
// "what" is "all", "cat:<category>" or "type:<session type id>".
// ---------------------------------------------------------------------------
export async function addCoverage(form: FormData) {
  const { supabase, org } = await requireManager();
  const what = str(form, "what");
  const days = form.getAll("days").map(Number);
  const start = optStr(form, "start_time");
  const end = optStr(form, "end_time");
  if (Boolean(start) !== Boolean(end)) back("/settings", "Enter both times, or leave both empty for any time.");
  const { error } = await supabase.from("package_coverage").insert({
    org_id: org.id,
    package_type_id: str(form, "package_id"),
    category: what.startsWith("cat:") ? what.slice(4) : null,
    session_type_id: what.startsWith("type:") ? what.slice(5) : null,
    // None ticked, or all seven, means every day.
    days_of_week: days.length && days.length < 7 ? days : null,
    start_time: start,
    end_time: end,
  });
  if (error) back("/settings", friendly(error));
  revalidatePath("/settings");
  back("/settings", "Package now covers those sessions.", "notice");
}

export async function removeCoverage(form: FormData) {
  const { supabase } = await requireManager();
  const { error } = await supabase.from("package_coverage").delete().eq("id", str(form, "coverage_id"));
  if (error) back("/settings", friendly(error));
  revalidatePath("/settings");
  back("/settings", "Rule removed.", "notice");
}

export async function setPriorityDays(form: FormData) {
  const { supabase } = await requireManager();
  const { error } = await supabase
    .from("package_types")
    .update({ priority_days: num(form, "priority_days") ?? 0 })
    .eq("id", str(form, "package_id"));
  if (error) back("/settings", friendly(error));
  revalidatePath("/settings");
  back("/settings", "Priority booking saved.", "notice");
}

export async function addRateRule(form: FormData) {
  const { supabase, org } = await requireManager();
  const days = form.getAll("days").map(Number).filter((d) => d >= 0 && d <= 6);
  const { error } = await supabase.from("rate_rules").insert({
    org_id: org.id,
    label: str(form, "label"),
    days_of_week: days.length ? days : [0, 1, 2, 3, 4, 5, 6],
    start_time: str(form, "start_time"),
    end_time: str(form, "end_time"),
    drop_in_price: num(form, "drop_in_price") ?? 0,
    member_price: num(form, "member_price") ?? 0,
    priority: num(form, "priority") ?? 50,
    location_id: optStr(form, "location_id"),
  });
  if (error) back("/settings", friendly(error));
  revalidatePath("/settings");
  back("/settings", "Price rule added.", "notice");
}

export async function deleteRateRule(form: FormData) {
  const { supabase } = await requireManager();
  const { error } = await supabase.from("rate_rules").delete().eq("id", str(form, "rule_id"));
  if (error) back("/settings", friendly(error));
  revalidatePath("/settings");
  back("/settings", "Price rule removed.", "notice");
}

export async function addDemoData() {
  const { supabase, org } = await requireManager();
  const { error } = await supabase.rpc("add_demo_data", { p_org: org.id });
  if (error) back("/dashboard", friendly(error));
  revalidatePath("/", "layout");
  back("/dashboard", "Added 12 sample members so you can try things out.", "notice");
}

// ---------------------------------------------------------------- Locations

function locationFields(form: FormData) {
  return {
    name: str(form, "name"),
    address: optStr(form, "address"),
    timezone: str(form, "timezone") || "Asia/Bangkok",
    opens_at: str(form, "opens_at") || "07:00",
    closes_at: str(form, "closes_at") || "22:00",
    slot_minutes: num(form, "slot_minutes") ?? 60,
    whatsapp: optStr(form, "whatsapp"),
  };
}

export async function addLocation(form: FormData) {
  const { supabase, org, locations } = await requireManager();
  const fields = locationFields(form);
  if (!fields.name) back("/settings", "Enter a name for the location.");
  const { data, error } = await supabase
    .from("locations")
    .insert({ org_id: org.id, ...fields, sort_order: locations.length + 1 })
    .select("id")
    .single();
  if (error) back("/settings", friendly(error));

  // Start the new site with two courts, like a new club.
  await supabase.from("courts").insert([
    { org_id: org.id, location_id: data.id, name: "Court 1", sort_order: 1 },
    { org_id: org.id, location_id: data.id, name: "Court 2", sort_order: 2 },
  ]);
  revalidatePath("/", "layout");
  back("/settings", `${fields.name} added with 2 courts. Rename or add courts below.`, "notice");
}

export async function updateLocation(form: FormData) {
  const { supabase } = await requireManager();
  const fields = locationFields(form);
  if (!fields.name) back("/settings", "Enter a name for the location.");
  const { error } = await supabase.from("locations").update(fields).eq("id", str(form, "location_id"));
  if (error) back("/settings", friendly(error));
  revalidatePath("/", "layout");
  back("/settings", `${fields.name} saved.`, "notice");
}

export async function toggleLocation(form: FormData) {
  const { supabase, locations } = await requireManager();
  const id = str(form, "location_id");
  const activate = str(form, "is_active") === "true";
  if (!activate && locations.filter((l) => l.is_active).length <= 1) {
    back("/settings", "A club needs at least one open location.");
  }
  const { error } = await supabase.from("locations").update({ is_active: activate }).eq("id", id);
  if (error) back("/settings", friendly(error));
  revalidatePath("/", "layout");
  back(
    "/settings",
    activate ? "Location reopened." : "Location closed. Its courts can't be booked and no new sessions are created there.",
    "notice",
  );
}

// Online court requests from visitors (club in "Request, staff approve" mode).
export async function decideCourtRequest(form: FormData) {
  const { supabase, org } = await requireOrg();
  const approve = str(form, "approve") === "true";
  const bookingId = str(form, "booking_id");
  // Read it first: a request made in a chat gets the answer in that chat.
  const { data: req } = await supabase
    .from("booking_calendar")
    .select("start_at, end_at, price, member_id, court_name, location_name")
    .eq("id", bookingId)
    .maybeSingle();
  const { data: extra } = await supabase
    .from("bookings")
    .select("chat_conversation_id, coaches(name), locations(timezone)")
    .eq("id", bookingId)
    .maybeSingle();
  const { error } = await supabase.rpc("decide_online_court", { p_booking: bookingId, p_approve: approve });
  if (error) back("/dashboard", friendly(error));
  const chatId = (extra as { chat_conversation_id: string | null } | null)?.chat_conversation_id ?? null;
  // Members on LINE get the usual confirmation notice; visitors (and every decline) hear it in the chat.
  let toldInChat = false;
  if (chatId && req && (!approve || !req.member_id)) {
    const coach = (extra as unknown as { coaches: { name: string } | null }).coaches?.name;
    const tz = (extra as unknown as { locations: { timezone: string } | null }).locations?.timezone ?? org.timezone;
    const day = new Date(req.start_at).toLocaleDateString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" });
    const t = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
    const what = coach ? `your lesson with ${coach}` : `your booking for ${req.court_name}`;
    const text = approve
      ? `Confirmed: ${what} on ${day}, ${t(req.start_at)}–${t(req.end_at)} (${req.court_name}, ${req.location_name}). ${
          Number(req.price) > 0 ? `${formatMoney(Number(req.price), org.currency)}, pay at the club. ` : ""
        }See you on court.`
      : `Sorry, we can't confirm ${what} on ${day} at ${t(req.start_at)}. Reply here and we'll find another time.`;
    const { error: msgErr } = await supabase.from("chat_messages").insert({
      org_id: org.id,
      conversation_id: chatId,
      role: "staff",
      body: text,
      api: staffApiMessage(text),
    });
    if (!msgErr) {
      await supabase.from("chat_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", chatId);
      await deliverChat(supabase, chatId);
      toldInChat = true;
    }
  }
  if (approve) await sendPendingNotices(supabase, org.id); // the member's confirmation (LINE when linked)
  revalidatePath("/dashboard");
  revalidatePath("/bookings");
  revalidatePath("/payments");
  revalidatePath("/coaches");
  back(
    "/dashboard",
    approve
      ? toldInChat
        ? "Request approved. We told them in the chat."
        : req?.member_id
          ? "Request approved. The member gets the confirmation automatically."
          : "Request approved. Let them know on WhatsApp."
      : `Request declined. The court (and coach) are free again.${toldInChat ? " We told them in the chat." : ""}`,
    "notice",
  );
}

// The club's PromptPay, for QR codes on pay pages (lib/promptpay.ts).
export async function savePromptPay(form: FormData) {
  const { supabase, org } = await requireManager();
  let id = str(form, "promptpay_id").replace(/\D/g, "");
  if (/^66\d{9}$/.test(id)) id = `0${id.slice(2)}`; // +66 81... → 081...
  if (id && !promptPayKind(id)) {
    back("/settings#payments", "Enter the PromptPay phone number (10 digits), national ID or tax ID (13 digits), or e-wallet ID (15 digits).");
  }
  const { error } = await supabase
    .from("orgs")
    .update({
      promptpay_id: id || null,
      promptpay_name: str(form, "promptpay_name").slice(0, 80) || null,
      slip_autoverify: form.get("slip_autoverify") === "on",
    })
    .eq("id", org.id);
  if (error) back("/settings#payments", friendly(error));
  revalidatePath("/settings");
  back("/settings#payments", id ? "PromptPay saved. Pay pages now show a QR with the amount." : "PromptPay removed. Pay pages say to pay at the club.", "notice");
}
