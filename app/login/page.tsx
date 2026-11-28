import { getI18n } from "@/lib/i18n/server";
import { CourtixLogo } from "@/components/CourtixLogo";
import Link from "next/link";
import { Banner, type SearchParams } from "@/components/Banner";
import { ClubBrandStyle } from "@/components/ClubBrand";
import { ClubLogo } from "@/components/ClubLogo";
import { currentHost } from "@/lib/host";
import { loadPublicClub } from "@/lib/public";
import { signIn, signUp } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { t } = await getI18n();
  const sp = await searchParams;
  const host = await currentHost();

  // On a club's subdomain, show whose sign-in this is; unknown subdomains don't exist.
  // loadPublicClub 404s for a subdomain that isn't a club.
  const club = host.kind === "club" ? (await loadPublicClub()).club : null;
  const clubName = club?.name ?? null;

  return (
    <>
      {club && <ClubBrandStyle club={club} />}
      <main className="auth">
        <div className="card">
          {club && (
            <p className="small" style={{ marginBottom: 12 }}>
              <Link href="/">← {club.name}</Link>
            </p>
          )}
          {club && <ClubLogo path={club.logo_path} name={club.name} />}
          {clubName ? (
            <h1>{clubName}</h1>
          ) : (
            <h1 style={{ marginBottom: 12 }}>
              <CourtixLogo height={40} />
            </h1>
          )}
          <p className="muted" style={{ marginBottom: 20 }}>
            {clubName
              ? t("Staff sign-in: members, courts and sessions.")
              : t("Sign in to your club, or create an account to set one up.")}
          </p>
          <Banner sp={sp} />
          <form className="form">
            <label>
              {t("Email")}
              <input name="email" type="email" required autoComplete="email" placeholder="owner@yourclub.com" />
            </label>
            <label>
              {t("Password")}
              <input name="password" type="password" required minLength={8} autoComplete="current-password" />
            </label>
            <div className="actions">
              <button className="primary" formAction={signIn}>{t("Sign in")}</button>
              {/* On a club's own address, "Create account" would start a new club, so it lives on the main site. */}
              {!clubName && <button formAction={signUp}>{t("Create account")}</button>}
            </div>
            <p className="small">
              <Link href="/login/forgot">{t("Forgot password?")}</Link>
            </p>
          </form>
          {clubName && (
            <p className="muted small" style={{ marginTop: 16 }}>
              {t("Setting up a new club?")}{" "}<a href={host.rootUrl("/login")}>{t("Start at Courtix")}</a>.
            </p>
          )}
          <p className="muted small" style={{ marginTop: 4 }}>
            {clubName ? (t("Powered by Courtix ·") + " ") : ""}
            <Link href="/privacy">{t("Privacy")}</Link> · <Link href="/terms">{t("Terms")}</Link>
          </p>
        </div>
      </main>
    </>
  );
}
