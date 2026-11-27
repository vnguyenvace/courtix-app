import Link from "next/link";
import { Banner, type SearchParams } from "@/components/Banner";
import { requestPasswordReset } from "../actions";

export const metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return (
    <main className="auth">
      <div className="card">
        <p className="small" style={{ marginBottom: 12 }}>
          <Link href="/login">← Sign in</Link>
        </p>
        <h1>Forgot your password?</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          Enter the email you sign in with. We&apos;ll send a link to choose a new password.
        </p>
        <Banner sp={sp} />
        <form action={requestPasswordReset} className="form">
          <label>
            Email
            <input name="email" type="email" required autoComplete="email" placeholder="owner@yourclub.com" />
          </label>
          <div className="actions">
            <button className="primary">Send the link</button>
          </div>
        </form>
        <p className="muted small" style={{ marginTop: 16 }}>
          Open the link on this phone or computer, in this browser.
        </p>
      </div>
    </main>
  );
}
