import { Banner, type SearchParams } from "@/components/Banner";
import { requirePlatform } from "@/lib/platform";
import { PLATFORM_ROLE_DESCRIPTIONS, PLATFORM_ROLE_LABELS, PLATFORM_ROLES, type PlatformRole } from "@/lib/permissions";
import { removeTeamMember, setTeamMember } from "../actions";

export default async function AdminTeamPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, userId, t, locale } = await requirePlatform(["super_admin"]);
  const { data, error } = await supabase.rpc("platform_team");
  if (error) throw new Error(error.message);
  const team = (data ?? []) as { user_id: string; email: string; role: PlatformRole; created_at: string }[];

  return (
    <>
      <h1>{t("Courtix team")}</h1>
      <p className="muted" style={{ marginBottom: 12 }}>{t("Your own team. Club staff are managed by each club on its Staff page.")}</p>
      <Banner sp={sp} />
      <section className="card" style={{ marginBottom: 16 }}>
        <ul className="list">
          {team.map((ty) => (
            <li key={ty.user_id} style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>{ty.email}</strong>
                {ty.user_id === userId && <span className="muted small">{" "}{t("(you)")}</span>}
                <div className="muted small">{t(PLATFORM_ROLE_LABELS[ty.role])}</div>
              </div>
              <div className="actions">
                <form action={setTeamMember} className="inline actions">
                  <input type="hidden" name="email" value={ty.email} />
                  <select name="role" defaultValue={ty.role} aria-label={t("Role for {email}", { email: ty.email })}>
                    {PLATFORM_ROLES.map((r) => (
                      <option key={r} value={r}>{t(PLATFORM_ROLE_LABELS[r])}</option>
                    ))}
                  </select>
                  <button>{t("Save")}</button>
                </form>
                <form action={removeTeamMember} className="inline">
                  <input type="hidden" name="user_id" value={ty.user_id} />
                  <button className="danger">{t("Remove")}</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>{t("Add someone")}</h2>
        <form action={setTeamMember} className="form">
          <label>
            {t("Email of their Courtix account")}
            <input name="email" type="email" required placeholder="name@courtix.app" />
          </label>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
            <legend className="small muted" style={{ marginBottom: 6 }}>{t("Role")}</legend>
            {PLATFORM_ROLES.map((r) => (
              <label key={r} className="check" style={{ alignItems: "flex-start" }}>
                <input type="radio" name="role" value={r} defaultChecked={r === "support"} />
                <span>
                  <strong>{t(PLATFORM_ROLE_LABELS[r])}</strong>
                  <span className="muted small" style={{ display: "block" }}>{t(PLATFORM_ROLE_DESCRIPTIONS[r])}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="actions">
            <button className="primary">{t("Add to the team")}</button>
          </div>
          <p className="muted small">
            {t("They need a Courtix account first: ask them to create one at courtix.app (they don't need to set up a club).")}
          </p>
        </form>
      </section>
    </>
  );
}
