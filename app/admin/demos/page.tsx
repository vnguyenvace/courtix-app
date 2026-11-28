import Link from "next/link";
import { Banner, type SearchParams } from "@/components/Banner";
import { requirePlatform } from "@/lib/platform";
import { updateDemoRequest } from "../actions";

interface DemoRow {
  id: string;
  name: string;
  club_name: string;
  contact: string;
  email: string | null;
  sports: string[];
  courts: number | null;
  message: string | null;
  language: "en" | "th";
  status: "new" | "contacted" | "closed";
  note: string | null;
  created_at: string;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Demo requests from courtix.app (the landing page's Book a demo form). */
export default async function DemoRequestsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const showAll = sp.show === "all";
  const { supabase, t } = await requirePlatform(["super_admin", "support"]);
  let q = supabase.from("demo_requests").select("*").order("created_at", { ascending: false }).limit(200);
  if (!showAll) q = q.neq("status", "closed");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as DemoRow[];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Demo requests")}</h1>
          <p className="muted">{t("From the Book a demo form on courtix.app. Times are Thailand time.")}</p>
        </div>
        <div className="actions">
          {showAll ? <Link href="/admin/demos">{t("Open only")}</Link> : <Link href="/admin/demos?show=all">{t("Show closed too")}</Link>}
        </div>
      </div>
      <Banner sp={sp} />
      {rows.length === 0 && (
        <section className="card">
          <p className="muted">{t("No demo requests yet.")}</p>
        </section>
      )}
      {rows.map((r) => (
        <section key={r.id} className="card" style={{ marginBottom: 12, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
            <div>
              <strong>{r.club_name}</strong> · {r.name}
              <div className="muted small">
                {fmt(r.created_at)} · {r.language === "th" ? "ไทย" : "English"}
                {r.sports.length > 0 && ` · ${r.sports.join(", ")}`}
                {r.courts && ` · ${t("{n} courts", { n: r.courts })}`}
              </div>
            </div>
            <span className={`badge ${r.status === "new" ? "warn" : r.status === "contacted" ? "info" : ""}`}>{t(r.status)}</span>
          </div>
          <div>
            {r.contact}
            {r.email && <> · <a href={`mailto:${r.email}`}>{r.email}</a></>}
          </div>
          {r.message && <div style={{ whiteSpace: "pre-wrap" }}>{r.message}</div>}
          <form action={updateDemoRequest} className="form">
            <input type="hidden" name="id" value={r.id} />
            <div className="form-row">
              <label>
                {t("Status")}
                <select name="status" defaultValue={r.status}>
                  <option value="new">{t("New")}</option>
                  <option value="contacted">{t("Contacted")}</option>
                  <option value="closed">{t("Closed")}</option>
                </select>
              </label>
              <label>
                {t("Note")}
                <input name="note" defaultValue={r.note ?? ""} maxLength={2000} placeholder={t("e.g. Demo booked for Tuesday")} />
              </label>
            </div>
            <button style={{ justifySelf: "start" }}>{t("Save")}</button>
          </form>
        </section>
      ))}
    </>
  );
}
