import type { Metadata } from "next";
import Link from "next/link";
import { param, type SearchParams } from "@/components/Banner";
import { ClubLogo } from "@/components/ClubLogo";
import { PublicFooter } from "@/components/PublicFooter";
import { loadPublicClub, type PublicCoach } from "@/lib/public";
import { addDays, formatLongDay, formatMoney, isValidDate, localTime, todayIn } from "@/lib/time";

export async function generateMetadata(): Promise<Metadata> {
  const { club } = await loadPublicClub();
  return { title: `Private lessons · ${club.name}` };
}

const DAYS_AHEAD = 14;
const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);

// Private lessons: pick a coach, length and group size, then a free start time.
export default async function PublicLessonsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, slug, club } = await loadPublicClub();
  const location = club.locations.find((l) => l.id === param(sp, "location")) ?? club.locations[0];
  if (!location) return <main className="public"><p className="muted">No lessons listed yet.</p></main>;

  const { data } = club.public_booking ? await supabase.rpc("public_lessons", { p_slug: slug }) : { data: [] };
  const coaches = ((data ?? []) as PublicCoach[]).filter((c) => !c.location_ids || c.location_ids.includes(location.id));
  const coach = coaches.find((c) => c.id === param(sp, "coach")) ?? coaches[0];
  // Lengths and group sizes this coach has a price for.
  const options = coach?.prices ?? [];
  const minutesList = [...new Set(options.map((p) => p.minutes))];
  const minutes = Number(param(sp, "minutes")) || (minutesList.includes(60) ? 60 : minutesList[0]);
  const sizes = options.filter((p) => p.minutes === minutes).map((p) => p.group_size);
  const size = sizes.includes(Number(param(sp, "size"))) ? Number(param(sp, "size")) : sizes[0];
  const price = options.find((p) => p.minutes === minutes && p.group_size === size)?.price;

  const today = todayIn(location.timezone);
  const requested = param(sp, "day");
  const day = isValidDate(requested) && requested >= today && requested <= addDays(today, DAYS_AHEAD - 1) ? requested : today;
  const { data: timeData } =
    coach && size
      ? await supabase.rpc("public_lesson_times", { p_slug: slug, p_coach: coach.id, p_location: location.id, p_day: day, p_minutes: minutes })
      : { data: [] };
  const times = (timeData ?? []) as string[];
  const error = param(sp, "error");
  const notice = param(sp, "notice");
  const qs = (over: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    const base = { location: club.locations.length > 1 ? location.id : undefined, coach: coach?.id, minutes, size, day, ...over };
    for (const [k, v] of Object.entries(base)) if (v !== undefined && v !== "") q.set(k, String(v));
    return `/book/lessons?${q.toString()}`;
  };

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
            <Link key={l.id} href={`/book/lessons?location=${l.id}`} className={l.id === location.id ? "active" : undefined}>
              {l.name}
            </Link>
          ))}
        </nav>
      )}
      <nav className="tabs" aria-label="What to book">
        <Link href={`/book${club.locations.length > 1 ? `?location=${location.id}` : ""}`}>Sessions</Link>
        <Link href={`/book/courts${club.locations.length > 1 ? `?location=${location.id}` : ""}`}>Court times</Link>
        <span className="active">Lessons</span>
      </nav>

      {error && <div className="banner error" role="alert">{error}</div>}
      {notice && <div className="banner notice" role="status">{notice}</div>}

      {coaches.length === 0 ? (
        <section className="card">
          <p className="muted">No private lessons to book online here yet. Message the club to arrange one.</p>
        </section>
      ) : (
        <>
          <section className="card" style={{ marginBottom: 12 }}>
            <h2>Coach</h2>
            <nav className="tabs" aria-label="Coach">
              {coaches.map((c) => (
                <Link key={c.id} href={qs({ coach: c.id, minutes: undefined, size: undefined })} className={c.id === coach?.id ? "active" : undefined}>
                  {c.name}
                </Link>
              ))}
            </nav>
            {coach?.about && <p className="muted small">{coach.about}</p>}
            <div className="actions" style={{ marginTop: 8 }}>
              {minutesList.map((m) => (
                <Link key={m} href={qs({ minutes: m, size: undefined })} className={`button${m === minutes ? " primary" : ""}`}>
                  {m} min
                </Link>
              ))}
            </div>
            <div className="actions" style={{ marginTop: 8 }}>
              {sizes.map((n) => (
                <Link key={n} href={qs({ size: n })} className={`button${n === size ? " primary" : ""}`}>
                  {people(n)}
                </Link>
              ))}
            </div>
            {price !== undefined && (
              <p style={{ marginTop: 8 }}>
                <strong>{formatMoney(Number(price), club.currency)}</strong>{" "}
                <span className="muted small">for the lesson{size && size > 1 ? `, ${people(size)} together` : ""}, court included. Pay at the club.</span>
              </p>
            )}
          </section>

          <nav className="tabs days" aria-label="Day">
            {Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d) => (
              <Link key={d} href={qs({ day: d })} className={d === day ? "active" : undefined}>
                {d === today ? "Today" : d === addDays(today, 1) ? "Tomorrow" : new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" })}
              </Link>
            ))}
          </nav>
          <section className="card">
            <h2>{formatLongDay(day)}</h2>
            {times.length === 0 ? (
              <p className="muted">{coach?.name} has no free times this day. Try another day.</p>
            ) : (
              <div className="actions">
                {times.map((t) => (
                  <Link
                    key={t}
                    className="slot-open"
                    href={`/book/lessons/book?${new URLSearchParams({ coach: coach!.id, start: t, minutes: String(minutes), size: String(size), location: location.id })}`}
                  >
                    {localTime(t, location.timezone)}
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      <PublicFooter />
    </main>
  );
}
