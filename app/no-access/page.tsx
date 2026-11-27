import { getI18n } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentHost } from "@/lib/host";
import { signOut } from "@/app/login/actions";

// Shown when someone is signed in on a club subdomain they're not staff of.
export default async function NoAccessPage() {
  const { t } = await getI18n();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Invited but never finished joining (e.g. the confirmation email didn't lead back to the invite
  // link): join now and go in. The database only does this for a confirmed, invited email.
  const { data: joined } = await supabase.rpc("accept_my_invites");
  if (joined && (joined as unknown[]).length > 0) redirect("/dashboard?notice=" + encodeURIComponent("Welcome to the team."));

  const host = await currentHost();
  let clubName = t("this club");
  if (host.kind === "club") {
    const { data } = await supabase.rpc("club_by_slug", { p_slug: host.slug });
    clubName = ((data ?? [])[0] as { name: string } | undefined)?.name ?? clubName;
  }

  const { data: rows } = await supabase
    .from("org_staff")
    .select("orgs(name, slug)")
    .eq("user_id", user.id)
    .order("created_at");
  const myClubs = ((rows ?? []) as unknown as { orgs: { name: string; slug: string } }[]).map((r) => r.orgs);

  return (
    <main className="auth">
      <div className="card">
        <h1>{t("No access")}</h1>
        <p className="muted" style={{ marginBottom: 16 }}>
          {t("You're signed in as {email}, but you're not on the staff of {clubName}. Ask the club's owner to add you.", { email: user.email, clubName: clubName })}
        </p>
        {myClubs.length > 0 && (
          <>
            <p className="small">{t("Your clubs:")}</p>
            <ul className="list" style={{ marginBottom: 16 }}>
              {myClubs.map((c) => (
                <li key={c.slug}>
                  <a href={host.kind === "other" ? "/dashboard" : host.clubUrl(c.slug, "/dashboard")}>{c.name}</a>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="actions">
          {myClubs.length === 0 && (
            <a className="button" href={host.kind === "other" ? "/onboarding" : host.rootUrl("/onboarding")}>
              {t("Set up your own club")}
            </a>
          )}
          <form action={signOut}>
            <button className="link">{t("Sign out")}</button>
          </form>
        </div>
      </div>
    </main>
  );
}
