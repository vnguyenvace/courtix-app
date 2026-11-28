"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, canManage } from "@/lib/org";
import { back, friendly, num, optStr, str } from "@/lib/form";
import { formatMoney, isValidDate, zonedToUtc } from "@/lib/time";
import { sendPendingNotices } from "@/lib/notices";

function refresh() {
  revalidatePath("/sessions", "layout");
  revalidatePath("/bookings");
  revalidatePath("/dashboard");
}

async function requireManager(path: string) {
  const ctx = await requireOrg();
  if (!canManage(ctx.role)) back(path, "Only the owner or an admin can do that.");
  return ctx;
}

// ---------------------------------------------------------------- Timetable

export async function generateSessions(form: FormData) {
  const returnTo = str(form, "return_to") || "/sessions";
  const { supabase, org } = await requireManager(returnTo);
  const { data, error } = await supabase.rpc("generate_sessions", { p_org: org.id, p_days: num(form, "days") ?? 14 });
  if (error) back(returnTo, friendly(error));
  refresh();
  back(returnTo, data === 0 ? "Timetable is already up to date." : `Added ${data} sessions to the timetable.`, "notice");
}

export async function runMinimumCheck(form: FormData) {
  const returnTo = str(form, "return_to") || "/sessions";
  const { supabase, org } = await requireOrg();
  const { data, error } = await supabase.rpc("check_session_minimums", { p_org: org.id });
  if (error) back(returnTo, friendly(error));
  // Members whose place moved up off the waitlist, or whose session was cancelled, are told now.
  await notifyMembers(supabase);
  const rows = (data ?? []) as { outcome: string }[];
  const confirmed = rows.filter((r) => r.outcome === "confirmed").length;
  const cancelled = rows.filter((r) => r.outcome === "cancelled").length;
  refresh();
  back(
    returnTo,
    rows.length === 0
      ? "No sessions are due for a go / no-go decision yet."
      : `Checked ${rows.length}: ${confirmed} confirmed, ${cancelled} cancelled for too few players.`,
    "notice",
  );
}

export async function loadRaccoonDemo() {
  const { supabase, org } = await requireManager("/sessions");
  const { data, error } = await supabase.rpc("load_raccoon_demo", { p_org: org.id });
  if (error) back("/sessions", friendly(error));
  refresh();
  revalidatePath("/settings");
  back("/sessions", String(data), "notice");
}

// ---------------------------------------------------------------- Sign-ups

export async function registerForSession(form: FormData) {
  const sessionId = str(form, "session_id");
  const path = `/sessions/${sessionId}`;
  const { supabase, org } = await requireOrg();

  const memberId = optStr(form, "member_id");
  const guestName = optStr(form, "guest_name");
  if (!memberId && !guestName) back(path, "Choose a member or enter a guest name.");

  const { data, error } = await supabase.rpc("register_for_session", {
    p_session: sessionId,
    p_member: memberId,
    p_guest_name: memberId ? null : guestName,
    p_guest_phone: memberId ? null : optStr(form, "guest_phone"),
    p_allow_late: form.get("allow_late") === "on",
    p_ignore_level: form.get("ignore_level") === "on",
    p_spots: form.get("pair") === "on" ? 2 : 1,
    p_partner_name: form.get("pair") === "on" ? optStr(form, "partner_name") : null,
    p_division: optStr(form, "division_id"),
  });
  if (error) back(path, friendly(error));
  await notifyMembers(supabase); // the member's booking confirmation
  revalidatePath("/payments");

  const { data: reg } = await supabase
    .from("session_roster")
    .select("status, price, credit_used, covered_by, covered_kind, sessions_left")
    .eq("id", data)
    .single();
  refresh();
  back(path, signUpMessage(reg, org.currency), "notice");
}

