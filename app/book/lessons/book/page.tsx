import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { param, type SearchParams } from "@/components/Banner";
import { ClubLogo } from "@/components/ClubLogo";
import { PublicFooter } from "@/components/PublicFooter";
import { loadMember, loadPublicClub, type PublicCoach } from "@/lib/public";
import { formatLongDay, formatMoney, localTime } from "@/lib/time";
import { memberBookLesson, publicBookLesson } from "../../actions";

export const metadata: Metadata = { title: "Book a lesson" };

const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);

// One lesson time: guests give a name, WhatsApp number and consent; signed-in members book with one tap.
export default async function BookLessonPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, slug, club } = await loadPublicClub();
  if (!club.public_booking) notFound();
  const location = club.locations.find((l) => l.id === param(sp, "location")) ?? club.locations[0];
  const start = param(sp, "start") ?? "";
  const minutes = Number(param(sp, "minutes"));
  const size = Number(param(sp, "size"));
  if (!location || Number.isNaN(new Date(start).getTime()) || !minutes || !size) notFound();

  const [{ data: coachData }, { data: price }, me] = await Promise.all([
    supabase.rpc("public_lessons", { p_slug: slug }),
    supabase.rpc("public_lesson_price", { p_slug: slug, p_coach: param(sp, "coach") ?? "", p_minutes: minutes, p_group_size: size }),
    loadMember(),
  ]);
  const coach = ((coachData ?? []) as PublicCoach[]).find((c) => c.id === param(sp, "coach"));
  if (!coach || price === null) notFound();

  const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
  const day = new Date(start).toLocaleDateString("en-CA", { timeZone: location.timezone });
  const back = `/book/lessons?${new URLSearchParams({ location: location.id, coach: coach.id, minutes: String(minutes), size: String(size), day })}`;
  const approve = club.online_signups === "approve";
  const error = param(sp, "error");
  const hidden = (
    <>
      <input type="hidden" name="coach_id" value={coach.id} />
      <input type="hidden" name="start" value={start} />
      <input type="hidden" name="minutes" value={minutes} />
      <input type="hidden" name="group_size" value={size} />
      <input type="hidden" name="location" value={location.id} />
    </>
  );

  return (
    <main className="public">
      <div className="public-crumb">
        <Link href={back}>← Lesson times</Link>
        <span className="club">
          <ClubLogo path={club.logo_path} name={club.name} small />
          {club.name}
        </span>
      </div>
      <header className="public-head" style={{ marginTop: 8 }}>
        <div>
          <h1>Lesson with {coach.name}</h1>
          <p className="muted">
            {formatLongDay(day)}, {localTime(start, location.timezone)}–{localTime(end, location.timezone)} · {people(size)} · {location.name}
          </p>
        </div>
        <div className="stat">
          <div className="label">Price</div>
          <div className="value"><span className="unit">{club.currency}</span>{Number(price).toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
          <div className="muted small">Court included · pay at the club</div>
        </div>
      </header>
      {error && <div className="banner error" role="alert">{error}</div>}

      {me ? (
        <section className="card">
          <h2>{approve ? `Request as ${me.first_name}` : `Book as ${me.first_name}`}</h2>
          {approve && <p className="muted small">The club holds the coach and court for you and confirms on WhatsApp.</p>}
          <form action={memberBookLesson}>
            {hidden}
            <button className="primary">{approve ? "Send request" : `Book lesson · ${formatMoney(Number(price), club.currency)}`}</button>
          </form>
        </section>
      ) : (
        <section className="card">
          <p className="small member-hint">
            Member? <Link href={`/book/me?next=${encodeURIComponent(`/book/lessons/book?${new URLSearchParams({ coach: coach.id, start, minutes: String(minutes), size: String(size), location: location.id })}`)}`}>Sign in first</Link>
          </p>
          <h2>{approve ? "Request this lesson" : "Book this lesson"}</h2>
          {approve && <p className="muted small">The club holds the coach and court for you and confirms on WhatsApp.</p>}
          <form action={publicBookLesson} className="form">
            {hidden}
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
              <span>{club.name} may contact me about this lesson (<Link href="/privacy">privacy</Link>)</span>
            </label>
            <label className="check">
              <input type="checkbox" name="marketing" />
              Send me news and offers (optional)
            </label>
            <button className="primary">{approve ? "Send request" : "Book lesson"}</button>
          </form>
        </section>
      )}
      <PublicFooter />
    </main>
  );
}
