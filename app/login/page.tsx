import { notFound } from "next/navigation";
import { Banner, type SearchParams } from "@/components/Banner";
import { createClient } from "@/lib/supabase/server";
import { currentHost } from "@/lib/host";
import { signIn, signUp } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const host = await currentHost();

  // On a club's subdomain, show whose sign-in this is; unknown subdomains don't exist.
  let clubName: string | null = null;
  if (host.kind === "club") {
    const supabase = await createClient();
    const { data } = await supabase.rpc("club_by_slug", { p_slug: host.slug });
    const club = (data ?? [])[0] as { name: string } | undefined;
    if (!club) notFound();
    clubName = club.name;
  }

  return (
    <main className="auth">
      <div className="card">
        <h1>{clubName ?? "Courtix"}</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          {clubName
            ? "Sign in to manage members, courts and sessions."
            : "Sign in to your club, or create an account to set one up."}
        </p>
        <Banner sp={sp} />
        <form className="form">
          <label>
            Email
            <input name="email" type="email" required autoComplete="email" placeholder="owner@yourclub.com" />
          </label>
          <label>
            Password
            <input name="password" type="password" required minLength={8} autoComplete="current-password" />
          </label>
          <div className="actions">
            <button className="primary" formAction={signIn}>Sign in</button>
            {/* On a club's own address, "Create account" would start a new club, so it lives on the main site. */}
            {!clubName && <button formAction={signUp}>Create account</button>}
          </div>
        </form>
        {clubName && (
          <p className="muted small" style={{ marginTop: 16 }}>
            Setting up a new club? <a href={host.rootUrl("/login")}>Start at Courtix</a>.
          </p>
        )}
        {clubName && <p className="muted small" style={{ marginTop: 4 }}>Powered by Courtix</p>}
      </div>
    </main>
  );
}
