# Courtix

Membership and court booking system for racket clubs (pickleball, padel, tennis), built as multi-club SaaS from day one.

**Stack:** Next.js 15 (App Router, server actions) · Supabase (Postgres, auth, row-level security) · TypeScript

## What's in this starter

- **Multi-club:** every row belongs to a club (`org_id`). Row-level security in Postgres keeps clubs fully separate, so one database serves every customer.
- **Staff roles:** owner, manager, staff. Only owners and managers can change prices, packages and courts.
- **Members:** contact details, message language (EN/TH/RU/ZH…), skill level, usual play time, and PDPA marketing consent.
- **Packages:** period packages (monthly, 3-month) and session packs (10 sessions). Selling, cancelling, and **pausing** (end date moves out by the pause length, for low-season leavers).
- **Check-ins:** from the member list, member page, dashboard or the booking calendar. Session packs lose one session per check-in.
- **Court booking:** day calendar per court, member vs drop-in pricing, peak/off-peak price rules, coaching and open-play blocks, maintenance closures, played / no-show / cancel.
- **Booking rules enforced in the database:** no double bookings (exclusion constraint), opening hours, members book up to N days ahead, max N upcoming bookings per member, active package required for member bookings.
- **Retention signals** (the base for the AI step): `member_status` view flags **at risk** (no visit for N days and nothing booked), **renewing soon**, and **drop-in leads**. The dashboard shows them.
- **Sessions (open play, clinics, match play, camps, tournaments, courses):** people sign up for spots instead of booking a whole court.
  - Weekly timetable fills itself into real sessions and holds their courts on the court calendar. Court clashes are flagged, never overwritten.
  - Minimum and maximum players, minimum age, level range (desk can override), sign-up cut-off ("no walk-ins").
  - Full sessions go to a waitlist; when someone cancels, the first person moves up automatically.
  - **Go / no-go check:** a set number of hours before the start, sessions with enough players are confirmed and the rest are cancelled, freeing their courts.
  - One-off events with their own price, levels, coach and courts, including multi-day courses.
  - Attended counts as a visit for retention tracking.
- **Multiple locations:** one club, several sites. Members and packages are shared; courts, timetable, prices and check-ins belong to a site.
  - Each location has its own opening hours, slot length, time zone (a Bali site books in Bali time) and WhatsApp number.
  - **Packages work at every location** unless limited to chosen sites. A member booking at a site their package doesn't cover is booked as a drop-in.
  - Court prices can be club-wide or per location (location rules win).
  - A location picker in the sidebar filters the dashboard, sessions and courts. "All locations" shows everything, with a side-by-side comparison of players, visits, sessions filled and revenue.
  - Desk staff can be limited to their site(s): they see every calendar but can only change bookings and sign-ups where they work.
  - AI follow-ups suggest sessions at the member's home location (or where they actually play) and say which site.
  - Single-site clubs see no difference: the location picker only appears once a second location is added (Settings → Locations).
- **AI follow-ups (Claude):** one click drafts a personal WhatsApp message for every member who needs one, in their own language:
  - **Renewal** (package ending or few sessions left), **Missing you** (active but quiet, or paid and never started), **Drop-in lead** (played but never bought).
  - **Session invites:** for sessions short of players, it picks members whose level and history fit and drafts invites.
  - Messages use real facts only: their package, end date, usual play time, and upcoming sessions with spots. It never invents offers; it only mentions the ones you list.
  - Staff edit if needed, then tap **Send on WhatsApp**, which opens WhatsApp with the message filled in. No WhatsApp API setup needed.
  - Only members with marketing consent; a cooldown stops repeat messages.
  - Tracks results: who came back, signed up, or bought a package within 14 days of a message.
  - Works without an API key using simple English templates, so you can demo it anywhere.
- **Sample data:** one click loads 12 realistic members. On the Sessions page, **Load Raccoon demo timetable** loads Raccoon Pickleball's published timetable and prices (see below).

## Run it locally

You need Node 20+, Docker (for local Supabase) and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
supabase init            # creates supabase/config.toml; keeps the migrations folder
supabase start           # starts Postgres, auth and the API in Docker, and applies migrations
cp .env.example .env.local
# paste the "API URL" and "anon key" from `supabase status` into .env.local
npm run dev
```

Open **http://raccoon.courtix.localhost:3000** in Chrome and sign in as **demo@clubos.test** / **password123** (`supabase db reset` loads this demo club from `supabase/seed.sql`). Each club lives on its own subdomain: the main site is http://courtix.localhost:3000 (sign up, create a club), and a second demo club, Chalong Padel, is at http://chalong.courtix.localhost:3000 (`other@clubos.test` / `password123`). Chrome resolves `*.localhost` to your computer without any setup; in production the same works on `courtix.app` with `ROOT_DOMAIN=courtix.app`.

For AI follow-ups, add your Claude API key (from console.anthropic.com) to `.env.local` as `ANTHROPIC_API_KEY`, then restart `npm run dev`. The default model is `claude-haiku-5-5`; set `ANTHROPIC_MODEL` to change it.

Local email confirmations go to Inbucket at http://localhost:54324.

## Deploy

1. Create a project at supabase.com (choose the Singapore region for Thailand).
2. `supabase link --project-ref <your-ref>` then `supabase db push` to apply the migrations.
3. In Supabase → Authentication → URL configuration, set the site URL to your domain and add `https://your-domain/auth/callback` as a redirect URL.
4. Deploy to Vercel with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `ANTHROPIC_API_KEY` set.
5. Scheduled jobs come with the migrations (`20261118020000_scheduled_jobs.sql`, using `pg_cron`): every hour `run_housekeeping()` expires finished packages, ends finished pauses and keeps two weeks of sessions generated for every club. Check runs in Supabase Studio → Integrations → Cron.