export async function cancelRegistration(form: FormData) {
  const path = `/sessions/${str(form, "session_id")}`;
  const { supabase } = await requireOrg();
  const registrationId = str(form, "registration_id");
  const { data: before } = await supabase
    .from("session_registrations")
    .select("credit_used")
    .eq("id", registrationId)
    .maybeSingle();
  const { data: promoted, error } = await supabase.rpc("cancel_registration", {
    p_registration: registrationId,
  });
  if (error) back(path, friendly(error));
  // Members whose place moved up off the waitlist, or whose session was cancelled, are told now.
  await notifyMembers(supabase);
  const { data: after } = await supabase
    .from("session_registrations")
    .select("credit_used")
    .eq("id", registrationId)
    .maybeSingle();

  let message = "Place cancelled.";
  if (before?.credit_used && !after?.credit_used) message += " Their credit is back on their pack.";
  if (before?.credit_used && after?.credit_used) message += " It's past the late-cancel cut-off, so the credit is used.";
  if (promoted) {
    const { data } = await supabase.from("session_roster").select("name").eq("id", promoted).single();
    message += ` ${data?.name ?? "Next person"} moved up from the waitlist.`;
  }
  refresh();
  back(path, message, "notice");
}

export async function markAttendance(form: FormData) {
  const path = `/sessions/${str(form, "session_id")}`;
  const { supabase } = await requireOrg();
  const { error } = await supabase.rpc("mark_attendance", {
    p_registration: str(form, "registration_id"),
    p_attended: str(form, "attended") === "true",
  });
  if (error) back(path, friendly(error));
  refresh();
  back(path, str(form, "attended") === "true" ? "Marked as attended." : "Marked as a no-show.", "notice");
}

export async function cancelSession(form: FormData) {
  const sessionId = str(form, "session_id");
  const path = `/sessions/${sessionId}`;
  const { supabase } = await requireOrg();
  const { data, error } = await supabase.rpc("cancel_session", {
    p_session: sessionId,
    p_reason: optStr(form, "reason"),
  });
  if (error) back(path, friendly(error));
  // Members whose place moved up off the waitlist, or whose session was cancelled, are told now.
  await notifyMembers(supabase);
  refresh();
  back(
    path,
    `Session cancelled and its courts freed.${data ? ` ${data} people were signed up and need to be told.` : ""}`,
    "notice",
  );
}

// ---------------------------------------------------------------- Events

export async function createEvent(form: FormData) {
  const { supabase, locations, workLocation } = await requireManager("/sessions/new");
  const loc = locations.find((l) => l.id === str(form, "location_id")) ?? workLocation;
  const date = str(form, "date");
  const endDate = str(form, "end_date") || date;
  const start = str(form, "start_time");
  const end = str(form, "end_time");
  if (!isValidDate(date) || !isValidDate(endDate) || !start || !end) {
    back("/sessions/new", "Choose the date and start and end times.");
  }

  const { data, error } = await supabase.rpc("create_event", {
    p_type: str(form, "session_type_id"),
    p_starts_at: zonedToUtc(date, start, loc.timezone).toISOString(),
    p_ends_at: zonedToUtc(endDate, end, loc.timezone).toISOString(),
    p_title: optStr(form, "title"),
    p_price: num(form, "price"),
    p_min_players: num(form, "min_players"),
    p_max_players: num(form, "max_players"),
    p_level_min: num(form, "level_min"),
    p_level_max: num(form, "level_max"),
    p_courts: form.getAll("court_ids").map(String),
    p_description: optStr(form, "description"),
    p_coach_name: optStr(form, "coach_name"),
    p_location: loc.id,
  });
  if (error) back("/sessions/new", friendly(error));
  refresh();
  redirect(`/sessions/${data}?notice=${encodeURIComponent("Event created.")}`);
}

// ---------------------------------------------------------------- Setup

export async function addSessionType(form: FormData) {
  const { supabase, org } = await requireManager("/sessions/setup");
  const { error } = await supabase.from("session_types").insert({
    org_id: org.id,
    name: str(form, "name"),
    category: str(form, "category") || "open_play",
    description: optStr(form, "description"),
    price: num(form, "price") ?? 0,
    duration_minutes: num(form, "duration_minutes") ?? 60,
    min_players: num(form, "min_players") ?? 1,
    max_players: num(form, "max_players") ?? 8,
    min_age: num(form, "min_age"),
    level_min: num(form, "level_min"),
    level_max: num(form, "level_max"),
    book_by_minutes: num(form, "book_by_minutes") ?? 60,
    min_check_hours: num(form, "min_check_hours") ?? 3,
    signup_opens_days: num(form, "signup_opens_days"),
  });
  if (error) back("/sessions/setup", friendly(error));
  refresh();
  back("/sessions/setup", "Session type added.", "notice");
}

