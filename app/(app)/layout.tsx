import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireOrg, ORG_COOKIE, LOCATION_COOKIE } from "@/lib/org";
import { signOut } from "@/app/login/actions";
import { currentHost } from "@/lib/host";

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
        <div className="brand">Courtix</div>
        <div className="club-name">{org.name}</div>
        {multiLocation && (
          <form action={switchLocation} className="actions" style={{ padding: "0 10px 12px", gap: 6 }}>
            <select
              name="location_id"
              defaultValue={location?.id ?? "all"}
              aria-label="Location"
              style={{ flex: 1, minWidth: 0, padding: "6px 8px", fontSize: 14 }}
            >
              {canSeeAll && <option value="all">All locations</option>}
              {myLocations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <button style={{ padding: "6px 10px" }}>Go</button>
          </form>
        )}
        <nav className="nav">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/sessions">Sessions</Link>
          <Link href="/bookings">Courts</Link>
          <Link href="/members">Members</Link>
          <Link href="/replies">Reply helper</Link>
          <Link href="/followups">AI follow-ups</Link>
          <Link href="/settings">Settings</Link>
        </nav>
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
          <span>{email}</span>
          <form action={signOut}>
            <button className="link">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
