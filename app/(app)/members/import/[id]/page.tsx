import Link from "next/link";
import { notFound } from "next/navigation";
import { Banner, param, type SearchParams } from "@/components/Banner";
import { requirePermission } from "@/lib/org";
import { friendly } from "@/lib/form";
import { guessMapping, IMPORT_FIELDS, type ImportField } from "@/lib/importFields";
import { runImport } from "../actions";

export const metadata = { title: "Check the import" };

interface RowResult {
  row: number;
  status: "ok" | "skip" | "error";
  message: string | null;
  name: string | null;
  phone: string | null;
  package: string | null;
}

export default async function ImportPreviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, t, locale } = await requirePermission("club.setup", "/members");
  const { data: imp } = await supabase
    .from("member_imports")
    .select("id, file_name, headers, rows, imported_at")
    .eq("id", id)
    .maybeSingle();
  if (!imp) notFound();
  if (imp.imported_at) {
    return (
      <>
        <Link href="/members/import" className="small">{t("← Import members")}</Link>
        <h1>{t("Already imported")}</h1>
        <p className="muted">{t("This file was imported.")}{" "}<Link href="/members">{t("See your members")}</Link>.</p>
      </>
    );
  }
  const headers = imp.headers as string[];
  const rows = imp.rows as string[][];

  // The mapping: from the form (after "Check again"), else a guess from the column names.
  const chosen = IMPORT_FIELDS.some((f) => param(sp, `map_${f.key}`) !== undefined);
  const mapping: Partial<Record<ImportField, number>> = {};
  if (chosen) {
    for (const f of IMPORT_FIELDS) {
      const v = param(sp, `map_${f.key}`) ?? "";
      if (/^\d+$/.test(v) && Number(v) < headers.length) mapping[f.key] = Number(v);
    }
  } else Object.assign(mapping, guessMapping(headers));
  const hasName = mapping.full_name !== undefined || mapping.first_name !== undefined;

  const { data, error } = hasName
    ? await supabase.rpc("import_members", { p_import: id, p_mapping: mapping })
    : { data: null, error: null };
  const result = data as { counts: { rows: number; ok: number; skip: number; error: number }; rows: RowResult[] } | null;
  const problems = result?.rows.filter((r) => r.status === "error") ?? [];
  const skipped = result?.rows.filter((r) => r.status === "skip") ?? [];
  const okRows = result?.rows.filter((r) => r.status === "ok") ?? [];
  const noted = okRows.filter((r) => r.message);
  const sample = (i: number) => rows.map((r) => r[i]).find((v) => v && v.trim()) ?? "";

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/members/import" className="small">{t("← Import members")}</Link>
          <h1>{t("Check the import")}</h1>
          <p className="muted">{imp.file_name ?? t("File")} · {t("{n} rows. Nothing is saved until you press Import.", { n: rows.length })}</p>
        </div>
      </div>
      <Banner sp={sp} />

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>{t("2. Match your columns")}</h2>
        <p className="muted small" style={{ marginBottom: 8 }}>{t("We guessed from the column names. Change any that are wrong, then check again.")}</p>
        <form method="get" className="form">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
            {IMPORT_FIELDS.map((f) => (
              <label key={f.key} style={{ minWidth: 0 }}>
                {t(f.label)}
                <select name={`map_${f.key}`} style={{ width: "100%" }} defaultValue={mapping[f.key] !== undefined ? String(mapping[f.key]) : ""}>
                  <option value="">{t("Not in my file")}</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                      {sample(i) ? ` (e.g. ${sample(i).slice(0, 24)})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="actions">
            <button>{t("Check again")}</button>
          </div>
        </form>
      </section>

      {!hasName ? (
        <section className="card">
          <p>{t("Choose the column with the member's name (or first and last name) to continue.")}</p>
        </section>
      ) : error ? (
        <div className="banner error">{friendly(error)}</div>
      ) : result && (
        <>
          <div className="stats" style={{ marginBottom: 16 }}>
            <div className="stat"><div className="label">{t("Ready to import")}</div><div className="value">{result.counts.ok}</div></div>
            <div className="stat"><div className="label">{t("Already members")}</div><div className="value">{result.counts.skip}</div></div>
            <div className="stat"><div className="label">{t("With problems")}</div><div className="value">{result.counts.error}</div></div>
          </div>

          {problems.length > 0 && (
            <section className="card" style={{ marginBottom: 16 }}>
              <h2>{t("Rows with problems ({n})", { n: problems.length })}</h2>
              <p className="muted small" style={{ marginBottom: 8 }}>{t("Fix these in your file and upload it again, or leave them out below.")}</p>
              <ul className="list small">
                {problems.map((r) => (
                  <li key={r.row}>
                    <span><strong>{t("Row {row}", { row: r.row })}</strong> · {r.name || "no name"}</span>
                    <span className="danger-text" style={{ color: "var(--danger)" }}>{r.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {skipped.length > 0 && (
            <section className="card" style={{ marginBottom: 16 }}>
              <details>
                <summary>{t("Already members, skipped ({length})", { length: skipped.length })}</summary>
                <ul className="list small" style={{ marginTop: 8 }}>
                  {skipped.map((r) => (
                    <li key={r.row}><span>{t("Row {row} · {name} · {phone}", { row: r.row, name: r.name, phone: r.phone })}</span><span className="muted">{r.message}</span></li>
                  ))}
                </ul>
              </details>
            </section>
          )}

          {okRows.length > 0 && (
            <section className="card" style={{ marginBottom: 16 }}>
              <h2>{t("Ready to import ({length})", { length: okRows.length })}</h2>
              {noted.length > 0 && (
                <ul className="list small" style={{ marginBottom: 8 }}>
                  {noted.slice(0, 30).map((r) => (
                    <li key={r.row}><span>{t("Row {row} · {name}", { row: r.row, name: r.name })}</span><span className="muted">{r.message}</span></li>
                  ))}
                </ul>
              )}
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t("Row")}</th><th>{t("Name")}</th><th>{t("Phone")}</th><th>{t("Package")}</th></tr></thead>
                  <tbody>
                    {okRows.slice(0, 15).map((r) => (
                      <tr key={r.row}><td>{r.row}</td><td>{r.name}</td><td>{r.phone ?? "—"}</td><td>{r.package ?? "—"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {okRows.length > 15 && <p className="muted small">{t("…and {n} more.", { n: okRows.length - 15 })}</p>}
            </section>
          )}

          {okRows.length > 0 && (
            <section className="card">
              <h2>{t("3. Import")}</h2>
              <form action={runImport} className="form">
                <input type="hidden" name="import_id" value={id} />
                {Object.entries(mapping).map(([k, v]) => (
                  <input key={k} type="hidden" name={`map_${k}`} value={String(v)} />
                ))}
                {problems.length > 0 && (
                  <label className="check">
                    <input type="checkbox" name="skip_bad" required />
                    <span>{t("Leave out the {length} rows with problems and import the other {length2}", { length: problems.length, length2: okRows.length })}</span>
                  </label>
                )}
                {mapping.marketing_consent !== undefined && (
                  <p className="muted small">
                    {t("Members marked \"yes\" for consent will get offers and AI follow-ups. Only import consent the club actually has on record (Thailand's PDPA).")}
                  </p>
                )}
                <p className="muted small">
                  {t("Everything goes in together, or nothing does. Packages count as already paid: nothing is added to Payments.")}
                </p>
                <div className="actions">
                  <button className="primary">{okRows.length === 1 ? t("Import 1 member") : t("Import {n} members", { n: okRows.length })}</button>
                </div>
              </form>
            </section>
          )}
        </>
      )}
    </>
  );
}
