import { Banner, type SearchParams } from "@/components/Banner";
import { requireOrg } from "@/lib/org";
import { askForHelp, closeRequest } from "./actions";

interface RequestRow {
  id: string;
  created_by_email: string | null;
  message: string;
  contact: string | null;
  grant_id: string | null;
  status: "open" | "closed";
  reply: string | null;
  replied_at: string | null;
  created_at: string;
}

export default async function HelpPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, can, role, t, locale } = await requireOrg();
  const owner = can("staff.manage");

  const [{ data, error }, { data: grantData }] = await Promise.all([
    supabase
      .from("support_requests")
      .select("id, created_by_email, message, contact, grant_id, status, reply, replied_at, created_at")
      .eq("org_id", org.id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("support_grants")
      .select("expires_at")
      .eq("org_id", org.id)
      .is("ended_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  const requests = (data ?? []) as RequestRow[];
  const grant = grantData as { expires_at: string } | null;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { timeZone: org.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Get help")}</h1>
          <p className="muted">{t("Tell the Courtix team what's wrong or what you need. We reply here and by email.")}</p>
        </div>
      </div>
      <Banner sp={sp} />

      {role !== "support" && (
        <section className="card" style={{ marginBottom: 16 }}>
          <form action={askForHelp} className="form">
            <label>
              {t("What's wrong, or what do you need?")}
              <textarea
                name="message"
                required
                maxLength={2000}
                rows={5}
                placeholder={t("Members say the booking page shows the wrong price for evening courts")}
              />
            </label>
            <label>
              {t("Best way to reach you (optional)")}
              <input name="contact" maxLength={200} placeholder={t("LINE ID or phone number")} />
            </label>
            {owner &&
              (grant ? (
                <p className="muted small">{t("Courtix support can already look at your club until {when}.", { when: when(grant.expires_at) })}</p>
              ) : (
                <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 6 }}>
                  <label className="check">
                    <input type="checkbox" name="allow" defaultChecked />{" "}{t("Let Courtix support look at the club (read only)")}
                  </label>
                  <label>
                    {t("For")}
                    <select name="hours" defaultValue="24">
                      <option value="2">{t("2 hours")}</option>
                      <option value="24">{t("24 hours")}</option>
                      <option value="72">{t("3 days")}</option>
                      <option value="168">{t("7 days")}</option>
                    </select>
                  </label>
                  <p className="muted small">
                    {t("It helps us see the problem. We can only look, not change anything, and every page we open is listed on your Staff page. You can end it there any time.")}
                  </p>
                </fieldset>
              ))}
            {!owner && (
              <p className="muted small">
                {t("If we need to look at your club's data, the owner will be asked to allow it.")}
              </p>
            )}
            <div className="actions">
              <button className="primary">{t("Send to Courtix")}</button>
            </div>
          </form>
        </section>
      )}

      {requests.length > 0 && (
        <section className="card">
          <h2>{t("Your club's requests")}</h2>
          <ul className="list">
            {requests.map((r) => (
              <li key={r.id} style={{ display: "grid", gap: 6 }}>
                <div className="muted small">
                  {when(r.created_at)} · {r.created_by_email ?? "staff"} · {r.status === "open" ? (r.reply ? "answered" : t("waiting for Courtix")) : "solved"}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{r.message}</div>
                {r.reply && (
                  <div className="card" style={{ padding: 10, whiteSpace: "pre-wrap" }}>
                    <div className="muted small">{t("Courtix support")}{r.replied_at ? ` · ${when(r.replied_at)}` : ""}</div>
                    {r.reply}
                  </div>
                )}
                {r.status === "open" && role !== "support" && (
                  <form action={closeRequest} className="inline">
                    <input type="hidden" name="request_id" value={r.id} />
                    <button className="link">{t("Mark as solved")}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
