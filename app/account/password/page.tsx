import { getI18n } from "@/lib/i18n/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Banner, param, type SearchParams } from "@/components/Banner";
import { createClient } from "@/lib/supabase/server";
import { changePassword } from "@/app/login/actions";

export const metadata = { title: "Change password" };

// Signed in only (the middleware sends everyone else to sign in). The reset email signs people
// in and brings them here with ?reset=1.
export default async function ChangePasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const { t } = await getI18n();
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const reset = param(sp, "reset") === "1";

  return (
    <main className="auth">
      <div className="card">
        {!reset && (
          <p className="small" style={{ marginBottom: 12 }}>
            <Link href="/dashboard">{t("← Back")}</Link>
          </p>
        )}
        <h1>{reset ? t("Choose a new password") : t("Change password")}</h1>
        <p className="muted" style={{ marginBottom: 20 }}>{t("For {email}", { email: user.email })}</p>
        <Banner sp={sp} />
        <form action={changePassword} className="form">
          {reset && <input type="hidden" name="reset" value="1" />}
          <label>
            {t("New password")}
            <input name="password" type="password" required minLength={8} autoComplete="new-password" />
          </label>
          <label>
            {t("New password again")}
            <input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
          </label>
          <div className="actions">
            <button className="primary">{t("Save password")}</button>
          </div>
          <p className="muted small">{t("At least 8 characters.")}</p>
        </form>
      </div>
    </main>
  );
}
