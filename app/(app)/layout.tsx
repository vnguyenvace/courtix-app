import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireOrg, ORG_COOKIE, LOCATION_COOKIE } from "@/lib/org";
import { signOut } from "@/app/login/actions";
import { currentHost } from "@/lib/host";
import SidebarNav from "@/components/SidebarNav";
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
  const { org, email, clubs, location, myLocations, multiLocation, role } = await requireOrg();
  const canSeeAll = role === "owner" || role === "manager" || myLocations.length > 1;

  return (
    <div className="shell">
      <aside className="sidebar">
        {/* Phones and tablets: this checkbox opens the menu (CSS only, works without JS) */}
        <input type="checkbox" id="nav-toggle" className="nav-toggle" aria-label="Menu" />
        <div className="sidebar-top">
          <Link href="/dashboard" className="brand-block">
            <span className="brand-mark" aria-hidden>C</span>
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
              <select name="location_id" defaultValue={location?.id ?? "all"} aria-label="Location">
                {canSeeAll && <option value="all">All locations</option>}
                {myLocations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <button>Go</button>
            </form>
          )}
          <SidebarNav />
          <div className="sidebar-foot">
            {clubs.length > 1 && (
              <form action={switchClub} className="form">
                <select name="club_id" defaultValue={org.id} aria-label="Switch club">
                  {clubs.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button>Switch club</button>
              </form>
            )}
            <span className="user-email" title={email ?? undefined}>{email}</span>
            <form action={signOut}>
              <button className="nav-button">
                <LogOut size={18} strokeWidth={1.75} aria-hidden />
                <span>Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
