import Link from "next/link";
import { Banner, type SearchParams } from "@/components/Banner";
import { requirePlatform } from "@/lib/platform";
import { replyToRequest } from "../actions";

interface RequestRow {
  id: string;
  club_name: string;
  club_slug: string;
  created_by_email: string | null;
  message: string;
  contact: string | null;
  status: "open" | "closed";
  reply: string | null;
  replied_at: string | null;
  closed_at: string | null;
  created_at: string;
  support_until: string | null;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function AdminHelpPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const showAll = sp.show === "all";
  const { supabase, host, t, locale } = await requirePlatform(["super_admin", "support"]);
  const { data, error } = await supabase.rpc("platform_support_requests", { p_status: showAll ? null : "open" });
  if (error) throw new Error(error.message);
  const requests = (data ?? []) as RequestRow[];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Help requests")}</h1>
          <p className="muted">{t("From club staff, via Get help in their club. Times are Thailand time.")}</p>
        </div>
        <div className="actions">
          {showAll ? <Link href="/admin/help">{t("Open only")}</Link> : <Link href="/admin/help?show=all">{t("Show closed too")}</Link>}
        </div>
      </div>
      <Banner sp={sp} />

      {requests.length === 0 && (
        <section className="card">
          <p className="muted">{showAll ? t("No help requests yet.") : t("Nothing open. All caught up.")}</p>
        </section>
      )}

      {requests.map((r) => (
        <section key={r.id} className="card" style={{ marginBottom: 12, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
            <div>
              <strong>{r.club_name}</strong>
              <div className="muted small">
                {fmt(r.created_at)} · {r.created_by_email ?? t("club staff")}
                {r.contact && ` · ${t("reach them on {contact}", { contact: r.contact })}`}
              </div>
            </div>
            <div className="small" style={{ textAlign: "right" }}>
              {r.status === "closed" ? (
                <span className="muted">{t("Closed")}{r.closed_at ? ` ${fmt(r.closed_at)}` : ""}</span>
              ) : r.support_until ? (
                <>
                  {t("Access until {fmt}", { fmt: fmt(r.support_until) })}
                  <div>
                    <a href={host.clubUrl(r.club_slug, "/dashboard")}>{t("Open club (read only)")}</a>
                  </div>
                </>
              ) : (
                <span className="muted">{t("No access allowed. Ask the owner if you need to look.")}</span>
              )}
            </div>
          </div>
          <div style={{ whiteSpace: "pre-wrap" }}>{r.message}</div>
          {r.reply && (
            <div className="card" style={{ padding: 10, whiteSpace: "pre-wrap" }}>
              <div className="muted small">{t("Your reply")}{r.replied_at ? ` · ${fmt(r.replied_at)}` : ""}</div>
              {r.reply}
            </div>
          )}
          {r.status === "open" && (
            <form action={replyToRequest} className="form">
              <input type="hidden" name="request_id" value={r.id} />
              <label>
                {r.reply ? t("Reply again (replaces the reply above)") : t("Reply")}
                <textarea name="reply" rows={3} maxLength={2000} placeholder={t("What you found or fixed, and what they should do")} />
              </label>
              <label className="check">
                <input type="checkbox" name="close" />{" "}{t("Close the request")}
              </label>
              <div className="actions">
                <button className="primary">{t("Send reply")}</button>
                <button name="intent" value="close" className="link">{t("Close without reply")}</button>
              </div>
              <p className="muted small">{t("The reply shows on the club's Get help page and is emailed to {email}.", { email: r.created_by_email ?? t("them") })}</p>
            </form>
          )}
        </section>
      ))}
    </>
  );
}
