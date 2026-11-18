import type { Metadata } from "next";
import Link from "next/link";
import { param, type SearchParams } from "@/components/Banner";
import { levelText } from "@/components/SessionBits";
import { whatsappLink } from "@/lib/ai";
import { StateBadge } from "@/components/PublicBits";
import { loadPublicClub, type PublicSession } from "@/lib/public";
import { formatLongDay, formatMoney, localTime } from "@/lib/time";

export async function generateMetadata(): Promise<Metadata> {
  const { club } = await loadPublicClub();
  return { title: `Book · ${club.name}`, description: `Sessions and courts at ${club.name}` };
}

export default async function BookPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, slug, club } = await loadPublicClub();
  const multi = club.locations.length > 1;
  const location = club.locations.find((l) => l.id === param(sp, "location")) ?? (multi ? null : club.locations[0] ?? null);

  const { data } = club.public_booking
    ? await supabase.rpc("public_sessions", { p_slug: slug, p_location: location?.id ?? null, p_days: 14 })
    : { data: [] };
  const sessions = (data ?? []) as PublicSession[];

  // Group by day in each session's own time zone.
  const days = new Map<string, PublicSession[]>();
  for (const s of sessions) {
    const day = new Date(s.starts_at).toLocaleDateString("en-CA", { timeZone: s.location_timezone });
    days.set(day, [...(days.get(day) ?? []), s]);
  }
  const contact = location ?? club.locations[0];
  const wa = whatsappLink(contact?.whatsapp, `Hi ${club.name}, I have a question about booking.`);

  return (
    <main className="public">
      <header className="public-head">
        <div>
          <h1>{club.name}</h1>
          <p className="muted">
            {location ? `${location.name}${location.address ? ` · ${location.address}` : ""}` : "Sessions at every location"}
          </p>
        </div>
        {wa && (
          <a className="button" href={wa}>WhatsApp the club</a>
        )}
      </header>

      {multi && (
        <nav className="tabs" aria-label="Location">
          <Link href="/book" className={!location ? "active" : undefined}>All locations</Link>
          {club.locations.map((l) => (
            <Link key={l.id} href={`/book?location=${l.id}`} className={location?.id === l.id ? "active" : undefined}>
              {l.name}
            </Link>
          ))}
        </nav>
      )}

      <nav className="tabs" aria-label="What to book">
        <span className="active">Sessions</span>
        <Link href={`/book/courts${location ? `?location=${location.id}` : ""}`}>Court times</Link>
      </nav>

      {!club.public_booking ? (
        <section className="card">
          <p>{club.name} takes bookings by WhatsApp or at the desk.</p>
          {wa && <p><a href={wa}>Message the club on WhatsApp</a></p>}
        </section>
      ) : sessions.length === 0 ? (
        <section className="card"><p className="muted">No sessions in the next two weeks. Check back soon.</p></section>
      ) : (
        [...days.entries()].map(([day, list]) => (
          <section key={day} className="public-day">
            <h2>{formatLongDay(day)}</h2>
            <ul className="public-list">
              {list.map((s) => (
                <li key={s.id}>
                  <Link href={`/book/s/${s.id}`} className="public-session">
                    <span className="public-time">{localTime(s.starts_at, s.location_timezone)}</span>
                    <span className="public-main">
                      <strong>{s.name}</strong>
                      <span className="muted small">
                        {localTime(s.starts_at, s.location_timezone)}–{localTime(s.ends_at, s.location_timezone)}
                        {s.level_min !== null || s.level_max !== null ? ` · ${levelText(s.level_min, s.level_max)}` : ""}
                        {s.min_age ? ` · age ${s.min_age}+` : ""}
                        {multi && !location ? ` · ${s.location_name}` : ""}
                      </span>
                    </span>
                    <span className="public-side">
                      <span>{formatMoney(s.price, club.currency)}</span>
                      <StateBadge s={s} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <p className="muted small public-foot">Booking by Courtix</p>
    </main>
  );
}
