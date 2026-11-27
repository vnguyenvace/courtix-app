# Courtix (repo and code name: club-os)

Membership, court booking and session software for racket clubs (pickleball, padel, tennis) in Phuket, built as multi-club SaaS. The owner is Julian, a developer in Phuket who is building it to sell to local clubs. Julian is the SaaS vendor, not a club owner: club owners and their staff are his customers. Each club gets its own subdomain (`<slug>.courtix.app`). The first target club is Raccoon Pickleball at The Peak Racquet Park.

**Before starting work, read `docs/ROADMAP.md`.** It lists what is done, what is unverified, and the next steps in order. Follow its **Order of work** (automation first: club owners can't sit at a desk all day) unless Julian asks for something else.

## Stack

- Next.js 15 (App Router, React 19, server components and server actions), TypeScript (strict)
- Supabase: Postgres, auth, row-level security (RLS). Local dev runs in Docker via the Supabase CLI.
- Claude API for AI follow-up messages (`lib/ai.ts`, plain `fetch`, no SDK). Default model `claude-haiku-5-5`.
- No CSS framework: one stylesheet, `app/globals.css`, with CSS variables and light/dark themes.

## Commands

```bash
npm install
supabase start                 # local Postgres/auth/API in Docker; applies migrations
npm run dev                    # http://courtix.localhost:3000 (main site), http://raccoon.courtix.localhost:3000 (a club)
npm run typecheck              # tsc --noEmit
npm run build                  # production build; run before saying a change works
npm run test:db                # all SQL tests; resets the LOCAL database between files (wipes local data)
./scripts/test-db.sh locations_test   # one test file
supabase migration up          # apply new migrations without wiping data
supabase db reset              # wipe local DB, re-apply all migrations, load supabase/seed.sql (demo club)
```

Demo login after a reset (Chrome resolves `*.localhost` by itself): `demo@clubos.test` / `password123` at http://raccoon.courtix.localhost:3000; a second club, Chalong Padel, belongs to `other@clubos.test` / `password123` (Raccoon Pickleball with members, sign-ups and bookings; see `supabase/seed.sql`). `npm run test:db` resets with `--no-seed`, so run `supabase db reset` afterwards to get the demo back.

Supabase Studio: http://localhost:54323 · local email inbox: http://localhost:54324

Environment (`.env.local`, never commit): `ROOT_DOMAIN` (`courtix.localhost` locally, `courtix.app` in production), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY` (optional; follow-ups fall back to templates, the reply helper needs it), `ANTHROPIC_MODEL` (optional), `ANTHROPIC_BASE_URL` (optional; proxy or local test stub).

`psql` isn't installed on the host; `scripts/test-db.sh` runs the `psql` inside the `supabase_db_club-os` container. For ad-hoc queries: `docker exec -i supabase_db_club-os psql -U postgres`.

## How the code is organised

```
supabase/migrations/   schema, RLS, business-rule functions, views (source of truth for rules)
supabase/tests/        SQL tests, one file per feature
supabase/seed.sql      local demo data, loaded by `supabase db reset` (not by tests or `migration up`)
scripts/               test-db.sh (runner), check-test-output.sh (pass/fail checker)
lib/org.ts             requireOrg(): signed-in user, current club (from the subdomain), role, locations
lib/tenant.ts          host → club slug, shared sign-in cookie domain, club/main-site URLs (ROOT_DOMAIN)
lib/form.ts            str/optStr/num readers, back() redirect-with-message, friendly() errors
lib/time.ts            time zone helpers (zonedToUtc, todayIn, localTime, slotTimes, formatting)
lib/ai.ts              Claude prompts and call, template fallback, WhatsApp links
lib/types.ts           hand-written row types (keep in sync with migrations)
app/(app)/...          signed-in pages: dashboard, sessions, bookings (courts), members, replies (reply helper), followups, settings
app/(app)/actions.ts   server actions for members, check-ins, bookings, settings, locations
```

### Domain model (short)

- **Club** = `orgs` (the tenant). Every table has `org_id`. Staff join clubs through `org_staff` with role `owner`, `manager` or `staff`, plus optional `location_ids` limiting staff to some sites.
- **Locations**: a club has 1+ sites, each with its own hours, slot length, time zone and WhatsApp number. Courts, sessions, timetable entries, bookings and check-ins belong to a location. Members and packages belong to the club.
- **Packages** (`package_types`): `time_based` (N days unlimited) or `class_pack` (N sessions). `location_ids` null = valid at every location (the default; the club's answer was "memberships normally work everywhere"). **Memberships** are packages sold to members, which can be paused.
- **Court bookings** (`bookings`): a whole court for a time range. Kinds: member, drop_in, open_play, coaching, maintenance. Sessions hold courts by creating bookings with `session_id`.
- **Sessions**: things people sign up for spots in (open play, clinics, match play, camps, tournaments, courses). `session_types` → weekly `session_schedules` → generated `sessions` → `session_registrations` (booked, waitlisted, attended, no_show, cancelled).
- **Retention signals**: the `member_status` view flags `is_at_risk`, `is_renewing_soon` and `is_drop_in_lead`. AI follow-ups (`ai_messages`) are drafted from these flags and sent by staff via a WhatsApp link.

## Rules to follow

**Database**
- **Business rules live in Postgres functions** (`create_booking`, `register_for_session`, `sell_membership`, `generate_sessions`, ...), not only in the UI. Future channels (LINE/WhatsApp bots, public booking page, AI tools) must call the same functions so the rules hold everywhere.
- **Never edit a migration that has been applied.** Julian has migrations applied locally. Add a new timestamped file in `supabase/migrations/` (`YYYYMMDDHHMMSS_name.sql`). To change a function, `create or replace` it in the new file. To change a function's arguments, `drop function` first and re-grant.
- Changing a view: `create or replace view` can only **append** columns at the end. Otherwise drop and recreate it, including dependent views (`sessions_needing_players` depends on `session_overview`).
- Every new table: `org_id`, composite foreign keys `(org_id, x_id)` so rows can't point at another club's data, `enable row level security`, policies using `is_org_staff` / `has_org_role` / `can_use_location`, grants to `authenticated`, and `revoke ... from anon`.
- Functions: `set search_path = ''`, fully qualified names (`public.x`). Prefer `security invoker`, so RLS applies. Use `security definer` only when needed, and check `auth.uid()` and roles inside.
- Write raise messages for front-desk staff ("Court 2 is already booked at that time"). They are shown in the UI via `friendly()`.
- Times: store `timestamptz`. Convert with the **location's** time zone (`locations.timezone`), not the server's. `org_today(org)` and `orgs.timezone` are only for club-wide things.

**Tests**
- Each feature gets a SQL test file in `supabase/tests/`. Convention: print `\echo 'expect: <what>'` on the line directly before any statement that should fail. `scripts/check-test-output.sh` fails on any other `ERROR`, and also fails if an `expect:` statement succeeds.
- Under RLS, an `update`/`delete` on rows you can't see changes 0 rows instead of raising an error. Don't label those `expect:`; select the row afterwards to show it didn't change.
- Tests use fixed user ids (`1111...`, `2222...`, `3333...`), act as them with `set role authenticated; set request.jwt.claim.sub = '<uuid>';`, and need a fresh database (`test-db.sh` resets between files).
- Insert test users as `insert into auth.users (id, email) values (...)`. Always name the columns.
- Run `npm run test:db`, `npm run typecheck` and `npm run build` before reporting a change as done.

**App**
- Pages are server components. Mutations are server actions in `actions.ts` files, called by plain `<form action>`/`formAction`, so they work without client JS. Add `"use client"` components only when needed (see `components/CopyButton.tsx`).
- Every action starts with `requireOrg()` (or a manager check), then calls Supabase **as the user** so RLS applies. Never use the service-role key in request handlers.
- After a mutation: `revalidatePath(...)`, then `back(path, message, "notice")`. Errors: `back(path, friendly(error))`.
- **Club comes from the subdomain** (`<slug>.courtix.app`): `requireOrg()` handles it (no access / not found / main site redirects). Read the host with `requestHost()` or `currentHost()` (they prefer `x-forwarded-host`; a server action's redirect is rendered via an internal request whose Host is the server's own). Never trust the host for permissions: RLS decides. Other hosts (preview URLs, LAN IP) fall back to the club cookie.
- Links to another club or to the main site must be absolute: `currentHost().clubUrl(slug, path)` / `.rootUrl(path)`.
- Location-aware pages use `location` (picked in the sidebar, null = all locations) or `workLocation` (always a concrete site) from `requireOrg()`.
- Keep `lib/types.ts` in sync with schema changes. `npm run db:types` can generate exact types once Supabase is running, if we decide to switch to them.

**Copy and UI**
- Sentence case everywhere ("Book a court", not "Book A Court"). Plain, friendly words for front-desk staff. No "successfully", no exclamation marks in system messages.
- Members speak English, Thai, Russian, Chinese and more. AI messages go out in the member's `language`. UI copy is English for now.
- Mobile matters: front desks often use phones or tablets. Check pages at about 380px wide.

**AI and messaging**
- Product defaults decided 18 Nov 2026 (details in the roadmap's "Automation defaults"); each club can change them in its settings, so build them as per-club settings, not constants:
  - **Follow-ups:** Claude drafts; the club's owner approves them each morning with one tap (Approve all). Nothing outbound goes out without that approval.
  - **Chat (WhatsApp first, LINE later):** Claude may answer and book free or package-covered spots by itself. Private lessons: Claude may hold one as a request with the price, which staff approve (decided 27 Nov 2026); it never confirms a paid lesson itself. Other paid bookings, refunds, complaints and anything unclear go to the club's owner/managers.
  - New automation beyond this (paid bookings by chat, fully automatic follow-ups, automatic cancellation notices) needs Julian's OK first.
- Only message members with `marketing_consent = true` (Thailand's PDPA data privacy law). Respect `followup_cooldown_days`.
- Prompts in `lib/ai.ts`: Claude may use only facts from the context JSON, may mention only offers listed in `orgs.ai_offers`, and member data goes inside `<member>` tags as data, never instructions.
- `ANTHROPIC_API_KEY` is server-only. Never prefix it with `NEXT_PUBLIC_` or import `lib/ai.ts` into a client component (it imports `server-only`).

## Working with Julian

- He's a capable developer who vibe codes. Explain decisions briefly and in plain words, and show what changed.
- Work one roadmap step at a time: DB migration + SQL test first, then the app, then typecheck/build, then update `docs/ROADMAP.md` (tick the box, note anything left open).
- Ask before anything that changes how a club's money or members are handled (pricing logic, payment flows, deleting data, sending messages automatically).
- Facts about Raccoon Pickleball come from their flyers. Values marked as placeholders in the roadmap must be confirmed with the club, not guessed.
