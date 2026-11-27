"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/org";
import { back, friendly, str } from "@/lib/form";
import { readSpreadsheet, SheetError, type Sheet } from "@/lib/spreadsheet";
import { IMPORT_FIELDS } from "@/lib/importFields";

const PATH = "/members/import";
const MAX_BYTES = 3 * 1024 * 1024;

/** Upload a CSV or Excel file: read it into rows and go to the preview. Nothing is imported yet. */
export async function uploadImport(form: FormData) {
  const { supabase, org } = await requirePermission("club.setup", PATH);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) back(PATH, "Choose a CSV or Excel file.");
  if (file.size > MAX_BYTES) back(PATH, "That file is over 3 MB. Remove extra sheets or columns, or save it as CSV.");
  let sheet: Sheet;
  try {
    sheet = readSpreadsheet(file.name, Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    back(PATH, e instanceof SheetError ? e.message : "That file can't be read. Save it as .xlsx or CSV and try again.");
  }
  const { data, error } = await supabase
    .from("member_imports")
    .insert({ org_id: org.id, file_name: file.name.slice(0, 200), headers: sheet.headers, rows: sheet.rows })
    .select("id")
    .single();
  if (error) back(PATH, friendly(error));
  redirect(`${PATH}/${data.id}`);
}

/** The column mapping from the preview form: {"full_name": 0, ...} for the columns that were chosen. */
function mappingFrom(form: FormData) {
  const map: Record<string, number> = {};
  for (const f of IMPORT_FIELDS) {
    const v = str(form, `map_${f.key}`);
    if (v !== "" && /^\d+$/.test(v)) map[f.key] = Number(v);
  }
  return map;
}

/** Import every good row, in one go (the database refuses if there are problems and they weren't left out). */
export async function runImport(form: FormData) {
  const { supabase } = await requirePermission("club.setup", PATH);
  const id = str(form, "import_id");
  const mapping = mappingFrom(form);
  const qs = new URLSearchParams(Object.entries(mapping).map(([k, v]) => [k, String(v)]));
  const { data, error } = await supabase.rpc("import_members", {
    p_import: id,
    p_mapping: mapping,
    p_commit: true,
    p_skip_bad: form.get("skip_bad") === "on",
  });
  if (error) back(`${PATH}/${id}?${qs}`, friendly(error));
  const c = (data as { counts: { ok: number; skip: number; error: number } }).counts;
  revalidatePath("/members");
  revalidatePath("/dashboard");
  const parts = [`${c.ok} ${c.ok === 1 ? "member" : "members"} imported`];
  if (c.skip) parts.push(`${c.skip} already here, skipped`);
  if (c.error) parts.push(`${c.error} left out`);
  back("/members", parts.join(", ") + ".", "notice");
}

export async function discardImport(form: FormData) {
  const { supabase } = await requirePermission("club.setup", PATH);
  await supabase.from("member_imports").delete().eq("id", str(form, "import_id")).is("imported_at", null);
  revalidatePath(PATH);
  back(PATH, "Upload removed.", "notice");
}
