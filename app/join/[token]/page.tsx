import Link from "next/link";
import { Banner, type SearchParams } from "@/components/Banner";
import { createClient } from "@/lib/supabase/server";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/permissions";
import type { StaffRole } from "@/lib/types";
import { joinClub, joinSignIn, joinSignOut, joinSignUp } from "./actions";

export const metadata = { title: "Join the team · Courtix", robots: { index: false } };

interface Invite {
  club_name: string;
  club_slug: string;
  email: string;
  role: StaffRole;
  expired: boolean;
  accepted: boolean;
}

export default async function JoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SearchParams }) {
  const { token } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data }, { data: auth }] = await Promise.all([
    supabase.rpc("staff_invite_info", { p_token: token }),
    supabase.auth.getUser(),
  ]);
  const invite = ((data ?? []) as Invite[])[0] ?? null;
  const user = auth.user;
  const sameEmail = Boolean(user?.email && invite && user.email.toLowerCase() === invite.email);

  let body: React.ReactNode;
  if (!invite) {
    body = <p className="muted">This invite link isn&apos;t valid any more. Ask the club owner for a new one.</p>;
  } else if (invite.expired && !invite.accepted) {
    body = <p className="muted">This invite has expired. Ask the owner of {invite.club_name} for a new link.</p>;
  } else if (user && !sameEmail) {
    body = (
      <>
        <p className="muted" style={{ marginBottom: 12 }}>
          You&apos;re signed in as {user.email}, but this invite is for <strong>{invite.email}</strong>.
        </p>
        <form action={joinSignOut}>
          <input type="hidden" name="token" value={token} />
          <button>Sign out and use {invite.email}</button>
        </form>
      </>
    );
  } else if (user) {
    body = (
      <form action={joinClub} className="form">
        <input type="hidden" name="token" value={token} />
        <p className="muted">Signed in as {user.email}.</p>
        <div className="actions">
          <button className="primary">{invite.accepted ? `Open ${invite.club_name}` : `Join ${invite.club_name}`}</button>
        </div>
      </form>
    );
  } else {
    body = (
      <form className="form">
        <input type="hidden" name="token" value={token} />
        <label>
          Email
          <input name="email" type="email" value={invite.email} readOnly autoComplete="email" />
        </label>
        <label>
          Password
          <input name="password" type="password" required minLength={8} autoComplete="current-password" />
        </label>
        <div className="actions">
          <button className="primary" formAction={joinSignIn}>Sign in and join</button>
          <button formAction={joinSignUp}>Create account and join</button>
        </div>
        <p className="muted small">New to Courtix? Choose a password (8 characters or more) and create your account.</p>
      </form>
    );
  }

  return (
    <main className="auth">
      <div className="card">
        <h1>{invite ? `Join ${invite.club_name}` : "Join a club"}</h1>
        {invite && (
          <p className="muted" style={{ marginBottom: 16 }}>
            You&apos;ve been added as <strong>{ROLE_LABELS[invite.role]}</strong>. {ROLE_DESCRIPTIONS[invite.role]}
          </p>
        )}
        <Banner sp={sp} />
        {body}
        <p className="muted small" style={{ marginTop: 16 }}>
          Powered by Courtix · <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link>
        </p>
      </div>
    </main>
  );
}
