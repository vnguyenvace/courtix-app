import Link from "next/link";
import { CourtixMark } from "@/components/CourtixLogo";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireOrg, ORG_COOKIE, LOCATION_COOKIE } from "@/lib/org";
import { setLanguage, signOut } from "@/app/login/actions";
import { LANGS } from "@/lib/i18n";
import { currentHost } from "@/lib/host";
import SidebarNav from "@/components/SidebarNav";
import { NAV_LABELS } from "@/lib/nav";
import { PAGE_PERMISSION } from "@/lib/permissions";

const NAV_HREFS = ["/dashboard", "/morning", "/sessions", "/bookings", "/coaches", "/members", "/payments", "/chats", "/replies", "/followups", "/settings", "/staff", "/help"];
import { LogOut, Menu, X } from "lucide-react";

const COOKIE = { path: "/", httpOnly: true, sameSite: "lax" as const };

async function switchClub(form: FormData) {
  "use server";
  const clubId = String(form.get("club_id") ?? "");
  const jar = await cookies();
  jar.set(ORG_COOKIE, clubId, COOKIE);
  jar.delete(LOCATION_COOKIE);
  // On courtix.app each club has its own subdomain: go there.
  const host = await currentHost();
  if (host.kind !== "other") {
    const { clubs } = await requireOrg();
    const club = clubs.find((c) => c.id === clubId);
    if (club) redirect(host.clubUrl(club.slug, "/dashboard"));
  }
  redirect("/dashboard");
}

async function switchLocation(form: FormData) {
  "use server";
  (await cookies()).set(LOCATION_COOKIE, String(form.get("location_id") ?? "all"), COOKIE);
  // Stay on the same page, without old messages in the address.
  const referer = (await headers()).get("referer");
  let path = "/dashboard";
  if (referer) {
    const url = new URL(referer);
    url.searchParams.delete("notice");
    url.searchParams.delete("error");
    path = url.pathname + (url.search || "");
  }
  redirect(path);
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { org, email, clubs, location, myLocations, multiLocation, role, can, supportUntil, t, setting, locale } = await requireOrg();
  const allowed = NAV_HREFS.filter((href) => !PAGE_PERMISSION[href] || can(PAGE_PERMISSION[href]));
  const canSeeAll = role === "owner" || role === "manager" || myLocations.length > 1;

  return (
    <div className="shell">
      <aside className="sidebar">
        {/* Phones and tablets: this checkbox opens the menu (CSS only, works without JS) */}
        <input type="checkbox" id="nav-toggle" className="nav-toggle" aria-label="Menu" />
        <div className="sidebar-top">
          <Link href="/dashboard" className="brand-block">
            <CourtixMark size={34} className="brand-mark-img" />
            <span className="brand-text">
              <span className="brand">Courtix</span>
              <span className="club-name">{org.name}</span>
            </span>
          </Link>
          <label htmlFor="nav-toggle" className="menu-button" aria-hidden>
            <Menu className="icon-open" size={22} strokeWidth={1.75} />
            <X className="icon-close" size={22} strokeWidth={1.75} />
          </label>
        </div>
        <div className="sidebar-body">
          {multiLocation && (
            <form action={switchLocation} className="location-picker">
              <select name="location_id" defaultValue={location?.id ?? "all"} aria-label={t("Location")}>
                {canSeeAll && <option value="all">{t("All locations")}</option>}
                {myLocations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <button>{t("Go")}</button>
            </form>
          )}
          <SidebarNav allowed={allowed} labels={Object.fromEntries(Object.entries(NAV_LABELS).map(([h, l]) => [h, t(l)]))} />
          <div className="sidebar-foot">
            {clubs.length > 1 && (
              <form action={switchClub} className="form">
                <select name="club_id" defaultValue={org.id} aria-label={t("Switch club")}>
                  {clubs.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button>{t("Switch club")}</button>
              </form>
            )}
            <span className="user-email" title={email ?? undefined}>{email}</span>
            {role !== "support" && (
              <Link href="/account/password" className="small" style={{ padding: "0 12px" }}>{t("Change password")}</Link>
            )}
            <form action={setLanguage} className="location-picker" aria-label={t("Language")}>
              <select name="ui_language" defaultValue={setting} aria-label={t("Language")}>
                <option value="auto">{t("Language: automatic")}</option>
                {LANGS.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
              <button>{t("Save")}</button>
            </form>
            <form action={signOut}>
              <button className="nav-button">
                <LogOut size={18} strokeWidth={1.75} aria-hidden />
                <span>{t("Sign out")}</span>
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main className="main">
        {role === "support" && (
          <p className="banner warn" role="status">
            {t("Courtix support view of {club}: read only, every page you open is logged for the club.", { club: org.name })}
            {supportUntil && ` ${t("The owner's permission ends {when}.", { when: new Date(supportUntil).toLocaleString(locale, { timeZone: org.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}`}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
