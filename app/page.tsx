import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClubBrandStyle, clubIcons, clubOpenGraph } from "@/components/ClubBrand";
import { ClubLogo } from "@/components/ClubLogo";
import { StateBadge } from "@/components/PublicBits";
import { levelText } from "@/components/SessionBits";
import { whatsappLink } from "@/lib/ai";
import { currentHost } from "@/lib/host";
import { loadPublicClub, type PublicSession } from "@/lib/public";
import { formatLongDay, formatMoney, localTime } from "@/lib/time";
import { PublicFooter } from "@/components/PublicFooter";
import { Landing } from "@/components/landing/Landing";
import { COPY } from "@/components/landing/copy";
import { translateMessage } from "@/lib/i18n";
import { headers } from "next/headers";

// <slug>.courtix.app/ is the club's public front page: who they are, where, what's on, and how to
// book. Staff sign in from a link on it. On the main site (courtix.app/) it's the Courtix landing
// page (components/landing), in English or Thai (?lang=th, else the browser's language).

const UPCOMING = 6;

type SP = Promise<Record<string, string | string[] | undefined>>;

async function landingLang(sp: Awaited<SP>): Promise<"en" | "th"> {
  if (sp.lang === "th") return "th";
  if (sp.lang === "en") return "en";
  const accept = (await headers()).get("accept-language") ?? "";
  return /^th\b/i.test(accept.trim()) ? "th" : "en";
}

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const host = await currentHost();
  if (host.kind !== "club") {
    const lang = await landingLang(await searchParams);
    const description = COPY[lang].hero.lead;
    return {
      title: { absolute: "Courtix · AI Assisted Court Management" },
      description,
      openGraph: { title: "Courtix · AI Assisted Court Management", description, siteName: "Courtix", images: ["/brand/og.png"] },
      alternates: { languages: { en: "/", th: "/?lang=th" } },
    };
  }
  const { club } = await loadPublicClub();
  const where = club.locations.map((l) => l.name).join(", ");
  return {
    title: club.name,
    description: `Sessions, court times and bookings at ${club.name}${where ? ` (${where})` : ""}`,
    icons: clubIcons(club),
    openGraph: clubOpenGraph(club),
  };
}

export default async function Home({ searchParams }: { searchParams: SP }) {
  const host = await currentHost();
  if (host.kind === "root") {
    const sp = await searchParams;
    const lang = await landingLang(sp);
    const err = typeof sp.demo_error === "string" ? translateMessage(lang, sp.demo_error.slice(0, 300)) : null;
    return <Landing lang={lang} sent={sp.sent === "1"} error={err} />;
  }
  if (host.kind !== "club") redirect("/dashboard");

  const { supabase, slug, club } = await loadPublicClub();
  const [{ data: sessionData }, { data: userData }] = await Promise.all([
    club.public_booking
      ? supabase.rpc("public_sessions", { p_slug: slug, p_location: null, p_days: 7 })
      : Promise.resolve({ data: [] }),
    supabase.auth.getUser(),
  ]);
  const upcoming = ((sessionData ?? []) as PublicSession[]).slice(0, UPCOMING);
  const signedIn = !!userData.user;
  const multi = club.locations.length > 1;
  const main = club.locations[0];
  const wa = whatsappLink(main?.whatsapp, `Hi ${club.name}, I have a question.`);

  return (
    <>
      <ClubBrandStyle club={club} />
      <main className="public">
        <div className="public-top">
          {club.public_booking && <Link href="/book/me" className="small">Member sign in</Link>}
          {signedIn ? (
            <Link href="/dashboard" className="button small-button">Open dashboard</Link>
          ) : (
            <Link href="/login" className="muted small">Staff sign in</Link>
          )}
        </div>

        <header className="landing-hero">
          <ClubLogo path={club.logo_path} name={club.name} />
          <div>
            <h1>{club.name}</h1>
            <p className="muted">
              {multi ? club.locations.map((l) => l.name).join(" · ") : main?.address ?? main?.name ?? ""}
            </p>
          </div>
        </header>

        <div className="actions landing-actions">
          {club.public_booking && <Link href="/book" className="button primary">Book a session</Link>}
          {club.public_booking && main && <Link href="/book/courts" className="button">Court times</Link>}
          {wa && <a href={wa} className="button">WhatsApp us</a>}
        </div>

        {club.public_booking && (
          <section className="public-day">
            <div className="landing-section-head">
              <h2>Coming up</h2>
              <Link href="/book" className="small">See all sessions</Link>
            </div>
            {upcoming.length === 0 ? (
              <p className="muted">No sessions in the next week. Check back soon or message us on WhatsApp.</p>
            ) : (
              <ul className="public-list">
                {upcoming.map((s) => {
                  const day = new Date(s.starts_at).toLocaleDateString("en-CA", { timeZone: s.location_timezone });
                  return (
                    <li key={s.id}>
                      <Link href={`/book/s/${s.id}`} className="public-session">
                        <span className="public-time">{localTime(s.starts_at, s.location_timezone)}</span>
                        <span className="public-main">
                          <strong>{s.name}</strong>
                          <span className="muted small">
                            {formatLongDay(day)}
                            {s.level_min !== null || s.level_max !== null ? ` · ${levelText(s.level_min, s.level_max)}` : ""}
                            {multi ? ` · ${s.location_name}` : ""}
                          </span>
                        </span>
                        <span className="public-side">
                          <span>{formatMoney(s.price, club.currency)}</span>
                          <StateBadge s={s} />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        <section className="public-day">
          <h2>{multi ? "Where to find us" : "Find us"}</h2>
          <div className="landing-locations">
            {club.locations.map((l) => {
              const lwa = whatsappLink(l.whatsapp, `Hi ${club.name} ${l.name}, I have a question.`);
              return (
                <div key={l.id} className="card">
                  <h3>{l.name}</h3>
                  {l.address && <p>{l.address}</p>}
                  <p className="muted small">Open {l.opens_at.slice(0, 5)}–{l.closes_at.slice(0, 5)}</p>
                  <div className="actions">
                    {l.address && (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${club.name} ${l.address}`)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="small"
                      >
                        Map
                      </a>
                    )}
                    {lwa && <a href={lwa} className="small">WhatsApp {l.whatsapp}</a>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <PublicFooter />
      </main>
    </>
  );
}
