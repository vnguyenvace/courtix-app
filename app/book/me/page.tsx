import type { Metadata } from "next";
import Link from "next/link";
import { param, type SearchParams } from "@/components/Banner";
import { ClubLogo } from "@/components/ClubLogo";
import { loadMember, loadPublicClub } from "@/lib/public";
import { formatMoney } from "@/lib/time";
import { memberCancel, memberSignOut, requestCode, verifyCode } from "../actions";

// A member's own page on the club's booking site: sign in with a one-time code (LINE, SMS or
// email), then see their package, what they owe, and their upcoming bookings, and cancel.

export const metadata: Metadata = { title: "My bookings" };

function when(iso: string, tz: string) {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz,
  });
}

export default async function MemberPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { club } = await loadPublicClub();
  const me = await loadMember();
  const error = param(sp, "error");
  const notice = param(sp, "notice");
  const step = param(sp, "step");
  const contact = param(sp, "contact") ?? "";
  const next = param(sp, "next") ?? "";

  return (
    <main className="public">
      <header className="public-head">
        <div className="public-brand">
          <ClubLogo path={club.logo_path} name={club.name} />
          <div>
            <h1>{me ? `Hi ${me.first_name}` : "Member sign in"}</h1>
            <p className="muted">{club.name}</p>
          </div>
        </div>
      </header>
      <nav className="tabs" aria-label="Booking">
        <Link href="/book">Sessions</Link>
        <Link href="/book/courts">Court times</Link>
        <span className="active">My bookings</span>
      </nav>
      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner notice">{notice}</div>}

      {!me ? (
        step === "code" ? (
          <section className="card member-card">
            <h2>Enter your code</h2>
            <p className="small">
              If <strong>{contact}</strong> belongs to a member of {club.name}, we&apos;ve sent a 6-digit code (on LINE, by
              text message or by email). It works for 10 minutes.
            </p>
            <form action={verifyCode} className="form">
              <input type="hidden" name="contact" value={contact} />
              <input type="hidden" name="next" value={next} />
              <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required placeholder="123456" className="code-input" />
              <button className="primary">Sign in</button>
            </form>
            <p className="muted small" style={{ marginTop: 10 }}>
              No code after a minute? <Link href="/book/me">Try again</Link>, or message the club. Not a member yet? You
              can still <Link href="/book">book as a guest</Link>.
            </p>
          </section>
        ) : (
          <section className="card member-card">
            <h2>Book with your membership</h2>
            <p className="small">
              Enter the phone number or email the club has for you. We&apos;ll send a one-time code, then you can book with
              your package and see or cancel your bookings. This phone stays signed in for 90 days.
            </p>
            <form action={requestCode} className="form">
              <input name="contact" required maxLength={120} autoComplete="tel" placeholder="+66 81 234 5678 or you@email.com" defaultValue={contact} />
              {next && <input type="hidden" name="next" value={next} />}
              <button className="primary">Send me a code</button>
            </form>
            <p className="muted small" style={{ marginTop: 10 }}>
              Not a member? <Link href="/book">Book as a guest</Link> and pay at the club.
            </p>
          </section>
        )
      ) : (
        <>
          <section className="card member-card">
            <h2>Your package</h2>
            {me.package ? (
              <p>
                <strong>{me.package.name}</strong>
                {me.package.ends_on ? ` · until ${new Date(`${me.package.ends_on}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}` : ""}
                {me.package.sessions_left != null ? ` · ${me.package.sessions_left} sessions left` : ""}
                {me.package.status && me.package.status !== "active" ? ` · ${me.package.status}` : ""}
              </p>
            ) : (
              <p className="muted">No package at the moment. You pay the drop-in price at the club.</p>
            )}
            {me.to_pay > 0 && <p className="small">To pay: <strong>{formatMoney(me.to_pay, club.currency)}</strong></p>}
            {me.unpaid.length > 0 && (
              <ul className="list">
                {me.unpaid.map((u) => (
                  <li key={u.order_id}>
                    <span className="small">
                      {u.description}
                      {u.slip_sent && <span className="muted"> · slip sent</span>}
                    </span>
                    <Link className="button small-button" href={`/book/pay/${u.order_id}`}>
                      Pay {formatMoney(u.total, club.currency)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="public-day">
            <h2>Your upcoming bookings</h2>
            {me.sessions.length === 0 && me.courts.length === 0 ? (
              <p className="muted">
                Nothing booked. <Link href="/book">Find a session</Link> or <Link href="/book/courts">book a court</Link>.
              </p>
            ) : (
              <ul className="public-list">
                {me.sessions.map((r) => (
                  <li key={r.id} className="public-session member-booking">
                    <span className="public-main">
                      <Link href={`/book/s/${r.session_id}`}><strong>{r.name}</strong></Link>
                      <span className="muted small">
                        {when(r.starts_at, r.timezone)} · {r.location}
                        {r.status === "waitlisted" ? " · waitlist" : r.status === "requested" ? " · waiting for the club to confirm" : ""}
                      </span>
                      <span className="small">{r.covered ? "Covered by your package" : Number(r.price) > 0 ? `${formatMoney(r.price, club.currency)} at the club` : "Free"}</span>
                    </span>
                    <form action={memberCancel}>
                      <input type="hidden" name="kind" value="session" />
                      <input type="hidden" name="id" value={r.id} />
                      <button className="link danger">Cancel</button>
                    </form>
                  </li>
                ))}
                {me.courts.map((b) => (
                  <li key={b.id} className="public-session member-booking">
                    <span className="public-main">
                      <strong>{b.court}</strong>
                      <span className="muted small">{when(b.starts_at, b.timezone)} · {b.location}</span>
                      <span className="small">{Number(b.price) > 0 ? `${formatMoney(b.price, club.currency)} at the club` : "Covered by your package"}</span>
                    </span>
                    <form action={memberCancel}>
                      <input type="hidden" name="kind" value="court" />
                      <input type="hidden" name="id" value={b.id} />
                      <button className="link danger">Cancel</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small" style={{ marginTop: 8 }}>
              Cancel at least {me.late_cancel_hours} hours before a session to get a package credit back.
            </p>
          </section>
          <form action={memberSignOut} style={{ marginTop: 16 }}>
            <button className="link">Sign out on this phone</button>
          </form>
        </>
      )}
      <p className="muted small public-foot">Booking by Courtix</p>
    </main>
  );
}
