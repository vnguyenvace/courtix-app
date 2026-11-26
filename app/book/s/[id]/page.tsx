import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { param, type SearchParams } from "@/components/Banner";
import { StateBadge } from "@/components/PublicBits";
import { ClubLogo } from "@/components/ClubLogo";
import { levelText } from "@/components/SessionBits";
import { whatsappLink } from "@/lib/ai";
import { loadMember, loadPublicClub, sessionState, type PublicSession } from "@/lib/public";
import { formatLongDay, formatMoney, localTime } from "@/lib/time";
import { memberBookSession, publicSignUp } from "../../actions";
import { PublicFooter } from "@/components/PublicFooter";

async function load(id: string) {
  const { supabase, slug, club } = await loadPublicClub();
  const { data } = await supabase.rpc("public_sessions", { p_slug: slug, p_location: null, p_days: 31 });
  const s = ((data ?? []) as PublicSession[]).find((x) => x.id === id);
  if (!s) notFound();
  return { club, s };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { club, s } = await load((await params).id);
  return { title: `${s.name} · ${club.name}` };
}

export default async function PublicSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { club, s } = await load(id);
  const tz = s.location_timezone;
  const day = new Date(s.starts_at).toLocaleDateString("en-CA", { timeZone: tz });
  const state = sessionState(s);
  const approve = club.online_signups === "approve";
  const done = param(sp, "done");
  const me = await loadMember();
  const already = me?.sessions.find((r) => r.session_id === s.id);
  const error = param(sp, "error");
  const location = club.locations.find((l) => l.id === s.location_id);
  const when = `${formatLongDay(day)} ${localTime(s.starts_at, tz)}`;
  const wa = whatsappLink(location?.whatsapp, `Hi ${club.name}, about ${s.name} on ${when}: `);

  return (
    <main className="public">
      <div className="public-crumb">
        <Link href={`/book${club.locations.length > 1 ? `?location=${s.location_id}` : ""}`}>← All sessions</Link>
        <span className="club">
          <ClubLogo path={club.logo_path} name={club.name} small />
          {club.name}
        </span>
      </div>
      <header className="public-head" style={{ marginTop: 8 }}>
        <div>
          <h1>{s.name}</h1>
          <p className="muted">
            {formatLongDay(day)} · {localTime(s.starts_at, tz)}–{localTime(s.ends_at, tz)}
          </p>
          <div className="actions" style={{ marginTop: 6 }}>
            <StateBadge s={s} />
            <span className="badge">{levelText(s.level_min, s.level_max)}</span>
            {s.min_age && <span className="badge">Age {s.min_age}+</span>}
          </div>
        </div>
        <div className="stat">
          <div className="label">Price</div>
          <div className="value"><span className="unit">{club.currency}</span>{Number(s.price).toLocaleString("en-US")}</div>
          <div className="muted small">Pay at the club</div>
        </div>
      </header>

      {done === "member" && (
        <div className="banner notice" role="status">
          {param(sp, "status") === "waitlisted"
            ? `You're on the waitlist for ${s.name} on ${when}. We'll let you know if a place opens up.`
            : `You're booked for ${s.name} on ${when}. ${
                param(sp, "covered") === "1"
                  ? "Covered by your package."
                  : Number(param(sp, "price") ?? 0) > 0
                    ? `Please pay ${formatMoney(Number(param(sp, "price")), club.currency)} at the club.`
                    : ""
              } See you on court.`}{" "}
          {param(sp, "pay") ? <Link href={`/book/pay/${param(sp, "pay")}`}>Pay now by PromptPay</Link> : <Link href="/book/me">My bookings</Link>}
        </div>
      )}
      {done === "booked" && (
        <div className="banner notice" role="status">
          You&apos;re booked for {s.name} on {when}. Pay {formatMoney(s.price, club.currency)}
          {param(sp, "pay") ? <> <Link href={`/book/pay/${param(sp, "pay")}`}>now by PromptPay</Link> or</> : ""} at the club. See you on court.
        </div>
      )}
      {done === "requested" && (
        <div className="banner notice" role="status">
          Thanks, your request for {s.name} on {when} is in. The club will confirm your place on WhatsApp.
        </div>
      )}
      {done === "waitlisted" && (
        <div className="banner notice" role="status">
          This session is full, so you&apos;re on the waitlist. The club will let you know if a spot opens up.
        </div>
      )}
      {error && <div className="banner error" role="alert">{error}</div>}

      <div className="grid grid-2">
        <section className="card">
          <h2>Details</h2>
          <ul className="list">
            <li><span className="muted">Where</span><span>{s.location_name}{location?.address ? `, ${location.address}` : ""}</span></li>
            {s.coach_name && <li><span className="muted">Coach</span><span>{s.coach_name}</span></li>}
            <li><span className="muted">Places</span><span>{s.spots_left} of {s.max_players} left</span></li>
            <li>
              <span className="muted">Sign-ups close</span>
              <span>{formatLongDay(new Date(s.book_by).toLocaleDateString("en-CA", { timeZone: tz }))} {localTime(s.book_by, tz)}</span>
            </li>
          </ul>
          {s.description && <p className="small" style={{ marginTop: 12 }}>{s.description}</p>}
          {wa && <p className="small" style={{ marginTop: 12 }}><a href={wa}>Questions? WhatsApp the club</a></p>}
        </section>

        {!done && (
          <section className="card">
            {state === "closed" ? (
              <>
                <h2>Sign-ups have closed</h2>
                <p className="muted small">Message the club if you&apos;d still like to come.</p>
                {wa && <a className="button primary" href={wa}>WhatsApp the club</a>}
              </>
            ) : state === "not_open" ? (
              <>
                <h2>Sign-ups open soon</h2>
                <p className="muted small">
                  You can sign up from {s.signups_open_at && formatLongDay(new Date(s.signups_open_at).toLocaleDateString("en-CA", { timeZone: tz }))}{" "}
                  {s.signups_open_at && localTime(s.signups_open_at, tz)}.
                </p>
              </>
            ) : (
              <>
                {me ? (
                  already ? (
                    <>
                      <h2>You&apos;re {already.status === "booked" ? "booked" : already.status === "waitlisted" ? "on the waitlist" : "waiting for the club"}</h2>
                      <p className="small"><Link href="/book/me">See or cancel it in My bookings</Link></p>
                    </>
                  ) : (
                    <>
                      <h2>{state === "full" ? "Join the waitlist" : `Book as ${me.first_name}`}</h2>
                      <p className="muted small">
                        {me.package ? `With your ${me.package.name} if it covers this session; otherwise pay at the club.` : "You pay at the club."}
                      </p>
                      <form action={memberBookSession}>
                        <input type="hidden" name="session_id" value={s.id} />
                        <button className="primary">{state === "full" ? "Join the waitlist" : "Book my place"}</button>
                      </form>
                    </>
                  )
                ) : (
                <>
                <p className="small member-hint">
                  Member? <Link href={`/book/me?next=/book/s/${s.id}`}>Sign in to book with your package</Link>
                </p>
                <h2>{approve ? "Request a place" : state === "full" ? "Join the waitlist" : "Sign up"}</h2>
                {approve && <p className="muted small">The club confirms each place on WhatsApp.</p>}
                <form action={publicSignUp} className="form">
                  <input type="hidden" name="session_id" value={s.id} />
                  {/* Honeypot for bots: hidden from people and screen readers. */}
                  <div aria-hidden="true" className="hp">
                    <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
                  </div>
                  <label>
                    Your name
                    <input name="name" required maxLength={80} autoComplete="name" placeholder="Alex Smith" />
                  </label>
                  <label>
                    WhatsApp number
                    <input name="phone" type="tel" required autoComplete="tel" placeholder="+66 81 234 5678" />
                    <span className="small muted">With country code if you&apos;re not on a Thai number.</span>
                  </label>
                  <label className="check">
                    <input type="checkbox" name="contact_ok" required /> The club may contact me on WhatsApp about this booking (<Link href="/privacy">privacy</Link>)
                  </label>
                  <label className="check">
                    <input type="checkbox" name="marketing" /> Send me news and offers from {club.name} (optional)
                  </label>
                  <button className="primary" data-pending-label={approve ? "Sending…" : "Booking…"}>
                    {approve
                      ? "Send my request"
                      : state === "full"
                        ? "Join the waitlist"
                        : `Book my place · ${formatMoney(s.price, club.currency)}`}
                  </button>
                  <p className="muted small">No account needed. You pay at the club.</p>
                </form>
                </>
                )}
              </>
            )}
          </section>
        )}
      </div>
      <PublicFooter />
    </main>
  );
}