The go / no-go check (`check_session_minimums`) is **not** scheduled yet: on its own it would cancel short sessions without telling players. It will be scheduled together with automatic WhatsApp notices. Until then, use **Run go / no-go check** on the Sessions page.

## Project layout

```
supabase/migrations/   database schema, security rules, booking logic, views
supabase/tests/        smoke test (club isolation, booking rules, retention flags)
lib/                   Supabase clients, current-club lookup, time-zone helpers, types
app/login, onboarding  sign in, sign up, create a club
app/(app)/dashboard    headline numbers, at risk, renewing soon, today on court, leads
app/(app)/members      list with filters, add, member page (packages, pause, visits, bookings)
app/(app)/sessions     week view, session page with sign-ups and waitlist, new event, timetable setup
app/(app)/followups    AI follow-ups: drafts, WhatsApp send, session invites, results, message settings
lib/ai.ts              Claude prompts and API call, template fallback, WhatsApp links
app/(app)/bookings     court calendar and booking form (shows courts held by sessions)
app/(app)/settings     club rules, locations (hours, time zone), courts per location, packages and where they're valid, prices
```

## Where the logic lives

Business rules live in Postgres functions, not only in the UI, so the LINE bot and AI you add next get the same rules for free:

| Function | What it does |
| --- | --- |
| `create_org(name, slug)` | Creates a club, makes you owner, adds starter courts, prices and packages |
| `sell_membership(member, package, starts_on?, price?)` | Works out end date or session count |
| `pause_membership(membership, from, until)` | Pauses and extends the end date |
| `create_booking(court, start, member?, guest?, kind?, minutes?, notes?)` | Applies every booking rule and prices the slot |
| `slot_price(org, start, is_member)` | Price for a slot from the club's rules |
| `refresh_membership_statuses()` | Daily housekeeping (cron) |
| `add_demo_data(org)` | Sample members for demos |
| `generate_sessions(org, days)` | Turns the weekly timetable into sessions and holds courts. Safe to re-run |
| `create_event(type, start, end, …)` | One-off camp, tournament or course |
| `register_for_session(session, member? or guest, …)` | Signs up or waitlists, with level, cut-off and capacity checks |
| `cancel_registration(registration)` | Cancels a place and moves the waitlist up |
| `mark_attendance(registration, attended)` | Attended (counts as a visit) or no-show |
| `cancel_session(session, reason)` | Cancels everything and frees the courts |
| `check_session_minimums(org?)` | Go / no-go decisions; returns what changed so people can be told |
| `followup_candidates(org, limit)` | Who needs a message today, with everything the AI needs to write it |
| `fill_session_candidates(session, limit)` | Best members to invite to a session short of players |
| `member_session_suggestions(member)` | Upcoming sessions with spots that fit one member |
| `can_use_location(org, location)` | Whether the signed-in staff member can make changes at a site |
| `package_valid_at(location_ids, location)` | Whether a package covers a site (null = every site) |
| `load_raccoon_demo(org)` | Raccoon Pickleball's timetable as demo data |

## Testing the database

Against local Supabase:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/smoke_test.sql
```

Then `supabase/tests/sessions_test.sql`, `supabase/tests/ai_followups_test.sql` and `supabase/tests/locations_test.sql` the same way. Every `ERROR` line in the output should be one the test expects (each is labelled "expect: …"). Run it on a fresh local database only, since it creates test users and clubs.

## Updating an existing install

Unzip over your folder (your `.env.local` stays), then:

```bash
npm install
supabase migration up    # applies only the new migrations; your data stays
npm run dev
```

The locations migration moves every existing court, session and booking into one location named after the club. Rename it in Settings → Locations.

**Limiting staff to a location:** there's no staff management screen yet. For now, set it in Supabase Studio (`org_staff.location_ids`, a list of location ids; empty means all locations).

## The Raccoon demo timetable

Built from Raccoon Pickleball's flyers (The Peak Racquet Park, Phuket):

- Open play 350, daily 08:30–11:30 and 18:00–21:00, min 4 players (courts 1–2)
- Adult clinic 500, Mon–Fri 09:00 and Mon–Sat 17:00, min 2 (court 3)
- Kids clinic 600, Mon–Sat 16:00 and Sat 09:00, age 8+, min 2 (court 3)
- Social match play (tennis), Tue/Thu mornings 450, Thu nights 380, level 3.5+
- Court rental 600/hour; Unlimited evenings 3,500 and Unlimited any session 4,000 (30 days); match play buy-10-get-1-free packs
- Coach Kimo camps on 21 and 23 Nov, and the IPTPA coach workshop on 28–29 Nov

**Placeholders to confirm with the club:** maximum players per session, camp start times, the IPTPA workshop price, and which court each session uses.

## Next steps

1. **Run it** and click through with sample data; fix anything that feels wrong at the front desk.
1. **Packages that cover sessions:** unlimited evenings covers evening open play, match play packs use credits, priority booking for "any session" members.
1. **Event ticket tiers:** early bird pricing with a deadline, divisions, pair sign-ups for tournaments.
1. **Coaches and private coaching**, then **orders and payments** (staff-marked first, then PromptPay).
2. **Spreadsheet import** for a real club's member list.
3. **LINE Messaging API:** webhook route that links `line_user_id`, lets members book by chat (calling `create_booking`), and sends messages.
4. **Automatic sending** of approved follow-ups through the LINE or WhatsApp API, and a daily scheduled draft run.
5. **Player matching and waitlist.**
6. **Billing** per club (subscription tiers) once a second club signs up.
