import { getI18n } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Banner, type SearchParams } from "@/components/Banner";
import { back, friendly, str } from "@/lib/form";
import { ORG_COOKIE } from "@/lib/org";
import { currentHost } from "@/lib/host";
import { ROOT_DOMAIN } from "@/lib/tenant";

async function createClub(form: FormData) {
  "use server";
  const name = str(form, "name");
  const slug = str(form, "slug")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!name) back("/onboarding", "Enter your club's name.");
  if (slug.length < 2) back("/onboarding", "Choose a short link for your club, like rawai-pickleball.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_org", { p_name: name, p_slug: slug });
  if (error) back("/onboarding", friendly(error));

  (await cookies()).set(ORG_COOKIE, String(data), { path: "/", httpOnly: true, sameSite: "lax" });
  const notice = "/dashboard?notice=" + encodeURIComponent("Your club is ready. We added 2 courts and 3 starter packages you can edit in Settings.");
  // On courtix.app the club lives at its own subdomain; the sign-in cookie is shared, so they arrive signed in.
  const host = await currentHost();
  redirect(host.kind === "other" ? notice : host.clubUrl(slug, notice));
}

export default async function Onboarding({ searchParams }: { searchParams: SearchParams }) {
  const { t } = await getI18n();
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // New clubs are set up on the main site, not on another club's subdomain.
  const host = await currentHost();
  if (host.kind === "club") redirect(host.rootUrl("/onboarding"));

  return (
    <main className="auth">
      <div className="card">
        <h1>{t("Set up your club")}</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          {t("You can change all of this later.")}
        </p>
        <Banner sp={sp} />
        <form className="form" action={createClub}>
          <label>
            {t("Club name")}
            <input name="name" required placeholder={t("Rawai Pickleball Club")} />
          </label>
          <label>
            {t("Club link")}
            <input name="slug" required placeholder={t("rawai-pickleball")} pattern="[a-zA-Z0-9\-]{2,40}" title={t("Letters, numbers and dashes")} />
            <span className="muted small">{t("Your club's address:")}{" "}<strong>{t("your-link.{ROOT_DOMAIN}", { ROOT_DOMAIN: ROOT_DOMAIN })}</strong></span>
          </label>
          <button className="primary">{t("Create club")}</button>
        </form>
      </div>
    </main>
  );
}
