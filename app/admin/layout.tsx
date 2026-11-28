import Link from "next/link";
import { CourtixMark } from "@/components/CourtixLogo";
import { signOut } from "@/app/login/actions";
import { requirePlatform } from "@/lib/platform";
import { PLATFORM_ROLE_LABELS } from "@/lib/permissions";

export const metadata = { title: "Courtix admin", robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { supabase, email, role, t, locale } = await requirePlatform();
  const canSupport = role === "super_admin" || role === "support";
  const { count: openHelp } = canSupport
    ? await supabase.from("support_requests").select("id", { count: "exact", head: true }).eq("status", "open")
    : { count: 0 };
  return (
    <div className="admin-shell" style={{ maxWidth: 1180, margin: "0 auto", padding: "20px 16px 48px" }}>
      <header style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <nav className="actions" aria-label={t("Courtix admin")}>
          <Link href="/admin" style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 8 }} aria-label={t("Courtix admin")}>
            <CourtixMark size={28} />
            <strong>{t("Courtix admin")}</strong>
          </Link>
          <Link href="/admin">{t("Clubs")}</Link>
          {canSupport && <Link href="/admin/help">{t("Help requests")}{openHelp ? ` (${openHelp})` : ""}</Link>}
          {role === "super_admin" && <Link href="/admin/team">{t("Team")}</Link>}
        </nav>
        <div className="actions">
          <span className="muted small">
            {email} · {t(PLATFORM_ROLE_LABELS[role])}
          </span>
          <Link href="/account/password" className="small">{t("Change password")}</Link>
          <form action={signOut}>
            <button className="link">{t("Sign out")}</button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
