"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, canManage } from "@/lib/org";
import { back, friendly, num, optStr, str } from "@/lib/form";
import { formatMoney, isValidDate, zonedToUtc } from "@/lib/time";

function refresh() {
  revalidatePath("/sessions", "layout");
  revalidatePath("/bookings");
  revalidatePath("/dashboard");
}

async function requireManager(path: string) {
  const ctx = await requireOrg();
  if (!canManage(ctx.role)) back(path, "Only owners and managers can do that.");
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
  });
  if (error) back(path, friendly(error));

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

// Sign-ups open this many days before each session (empty = any time).
export async function setSignupWindow(form: FormData) {
  const { supabase } = await requireManager("/sessions/setup");
  const { error } = await supabase
    .from("session_types")
    .update({ signup_opens_days: num(form, "signup_opens_days") })
    .eq("id", str(form, "type_id"));
  if (error) back("/sessions/setup", friendly(error));
  refresh();
  back("/sessions/setup", "Sign-up window saved.", "notice");
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
