"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, canManage } from "@/lib/org";
import { back, friendly, num, optStr, str } from "@/lib/form";
import { isValidDate, zonedToUtc } from "@/lib/time";
import type { BookingKind, MessageChannel } from "@/lib/types";

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

  const { error } = await supabase.rpc("sell_membership", {
    p_member: memberId,
    p_package: str(form, "package_id"),
    p_starts_on: isValidDate(startsOn) ? startsOn : null,
    p_price: price,
  });

  if (error) back(path, friendly(error));
  revalidatePath(path);
  back(path, "Package sold.", "notice");
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
  const { supabase, locations, workLocation } = await requireOrg();
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
  revalidatePath("/bookings");
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
  if (!canManage(ctx.role)) back("/settings", "Only owners and managers can change settings.");
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