// Online requests (club setting "Request, staff approve"). back_to: where to return.
function backTo(form: FormData, fallback: string) {
  const to = str(form, "back_to");
  return to.startsWith("/") && !to.startsWith("//") ? to : fallback;
}

export async function approveRequest(form: FormData) {
  const path = backTo(form, `/sessions/${str(form, "session_id")}`);
  const { supabase } = await requireOrg();
  const { data, error } = await supabase.rpc("approve_online_request", { p_registration: str(form, "registration_id") });
  if (error) back(path, friendly(error));
  // Members whose place moved up off the waitlist, or whose session was cancelled, are told now.
  await notifyMembers(supabase);
  refresh();
  revalidatePath("/dashboard");
  back(
    path,
    data === "waitlisted"
      ? "Approved, but the session is full now, so they're on the waitlist. Let them know on WhatsApp."
      : "Approved. Let them know on WhatsApp that their place is confirmed.",
    "notice",
  );
}

export async function declineRequest(form: FormData) {
  const path = backTo(form, `/sessions/${str(form, "session_id")}`);
  const { supabase } = await requireOrg();
  const { error } = await supabase.rpc("decline_online_request", { p_registration: str(form, "registration_id") });
  if (error) back(path, friendly(error));
  refresh();
  revalidatePath("/dashboard");
  back(path, "Request declined.", "notice");
}

// Show or hide a session type on the public booking page.
export async function setSessionTypePublic(form: FormData) {
  const { supabase } = await requireManager("/sessions/setup");
  const isPublic = str(form, "is_public") === "true";
  const { error } = await supabase
    .from("session_types")
    .update({ is_public: isPublic })
    .eq("id", str(form, "type_id"));
  if (error) back("/sessions/setup", friendly(error));
  refresh();
  back("/sessions/setup", isPublic ? "Shown on the booking page." : "Hidden from the booking page.", "notice");
}

export async function toggleSessionType(form: FormData) {
  const { supabase } = await requireManager("/sessions/setup");
  const { error } = await supabase
    .from("session_types")
    .update({ is_active: str(form, "is_active") === "true" })
    .eq("id", str(form, "type_id"));
  if (error) back("/sessions/setup", friendly(error));
  refresh();
  back("/sessions/setup", "Session type updated.", "notice");
}

export async function addSchedule(form: FormData) {
  const { supabase, org, workLocation } = await requireManager("/sessions/setup");
  const locationId = optStr(form, "location_id") ?? workLocation.id;
  const courtIds = form.getAll("court_ids").map(String);
  if (courtIds.length) {
    const { data: wrong } = await supabase.from("courts").select("name").in("id", courtIds).neq("location_id", locationId);
    if (wrong?.length) back("/sessions/setup", `${wrong.map((c) => c.name).join(", ")} isn't at that location.`);
  }
  const days = form.getAll("days").map(Number).filter((d) => d >= 0 && d <= 6);
  if (days.length === 0) back("/sessions/setup", "Pick at least one day.");
  const validFrom = str(form, "valid_from");
  const validUntil = str(form, "valid_until");

  const { error } = await supabase.from("session_schedules").insert({
    org_id: org.id,
    session_type_id: str(form, "session_type_id"),
    days_of_week: days,
    start_time: str(form, "start_time"),
    court_ids: courtIds,
    location_id: locationId,
    ...(isValidDate(validFrom) ? { valid_from: validFrom } : {}),
    valid_until: isValidDate(validUntil) ? validUntil : null,
  });
  if (error) back("/sessions/setup", friendly(error));
  refresh();
  back("/sessions/setup", "Added to the weekly timetable. Click “Fill the next 2 weeks” to create the sessions.", "notice");
}

