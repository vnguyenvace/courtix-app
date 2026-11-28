"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { emailConfigured, sendEmail } from "@/lib/email";
import { str } from "@/lib/form";

// The landing page's "Book a demo" form (visitors, not signed in). The database function checks
// the fields and floods; the Courtix team is told by email (SALES_EMAIL) and sees it in Admin.

export async function requestDemo(form: FormData) {
  const lang = str(form, "lang") === "th" ? "th" : "en";
  const base = lang === "th" ? "/?lang=th" : "/?";
  const supabase = await createClient();
  const courts = Number(str(form, "courts"));
  const fields = {
    p_name: str(form, "name"),
    p_club: str(form, "club"),
    p_contact: str(form, "contact"),
    p_email: str(form, "email") || null,
    p_sports: form.getAll("sports").map(String),
    p_courts: Number.isInteger(courts) && courts > 0 ? courts : null,
    p_message: str(form, "message") || null,
    p_language: lang,
  };
  const { error } = await supabase.rpc("request_demo", fields);
  if (error) redirect(`${base}${lang === "th" ? "&" : ""}demo_error=${encodeURIComponent(error.message)}#demo`);

  const to = process.env.SALES_EMAIL;
  if (to && emailConfigured()) {
    const text = [
      `New demo request from courtix.app (${lang === "th" ? "Thai" : "English"} page)`,
      "",
      `Name: ${fields.p_name}`,
      `Club: ${fields.p_club}`,
      `Phone / LINE: ${fields.p_contact}`,
      fields.p_email ? `Email: ${fields.p_email}` : null,
      fields.p_sports.length ? `Sports: ${fields.p_sports.join(", ")}` : null,
      fields.p_courts ? `Courts: ${fields.p_courts}` : null,
      fields.p_message ? `\n${fields.p_message}` : null,
      "",
      "All requests: https://courtix.app/admin/demos",
    ]
      .filter((l) => l !== null)
      .join("\n");
    await sendEmail(to, `Demo request: ${fields.p_club}`, text).catch((e) => console.error("Demo request email failed", e));
  }
  redirect(`${base}${lang === "th" ? "&" : ""}sent=1#demo`);
}
