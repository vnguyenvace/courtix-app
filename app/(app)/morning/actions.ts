"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/org";
import { back, friendly, str } from "@/lib/form";

/** A notice staff sent by hand (or decided not to send). */
export async function markNoticeDone(form: FormData) {
  const { supabase } = await requireOrg();
  const status = str(form, "skip") === "true" ? "skipped" : "done";
  const { error } = await supabase
    .from("member_notices")
    .update({ status, sent_at: status === "done" ? new Date().toISOString() : null })
    .eq("id", str(form, "notice_id"))
    .in("status", ["manual", "failed"]);
  if (error) back("/morning", friendly(error));
  revalidatePath("/morning");
  back("/morning", status === "done" ? "Marked as sent." : "Skipped.", "notice");
}
