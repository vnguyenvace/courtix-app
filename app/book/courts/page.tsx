import type { Metadata } from "next";
import Link from "next/link";
import { param, type SearchParams } from "@/components/Banner";
import { whatsappLink } from "@/lib/ai";
import { loadPublicClub, type PublicCourtSlot } from "@/lib/public";
import { addDays, formatLongDay, isValidDate, localTime, todayIn } from "@/lib/time";

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
  const qs = (d: string) => `?day=${d}${club.locations.length > 1 ? `&location=${location.id}` : ""}`;

  return (
    <main className="public">
      <header className="public-head">
        <div>
          <h1>{club.name}</h1>
          <p className="muted">{location.name}{location.address ? ` · ${location.address}` : ""}</p>
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
        <p className="muted small">
          Tap a free time to ask the club on WhatsApp. Times shown are when each court is free right now.
        </p>
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
                      const link = whatsappLink(
                        location.whatsapp,
                        `Hi ${club.name}, can I book ${name} on ${formatLongDay(day)} at ${localTime(t, location.timezone)}?`,
                      );
                      return (
                        <td key={id}>
                          {link ? <a className="slot-open" href={link}>Free</a> : <span className="slot-open">Free</span>}
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
      <p className="muted small public-foot">Booking by Courtix</p>
    </main>
  );
}

function i18nDay(d: string, today: string): string {
  if (d === today) return "Today";
  if (d === addDays(today, 1)) return "Tomorrow";
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });
}
