"use server";

import { revalidatePath } from "next/cache";
import { requireOrg, canManage } from "@/lib/org";
import { back, friendly, str } from "@/lib/form";
import { LOGO_MAX_BYTES, normalizeSlip } from "@/lib/logo";

// Recording money the club received (Step 3). Orders are created by the database for every
// paid thing; staff mark them paid here, on the session roster or on the member page.

const METHODS = ["cash", "transfer", "promptpay", "card", "other"];

/** Pages that send return_to (so the desk stays where it was). */
function pageOf(form: FormData) {
  const to = str(form, "return_to");
  return /^\/(payments|sessions\/[0-9a-f-]{36}|members\/[0-9a-f-]{36})(\?[a-z=&]*)?$/.test(to) ? to : "/payments";
}

function refresh() {
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/morning");
}

export async function markPaid(form: FormData) {
  const { supabase, org } = await requireOrg();
  const page = pageOf(form);
  const orderId = str(form, "order_id");
  const method = str(form, "method");
  if (!METHODS.includes(method)) back(page, "Choose how it was paid.");

  // Optional transfer slip photo, kept privately for this club.
  let slipPath: string | null = null;
  const file = form.get("slip");
  if (file instanceof File && file.size > 0) {
    if (file.size > LOGO_MAX_BYTES) back(page, "That photo is over 4 MB. Try a smaller one.");
    let jpg: Buffer;
    try {
      jpg = await normalizeSlip(Buffer.from(await file.arrayBuffer()));
    } catch {
      back(page, "That file couldn't be read as a photo. Try a JPG or PNG.");
    }
    slipPath = `${org.id}/${orderId}-${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage.from("payment-slips").upload(slipPath, jpg, { contentType: "image/jpeg" });
    if (upErr) back(page, friendly(upErr));
  }

  const { error } = await supabase.rpc("mark_order_paid", {
    p_order: orderId,
    p_method: method,
    p_note: str(form, "note") || null,
    p_slip: slipPath,
  });
  if (error) back(page, friendly(error));
  refresh();
  revalidatePath(page.split("?")[0]);
  back(page, "Marked as paid.", "notice");
}

export async function markUnpaid(form: FormData) {
  const { supabase, role } = await requireOrg();
  const page = pageOf(form);
  if (!canManage(role)) back(page, "Only an owner or manager can undo a payment.");
  const { error } = await supabase.rpc("mark_order_unpaid", { p_order: str(form, "order_id") });
  if (error) back(page, friendly(error));
  refresh();
  back(page, "Payment undone. It's back on the list to pay.", "notice");
}

export async function resolveRefund(form: FormData) {
  const { supabase, role } = await requireOrg();
  const page = pageOf(form);
  if (!canManage(role)) back(page, "Only an owner or manager can decide about refunds.");
  const refunded = str(form, "refunded") === "true";
  const { error } = await supabase.rpc("resolve_refund", {
    p_order: str(form, "order_id"),
    p_refunded: refunded,
    p_note: str(form, "note") || null,
  });
  if (error) back(page, friendly(error));
  refresh();
  back(page, refunded ? "Marked as refunded." : "Kept: no refund.", "notice");
}
