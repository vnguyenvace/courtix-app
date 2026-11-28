/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import {
  CalendarDays, Check, CheckCheck, Globe, GraduationCap, Languages, MessageCircle, Sun, Ticket, Users, Wallet,
} from "lucide-react";
import { COPY, type LandingLang } from "./copy";
import { requestDemo } from "@/app/landing-actions";

// The Courtix front page (courtix.app). Server component, no client JS: the demo form is a
// plain form posting to a server action. Styles: the .lp block in app/globals.css.

const ICONS = {
  chat: MessageCircle, calendar: CalendarDays, ticket: Ticket, users: Users, wallet: Wallet,
  sun: Sun, globe: Globe, coach: GraduationCap, lang: Languages,
} as const;

export function Landing({ lang, sent, error }: { lang: LandingLang; sent: boolean; error: string | null }) {
  const c = COPY[lang];
  const q = lang === "th" ? "?lang=th" : "";

  return (
    <div className="lp" lang={lang}>
      <header className="lp-header">
        <div className="lp-wrap lp-header-row">
          <Link href={`/${q}`} className="lp-logo" aria-label="Courtix">
            <img src="/brand/logo.png" alt="Courtix" height={30} />
          </Link>
          <nav className="lp-nav" aria-label="Courtix">
            <a href="#features">{c.nav.features}</a>
            <a href="#ai">{c.nav.ai}</a>
            <a href="#day">{c.nav.how}</a>
            <a href="#faq">{c.nav.faq}</a>
          </nav>
          <div className="lp-header-actions">
            <span className="lp-lang">
              <Link href="/" className={lang === "en" ? "on" : undefined} hrefLang="en">EN</Link>
              <Link href="/?lang=th" className={lang === "th" ? "on" : undefined} hrefLang="th">ไทย</Link>
            </span>
            <Link href="/login" className="lp-signin">{c.nav.signIn}</Link>
            <a href="#demo" className="lp-btn lp-btn-small">{c.nav.demo}</a>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-text">
              <p className="lp-eyebrow">{c.hero.eyebrow}</p>
              <h1>{c.hero.title}</h1>
              <p className="lp-lead">{c.hero.lead}</p>
              <div className="lp-cta-row">
                <a href="#demo" className="lp-btn">{c.hero.primary}</a>
                <a href="#features" className="lp-btn lp-btn-ghost">{c.hero.secondary}</a>
              </div>
              <p className="lp-note">{c.hero.note}</p>
            </div>
            <figure className="lp-phone" aria-label={c.chat.caption}>
              <div className="lp-phone-top">
                <img src="/brand/mark.png" alt="" width={30} height={30} />
                <span>
                  <strong>{c.chat.club}</strong>
                  <small>LINE</small>
                </span>
              </div>
              <div className="lp-chat">
                <p className="lp-msg me">{c.chat.q1}</p>
                <p className="lp-msg bot">{c.chat.a1}</p>
                <p className="lp-msg me">{c.chat.q2}</p>
                <p className="lp-booked"><CheckCheck size={15} aria-hidden /> {c.chat.booked}</p>
                <p className="lp-msg bot">{c.chat.a2}</p>
              </div>
              <figcaption>{c.chat.caption}</figcaption>
            </figure>
          </div>
        </section>

        <div className="lp-strip">
          <div className="lp-wrap lp-strip-row">
            {c.strip.map((s) => (
              <span key={s}><Check size={15} aria-hidden /> {s}</span>
            ))}
          </div>
        </div>

        {/* Problem */}
        <section className="lp-section">
          <div className="lp-wrap lp-problem">
            <div>
              <h2>{c.problem.title}</h2>
              <p className="lp-lead">{c.problem.lead}</p>
            </div>
            <div className="lp-stats">
              {c.problem.points.map((p) => (
                <div key={p.t} className="lp-stat">
                  <strong>{p.k}</strong>
                  <span>{p.t}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="lp-section lp-tinted" id="features">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <h2>{c.features.title}</h2>
              <p className="lp-lead">{c.features.lead}</p>
            </div>
            <div className="lp-features">
              {c.features.items.map((f) => {
                const Icon = ICONS[f.icon];
                return (
                  <article key={f.t} className="lp-feature">
                    <span className="lp-icon"><Icon size={22} strokeWidth={1.75} aria-hidden /></span>
                    <h3>{f.t}</h3>
                    <p>{f.d}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* AI rules */}
        <section className="lp-section lp-dark" id="ai">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <h2>{c.ai.title}</h2>
              <p className="lp-lead">{c.ai.lead}</p>
            </div>
            <div className="lp-rules">
              {c.ai.rules.map((r, i) => (
                <article key={r.t} className="lp-rule">
                  <span className="lp-rule-n">{String(i + 1).padStart(2, "0")}</span>
                  <h3>{r.t}</h3>
                  <p>{r.d}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* A day */}
        <section className="lp-section" id="day">
          <div className="lp-wrap lp-narrow">
            <h2 className="lp-center">{c.day.title}</h2>
            <ol className="lp-timeline">
              {c.day.items.map((d) => (
                <li key={d.time}>
                  <time>{d.time}</time>
                  <div>
                    <h3>{d.t}</h3>
                    <p>{d.d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Pricing teaser */}
        <section className="lp-section lp-tinted">
          <div className="lp-wrap lp-narrow lp-center lp-pricing">
            <h2>{c.pricing.title}</h2>
            <p className="lp-lead">{c.pricing.lead}</p>
            <a href="#demo" className="lp-btn">{c.pricing.cta}</a>
          </div>
        </section>

        {/* FAQ */}
        <section className="lp-section" id="faq">
          <div className="lp-wrap lp-narrow">
            <h2 className="lp-center">{c.faq.title}</h2>
            <div className="lp-faq">
              {c.faq.items.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Demo form */}
        <section className="lp-section lp-demo" id="demo">
          <div className="lp-wrap lp-demo-grid">
            <div>
              <h2>{c.demo.title}</h2>
              <p className="lp-lead">{c.demo.lead}</p>
            </div>
            <div className="lp-demo-card">
              {sent ? (
                <p className="lp-sent" role="status"><CheckCheck size={22} aria-hidden /> {c.demo.sent}</p>
              ) : (
                <form action={requestDemo} className="lp-form">
                  <input type="hidden" name="lang" value={lang} />
                  {error && <p className="lp-error" role="alert">{error}</p>}
                  <div className="lp-form-row">
                    <label>{c.demo.name}<input name="name" required maxLength={100} autoComplete="name" /></label>
                    <label>{c.demo.club}<input name="club" required maxLength={120} autoComplete="organization" /></label>
                  </div>
                  <div className="lp-form-row">
                    <label>{c.demo.contact}<input name="contact" required maxLength={120} autoComplete="tel" /></label>
                    <label>{c.demo.email}<input name="email" type="email" maxLength={200} autoComplete="email" /></label>
                  </div>
                  <fieldset>
                    <legend>{c.demo.sports}</legend>
                    {(["pickleball", "padel", "tennis", "other"] as const).map((s) => (
                      <label key={s} className="lp-check">
                        <input type="checkbox" name="sports" value={s} /> {c.demo.sportNames[s]}
                      </label>
                    ))}
                  </fieldset>
                  <label className="lp-courts">{c.demo.courts}<input name="courts" type="number" min={1} max={200} inputMode="numeric" /></label>
                  <label>{c.demo.message}<textarea name="message" rows={3} maxLength={2000} placeholder={c.demo.messagePh} /></label>
                  <button className="lp-btn">{c.demo.submit}</button>
                  <p className="lp-fine">
                    {c.demo.privacy} <Link href="/privacy">{c.demo.privacyLink}</Link>
                  </p>
                </form>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-row">
          <div>
            <img src="/brand/logo-on-dark.png" alt="Courtix" height={26} />
            <p>{c.footer.tagline}</p>
          </div>
          <nav>
            <Link href="/privacy">{c.footer.privacy}</Link>
            <Link href="/terms">{c.footer.terms}</Link>
            <Link href="/login">{c.footer.signIn}</Link>
          </nav>
          <p className="lp-made">© 2026 Courtix · {c.footer.made}</p>
        </div>
      </footer>
    </div>
  );
}