export async function toggleSchedule(form: FormData) {
  const { supabase } = await requireManager("/sessions/setup");
  const { error } = await supabase
    .from("session_schedules")
    .update({ is_active: str(form, "is_active") === "true" })
    .eq("id", str(form, "schedule_id"));
  if (error) back("/sessions/setup", friendly(error));
  refresh();
  back(
    "/sessions/setup",
    str(form, "is_active") === "true"
      ? "Timetable slot turned back on."
      : "Timetable slot turned off. Sessions already created stay until you cancel them.",
    "notice",
  );
}

type SignUpRow = {
  status: string;
  price: number;
  credit_used: boolean;
  covered_by: string | null;
  covered_kind: string | null;
  sessions_left: number | null;
} | null;

function signUpMessage(reg: SignUpRow, currency: string): string {
  if (!reg) return "Signed up.";
  if (reg.status === "waitlisted") {
    return reg.price === 0
      ? "Session is full, so they're on the waitlist. Their package covers it when they move up."
      : "Session is full, so they're on the waitlist.";
  }
  if (reg.credit_used) {
    const left = reg.sessions_left ?? 0;
    return `Signed up. Used 1 credit from ${reg.covered_by}: ${left} ${left === 1 ? "credit" : "credits"} left.`;
  }
  if (reg.covered_by) return `Signed up. Covered by ${reg.covered_by}.`;
  return `Signed up. Price ${formatMoney(reg.price, currency)}.`;
}

// ---------------------------------------------------------------- Editing
// Rules live in update_session / apply_session_type / update_schedule (database).

/** Edit one session (owners and managers). Times are in the session's location time zone. */
export async function updateSession(form: FormData) {
  const sessionId = str(form, "session_id");
  const path = `/sessions/${sessionId}`;
  const editPath = `${path}/edit`;
  const { supabase } = await requireManager(path);
  const tz = str(form, "timezone") || "Asia/Bangkok";
  const date = str(form, "date");
  const endDate = str(form, "end_date") || date;
  if (!isValidDate(date) || !isValidDate(endDate)) back(editPath, "Enter a valid date.");
  const start = str(form, "start_time");
  const end = str(form, "end_time");
  if (!start || !end) back(editPath, "Enter a start and end time.");

  const { data, error } = await supabase.rpc("update_session", {
    p_session: sessionId,
    // Unchanged title: keep following the session type's name (null keeps the current title).
    p_title: str(form, "title") === str(form, "original_title") ? null : str(form, "title"),
    p_starts_at: zonedToUtc(date, start, tz).toISOString(),
    p_ends_at: zonedToUtc(endDate, end, tz).toISOString(),
    p_price: num(form, "price"),
    p_min_players: num(form, "min_players"),
    p_max_players: num(form, "max_players"),
    p_level_min: num(form, "level_min"),
    p_level_max: num(form, "level_max"),
    p_coach_name: optStr(form, "coach_name"),
    p_description: optStr(form, "description"),
    p_notes: optStr(form, "notes"),
    p_courts: form.getAll("court_ids").map(String),
  });
  if (error) back(editPath, friendly(error));
  // A coach from the Coaches list: their name shows, and they can't be booked for lessons then.
  if (form.get("has_coach_list")) {
    const { error: coachError } = await supabase.rpc("set_session_coach", { p_session: sessionId, p_coach: optStr(form, "coach_id") });
    if (coachError) back(editPath, `Session saved, but the coach wasn't: ${friendly(coachError)}`);
  }
  // Members whose place moved up off the waitlist, or whose session was cancelled, are told now.
  await notifyMembers(supabase);
  refresh();
  const r = (data ?? {}) as { moved_up?: number; court_note?: string | null };
  let message = "Session saved. People already booked keep the price they signed up at.";
  if (r.moved_up) message += ` ${r.moved_up} moved up from the waitlist.`;
  if (r.court_note) message += ` ${r.court_note}.`;
  back(path, message, "notice");
}

