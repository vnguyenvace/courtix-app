import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { requirePlatform } from "@/lib/platform";
import { PLATFORM_ROLE_LABELS } from "@/lib/permissions";

export const metadata = { title: "Courtix admin", robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { supabase, email, role } = await requirePlatform();
  const canSupport = role === "super_admin" || role === "support";
  const { count: openHelp } = canSupport
    ? await supabase.from("support_requests").select("id", { count: "exact", head: true }).eq("status", "open")
    : { count: 0 };
  return (
    <div className="admin-shell" style={{ maxWidth: 1180, margin: "0 auto", padding: "20px 16px 48px" }}>
      <header style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <nav className="actions" aria-label="Courtix admin">
          <strong style={{ marginRight: 8 }}>Courtix admin</strong>
          <Link href="/admin">Clubs</Link>
          {canSupport && <Link href="/admin/help">Help requests{openHelp ? ` (${openHelp})` : ""}</Link>}
          {role === "super_admin" && <Link href="/admin/team">Team</Link>}
        </nav>
        <div className="actions">
          <span className="muted small">
            {email} · {PLATFORM_ROLE_LABELS[role]}
          </span>
          <form action={signOut}>
            <button className="link">Sign out</button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
