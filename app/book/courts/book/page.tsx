import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { param, type SearchParams } from "@/components/Banner";
import { ClubLogo } from "@/components/ClubLogo";
import { loadMember, loadPublicClub } from "@/lib/public";
import { formatLongDay, localTime } from "@/lib/time";
import { memberBookCourt, publicBookCourt } from "../../actions";
import { PublicFooter } from "@/components/PublicFooter";

// A visitor books one court time as a guest: name, WhatsApp number, consent. Pay at the club.
// Signed-in members book with one tap at their package's price instead.

export const metadata: Metadata = { title: "Book a court" };

export default async function BookCourtPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, slug, club } = await loadPublicClub();
  if (!club.public_booking) notFound();
  const courtId = param(sp, "court") ?? "";
  const start = param(sp, "start") ?? "";
  const location = club.locations.find((l) => l.id === param(sp, "location")) ?? club.locations[0];
  const day = param(sp, "day") ?? "";
  if (!location || !courtId || Number.isNaN(new Date(start).getTime())) notFound();

  const [{ data: slots }, { data: price }, me] = await Promise.all([
    supabase.rpc("public_court_slots", { p_slug: slug, p_location: location.id, p_day: day }),
    supabase.rpc("public_court_price", { p_slug: slug, p_court: courtId, p_start: start }),
    loadMember(),
  ]);
  const slot = ((slots ?? []) as { court_id: string; court_name: string; slot_start: string; slot_end: string; is_free: boolean }[]).find(
    (s) => s.court_id === courtId && new Date(s.slot_start).getTime() === new Date(start).getTime(),
  );
  if (!slot) notFound();
  const error = param(sp, "error");
  const back = `/book/courts?location=${location.id}&day=${day}`;
  const approve = club.online_signups === "approve";
  const when = `${formatLongDay(day)}, ${localTime(slot.slot_start, location.timezone)}–${localTime(slot.slot_end, location.timezone)}`;

  return (
    <main className="public">
      <div className="public-crumb">
        <Link href={back}>← Court times</Link>
        <span className="club">
          <ClubLogo path={club.logo_path} name={club.name} small />
          {club.name}
        </span>
      </div>
      <header className="public-head" style={{ marginTop: 8 }}>
        <div>
          <h1>{slot.court_name}</h1>
          <p className="muted">{when} · {location.name}</p>
        </div>
        {price !== null && Number(price) > 0 && (
          <div className="stat">
            <div className="label">Price</div>
            <div className="value"><span className="unit">{club.currency}</span>{Number(price).toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
            <div className="muted small">Pay at the club</div>
          </div>
        )}
      </header>
      {error && <div className="banner error" role="alert">{error}</div>}

      {!slot.is_free ? (
        <section className="card">
          <h2>Just taken</h2>
          <p className="muted">Someone booked this time a moment ago. <Link href={back}>Pick another time</Link>.</p>
        </section>
      ) : me ? (
        <section className="card">
          <h2>Book as {me.first_name}</h2>
          <p className="muted small">At your package&apos;s court price; pay anything due at the club.</p>
          <form action={memberBookCourt}>
            <input type="hidden" name="court_id" value={courtId} />
            <input type="hidden" name="start" value={slot.slot_start} />
            <input type="hidden" name="location" value={location.id} />
            <input type="hidden" name="day" value={day} />
            <button className="primary">Book this court</button>
          </form>
        </section>
      ) : (
        <section className="card">
          <p className="small member-hint">
            Member? <Link href={`/book/me?next=${encodeURIComponent(`/book/courts?location=${location.id}&day=${day}`)}`}>Sign in to book with your package</Link>
          </p>
          <h2>{approve ? "Request this court" : "Book this court"}</h2>
          {approve && <p className="muted small">The club holds the court for you and confirms on WhatsApp.</p>}
          <form action={publicBookCourt} className="form">
            <input type="hidden" name="court_id" value={courtId} />
            <input type="hidden" name="start" value={slot.slot_start} />
            <input type="hidden" name="location" value={location.id} />
            <input type="hidden" name="day" value={day} />
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
            </label>
            <label className="check">
              <input type="checkbox" name="contact_ok" required />
              <span>{club.name} may contact me about this booking (<Link href="/privacy">privacy</Link>)</span>
            </label>
            <label className="check">
              <input type="checkbox" name="marketing" />
              Send me news and offers (optional)
            </label>
            <button className="primary">{approve ? "Send request" : "Book court"}</button>
          </form>
        </section>
      )}
      <PublicFooter />
    </main>
  );
}
