import type { Metadata } from "next";
import Link from "next/link";
import { param, type SearchParams } from "@/components/Banner";
import { ClubLogo } from "@/components/ClubLogo";
import { loadMember, loadPublicClub, type PublicCourtSlot } from "@/lib/public";
import { memberBookCourt } from "../actions";
import { addDays, formatLongDay, isValidDate, localTime, todayIn } from "@/lib/time";
import { PublicFooter } from "@/components/PublicFooter";

export async function generateMetadata(): Promise<Metadata> {
  const { club } = await loadPublicClub();
  return { title: `Court times · ${club.name}` };
}

const DAYS_AHEAD = 7;

export default async function PublicCourtsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, slug, club } = await loadPublicClub();
  const location = club.locations.find((l) => l.id === param(sp, "location")) ?? club.locations[0];
  if (!location) {
    return <main className="public"><p className="muted">No courts listed yet.</p></main>;
  }
  const today = todayIn(location.timezone);
  const requested = param(sp, "day");
  const day =
    isValidDate(requested) && requested >= today && requested <= addDays(today, DAYS_AHEAD - 1) ? requested : today;

  const { data } = club.public_booking
    ? await supabase.rpc("public_court_slots", { p_slug: slug, p_location: location.id, p_day: day })
    : { data: [] };
  // Times that have already passed today aren't bookable: leave them out instead of showing "Taken".
  const now = Date.now();
  const slots = ((data ?? []) as PublicCourtSlot[]).filter((s) => new Date(s.slot_end).getTime() > now);
  const courts = [...new Map(slots.map((s) => [s.court_id, s.court_name])).entries()];
  const times = [...new Set(slots.map((s) => s.slot_start))].sort();
  const byKey = new Map(slots.map((s) => [`${s.court_id}|${s.slot_start}`, s]));
  const me = await loadMember();
  const { data: lessonData } = club.public_booking ? await supabase.rpc("public_lessons", { p_slug: slug }) : { data: [] };
  const hasLessons = ((lessonData ?? []) as unknown[]).length > 0;
  const error = param(sp, "error");
  const notice = param(sp, "notice");
  const qs = (d: string) => `?day=${d}${club.locations.length > 1 ? `&location=${location.id}` : ""}`;

  return (
    <main className="public">
      <header className="public-head">
        <div className="public-brand">
          <ClubLogo path={club.logo_path} name={club.name} />
          <div>
            <h1>{club.name}</h1>
            <p className="muted">{location.name}{location.address ? ` · ${location.address}` : ""}</p>
          </div>
        </div>
      </header>

      {club.locations.length > 1 && (
        <nav className="tabs" aria-label="Location">
          {club.locations.map((l) => (
            <Link key={l.id} href={`/book/courts?location=${l.id}&day=${day}`} className={l.id === location.id ? "active" : undefined}>
              {l.name}
            </Link>
          ))}
        </nav>
      )}
      <nav className="tabs" aria-label="What to book">
        <Link href={`/book${club.locations.length > 1 ? `?location=${location.id}` : ""}`}>Sessions</Link>
        <span className="active">Court times</span>
        {hasLessons && <Link href={`/book/lessons${club.locations.length > 1 ? `?location=${location.id}` : ""}`}>Lessons</Link>}
      </nav>

      <nav className="tabs days" aria-label="Day">
        {Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i)).map((d) => (
          <Link key={d} href={`/book/courts${qs(d)}`} className={d === day ? "active" : undefined}>
            {i18nDay(d, today)}
          </Link>
        ))}
      </nav>

      <section className="card">
        <h2>{formatLongDay(day)}</h2>
        {error && <div className="banner error" role="alert">{error}</div>}
        {notice && <div className="banner notice" role="status">{notice}</div>}
        <p className="muted small">
          {me
            ? `Tap a free time to book it as ${me.first_name} (your package's court price applies).`
            : "Tap a free time to book it. Members can sign in first to book at their package's price."}{" "}
          Times shown are when each court is free right now.
        </p>
        {!me && <p className="small"><Link href={`/book/me?next=${encodeURIComponent(`/book/courts${qs(day)}`)}`}>Member sign in</Link></p>}
        {courts.length === 0 ? (
          <p className="muted">No more court times today. Try tomorrow.</p>
        ) : (
          <div className="table-wrap">
            <table className="court-times">
              <thead>
                <tr>
                  <th>Time</th>
                  {courts.map(([id, name]) => <th key={id}>{name}</th>)}
                </tr>
              </thead>
              <tbody>
                {times.map((t) => (
                  <tr key={t}>
                    <td className="muted">{localTime(t, location.timezone)}</td>
                    {courts.map(([id, name]) => {
                      const slot = byKey.get(`${id}|${t}`);
                      if (!slot?.is_free) return <td key={id}><span className="slot-busy">Taken</span></td>;
                      if (me) {
                        return (
                          <td key={id}>
                            <form action={memberBookCourt}>
                              <input type="hidden" name="court_id" value={id} />
                              <input type="hidden" name="start" value={t} />
                              <input type="hidden" name="location" value={location.id} />
                              <input type="hidden" name="day" value={day} />
                              <button className="slot-open slot-button" aria-label={`Book ${name} at ${localTime(t, location.timezone)}`}>Book</button>
                            </form>
                          </td>
                        );
                      }
                      const href = `/book/courts/book?court=${id}&start=${encodeURIComponent(t)}&location=${location.id}&day=${day}`;
                      return (
                        <td key={id}>
                          <Link className="slot-open" href={href} aria-label={`Book ${name} at ${localTime(t, location.timezone)}`}>
                            Free
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <PublicFooter />
    </main>
  );
}

function i18nDay(d: string, today: string): string {
  if (d === today) return "Today";
  if (d === addDays(today, 1)) return "Tomorrow";
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });
}
