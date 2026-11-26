# Roadmap

Work top to bottom. Tick a box when its "Done when" list is met, and add a dated note under the step if anything is left open. Each step: migration + SQL test first, then app pages, then `npm run typecheck`, `npm run build` and `npm run test:db`.

## Status

### Built
- Multi-club setup with RLS isolation, staff roles, onboarding (`create_org` adds 2 courts, starter prices and packages).
- Members, packages (period and session packs), selling, pausing, cancelling, desk check-ins.
- Court booking calendar per location: hours, peak/off-peak and per-location prices, member vs drop-in, booking-ahead and active-booking limits, no double bookings, coaching/open-play/maintenance blocks.
- Sessions: types, weekly timetable, generated sessions holding courts, sign-ups, waitlist with automatic promotion, level/age/cut-off rules, go / no-go minimum-player check, one-off events (including multi-day), attendance.
- AI follow-ups: renewal / missing you / drop-in lead / session invites, drafted by Claude in each member's language, sent by staff via WhatsApp link, consent and cooldown, 14-day outcome tracking.
- Reply helper (`/replies`, 18 Nov 2026): staff paste a message from WhatsApp/LINE, Claude drafts an answer from `inquiry_context()` (sessions with spots, prices, packages, court hire, the member's package and bookings), staff edit and send via WhatsApp/LINE link. Needs `ANTHROPIC_API_KEY`; without it the page lists the next 3 days' sessions and prices. Drafts only, never books.
- Multiple locations: per-site hours, time zone, courts, timetable, prices; packages valid everywhere by default; staff limited to sites; location picker and per-location dashboard comparison.
- Demo data: `add_demo_data` (12 sample members) and `load_raccoon_demo` (Raccoon's real timetable and prices). `supabase/seed.sql` builds a ready demo club on every `supabase db reset` (login `demo@clubos.test` / `password123`), with WhatsApp numbers, session sign-ups and court bookings.

- Editing (18 Nov 2026, migration `20261118060000_edit_sessions.sql`, test `edit_sessions_test.sql`): owners and managers can edit **one session** (session page → Edit session: time, price, players, levels, coach, courts, text), a **session type** (Sessions → Set up → Edit, with "also update upcoming sessions"), and a **timetable entry** (days, start time, courts, end date). Booked places keep their price; limits can't drop below people booked; raising a limit moves the waitlist up; court holds follow the time. Hand-edited sessions (`sessions.edited_at`) are skipped by later type/timetable changes. Timetable edits remake only upcoming sessions nobody has signed up for; sessions with people keep their time and are listed for staff to move or cancel. `sessions.schedule_slot` remembers the timetable slot, so a moved session isn't recreated at its old time.
- Fixed 18 Nov 2026: `Referrer-Policy: no-referrer` made Chrome send `Origin: null` on plain form posts (before JavaScript loads), and every server action then failed with a 500 (sign-in included). Now `same-origin` (`next.config.ts`).

- Club logo and colours on the public booking page, and a public front page per club (26 Nov 2026), see Step 6 notes.
- Chat booking with Claude, tested in the app until WhatsApp is connected (26 Nov 2026), see Step 9 notes.

### Verified so far
- All migrations and the four SQL test files pass on **real local Supabase** (Postgres 17) via `npm run test:db` (18 Nov 2026).
- `lib/time.ts` and `lib/ai.ts` were unit-tested with tsx (time zones, WhatsApp numbers, prompts, a simulated Claude API response).
- The Next.js app installs, type-checks, builds and was clicked through end to end in a headless browser (18 Nov 2026). See Step 0 notes. Not yet tried: drafts from the real Claude API.

---

## Order of work (decided 18 Nov 2026)

Courtix is a SaaS that Julian sells to many clubs; each club gets its own subdomain (`<slug>.courtix.app`). Club owners are often one person who can't sit at a desk all day, so **automation comes first**. Work in this order (step numbers kept so references stay valid):

1. **Step 0** (finish: check real Claude drafts once there's an API key)
2. **Step 10a: Deploy with club subdomains** (hosted Supabase in Singapore + Vercel with a wildcard domain). Nothing automatic can run while the app lives on a laptop.
3. **Step 10: Scheduled jobs**
4. **Step 2: Packages that cover sessions** (needed before chat booking, so package holders aren't charged per session)
5. **Step 9: WhatsApp** (LINE after), with the defaults below
6. **Step 9b: Morning approval list**
7. **Steps 6 and 7: Public booking page and PromptPay**
8. **Step 11: SaaS billing** moves up once a second club is close; then Steps 1, 3, 4, 5, 8.

### Automation defaults (Julian, 18 Nov 2026)
These are **product defaults**. Each club can change them in its settings (per-club columns on `orgs`, not hard-coded):
- **Chat autonomy, default "answer and book free spots":** in WhatsApp/LINE chat, Claude answers questions **and books** sessions and courts that are free or covered by the member's package. Paid bookings, refunds, complaints, private coaching and anything unclear go to the club's owner/managers. Other settings to offer: "answer only", and later "also send a PromptPay link for paid spots" (Step 7, check with Julian first).
- **Follow-ups, default "morning approval":** not sent automatically. Every morning the club's owner (and managers who opt in) get a list on their phone and tap **Approve all** (or edit or skip single ones); approved messages then go out by WhatsApp.
- **WhatsApp first, LINE after.** Each club connects **its own** WhatsApp number; Courtix acts as a Meta Tech Provider (Embedded Signup), see Step 9.

---

## Step 0: First run and fix  ☐

Goal: the app installs, type-checks, builds and works end to end on Julian's machine against local Supabase.

1. `npm install`, then `supabase start` (Docker Desktop must be running).
2. `npm run test:db` and fix any failures. These would be differences between real Supabase and the plain-Postgres stub the tests were written against.
3. `npm run typecheck` and fix every error. Likely spots: Supabase query result typing (`data` possibly null, joined relations typed as arrays), `FormData.getAll` types, the `Promise.resolve({ data: [] })` branch in the dashboard's `Promise.all`.
4. `npm run build` and fix errors (server/client boundaries, `server-only` imports, async `searchParams`/`params` in Next 15).
5. Click through in the browser:
   - Create account → create club → **Load sample members** (dashboard) → **Load Raccoon demo timetable** (Sessions).
   - Courts: book a member slot, a drop-in, a coaching block; try a double booking (must be refused with a clear message).
   - Sessions: sign people up until full, check the waitlist, cancel a place (waitlist moves up), mark attended, run the go / no-go check.
   - Members: add a member with a package, pause it, check in.
   - AI follow-ups: **Write today's drafts** without an API key (templates), then with `ANTHROPIC_API_KEY` set. Check the language and facts. Open **Send on WhatsApp**.
   - Settings → Locations: add a second location; check the sidebar picker, the court calendar per site, the dashboard comparison, and a package limited to one site.
   - Check every page at about 380px wide.
6. Fix what's broken. Write down anything that works but feels wrong at a front desk, and ask Julian before redesigning it.

Done when: test:db, typecheck and build all pass; the click-through above works without errors; findings are noted here.

**Notes, 18 Nov 2026.** test:db, typecheck and build pass. Click-through done for everything except **drafts with `ANTHROPIC_API_KEY` set** (no key on this machine yet). Tick this step once Julian has checked a few real drafts for language and facts.

Setup added: own git repo in `club-os/` (the git root used to be the home folder), `supabase/config.toml` (`supabase init`), `scripts/test-db.sh` + `scripts/check-test-output.sh` (uses `psql` inside the db container; psql isn't installed on the host), `npm run test:db`, `.env.local` with local keys, `outputFileTracingRoot` in `next.config.ts` (a stray `~/package-lock.json` confused Next).

Fixed:
- Tests: `insert into auth.users` now names its columns (real `auth.users` has many). Two expected failures in the smoke test got `expect:` labels; one in the locations test was wrong (RLS updates change 0 rows, they don't error) and now checks the row instead.
- Typecheck: typed the Supabase cookie `setAll` callbacks (`@supabase/ssr` overloads stop inference).
- **Create club did nothing**: the slug input's `pattern="[a-zA-Z0-9-]"` is invalid under Chrome's `v`-flag regex, which broke form validation. Escaped the dash.
- **Court calendar hid sessions starting off the hour**: open play 08:30–11:30 left the 08:00 slot showing "Book" (would be refused) and started with "continued" at 09:00. Slots now count any overlap, and off-grid bookings show their real times.
- **Every page scrolled sideways at 380px**: the mobile nav didn't wrap and the grid column couldn't shrink. Fixed in `globals.css`; the Sessions week list now wraps price/spots/status onto a second line on phones.
- **No sign out on phones** (the sidebar footer was hidden on mobile). Now shown, without the email.
- "Ends … (in 1 days)" → "(tomorrow)". Time zone list showed "Asia/Ho Chi_Minh". Added `app/icon.svg` (favicon 404).

Works but may feel wrong at a front desk (ask Julian before changing):
- **Pause starts immediately**, whatever the "from" date: `pause_membership` sets status `paused` now, so a member pausing from next week can't book as a member this week. Options: only allow pauses starting today, or support scheduled pauses (nightly job flips the status).
- Check-in is allowed for a **paused** member with no warning, and two check-ins a minute apart are both recorded.
- **Send on WhatsApp** marks the message sent as soon as WhatsApp opens, and it opens in the same tab, so the desk leaves the app.
- Sample members have no phone numbers, so the demo never shows **Send on WhatsApp**. Could add numbers in a new migration that replaces `add_demo_data`.
- "Court 1 is already booked at that time" is also shown when a **session** holds the court; naming the session ("held by Open play 08:30–11:30") would help.
- "Cancel" on a sign-up or court booking acts on one tap, with no confirmation.
- Courts header says "9 booked of 70 slots" but counts bookings (a 3-hour session is 1), not slots.
- Kids clinic (age 8+) lists every member in the sign-up picker; members have no birth date, so the age rule can't be checked for members.
- Coach Kimo camps (21 Nov) show the 2,500 early-bird price after the 15 Nov deadline: expected until Step 4 (price tiers).
- Generated sessions skip a court that is already booked (Thursday 18:00 open play got only Court 2 because a sample member had Court 1). Correct, but easy to miss: the session list just shows fewer courts.

**Note, 26 Nov 2026:** `sessions_test.sql` now fails: it looks up the Coach Kimo camp (21 Nov 2026), which is in the past, so `:'camp'` is empty. The test needs a date-independent event. Not caused by the branding work (it fails the same way without it).

## Step 1: Staff management page  ☐

Clubs need to add desk staff without Supabase Studio.

- Settings → Staff: list staff with role and locations; invite by email (Supabase `auth.admin.inviteUserByEmail` needs the service-role key, so put it in a separate server-only module with an explicit owner check, or use a sign-up link with a one-time invite code stored in an `org_invites` table, which is simpler and keeps the service key out of the app. Ask Julian which).
- Owners can change roles and `location_ids`, and remove staff. Owners can't remove the last owner.
- Desk staff limited to one location land on that location automatically (already handled in `requireOrg`).

Done when: an owner can invite a desk person limited to one site, that person signs up, sees only their site's write actions, and the SQL test covers invite acceptance and the last-owner rule.

## Step 2: Packages that cover sessions  ☑

Raccoon sells "Unlimited evenings" (3,500 / 30 days, evening open play), "Unlimited any session" (4,000 / 30 days, plus priority booking) and match play "buy 10 get 1 free" credit packs (11 credits). Today signing up for a session ignores packages and always records the drop-in price.

- New table `package_coverage` (package_type_id → session category and/or specific session_type_id, optional time window like 17:00–22:00, optional days). A package with no coverage rows covers court booking only (today's behaviour).
- `register_for_session`: if the member has an active package that covers this session at this location, record price 0 and `covered_by_membership_id`. For class packs, use one credit (on sign-up or on attendance? **ask Julian**, and refund the credit on cancellation either way).
- Priority booking: "any session" members can sign up N days earlier than others (`priority_days` on package_types).
- Show "Covered by Unlimited evenings" or "Uses 1 of 7 credits" on the sign-up form and roster.
- Update `load_raccoon_demo` (in a new migration) to add coverage for Raccoon's packages.

Done when: an unlimited-evenings member signs up for 18:00 open play at 0 THB, pays 500 for a 09:00 clinic, a credit pack goes 11 → 10 and back to 11 on cancel, and the SQL test covers all of it.

**Notes, 18 Nov 2026.** Built: migration `20261118040000_package_coverage.sql`, test `package_coverage_test.sql`. Decided with Julian: **a credit is used at sign-up** (when the place is booked; waitlisted places take it when they move up, or pay the drop-in price if the pack ran out by then), **cancelling before the club's cut-off refunds it** (`orgs.late_cancel_hours`, default 24, in Settings), late cancels and no-shows lose it, and a session the club cancels (by hand or go / no-go) refunds everyone. Unlimited packages are used before credits. Session check-ins ("Attended") no longer use a credit (they used to, which would have charged twice); desk check-ins still do. Priority booking: `session_types.signup_opens_days` (null = any time) plus `package_types.priority_days`; the desk override lets anyone in early.
App: Settings → Packages → "Sessions it covers" (rules, priority days), late-cancel cut-off in club settings, sign-up window per session type (Sessions → Set up), coverage hints in the session sign-up picker, "Covered by…" / "1 credit (9 left)" / "Pays 500" on the roster, and credit messages on sign-up and cancel.
Left open: Raccoon's priority-booking days are a **placeholder (2)** until the club confirms; the demo's sample members have the old starter packages, which cover no sessions. The reply helper and AI follow-ups don't yet tell members their package covers a session (prices shown are drop-in prices).

## Step 3: Orders and payments (staff-marked)  ☐

Every sale becomes an order so the club can see what's paid and what's owed.

- Tables: `orders` (member or guest, location, status: pending/paid/refunded/cancelled, total, method: cash/transfer/promptpay/card, paid_at, received_by), `order_items` (what was bought: package, session registration, court booking, event ticket; amount).
- Selling a package, a drop-in session place and a drop-in court booking each create an order (pending or paid).
- Desk can mark paid (cash or transfer) and attach a transfer slip photo (Supabase Storage bucket, private, RLS by org).
- Dashboard: money in today/this month per location, unpaid orders list.
- Move "package sales this month" and the location revenue figures onto orders, so revenue is counted once and correctly.

Done when: every paid thing has an order, unpaid ones are listed, totals per location match the orders, and the SQL test covers it. **Check with Julian before changing any revenue figure the owner already sees.**

## Step 4: Event ticket tiers  ☐

For the Coach Kimo camps (early bird 2,500 until 15 Nov, then 3,300), the Parents Pickleball Cup (divisions, pairs), and the IPTPA workshop (30 spots).

- `session_price_tiers` (label, price, available_until, max_qty), with the current tier picked at sign-up time.
- Divisions within an event (beginner/open), each with its own capacity.
- Pair sign-ups: one registration with a partner (member or guest), counting as 2 spots.
- Registration deadline separate from `book_by`.

Done when: an early-bird sign-up records 2,500 before the deadline and 3,300 after; pair sign-ups fill 2 spots; divisions fill separately; tests cover it.

## Step 5: Coaches and private coaching  ☐

- `coaches` table (name, level, rates, active locations), linked from sessions instead of the free-text `coach_name`. Keep the old column for history.
- Coach calendar: a coach can't be in two places at once (exclusion constraint like courts).
- Private lessons: book a coach + court together. Price by group size (Raccoon: 1 pax 2,800? **confirm**: their flyer shows 1–4 pax prices and a 30-minute option), plus hour packages as credits.

Done when: a private lesson books a coach and a court in one step, clashes are refused, group-size pricing works, and tests cover it.

## Step 6: Public booking page per location  ☑

Replace "DM to book" on the flyers with a link and QR code.

- Public pages on the club's subdomain (`<slug>.courtix.app/book`, `/book/[location]` for multi-site clubs): timetable with spots left, session details, court availability.
- Sign up as a guest (name + WhatsApp + consent tick) or a known member (phone lookup with a one-time code via WhatsApp later).
- Holds a spot for 15 minutes as a pending order. Payment comes in step 7; until then the order stays pending for staff to confirm.
- Needs carefully scoped anon access: read-only views of public session info through `security definer` functions, never direct table access. Rate-limit sign-ups.

Done when: a stranger can open the link on a phone, see real sessions, request a spot, and staff see it as a pending order. Anon can't read members or anything else (test it).

**Notes, 18 Nov 2026.** Built: migration `20261118050000_public_booking.sql`, test `public_booking_test.sql`, pages `app/book` (timetable), `app/book/s/[id]` (session + sign-up form), `app/book/courts` (free court times). Decided with Julian: **an online sign-up takes the spot straight away** (pay at the club; there are no orders yet, so "pending order" became a booked place marked `source = 'online'`), and **courts show free times only**, with each free slot opening WhatsApp with the request typed in. Visitors only reach four security-definer functions (`public_club`, `public_sessions`, `public_court_slots`, `public_register`); no table access. Online sign-ups are always guests at the drop-in price: a phone number is never matched to a member, so nobody can spend someone else's credits. Spam limits: one live place per number per session, 3 online sign-ups per number per day, 60 per club per hour, plus a hidden honeypot field. Consent: a required "may contact me about this booking" tick and an optional marketing tick (stored on the sign-up).
Staff side: Settings → Booking page (link, QR code for flyers, on/off), Sessions → Set up → "Hide online" per session type, "booked online" on the roster, and an "Online sign-ups" card on the dashboard.
**Approval option (added 18 Nov 2026, Julian's request):** Settings → Booking page → "When someone signs up online": *They get the spot straight away* (default) or *Request, staff approve* (`orgs.online_signups = 'approve'`). Requests are saved as the new registration status `requested`, take no spot, and show with **Approve / Decline** on the dashboard and the session page. Approving books them, or waitlists them if the session filled up in the meantime; declining cancels. Open requests close when the session is cancelled. Migrations `20261118050100_requested_status.sql` (enum value on its own) and `20261118050200_online_approval.sql`, test `online_approval_test.sql`.
**Logo and colours (added 26 Nov 2026, Julian's request):** Settings → Logo and colours. The owner or a manager uploads a logo (PNG/JPG/WebP/GIF/SVG, up to 4 MB). The server re-encodes it as a PNG of at most 512 px (strips photo GPS data; SVGs become pixels, so no script) with `sharp`, stores it in the public Storage bucket `club-logos` under `<org_id>/`, and picks a main and second colour from it (`lib/logo.ts`; ignores white, transparent and anti-aliased edge pixels). "Pick colours from the logo" can be unticked to keep the current colours. The owner can change both colours (the colour picker suggests the ones found in the logo) or go back to the standard Courtix colours. The booking pages show the logo (also as the browser tab icon), use the main colour for buttons, tabs and links, and the second colour for a top stripe and session times. `lib/brand.ts` darkens or lightens colours just enough to stay readable in light and dark mode (a yellow brand gets dark text on yellow buttons and deep gold links). Migration `20261126000000_club_branding.sql`, test `club_branding_test.sql` (only owners/managers of that club can upload; desk staff, other clubs and visitors can't). The staff app keeps the Courtix colours.
**Club front page (added 26 Nov 2026, Julian's request):** `<slug>.courtix.app/` is now a public landing page instead of the staff sign-in: logo and colours, Book a session / Court times / WhatsApp buttons, the next 6 sessions, and each location's address (Google Maps link), hours and WhatsApp (`app/page.tsx`). A small "Staff sign in" link (top right and footer) goes to `/login`, which now has the club's colours and a link back. Signed-in staff see "Open dashboard" instead. Signing out lands on the front page. Staff pages still send signed-out people to `/login`, and the main site `courtix.app/` behaves as before.
Left open: the colour preview in Settings updates after **Save colours**, not while picking (no client JavaScript). Local dev needs Storage and its schema on the same version: if uploads fail with "database error, code: 42P10", run `supabase stop && supabase start`.
Left open: members recognised by phone with a one-time WhatsApp code (needs Step 9), so members can use their package online; visitors can't cancel online yet (they message the club); IP-based rate limiting (only per number and per club for now); no confirmation message is sent (needs Step 9).

## Step 7: PromptPay checkout  ☐

- Payment provider: Opn (Omise) or Stripe, both of which support PromptPay in Thailand. **Julian picks after comparing fees.**
- Checkout from the public page and from a staff "send payment link" button; the webhook marks the order paid; failed or expired payments release the held spot.
- Per-club provider keys (SaaS): store encrypted, never expose to the client.

Done when: a test-mode PromptPay payment marks an order paid via webhook, and an expired one frees the spot.

## Step 8: Spreadsheet import  ☐

- Upload CSV/XLSX of members (name, phone, language, package, start/end date, sessions left, home location). Preview, map columns, validate, then import in one transaction.
- Normalise Thai phone numbers (`0…` → `+66…`), skip duplicates by phone.

Done when: a 200-row file imports with a clear error list for bad rows and no partial imports.

## Step 9: WhatsApp and LINE messaging APIs  ☐

- Channel-agnostic `messages` layer: `channels` per location (whatsapp/line, credentials), inbound webhook routes, outbound sender.
- Link people to members (match phone; LINE needs a one-time code).
- Chat booking: Claude with tool use, where the tools call the same DB functions (`list sessions`, `register_for_session`, `create_booking`, `cancel_registration`), acting as a dedicated service identity scoped to one club. Hand off to staff on anything unclear.
- Send approved AI follow-ups and automatic notices (booking confirmations, waitlist promotions, go / no-go cancellations returned by `check_session_minimums`). WhatsApp proactive messages need approved templates.
- WhatsApp first (Raccoon's flyers all say WhatsApp).
- **Multi-club WhatsApp:** Julian's business registers as a Meta **Tech Provider**; each club connects its own WhatsApp Business Account and number through **Embedded Signup** in Settings. Store each club's tokens encrypted, per location. One webhook endpoint for all clubs routes by phone number id to the right club. Message templates are per club (each club's WABA). Who pays Meta's per-message fees (club's own WABA billing vs passed through) is a pricing decision for Julian.
- Per-club settings: chat autonomy level and who gets hand-offs (owner/managers' WhatsApp numbers).
- Chat answers should reuse `inquiry_context()` and the reply prompt in `lib/ai.ts` (`buildReplySystemPrompt`), adding tools for booking.
- Already in place (18 Nov 2026): `members.preferred_channel` (null = automatic) and `public.member_channel(members)`, the single rule for which app to use (staff choice, else LINE for Thai speakers, else WhatsApp). The follow-ups page has **Send on LINE** via LINE's share link (staff pick the chat; no API) next to **Send on WhatsApp**. Outbound sending in this step should use `member_channel()` too.

**Part 1 built, 26 Nov 2026 (chat booking with Claude, without WhatsApp yet).** Migration `20261126010000_chat_booking.sql`, test `chat_booking_test.sql`, `lib/chat.ts`, pages `/chats` and `/chats/[id]`.
- Tables `chat_conversations` (per contact phone and channel `whatsapp`/`line`/`test`; status `bot` = Claude answers, `staff` = handed off, `closed`) and `chat_messages` (every Claude API message stored exactly, so the next turn replays it unchanged). `chat_open_conversation()` matches the phone number to a member (`phone_key()`: digits, Thai 08x → 668x).
- Claude's tools: `find_sessions`, `free_court_times`, `book_session`, `book_court`, `hand_off_to_staff`. Booking goes through `chat_book_session` / `chat_book_court`, which use the normal booking functions and then **refuse and undo anything that costs money** (the rule is in Postgres, not the prompt). Claude can only book for the person in the conversation. Visitors can book free sessions, not courts. Claude never cancels or refunds.
- Per-club setting `orgs.chat_mode` (Settings → Chat): `book` (default: answer and book free / package-covered places) or `answer` (no booking tools at all).
- Hand-offs: Chats → "Waiting for you" with the reason, plus a banner on the dashboard. Staff reply (takes the chat over), hand back to Claude, or close. Claude also hands off on refusal, API errors and when it can't finish.
- **Test chat** (Chats page): staff play a member or a visitor. Bookings it makes are real. Tested with live Claude: Russian member booked covered evening open play at 0; Thai visitor got clinic times and prices; a visitor asking to book paid open play was refused by the database and handed off with a clear reason.
- Learned: Claude's thinking blocks are bound to the exact conversation, so the system prompt must never change between turns. The facts (which change every turn) go in as a mid-conversation system message after the member's message. If old blocks are still rejected (e.g. after the club changes chat settings), the turn retries once without them.
- Name: staff and members see **Courtix AI Assistant** (Julian, 26 Nov 2026), not "Claude". One constant, `lib/assistant.ts`. Asked who it is, it says it's the club's AI assistant and that a person can take over.
Left for part 2: WhatsApp Cloud API (Meta Tech Provider, Embedded Signup, webhook, sending, templates), a service identity for the webhook (today the tools run as the signed-in staff member), automatic notices (confirmations, waitlist moves, go / no-go cancellations; needs Julian's OK), notifying owners of hand-offs by WhatsApp (Step 9b). Claude can't cancel a member's own booking yet; ask Julian whether it may (free/covered places before the cut-off).

Done when: a member books a session by WhatsApp chat in Thai or Russian, gets a confirmation, and gets an automatic notice if the session is cancelled for too few players.

## Step 9b: Morning approval list  ☐

- A daily job (07:00 club time) drafts follow-ups for every club (Vercel cron or Supabase Edge Function calling a protected route; it needs a service identity, kept out of normal request handlers).
- Each club's owner (and managers who opt in) gets one WhatsApp message each morning: today's sessions, money in, anything waiting, and a link to a phone-friendly **Approve all** page on the club's subdomain (approve, edit or skip each draft). Sent from Courtix's own WhatsApp number, not the club's.
- Approved follow-ups are sent through the WhatsApp Cloud API with approved templates. Consent and cooldown rules still apply.
- Chat hand-offs ("needs a human") notify the club's owner/managers immediately.
- Per-club settings: follow-up mode (morning approval by default; "draft only" for clubs that prefer the desk to send), summary time and recipients.

Done when: drafts appear by themselves each morning, one tap sends them, and nothing goes out without that tap.

## Step 10a: Deploy with club subdomains  ☐

Each club gets `<slug>.courtix.app` (`orgs.slug` already exists). The main domain is the marketing site and sign-up.

- **Hosting:** hosted Supabase project (Singapore region), `supabase link` + `supabase db push`. Vercel project with production env vars (never the local keys). `seed.sql` is local only.
- **Wildcard domain:** add `*.courtix.app` in Vercel (requires the domain's nameservers on Vercel). Supabase Auth redirect URLs: `https://*.courtix.app/**`.
- **Tenant from the host:** `middleware.ts` reads the subdomain, finds the club by slug, and `requireOrg()` uses it instead of the club cookie. A signed-in person who isn't staff of that club gets "You don't have access to this club". Unknown subdomain: a friendly 404. RLS stays the real guard.
- **Reserved slugs:** `www`, `app`, `api`, `admin`, `mail`, `static`, ... blocked in `create_org` (new migration + test). Slugs are already unique.
- **Sign-up flow:** sign up and create a club on the main domain, then land on the new subdomain. Decide: sessions per subdomain (simplest and most isolated; the person signs in once more after creating the club) or one session cookie on the parent domain (smoother, but every subdomain shares it). **Ask Julian.**
- **Local dev:** `raccoon.localhost:3000` works in Chrome/Safari without setup; keep plain `localhost:3000` working with the club cookie for convenience.
- **Later:** custom domains per club (`book.raccoonpickleball.com`) via Vercel's domains API.
- **Needs Julian:** Supabase and Vercel accounts, and the product's domain name.

Done when: two demo clubs run at their own subdomains on the public URL, staff of one club can't open the other, a new club gets its subdomain at sign-up, and migrations apply with `supabase db push`.

**Notes, 18 Nov 2026.** Decided: one shared sign-in for all subdomains (cookie on `courtix.app`), product name **Courtix**, domain `courtix.app` (bought at GoDaddy). Built and tested locally on `courtix.localhost`:
- `lib/tenant.ts` / `lib/host.ts` (host → club, shared cookie domain, absolute club/main-site URLs, `x-forwarded-host` first), `requireOrg()` picks the club from the subdomain, `/no-access` page, unknown subdomain → 404, main site → your club's subdomain, club switcher jumps subdomains, club sign-in page shows the club's name (no "Create account" there), onboarding on the main site lands on the new subdomain signed in.
- Migration `20261118030000_club_subdomains.sql`: DNS-safe slugs, reserved names, friendly `create_org` messages, public `club_by_slug()` (name only). Test `club_subdomains_test.sql`.
- Seed has a second club (Chalong Padel, `other@clubos.test`).
Left: everything that needs the real accounts (hosted Supabase, Vercel wildcard domain, GoDaddy nameservers → Vercel, Supabase auth URLs for `https://*.courtix.app/**`).

**Notes, 18 Nov 2026 (hosting).** Code on GitHub `vnguyenvace/courtix-app`; Vercel (team `vace4`) deploys `main` automatically; `courtix.app` and `*.courtix.app` point at Vercel and the first production deploy works. Hosted Supabase project `courtix` (ref `ogiyiobrrgnyzxetvjks`, Singapore, org VACE): all migrations applied with `supabase db push --remote` (CLI v3 targets the local stack unless you pass `--remote`), both cron jobs scheduled. Left: Vercel env vars pointing at the hosted project, Supabase auth URLs, a real SMTP sender for sign-up emails, then the "Done when" check with two real clubs.
**Region (18 Nov 2026):** Vercel functions must run in **Singapore (`sin1`)**, next to the database. New Vercel projects default to Washington (`iad1`), which made every page about 5 s. `vercel.json` sets `regions: ["sin1"]`, but on this project only the dashboard setting took effect (Settings → Functions → Function Regions, then redeploy). Check with the `x-vercel-id` response header: it should read `sin1::sin1`.

## Step 10: Scheduled jobs  ☑

`pg_cron` in Supabase: `refresh_membership_statuses` nightly, `check_session_minimums` every 15 minutes, `generate_sessions` nightly (commands are in the README), and a daily AI draft run per club (Edge Function or a Vercel cron calling a protected route).

Done when: jobs are scheduled in the hosted project and their last runs are visible.

**Notes, 18 Nov 2026.** Migration `20261118020000_scheduled_jobs.sql` schedules `club-os-housekeeping` hourly (`run_housekeeping()`: refresh membership statuses + `generate_sessions(org, 14)` for every club; one club failing doesn't stop the others) and a daily cleanup of cron history. Tested locally (`scheduled_jobs_test.sql`, and pg_cron really fires inside local Supabase). Left for later:
- ~~Tick once it runs in the hosted project (after Step 10a).~~ Done 18 Nov 2026: `club-os-housekeeping` has run on the hosted project (5 runs, all succeeded).
- **Go / no-go is deliberately not scheduled**: it would cancel sessions without telling players. Schedule it in Step 9 together with automatic cancellation notices (needs Julian's OK: it's automatic messaging).
- The daily AI draft run belongs to Step 9b (morning approval list).

## Step 11: SaaS billing  ☐

Tiers (for example Basic: courts and members; Pro: sessions, AI follow-ups; Multi-site: several locations), monthly billing per club, feature gating, trial period. Only once a second paying club is close.

---

## Open questions for the club (don't guess these)

- Maximum players per session type (demo values are placeholders).
- Coach Kimo camp start times; IPTPA workshop price.
- Which court each session normally uses.
- Private coaching prices by group size and the 30-minute option.
- ~~Does a class-pack credit get used at sign-up or at attendance? Are late cancellations charged?~~ Decided 18 Nov 2026: at sign-up; late cancels (after the club's cut-off, default 24 h) and no-shows lose the credit. Confirm Raccoon is happy with 24 h.
- How many days early does "priority booking" mean for Unlimited any session? (demo uses 2, a placeholder)
- Which payment provider, and does the club already have a PromptPay QR or merchant account?
- For multi-site clubs: which sites, and should any package be limited to one site?
