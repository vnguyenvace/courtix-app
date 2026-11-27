import Link from "next/link";
import { Banner, type SearchParams } from "@/components/Banner";
import { requirePermission } from "@/lib/org";
import { IMPORT_FIELDS } from "@/lib/importFields";
import { discardImport, uploadImport } from "./actions";

export const metadata = { title: "Import members" };

export default async function ImportMembersPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, t, locale } = await requirePermission("club.setup", "/members");
  const { data } = await supabase
    .from("member_imports")
    .select("id, file_name, created_at, imported_at, result")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .limit(10);
  const past = (data ?? []) as { id: string; file_name: string | null; created_at: string; imported_at: string | null; result: { imported: number; skipped: number; left_out: number } | null }[];
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { timeZone: org.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/members" className="small">{t("← Members")}</Link>
          <h1>{t("Import members")}</h1>
          <p className="muted">{t("From Excel or Google Sheets. You see every row before anything is saved.")}</p>
        </div>
      </div>
      <Banner sp={sp} />

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>{t("1. Upload the file")}</h2>
        <form action={uploadImport} className="form">
          <label>
            {t("Excel (.xlsx) or CSV file")}
            <input type="file" name="file" required accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
          </label>
          <div className="actions">
            <button className="primary">{t("Upload and check")}</button>
          </div>
          <p className="muted small">
            {t("One member per row, with column names in the first row. Up to 2,000 rows. From Google Sheets: File → Download → .xlsx or .csv. Only the first sheet is read.")}
          </p>
        </form>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>{t("Columns Courtix understands")}</h2>
        <p className="muted small" style={{ marginBottom: 8 }}>{t("Only a name is needed. You match your columns to these on the next page.")}</p>
        <ul className="list small">
          {IMPORT_FIELDS.map((f) => (
            <li key={f.key}>
              <strong>{t(f.label)}</strong>
              {f.hint && <span className="muted"> · {t(f.hint)}</span>}
            </li>
          ))}
        </ul>
        <p className="muted small" style={{ marginTop: 8 }}>
          {t("Packages in the file count as already paid: nothing is added to Payments. Members with the same phone number as someone already in Courtix are skipped.")}
        </p>
      </section>

      {past.length > 0 && (
        <section className="card">
          <h2>{t("Earlier uploads")}</h2>
          <ul className="list">
            {past.map((p) => (
              <li key={p.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
                <span>
                  {p.file_name ?? t("File")} <span className="muted small">· {when(p.created_at)}</span>
                  <div className="muted small">
                    {p.imported_at
                      ? [
                          t("Imported {when}: {n} added", { when: when(p.imported_at), n: p.result?.imported ?? 0 }),
                          p.result?.skipped ? t("{n} skipped", { n: p.result.skipped }) : "",
                          p.result?.left_out ? t("{n} left out", { n: p.result.left_out }) : "",
                        ].filter(Boolean).join(", ")
                      : t("Not imported yet")}
                  </div>
                </span>
                {!p.imported_at && (
                  <span className="actions">
                    <Link href={`/members/import/${p.id}`}>{t("Continue")}</Link>
                    <form action={discardImport} className="inline">
                      <input type="hidden" name="import_id" value={p.id} />
                      <button className="link">{t("Remove")}</button>
                    </form>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
