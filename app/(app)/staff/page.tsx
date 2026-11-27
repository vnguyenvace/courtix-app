import type { T } from "@/lib/i18n";
import { cookies } from "next/headers";
import { Banner, type SearchParams } from "@/components/Banner";
import { CopyButton } from "@/components/CopyButton";
import { requirePermission } from "@/lib/org";
import { INVITE_LINK_COOKIE, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from "@/lib/permissions";
import type { Location, StaffRole } from "@/lib/types";
import { allowSupport, cancelInvite, endSupport, inviteStaff, removeStaff, renewInvite, updateStaff } from "./actions";

interface StaffRow {
  user_id: string;
  email: string;
  role: StaffRole;
  location_ids: string[] | null;
  created_at: string;
}

interface InviteRow {
  id: string;
  email: string;
  role: StaffRole;
  location_ids: string[] | null;
  expires_at: string;
}


function Locations({ locations, chosen, role, t }: { locations: Location[]; chosen: string[] | null; role?: StaffRole; t: T }) {
  if (role === "owner" || role === "manager") return null;
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="small muted" style={{ marginBottom: 6 }}>
        {t("Works at (leave all unticked for every location; owners and admins always have every location)")}
      </legend>
      <div className="actions">
        {locations.map((l) => (
          <label key={l.id} className="check">
            <input type="checkbox" name="location_ids" value={l.id} defaultChecked={chosen?.includes(l.id) ?? false} /> {l.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default async function StaffPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, userId, locations, multiLocation, t, locale } = await requirePermission("staff.manage");
  const active = locations.filter((l) => l.is_active);
  const locName = new Map(locations.map((l) => [l.id, l.name]));

  const [{ data: staffData, error }, { data: inviteData }, { data: grantData }, { data: logData }] = await Promise.all([
    supabase.rpc("club_staff", { p_org: org.id }),
    supabase
      .from("staff_invites")
      .select("id, email, role, location_ids, expires_at")
      .eq("org_id", org.id)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("support_grants")
      .select("expires_at, note")
      .eq("org_id", org.id)
      .is("ended_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("support_access_log")
      .select("id, email, path, viewed_at")
      .eq("org_id", org.id)
      .order("viewed_at", { ascending: false })
      .limit(30),
  ]);
  const grant = grantData as { expires_at: string; note: string | null } | null;
  const supportLog = (logData ?? []) as { id: number; email: string | null; path: string | null; viewed_at: string }[];
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { timeZone: org.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  if (error) throw new Error(error.message);
  const staff = (staffData ?? []) as StaffRow[];
  const invites = (inviteData ?? []) as InviteRow[];

  let justInvited: { email: string; link: string; emailed: boolean } | null = null;
  try {
    const raw = (await cookies()).get(INVITE_LINK_COOKIE)?.value;
    if (raw) justInvited = JSON.parse(raw);
  } catch {
    justInvited = null;
  }
  const where = (ids: string[] | null) => (ids ? ids.map((id) => locName.get(id) ?? "?").join(", ") : t("All locations"));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Staff and roles")}</h1>
          <p className="muted">{t("Who can sign in to {name}, and what each person can do.", { name: org.name })}</p>
        </div>
      </div>
      <Banner sp={sp} />

      {justInvited && invites.some((i) => i.email === justInvited!.email) && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2>{t("Invite link for {email}", { email: justInvited.email })}</h2>
          <p className="muted small">
            {justInvited.emailed ? (t("We emailed this link. You can also send it on LINE or WhatsApp.") + " ") : (t("Send this link on LINE, WhatsApp or email.") + " ")}
            {t("It works for 7 days, only for {email}. It's shown here only for a few minutes; make a new link any time below.", { email: justInvited.email })}
          </p>
          <div className="form" style={{ marginTop: 8 }}>
            <textarea id="invite-link" readOnly rows={2} defaultValue={justInvited.link} />
            <div className="actions">
              <CopyButton targetId="invite-link" />
            </div>
          </div>
        </section>
      )}

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>{t("Staff")}</h2>
        <ul className="list">
          {staff.map((s) => (
            <li key={s.user_id} style={{ display: "grid", gap: 8 }}>
              <div>
                <strong>{s.email}</strong>
                {s.user_id === userId && <span className="muted small">{" "}{t("(you)")}</span>}
                <div className="muted small">
                  {t(ROLE_LABELS[s.role])}
                  {multiLocation && ` · ${s.role === "owner" || s.role === "manager" ? t("All locations") : where(s.location_ids)}`}
                  {` · ${t("since {date}", { date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(s.created_at)) })}`}
                </div>
              </div>
              <details>
                <summary className="small">{t("Change role")}</summary>
                <form action={updateStaff} className="form" style={{ marginTop: 8 }}>
                  <input type="hidden" name="user_id" value={s.user_id} />
                  <label>
                    {t("Role")}
                    <select name="role" defaultValue={s.role}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{t(ROLE_LABELS[r])}</option>
                      ))}
                    </select>
                  </label>
                  {multiLocation && <Locations locations={active} chosen={s.location_ids} t={t} />}
                  <div className="actions">
                    <button>{t("Save")}</button>
                  </div>
                </form>
                <form action={removeStaff} className="form" style={{ marginTop: 8 }}>
                  <input type="hidden" name="user_id" value={s.user_id} />
                  <button className="danger">{s.user_id === userId ? t("Leave this club") : t("Remove from staff")}</button>
                </form>
              </details>
            </li>
          ))}
        </ul>
      </section>

      {invites.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2>{t("Waiting to join")}</h2>
          <ul className="list">
            {invites.map((i) => {
              const expired = new Date(i.expires_at).getTime() < Date.now();
              return (
                <li key={i.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong>{i.email}</strong>
                    <div className="muted small">
                      {t(ROLE_LABELS[i.role])}
                      {multiLocation && ` · ${where(i.location_ids)}`}
                      {" · "}
                      {expired ? t("link expired") : t("link works until {date}", { date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(i.expires_at)) })}
                    </div>
                  </div>
                  <div className="actions">
                    <form action={renewInvite} className="inline">
                      <input type="hidden" name="invite_id" value={i.id} />
                      <button>{t("New link")}</button>
                    </form>
                    <form action={cancelInvite} className="inline">
                      <input type="hidden" name="invite_id" value={i.id} />
                      <button className="link">{t("Cancel")}</button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>{t("Add someone")}</h2>
        <form action={inviteStaff} className="form">
          <label>
            {t("Email")}
            <input name="email" type="email" required autoComplete="off" placeholder="nong@yourclub.com" />
          </label>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
            <legend className="small muted" style={{ marginBottom: 6 }}>{t("Role")}</legend>
            {ROLES.map((r) => (
              <label key={r} className="check" style={{ alignItems: "flex-start" }}>
                <input type="radio" name="role" value={r} defaultChecked={r === "front_desk"} />
                <span>
                  <strong>{t(ROLE_LABELS[r])}</strong>
                  <span className="muted small" style={{ display: "block" }}>{t(ROLE_DESCRIPTIONS[r])}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {multiLocation && <Locations locations={active} chosen={null} t={t} />}
          <div className="actions">
            <button className="primary">{t("Add to staff")}</button>
          </div>
          <p className="muted small">
            {t("They get a link to join. They sign in, or create an account, with this email address. Location limits don't apply to owners and admins.")}
          </p>
        </form>
      </section>

      <section className="card" id="support">
        <h2>{t("Courtix support access")}</h2>
        {grant ? (
          <>
            <p>
              {t("Courtix support can view your club until {when}{note}. They can't change anything, and every page they open is listed below.", {
                when: when(grant.expires_at),
                note: grant.note ? ` (${grant.note})` : "",
              })}
            </p>
            <form action={endSupport} className="actions" style={{ marginTop: 8 }}>
              <button className="danger">{t("End access now")}</button>
            </form>
          </>
        ) : (
          <form action={allowSupport} className="form">
            <p className="muted small">
              {t("Courtix support can't see your members, bookings or payments unless you allow it here. Allow it when you've asked for help; they can only look, not change anything, and it ends by itself.")}
            </p>
            <label>
              {t("For")}
              <select name="hours" defaultValue="24">
                <option value="2">{t("2 hours")}</option>
                <option value="24">{t("24 hours")}</option>
                <option value="72">{t("3 days")}</option>
                <option value="168">{t("7 days")}</option>
              </select>
            </label>
            <label>
              {t("What it's about (optional)")}
              <input name="note" maxLength={300} placeholder={t("LINE replies stopped working")} />
            </label>
            <div className="actions">
              <button>{t("Allow Courtix support")}</button>
            </div>
          </form>
        )}
        {supportLog.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary className="small">{t("What Courtix support looked at ({length})", { length: supportLog.length })}</summary>
            <ul className="list small" style={{ marginTop: 8 }}>
              {supportLog.map((l) => (
                <li key={l.id}>
                  {when(l.viewed_at)} · {l.email ?? t("Courtix support")} · {l.path ?? "page"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </>
  );
}