/** Edit a session type, and optionally its upcoming sessions. */
export async function updateSessionType(form: FormData) {
  const path = "/sessions/setup";
  const { supabase } = await requireManager(path);
  const typeId = str(form, "type_id");
  const { error } = await supabase
    .from("session_types")
    .update({
      name: str(form, "name"),
      category: str(form, "category") || "open_play",
      description: optStr(form, "description"),
      price: num(form, "price") ?? 0,
      duration_minutes: num(form, "duration_minutes") ?? 60,
      min_players: num(form, "min_players") ?? 1,
      max_players: num(form, "max_players") ?? 8,
      min_age: num(form, "min_age"),
      level_min: num(form, "level_min"),
      level_max: num(form, "level_max"),
      book_by_minutes: num(form, "book_by_minutes") ?? 60,
      min_check_hours: num(form, "min_check_hours") ?? 3,
      signup_opens_days: num(form, "signup_opens_days"),
    })
    .eq("id", typeId);
  if (error) back(path, friendly(error));

  let message = "Session type saved.";
  if (form.get("apply_upcoming") === "on") {
    const { data, error: applyError } = await supabase.rpc("apply_session_type", { p_type: typeId });
    if (applyError) back(path, friendly(applyError));
    // Members whose place moved up off the waitlist, or whose session was cancelled, are told now.
    await notifyMembers(supabase);
    const r = (data ?? {}) as { updated?: number; kept_max?: number; moved_up?: number };
    message += ` ${r.updated ?? 0} upcoming ${r.updated === 1 ? "session" : "sessions"} updated (sessions you edited by hand were left alone).`;
    if (r.kept_max) message += ` ${r.kept_max} already had more people than the new maximum, so they keep a higher limit.`;
    if (r.moved_up) message += ` ${r.moved_up} moved up from waitlists.`;
  } else {
    message += " Upcoming sessions were not changed; new ones use the new settings.";
  }
  refresh();
  back(path, message, "notice");
}

/** Edit a weekly timetable entry and rebuild its upcoming empty sessions. */
export async function updateScheduleEntry(form: FormData) {
  const path = "/sessions/setup";
  const { supabase } = await requireManager(path);
  const scheduleId = str(form, "schedule_id");
  const days = form.getAll("days").map(Number).filter((d) => d >= 0 && d <= 6);
  if (days.length === 0) back(path, "Pick at least one day.");
  const validUntil = str(form, "valid_until");
  const { data: sched } = await supabase.from("session_schedules").select("location_id").eq("id", scheduleId).maybeSingle();
  const courtIds = form.getAll("court_ids").map(String);
  if (sched && courtIds.length) {
    const { data: wrong } = await supabase.from("courts").select("name").in("id", courtIds).neq("location_id", sched.location_id);
    if (wrong?.length) back(path, `${wrong.map((c) => c.name).join(", ")} isn't at that location.`);
  }

  const { data, error } = await supabase.rpc("update_schedule", {
    p_schedule: scheduleId,
    p_days: days,
    p_start_time: str(form, "start_time"),
    p_courts: courtIds,
    p_valid_until: isValidDate(validUntil) ? validUntil : null,
  });
  if (error) back(path, friendly(error));
  // Members whose place moved up off the waitlist, or whose session was cancelled, are told now.
  await notifyMembers(supabase);
  refresh();

  const r = (data ?? {}) as { rebuilt?: number; created?: number; kept?: { id: string; starts_at: string }[] };
  let message = `Timetable updated. ${r.created ?? 0} upcoming ${r.created === 1 ? "session" : "sessions"} made from the new times.`;
  const kept = r.kept ?? [];
  if (kept.length) {
    const { data: loc } = sched
      ? await supabase.from("locations").select("timezone").eq("id", sched.location_id).maybeSingle()
      : { data: null };
    const tz = loc?.timezone ?? "Asia/Bangkok";
    const when = kept
      .map((k) => new Date(k.starts_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }))
      .join(", ");
    message += ` ${kept.length} ${kept.length === 1 ? "session already has" : "sessions already have"} people signed up and stayed at the old time (${when}). Open each one to move it, or cancel it, and let the players know.`;
  }
  back(path, message, "notice");
}

