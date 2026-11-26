import { redirect } from "next/navigation";

// Small helpers for server actions that work without client-side JavaScript.

export function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function optStr(form: FormData, key: string): string | null {
  const v = str(form, key);
  return v === "" ? null : v;
}

export function num(form: FormData, key: string): number | null {
  const v = str(form, key);
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Go back to a page with a message shown in a banner. */
export function back(path: string, message: string, kind: "error" | "notice" = "error"): never {
  // "/settings#branding": the message goes before the #, so the page still scrolls to the section.
  const [base, hash] = path.split("#", 2);
  const sep = base.includes("?") ? "&" : "?";
  redirect(`${base}${sep}${kind}=${encodeURIComponent(message)}${hash ? `#${hash}` : ""}`);
}

/** Turns database errors into something a front-desk person can read. */
export function friendly(error: { message: string; code?: string } | null): string {
  if (!error) return "Something went wrong. Try again.";
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    return "You don't have permission to do that. Staff can only make changes at their own location.";
  }
  if (error.code === "23505") return "That already exists.";
  return error.message;
}
