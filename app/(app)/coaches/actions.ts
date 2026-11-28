"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/org";
import { back, friendly, num, optStr, str } from "@/lib/form";
import { isValidDate, zonedToUtc } from "@/lib/time";
import { confirmationNote, sendPendingNotices } from "@/lib/notices";

const PATH = "/coaches";

function done(message: string, path = PATH): never {
  revalidatePath(PATH);
  revalidatePath("/bookings");
  back(path, message, "notice");
}

export async function addCoach(form: FormData) {
  const { supabase, org } = await requirePermission("club.setup", PATH);
  const ids = form.getAll("location_ids").map(String);
  const { error } = await supabase.from("coaches").insert({
    org_id: org.id,
    name: str(form, "name"),
    phone: optStr(form, "phone"),
    about: optStr(form, "about"),
    location_ids: ids.length ? ids : null,
  });
  if (error) back(PATH, error.code === "23505" ? "There's already a coach with that name." : friendly(error));
  done(`${str(form, "name")} added. Now set their lesson prices below.`);
}

export async function updateCoach(form: FormData) {
  const { supabase } = await requirePermission("club.setup", PATH);
  const ids = form.getAll("location_ids").map(String);
  const { error } = await supabase
    .from("coaches")
    .update({
      name: str(form, "name"),
      phone: optStr(form, "phone"),
      about: optStr(form, "about"),
      location_ids: ids.length ? ids : null,
      is_active: form.get("is_active") === "on",
    })
    .eq("id", str(form, "coach_id"));
  if (error) back(PATH, error.code === "23505" ? "There's already a coach with that name." : friendly(error));
  done("Coach saved.");
}

export async function addRate(form: FormData) {
  const { supabase, org } = await requirePermission("club.setup", PATH);
  const price = num(form, "price");
  const minutes = num(form, "minutes");
  const size = num(form, "group_size");
  if (price === null || price < 0) back(PATH + "#prices", "Enter a price.");
  if (!minutes || !size) back(PATH + "#prices", "Choose the length and the number of people.");
  const { error } = await supabase.from("lesson_rates").upsert(
    { org_id: org.id, coach_id: optStr(form, "coach_id"), minutes, group_size: size, price },
    { onConflict: "org_id,coach_id,minutes,group_size" },
  );
  if (error) back(PATH + "#prices", friendly(error));
  done("Price saved.", PATH + "#prices");
}

export async function deleteRate(form: FormData) {
  const { supabase } = await requirePermission("club.setup", PATH);
  const { error } = await supabase.from("lesson_rates").delete().eq("id", str(form, "rate_id"));
  if (error) back(PATH + "#prices", friendly(error));
  done("Price removed.", PATH + "#prices");
}

export async function bookLesson(form: FormData) {
  const { supabase, org, locations, workLocation } = await requirePermission("bookings.manage", PATH);
  const court = optStr(form, "court_id");
  const loc = locations.find((l) => l.id === str(form, "location_id")) ?? workLocation;
  const date = str(form, "date");
  const time = str(form, "time");
  if (!isValidDate(date) || !/^\d{2}:\d{2}$/.test(time)) back(PATH, "Choose a date and time.");
  const { data: lessonId, error } = await supabase.rpc("book_lesson", {
    p_coach: str(form, "coach_id"),
    p_start: zonedToUtc(date, time, loc.timezone).toISOString(),
    p_minutes: num(form, "minutes"),
    p_group_size: num(form, "group_size"),
    p_court: court,
    p_location: court ? null : loc.id,
    p_member: optStr(form, "member_id"),
    p_guest_name: optStr(form, "guest_name"),
    p_notes: optStr(form, "notes"),
  });
  if (error) back(PATH, friendly(error));
  await sendPendingNotices(supabase, org.id); // the member's confirmation (LINE when linked)
  const note = await confirmationNote(supabase, `confirmed:court:${lessonId}`);
  done("Lesson booked. It's on the court calendar, and the payment is in Payments." + note);
}