/** Sends the automatic notices a change just queued (waitlist moved up, session cancelled). Never fails the action. */
async function notifyMembers(supabase: Awaited<ReturnType<typeof requireOrg>>["supabase"]) {
  try {
    const { data } = await supabase.from("member_notices").select("org_id").eq("status", "pending").limit(500);
    for (const orgId of new Set((data ?? []).map((r) => r.org_id as string))) await sendPendingNotices(supabase, orgId);
  } catch (e) {
    console.error("Notices: couldn't send after a session change", e);
  }
}

// ---------------------------------------------------------------- Event tickets (Step 4)

async function requireSetup(path: string) {
  const ctx = await requireOrg();
  if (!ctx.can("club.setup")) back(path, "Only the owner or an admin can change event tickets.");
  return ctx;
}

/** Pairs on/off and the registration deadline (local time of the session's location). */
export async function setEventOptions(form: FormData) {
  const sessionId = str(form, "session_id");
  const path = `/sessions/${sessionId}#tickets`;
  const { supabase } = await requireSetup(path);
  const date = str(form, "deadline_date");
  const time = str(form, "deadline_time") || "23:59";
  if (date && !isValidDate(date)) back(path, "Enter a valid date.");
  const { error } = await supabase.rpc("set_event_options", {
    p_session: sessionId,
    p_allow_pairs: form.get("allow_pairs") === "on",
    p_deadline: date ? zonedToUtc(date, time, str(form, "timezone") || "Asia/Bangkok").toISOString() : null,
  });
  if (error) back(path, friendly(error));
  refresh();
  back(path, "Event options saved.", "notice");
}

export async function addPriceTier(form: FormData) {
  const sessionId = str(form, "session_id");
  const path = `/sessions/${sessionId}#tickets`;
  const { supabase, org } = await requireSetup(path);
  const price = num(form, "price");
  if (price === null || price < 0) back(path, "Enter a price.");
  const date = str(form, "until_date");
  if (date && !isValidDate(date)) back(path, "Enter a valid date.");
  const { error } = await supabase.from("session_price_tiers").insert({
    org_id: org.id,
    session_id: sessionId,
    label: str(form, "label") || "Price",
    price,
    available_until: date ? zonedToUtc(date, str(form, "until_time") || "23:59", str(form, "timezone") || "Asia/Bangkok").toISOString() : null,
    max_qty: num(form, "max_qty"),
  });
  if (error) back(path, friendly(error));
  refresh();
  back(path, "Price added.", "notice");
}

export async function removePriceTier(form: FormData) {
  const sessionId = str(form, "session_id");
  const path = `/sessions/${sessionId}#tickets`;
  const { supabase } = await requireSetup(path);
  const { error } = await supabase.from("session_price_tiers").delete().eq("id", str(form, "tier_id"));
  if (error) back(path, friendly(error));
  refresh();
  back(path, "Price removed. People already signed up keep their price.", "notice");
}

export async function addDivision(form: FormData) {
  const sessionId = str(form, "session_id");
  const path = `/sessions/${sessionId}#tickets`;
  const { supabase, org } = await requireSetup(path);
  const places = num(form, "max_players");
  if (!places || places < 1) back(path, "Enter how many places the division has.");
  const { error } = await supabase.from("session_divisions").insert({
    org_id: org.id,
    session_id: sessionId,
    name: str(form, "name"),
    max_players: places,
    level_min: num(form, "level_min"),
    level_max: num(form, "level_max"),
  });
  if (error) back(path, error.code === "23505" ? "There's already a division with that name." : friendly(error));
  refresh();
  back(path, "Division added.", "notice");
}

export async function removeDivision(form: FormData) {
  const sessionId = str(form, "session_id");
  const path = `/sessions/${sessionId}#tickets`;
  const { supabase } = await requireSetup(path);
  const { count } = await supabase
    .from("session_registrations")
    .select("id", { count: "exact", head: true })
    .eq("division_id", str(form, "division_id"))
    .in("status", ["booked", "waitlisted", "requested"]);
  if (count) back(path, "People are signed up in this division. Cancel their places first.");
  const { error } = await supabase.from("session_divisions").delete().eq("id", str(form, "division_id"));
  if (error) back(path, friendly(error));
  refresh();
  back(path, "Division removed.", "notice");
}
