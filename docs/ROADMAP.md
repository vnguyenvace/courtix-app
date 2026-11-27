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
- Morning approval list: automatic morning drafts, owner approves on /morning, approval enforced in the database (26 Nov 2026), see Step 9b notes.
- Orders and payments: every paid booking, place and package becomes an order; staff mark payments (with slip photos); booking confirmations say what's due (26 Nov 2026), see Step 3 notes.

- Privacy policy and terms (26 Nov 2026): public pages `/privacy` and `/terms` (any Courtix address), written from what Courtix actually does (data held, sub-processors Supabase/Vercel/Anthropic/LINE/EasySlip/Twilio/Resend, Singapore hosting, cookies, PDPA roles: club = controller, Courtix = processor). Linked from every booking page footer, the front page, staff sign-in and the guest consent ticks. Facts in `lib/legal.ts`: **add the legal entity name and address there** once registered. **Needs review by a Thai lawyer before relying on it, and a Thai version** (PDPA notices should be in a language members understand).

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
- **Chat autonomy, default "answer and book free spots":** in WhatsApp/LINE chat, Claude answers questions **and books** sessions and courts that are free or covered by the member's package. Paid bookings, refunds, complaints, private coaching and anything unclear go to the club's owner/managers. *(27 Nov 2026, Julian: Claude may now hold a private lesson as a request with the price; staff approve it. It never confirms a paid lesson itself.)* Other settings to offer: "answer only", and later "also send a PromptPay link for paid spots" (Step 7, check with Julian first).
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
- ~~"Cancel" on a sign-up or court booking acts on one tap, with no confirmation.~~ Fixed 27 Nov 2026: every cancel (courts, lessons, session places and requests, packages, members' own bookings) asks "Yes, cancel …" first (`components/ConfirmSubmit.tsx`, works without JavaScript).
- Courts header says "9 booked of 70 slots" but counts bookings (a 3-hour session is 1), not slots.
- Kids clinic (age 8+) lists every member in the sign-up picker; members have no birth date, so the age rule can't be checked for members.
- Coach Kimo camps (21 Nov) show the 2,500 early-bird price after the 15 Nov deadline: expected until Step 4 (price tiers).
- Generated sessions skip a court that is already booked (Thursday 18:00 open play got only Court 2 because a sample member had Court 1). Correct, but easy to miss: the session list just shows fewer courts.

**Note, 26 Nov 2026:** `sessions_test.sql` now fails: it looks up the Coach Kimo camp (21 Nov 2026), which is in the past, so `:'camp'` is empty. The test needs a date-independent event. Not caused by the branding work (it fails the same way without it).

## Step 1: Staff management page  ☑

Clubs need to add desk staff without Supabase Studio.

- Settings → Staff: list staff with role and locations; invite by email (Supabase `auth.admin.inviteUserByEmail` needs the service-role key, so put it in a separate server-only module with an explicit owner check, or use a sign-up link with a one-time invite code stored in an `org_invites` table, which is simpler and keeps the service key out of the app. Ask Julian which).
- Owners can change roles and `location_ids`, and remove staff. Owners can't remove the last owner.
- Desk staff limited to one location land on that location automatically (already handled in `requireOrg`).

Done when: an owner can invite a desk person limited to one site, that person signs up, sees only their site's write actions, and the SQL test covers invite acceptance and the last-owner rule.

**Done 27 Nov 2026** (migrations `20261127000000_staff_roles.sql`, `20261127000100_staff_permissions.sql`, test `staff_roles_test.sql`):
- **Roles:** owner, admin (stored as `manager`), front desk (was `staff`), marketing, back office. Julian approved the role table on 27 Nov 2026.
- **Permissions, not role names:** `role_permissions` maps each role to permissions and `has_org_permission(org, 'payments.refund')` checks them. Policies on members, memberships, check-ins, bookings, sign-ups, orders, chats, reply helper, follow-ups, settings, staff and storage use it. The table is in the migration header and in `lib/permissions.ts`; keep the two in sync. Setup functions that check `has_org_role(.., '{owner,manager}')` were left as they are: that is exactly `club.setup`.
- **App:** `requireOrg()` returns `permissions` and `can()`, and `requirePermission()` guards pages and actions. The sidebar shows only pages the role can open. Money tiles show only with `reports.view`. Settings stays read-only for others. Marketing edits tone, sign-off and offers (`update_message_voice`); how follow-ups go out stays with owner and admin.
- **Staff page** (`/staff`, owner only): staff list with emails (`club_staff`), change role and locations, remove, and a club always keeps an owner (trigger). **Invites:** email + role + locations. The link `<slug>.courtix.app/join/<token>` lasts 7 days, the token is stored hashed, and it is emailed if Resend is set up and always shown to copy. The person signs in or creates an account **with the invited email** (`accept_staff_invite` checks the token, the email and that the email is confirmed).
- **Fixed 27 Nov 2026** (`20261127010000_accept_invites_on_sign_in.sql`): an invited admin created the account but landed on "No access", because the confirmation email didn't bring them back to the invite link. Now `requireOrg()` calls `accept_my_invites()`: open invites for the signed-in, **confirmed** email are accepted when the person arrives at the club (or on the main site). In Supabase Auth → URL Configuration, allow `https://*.courtix.app/**` as a redirect URL so confirmation emails return to the invite.
- **Production:** turn on **Confirm email** in Supabase Auth. Without it, someone who knew an invite link could create the account for that email without owning it.
- **Left open:**
  - Buttons the role can't use (for example "Add member" for marketing) still show; the database refuses them with "Your role or location doesn't allow it". Hide them page by page later.
  - `members.export` has no export feature yet.
  - Front desk can still read order totals in the database (it records payments); revenue is hidden only in the app.

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

## Step 3: Orders and payments (staff-marked)  ☑

Every sale becomes an order so the club can see what's paid and what's owed.

- Tables: `orders` (member or guest, location, status: pending/paid/refunded/cancelled, total, method: cash/transfer/promptpay/card, paid_at, received_by), `order_items` (what was bought: package, session registration, court booking, event ticket; amount).
- Selling a package, a drop-in session place and a drop-in court booking each create an order (pending or paid).
- Desk can mark paid (cash or transfer) and attach a transfer slip photo (Supabase Storage bucket, private, RLS by org).
- Dashboard: money in today/this month per location, unpaid orders list.
- Move "package sales this month" and the location revenue figures onto orders, so revenue is counted once and correctly.

Done when: every paid thing has an order, unpaid ones are listed, totals per location match the orders, and the SQL test covers it. **Check with Julian before changing any revenue figure the owner already sees.**

**Notes, 26 Nov 2026.** Built: migrations `20261126060000_orders_payments.sql`, `20261126060100_orders_triggers_definer.sql`, test `orders_test.sql`, page `/payments`, `components/Payments.tsx`. Decided with Julian: **full orders** (order + items), **booking confirmations with the amount due**, and **revenue figures owners already see keep their meaning** ("Received today / this month" and "Unpaid" shown next to them).
- The database makes the orders (deferred triggers that read the final row, so a package-covered sign-up makes none): court bookings (member / drop-in, price > 0), session places once booked, package sales. Desk, chat assistant and the public page all count. Cancelling before payment cancels the order; after payment the order becomes **refund_due** for an owner/manager to mark **Refunded** or **Keep**. A paid amount never changes afterwards. The triggers run with the owner's rights (`security definer`): as the visitor, an online sign-up failed.
- Recording: `mark_order_paid` (cash, transfer, PromptPay, card, other; note; optional slip photo in the private bucket `payment-slips/<org_id>/`, shrunk to a 1600px JPEG, opened via a 5-minute signed link). Owners/managers can undo a payment. On the Payments page (To pay / Paid / Refunds to check, per location plus club-wide packages), the session roster (quick Mark paid) and the member page (Payments card); selling a package can record "Paid now".
- Booking confirmation (`booking_confirmed`, an automatic message like the others, on by default): when the desk books a member in, they get "You're booked … To pay: THB 600. <the club's How members pay note>" or "Covered by your package". Chat and online bookings don't get it (already confirmed there).
- Orders start from this migration: earlier sales have none (no backfill, so live clubs don't get a long false "unpaid" list). The local demo seed marks demo package sales and past bookings paid.
- Tested locally (fake LINE): desk booked a court for Dmitri → LINE confirmation in Russian with "THB 600" and the PromptPay note; marked paid by transfer with a slip; dashboard and Payments figures moved together; roster quick Mark paid.
- Left open: PromptPay QR / payment links (Step 7); partial payments; one order per item for now (the schema allows combining items into one order later); staff names on "received by" (shows "by you" only).

## Step 4: Event ticket tiers  ☐

For the Coach Kimo camps (early bird 2,500 until 15 Nov, then 3,300), the Parents Pickleball Cup (divisions, pairs), and the IPTPA workshop (30 spots).

- `session_price_tiers` (label, price, available_until, max_qty), with the current tier picked at sign-up time.
- Divisions within an event (beginner/open), each with its own capacity.
- Pair sign-ups: one registration with a partner (member or guest), counting as 2 spots.
- Registration deadline separate from `book_by`.

Done when: an early-bird sign-up records 2,500 before the deadline and 3,300 after; pair sign-ups fill 2 spots; divisions fill separately; tests cover it.

## Step 5: Coaches and private coaching  ☑

- `coaches` table (name, level, rates, active locations), linked from sessions instead of the free-text `coach_name`. Keep the old column for history.
- Coach calendar: a coach can't be in two places at once (exclusion constraint like courts).
- Private lessons: book a coach + court together. Price by group size (Raccoon: 1 pax 2,800? **confirm**: their flyer shows 1–4 pax prices and a 30-minute option), plus hour packages as credits.

Done when: a private lesson books a coach and a court in one step, clashes are refused, group-size pricing works, and tests cover it.

**Done 27 Nov 2026** (migration `20261127040000_coaches_lessons.sql`, test `coaches_lessons_test.sql`):
- **Coaches page** (`/coaches`, roles with bookings.manage; adding coaches and prices needs club.setup): coaches (name, phone, about, which locations, taking lessons or not), lesson prices, the next 14 days per coach, and **Book a lesson**.
- **Prices** (`lesson_rates`): by length and number of people, for the whole lesson. "All coaches" prices, plus a coach's own price that wins over them. **The club enters its own prices**; Raccoon's private coaching prices are still to be confirmed (open question below). A lesson can't be booked until its price exists.
- **`book_lesson()`** books the coach and a court in one step (a `coaching` court booking with `coach_id`, `group_size` and the lesson price). "Any free court" picks the first free one. Opening hours, the past and court clashes are checked by `create_booking`. The payer is a member or a guest name.
- **No double-booked coaches:** `coach_busy` (exclusion constraint), filled by triggers from lessons and from sessions with a coach. Cancelling a lesson or a session frees the coach.
- **Payments:** a paid lesson becomes an order ("Lesson with Coach Kimo (2 people), Court 3, Sat 28 Nov 18:00"), and cancelling cancels the order, like court bookings.
- **Sessions:** the edit page can pick a coach from the list (`set_session_coach`). `coach_name` is filled from the coach and still works for coaches not on the list. Generated sessions don't take a coach automatically yet.
- **Left open:** hour packages / lesson credits (changes how packages are paid for: decide with Julian first); a coach's own sign-in to see their schedule; coach pay reports.

**Members book lessons themselves, done 27 Nov 2026** (migration `20261127050000_lessons_online.sql`, test `lessons_online_test.sql`). Julian decided: the booking page follows the club's online setting; in chat Claude only holds a lesson **request** that staff approve.
- **Booking page:** a **Lessons** tab (shown once a coach has a price): pick coach, length and number of people (only combinations with a price), a day, then a free start time (`public_lesson_times`: coach free and a court free, every 30 minutes, within opening hours). Guests give name, WhatsApp number and consent (`public_book_lesson`, same spam limits as online courts); signed-in members book with one tap (`member_book_lesson`). "Instant" clubs: booked, with the PromptPay pay page; "approve" clubs: held as a request.
- **Chat:** tools `lesson_times` and `request_lesson` (`chat_request_lesson`, only in "answer and book" mode). The lesson is held (coach and court) with `pending_approval`, at most 3 waiting per contact. Claude tells the price and says a team member will confirm. Answer-only clubs: handed to staff as before.
- **Approving:** lesson requests from the booking page and chat are on the dashboard (Online sign-ups) with Approve / Decline (`decide_online_court`). Approving a member's request sends the usual "booking confirmed" notice; guests are told by staff. Declining frees the coach and court.
- **Confirmations:** lessons booked at the desk for a member now send the "booking confirmed" notice too ("Lesson with Coach Kimo (Court 1)").
- `create_lesson()` holds the lesson rules for every channel; `book_lesson()` (desk) adds the staff permission check.
- Members see their lessons on /book/me as "Lesson with Coach Kimo (Court 3)" and can cancel them there, like court bookings (the coach is freed).
- **Left open:** no automatic reply in the chat when staff approve a visitor's (non-member's) request; staff tell them.

## Step 6: Public booking page per location  ☑

Replace "DM to book" on the flyers with a link and QR code.

- Public pages on the club's subdomain (`<slug>.courtix.app/book`, `/book/[location]` for multi-site clubs): timetable with spots left, session details, court availability.
- Sign up as a guest (name + WhatsApp + consent tick) or a known member (phone lookup with a one-time code via WhatsApp later).
- Holds a spot for 15 minutes as a pending order. Payment comes in step 7; until then the order stays pending for staff to confirm.
- Needs carefully scoped anon access: read-only views of public session info through `security definer` functions, never direct table access. Rate-limit sign-ups.

Done when: a stranger can open the link on a phone, see real sessions, request a spot, and staff see it as a pending order. Anon can't read members or anything else (test it).

**Notes, 18 Nov 2026.** Built: migration `20261118050000_public_booking.sql`, test `public_booking_test.sql`, pages `app/book` (timetable), `app/book/s/[id]` (session + sign-up form), `app/book/courts` (free court times). Decided with Julian: **an online sign-up takes the spot straight away** (pay at the club; there are no orders yet, so "pending order" became a booked place marked `source = 'online'`), and **courts show free times only**, with each free slot opening WhatsApp with the request typed in (changed 26 Nov 2026: visitors now book courts online, see below). Visitors only reach four security-definer functions (`public_club`, `public_sessions`, `public_court_slots`, `public_register`); no table access. Online sign-ups are always guests at the drop-in price: a phone number is never matched to a member, so nobody can spend someone else's credits. Spam limits: one live place per number per session, 3 online sign-ups per number per day, 60 per club per hour, plus a hidden honeypot field. Consent: a required "may contact me about this booking" tick and an optional marketing tick (stored on the sign-up).
Staff side: Settings → Booking page (link, QR code for flyers, on/off), Sessions → Set up → "Hide online" per session type, "booked online" on the roster, and an "Online sign-ups" card on the dashboard.
**Approval option (added 18 Nov 2026, Julian's request):** Settings → Booking page → "When someone signs up online": *They get the spot straight away* (default) or *Request, staff approve* (`orgs.online_signups = 'approve'`). Requests are saved as the new registration status `requested`, take no spot, and show with **Approve / Decline** on the dashboard and the session page. Approving books them, or waitlists them if the session filled up in the meantime; declining cancels. Open requests close when the session is cancelled. Migrations `20261118050100_requested_status.sql` (enum value on its own) and `20261118050200_online_approval.sql`, test `online_approval_test.sql`.
**Logo and colours (added 26 Nov 2026, Julian's request):** Settings → Logo and colours. The owner or a manager uploads a logo (PNG/JPG/WebP/GIF/SVG, up to 4 MB). The server re-encodes it as a PNG of at most 512 px (strips photo GPS data; SVGs become pixels, so no script) with `sharp`, stores it in the public Storage bucket `club-logos` under `<org_id>/`, and picks a main and second colour from it (`lib/logo.ts`; ignores white, transparent and anti-aliased edge pixels). "Pick colours from the logo" can be unticked to keep the current colours. The owner can change both colours (the colour picker suggests the ones found in the logo) or go back to the standard Courtix colours. The booking pages show the logo (also as the browser tab icon), use the main colour for buttons, tabs and links, and the second colour for a top stripe and session times. `lib/brand.ts` darkens or lightens colours just enough to stay readable in light and dark mode (a yellow brand gets dark text on yellow buttons and deep gold links). Migration `20261126000000_club_branding.sql`, test `club_branding_test.sql` (only owners/managers of that club can upload; desk staff, other clubs and visitors can't). The staff app keeps the Courtix colours.
**Club front page (added 26 Nov 2026, Julian's request):** `<slug>.courtix.app/` is now a public landing page instead of the staff sign-in: logo and colours, Book a session / Court times / WhatsApp buttons, the next 6 sessions, and each location's address (Google Maps link), hours and WhatsApp (`app/page.tsx`). A small "Staff sign in" link (top right and footer) goes to `/login`, which now has the club's colours and a link back. Signed-in staff see "Open dashboard" instead. Signing out lands on the front page. Staff pages still send signed-out people to `/login`, and the main site `courtix.app/` behaves as before.
Left open: the colour preview in Settings updates after **Save colours**, not while picking (no client JavaScript). Local dev needs Storage and its schema on the same version: if uploads fail with "database error, code: 42P10", run `supabase stop && supabase start`.
Left open: members recognised by phone with a one-time WhatsApp code (needs Step 9), so members can use their package online; visitors can't cancel online yet (they message the club); IP-based rate limiting (only per number and per club for now); no confirmation message is sent (needs Step 9).

**Member sign-in on the booking page (added 26 Nov 2026, Julian's request).** Migrations `20261126070000_member_sign_in.sql`, `20261126070100_member_code_attempts.sql`, test `member_sign_in_test.sql`, `lib/memberAuth.ts`, `lib/sms.ts`, `lib/email.ts`, page `/book/me`. Decided with Julian: codes by **LINE, SMS and email**; signed-in members **book, see and cancel** their own bookings.
- A member enters the phone number or email the club has; Courtix sends a 6-digit code by LINE (if linked, free), else SMS (Twilio, if `TWILIO_*` is set), else email (Resend, if `RESEND_API_KEY` + `EMAIL_FROM` are set). Same answer whether or not the contact is a member's. Codes: hash only, 10 minutes, 5 tries (a wrong code returns null instead of raising, so the try is counted), 3 per member per 15 minutes, 200 per club per hour. A correct code gives a sign-in token (stored hashed, 90 days) in an http-only cookie on the club's subdomain.
- Members then book sessions (`member_book_session`: package coverage and every desk rule; paid places become orders to pay at the club) and courts (`member_book_court`: their package's court price and booking limits), see their package, upcoming bookings and what they owe, and cancel their own (`member_cancel`: session credits by the usual cut-off; courts until they start). All through security-definer functions that take the token; the code sender is the only part using the service identity. Online member places don't wait for staff approval even in "Request, staff approve" mode (the approval was for strangers).
- Pages: "Member sign in" / "Hi Dmitri · My bookings" on every booking page and the front page; "Book my place" on a session; "Book" on free court times for signed-in members (guests still get the WhatsApp link).
- Tested locally (fake LINE): stranger's number got the same answer and no code; Dmitri's code came on LINE in Russian; wrong code refused; signed in back to the session; booked covered open play at 0 and a court at THB 600; cancelled the court; signed out.
- **To switch on SMS:** a Twilio account with a sender for Thailand; set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM` (or `TWILIO_MESSAGING_SERVICE_SID`) in Vercel. **Email:** a Resend account with courtix.app verified; set `RESEND_API_KEY` and `EMAIL_FROM`. Until then only members linked on LINE get codes; others can't sign in yet and book as guests. A Thai SMS provider (cheaper) can replace `lib/sms.ts`.
- Why no code went out is logged (Vercel logs, "Member sign-in (<club>): no code sent: ..."; no phone numbers or emails in the log). Member page now shows "Linked on LINE" / "Not linked on LINE" with how to link (Julian's first try failed silently: the member wasn't linked).
- Open: members can't see past bookings or pay online (Step 7); no "send by WhatsApp" option for codes until Step 9 part 2.

**Guest court booking (added 26 Nov 2026, Julian's request; replaces "courts show free times only, WhatsApp to book").** Migrations `20261126080000_public_court_booking.sql`, `20261126080100_public_court_price.sql`, test `public_court_test.sql`, page `/book/courts/book`.
- Tapping a free court time opens a form (name, WhatsApp number, required contact tick, optional marketing tick, honeypot) showing the drop-in price (`public_court_price`: that slot only; rate rules stay private). `public_book_court` books it with `create_booking` (hours, no double booking, drop-in price), at most 2 weeks ahead, max 3 online court bookings per number per day and 60 per club per hour. It becomes an order to pay at the club (Payments, with the guest's phone). Members are offered "sign in to book with your package" first; signed-in members book in one tap.
- Decided with Julian: follows the club's online sign-up setting. In "Request, staff approve" mode the booking holds the court (`bookings.pending_approval`; the slot shows taken) and waits for Approve / Decline on the dashboard's Online sign-ups card (`decide_online_court`); declining cancels it, frees the court and cancels the amount due.
- Tested in the browser: visitor booked Court 3 at THB 600, slot then taken, order on Payments; approve mode: held, then approved from the dashboard.

## Step 7: PromptPay checkout  ☐

**Part A built, 26 Nov 2026: PromptPay QR without a payment provider (Julian: "build A first").** Migrations `20261126090000_promptpay.sql`, `20261126090100_payer_slips_server_side.sql`, `20261126090200_order_lookup.sql`, test `promptpay_test.sql`, `lib/promptpay.ts`, `lib/payerSlip.ts`, pages `/book/pay/[id]` (+ `/qr` PNG).
- Settings → Payments: the club's PromptPay ID (mobile, national/tax ID or e-wallet) and account name, with a THB 1 test QR to scan. `lib/promptpay.ts` builds the Thai QR (EMVCo) payload with the exact amount; checked against all 8 test vectors of the dtinth/promptpay-qr library.
- Pay page per unpaid order (payment link by order id; shows only items and amount, no names): the QR, "Save QR image" for paying on the same phone, and "Send your slip". Linked from: guest/member court bookings (straight to the pay page), session sign-ups (banner), My bookings (Pay per unpaid item), LINE booking confirmations ("Pay by PromptPay: <link>"), Payments → Show PromptPay QR (scan from the desk screen). Court requests waiting for approval show no QR.
- Slips are saved by the server (`lib/payerSlip.ts`, service identity: unpaid order, max 3 slips, shrunk to JPEG); visitors get no storage access (a direct upload would have needed read access, and club ids are public). Staff see "Slip received · see slip" on Payments and mark paid. Money goes straight to the club; nothing is marked paid automatically.
- Tested locally: settings + test QR, visitor court booking → pay page with QR and PNG download, slip → "Slip received" for staff, LINE confirmation with the pay link (in production the link is https://<club>.courtix.app/book/pay/…; locally it lacks the :3000 port).
- **Automatic slip checks, 26 Nov 2026** (Julian: research the services, then build). Researched EasySlip, SlipOK, SlipMate, Thunder, HaveSlip, Slipaj, Check-slip: entry prices ~0.2-0.7 THB per check. Chose **EasySlip API v2** (documented current API, image upload, duplicate flag, receiver PromptPay/name in the response; 99 THB/month for 250 checks up to 40,000 THB for 320,000). SlipOK has a free 100/month tier but only an unofficial copy of its API guide was found. Migration `20261126100000_slip_verification.sql`, test `slip_verification_test.sql`, `lib/slipRules.ts` (pure, 19 cases tested), `lib/slipCheck.ts`.
  - When a payer sends a slip, Courtix asks EasySlip (bank network) and marks the order paid itself only if: amount exactly due; sent to the club's PromptPay (visible digits + proxy type) and, if the club entered its account name, that name matches too (or, for a bank-account receiver, the name matches); made after the booking (10 min leeway) and within 7 days; transfer reference never used before (`slip_refs`, primary key, across all clubs). Otherwise it stays "Slip received" for staff with the reason and a **Check again** button (e.g. Bangkok Bank slips are only checkable a few minutes after the transfer). Per club: Settings → Payments → "Check slips automatically" (on by default).
  - Tested in the browser against a fake EasySlip: good slip paid automatically; same slip on a second booking refused ("already used"); wrong amount to staff; Bangkok Bank pending → Check again → paid.
  - **To switch on:** an EasySlip account (developer portal: create an application, copy the API key, pick a plan); set `EASYSLIP_API_KEY` in Vercel. Leave the IP whitelist open (Vercel's IP addresses change). One Courtix account serves all clubs (cost per check is Courtix's, or passed on in pricing). First real slip: check the result on Payments.
- Part B (online checkout with automatic confirmation) is still open, below.

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
**LINE built, 26 Nov 2026 (each club connects its own LINE Official Account).** Migrations `20261126030000_line_channel.sql`, `20261126030100_chat_external_id.sql`, test `line_channel_test.sql`, `lib/line.ts`, `lib/messaging.ts`, `lib/secrets.ts`, webhook `app/api/line/[key]/route.ts`.
- Settings → Messaging: the owner/manager pastes the LINE **channel secret** and **channel access token**; Courtix checks the token with LINE (`/v2/bot/info`), stores both **encrypted** (AES-256-GCM, key `CHANNEL_SECRETS_KEY`, server-only) in `messaging_channels`, and shows the webhook URL `https://courtix.app/api/line/<webhook_key>` to paste into LINE Developers. On/off and disconnect (deletes the keys). Desk staff can't change it; other clubs can't see it.
- Webhook: finds the club by the key in the URL, checks LINE's `x-line-signature` with that club's secret before anything else, answers 200 at once and does the work after the response (`after()`): saves the message (LINE event ids stop repeats), the assistant answers with the same rules as every chat, the answer goes back as LINE's free **reply**, falling back to **push** (counts toward the club's monthly LINE allowance) if the reply token expired. Delivery failures are shown on the message and hand the chat to staff. Runs as the service identity.
- LINE gives a user id, not a phone number: a LINE chat starts as a visitor; staff link it to a member once on the chat page (`chat_link_member`, saved in `members.line_user_id`), later chats are recognised. Staff replies on LINE chats are sent by push. Approved follow-ups for members linked on LINE are sent directly by **Send on LINE** (checked against the approval rule first).
- Tested locally against a fake LINE API (`LINE_API_BASE`): bad token refused, keys stored encrypted, forged signature refused (401), verify ping OK, Russian question answered by reply, repeat event ignored, chat linked to a member, covered evening open play booked over LINE at 0, staff reply pushed, expired reply token falls back to push.
- Guide for club owners: `/guides/line` (English) and `/guides/line?lang=th` (Thai), public so it can be sent to clubs before they join, prints on paper, linked from Settings → Messaging.
- **To go live:** add `CHANNEL_SECRETS_KEY` (any random string, 32+ characters) in Vercel → Environment Variables (Production), deploy, `supabase db push --remote`. Then a club connects in Settings → Messaging. Not yet tried with a real LINE account.
- **Chats keep their AI answers while waiting for staff** (Julian, 26 Nov 2026: LINE should answer automatically; "can this not be manual?"). Migration `20261126040000_chat_keeps_answering.sql`. "Needs staff" (status `staff`) now only flags something for the desk; the assistant keeps answering other questions and may still book free / covered places, and is told a team member will follow up on the flagged request. It pauses only while a person answers: a staff reply pauses it 30 minutes (`assistant_paused_until`), **Take over** pauses it until **Hand back**. After a pause it resumes by itself on the member's next message. Staff replies reach the model as `<staff_note>` (user side): as assistant text the model took them for its own words and apologised for them. The assistant only answers when the member wrote something new, so Hand back alone sends nothing.
- Open: one LINE account per club (per location later if a club needs it); members can't link themselves yet (a one-time code in LINE would let them); no LINE message quota display; images and stickers are noted as "(sent a sticker)", not read.
Left for part 2: WhatsApp Cloud API (Meta Tech Provider, Embedded Signup, webhook, sending, templates), a service identity for the webhook (today the tools run as the signed-in staff member), automatic notices (confirmations, waitlist moves, go / no-go cancellations; needs Julian's OK), notifying owners of hand-offs by WhatsApp (Step 9b). Claude can't cancel a member's own booking yet; ask Julian whether it may (free/covered places before the cut-off).

Done when: a member books a session by WhatsApp chat in Thai or Russian, gets a confirmation, and gets an automatic notice if the session is cancelled for too few players.

## Step 9b: Morning approval list  ☐

- A daily job (07:00 club time) drafts follow-ups for every club (Vercel cron or Supabase Edge Function calling a protected route; it needs a service identity, kept out of normal request handlers).
- Each club's owner (and managers who opt in) gets one WhatsApp message each morning: today's sessions, money in, anything waiting, and a link to a phone-friendly **Approve all** page on the club's subdomain (approve, edit or skip each draft). Sent from Courtix's own WhatsApp number, not the club's.
- Approved follow-ups are sent through the WhatsApp Cloud API with approved templates. Consent and cooldown rules still apply.
- Chat hand-offs ("needs a human") notify the club's owner/managers immediately.
- Per-club settings: follow-up mode (morning approval by default; "draft only" for clubs that prefer the desk to send), summary time and recipients.

Done when: drafts appear by themselves each morning, one tap sends them, and nothing goes out without that tap.

**Part 1 built, 26 Nov 2026 (without WhatsApp).** Migrations `20261126020000_approved_status.sql` (enum value on its own) and `20261126020100_morning_approval.sql`, test `morning_approval_test.sql`, page `/morning`, job `app/api/cron/morning/route.ts`.
- **Morning job:** Vercel Cron (`vercel.json`) calls `/api/cron/morning` daily at 23:00 UTC (06:00 in Phuket) with `CRON_SECRET`. It runs as the service identity (`lib/supabase/service.ts`, server-only, used only by cron routes) and writes up to 20 drafts per club with `followup_candidates` + the same drafting code as the button (`lib/followups.ts`). Each club is claimed for its local date (`orgs.morning_run_on`), so a retry writes nothing twice. Fixed time for now: Vercel's free plan allows daily crons only; a per-club summary time needs an hourly cron (Pro plan) or pg_cron + pg_net.
- **New message status `approved`.** Settings on AI follow-ups: `orgs.followup_mode` = `approve` (default: owner/manager approves) or `desk` (anyone sends drafts, as before), and `orgs.morning_drafts` (on by default). Enforced by a trigger on `ai_messages`: in approve mode desk staff can't send an unapproved draft or change an approved one; only owners/managers approve (`approve_all_drafts()`). An approved-but-unsent message counts as open (no second draft, not a candidate again).
- **Morning page** (sidebar → Morning, phone first): sessions today and which are short of players, court bookings today, packages sold yesterday, chats and online requests waiting, drafts to approve (edit, Approve, Skip, **Approve all**), and approved messages ready to send by one-tap WhatsApp/LINE (anyone at the club). Dashboard shows owners "N follow-ups waiting for your approval".
- Tested locally with live Claude: 10 drafts in English, Russian and Thai for the demo club; approve one edited, approve all, send.
- **To go live:** add `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project settings → API keys, the service_role / secret key) and `CRON_SECRET` (any long random string) to Vercel → Settings → Environment Variables (Production), then deploy. Check the first run in Vercel → Cron Jobs.
Left for part 2 (needs Step 9 WhatsApp): send approved messages automatically through the WhatsApp Cloud API (templates), the owner's morning WhatsApp message from Courtix's own number with a link to /morning, instant WhatsApp notices of chat hand-offs, per-club summary time and recipients ("money in" waits for Step 3 orders; for now: packages sold yesterday).

**Automatic member messages, 26 Nov 2026 (Julian chose all four, plus auto-send for follow-ups).** Migrations `20261126050000_member_notices.sql`, `20261126050100_notice_window.sql`, test `member_notices_test.sql`, `lib/notices.ts`, job `app/api/cron/evening/route.ts`.
- **Service messages**, sent by themselves: booking reminders (18:00 the evening before, sessions and courts), package ending (within 3 days, or 1 session credit left), waitlist moved up and session cancelled (straight away). Fixed wording in all six member languages (en, th, ru, zh, de, fr), not AI-written, so times and places are always right; each ends "just reply to this message" (on LINE that reaches the assistant).
- How: the outbox `member_notices` (each notice once, by `dedupe_key`). Waitlist and cancellation notices are queued by a trigger on `session_registrations`, so every path counts (desk cancel, raised limit, approval, go / no-go). The evening job (Vercel Cron 11:00 UTC = 18:00 Phuket) runs `queue_evening_notices()` for every club. Sending: LINE push to members linked on LINE; everyone else is listed on Morning → Automatic messages for a one-tap WhatsApp/LINE send (Mark as sent / Skip). Session actions send right after the change.
- Per club: Settings → Automatic messages (each kind on/off) with this month's LINE message use (warns at 80%). Per member: "No automatic reminders or notices" on the member page. Service messages don't need marketing consent; marketing still does.
- **Marketing follow-ups:** third option "Send them automatically each morning" (`followup_mode = 'auto'`): the morning job approves the drafts and sends them on LINE; members not on LINE wait in Morning → Ready to send. Consent and cooldown still apply.
- Tested locally (fake LINE): desk cancels a place → the waitlisted member got the Russian notice on LINE within a second; evening job sent a Russian reminder on LINE and listed 12 others (not on LINE) on Morning in Thai/Russian/English; rerun queued nothing.
- Open: WhatsApp sending (needs Meta, Step 9 part 2), so members without LINE need a tap; LINE push messages count toward the club's monthly allowance (free plans are small: a busy club may need a paid LINE plan); a package-ending notice and an AI renewal follow-up can both reach the same member (consider skipping the AI renewal draft when the notice went out).

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

## Step 10b: Courtix team roles  ☑

Julian's own team (27 Nov 2026 plan): `platform_staff (user_id, role)` with super_admin, support, sales, marketing, kept apart from club staff. A separate admin area (e.g. `admin.courtix.app`) lists clubs, plans and usage. Sales and marketing see no member personal data. **Support sessions:** support sees a club's member data only when its owner allows it, for a limited time (e.g. 24 hours), with every view logged and visible to the owner (PDPA: the club is the controller). Julian agreed to "owner allows it" on 27 Nov 2026.

**Done 27 Nov 2026** (migration `20261127020000_platform_team.sql`, test `platform_team_test.sql`):
- `platform_staff` with `platform_role()`. **The first super admin is added by hand** in the Supabase SQL editor (the SQL is in the migration header). After that, super admins add people at `/admin/team`; they need a Courtix account first. Courtix always keeps one super admin.
- **Admin area** `courtix.app/admin` (`lib/platform.ts`, `app/admin/`): clubs with usage numbers (`platform_clubs()`, no member data). Owner email is hidden from marketing. Support status per club. Super admins also see recent support views. Non-team people get "not found". Team members without a club land here after sign-in.
- **Support sessions:** the owner allows Courtix support for 2 hours to 7 days, or ends it, on the Staff page (`allow_support_access`, `end_support_access`). During a session, support/super admin get **select-only** policies on club tables (`support_can_view`). `requireOrg()` gives them role `support`: read-only, all POSTs and server actions refused, every page logged (`log_support_view`, path from the middleware's `x-pathname`), and a banner. The owner sees the log on the Staff page.
- Local seed: `demo@clubos.test` is also a super admin.
- **Left open:** suspending a club and billing (Step 11); support can't see messaging channel settings (encrypted keys) by design; no alert to the owner when support first opens the club (the log is on the Staff page).
- Production: the first super admin is `admin@courtix.app` (added 27 Nov 2026). Julian's club test accounts (`demo1@courtix.app`, his Gmail) are club admins, not team.

**Help requests, done 27 Nov 2026** (migration `20261127030000_support_requests.sql`, test `support_requests_test.sql`):
- **Get help** in every club's sidebar (`/help`, all staff): describe the problem, optional "best way to reach you". The owner (staff.manage) can tick "Let Courtix support look" (2 hours to 7 days) in the same step; an open support session is kept. Other staff can ask, but can't open access. Max 5 requests an hour per person.
- **Team notified by email** (Resend, if `RESEND_API_KEY` and `EMAIL_FROM` are set): every super admin and support person, with the message and a link to the admin page. `support_request_notify_list()` returns their emails only to the person who just sent the request.
- **`courtix.app/admin/help`** (super admin and support; sales and marketing can't see requests because they may contain member details): open requests with the club, sender, contact, whether access is allowed, and "Open club (read only)". Reply (replaces the earlier reply), close, or close without reply. The reply shows on the club's Get help page and is emailed to the sender. The admin nav shows the open count.
- The club sees its requests and replies and can mark them solved.
- **Left open:** one reply per request (no back-and-forth thread); no LINE notification to the team; there's no Forgot password / Change password yet (passwords are reset by hand in SQL).

## Quick fixes (27 Nov 2026)  ☑
- **Forgot password** (`/login/forgot`) emails a link that signs them in and opens **Choose a new password** (`/account/password?reset=1`). **Change password** (`/account/password`) is linked under the email in the club sidebar and in the Courtix admin header. Production: the reset email comes from Supabase Auth, so add `https://courtix.app/**` (as well as `https://*.courtix.app/**`) to Supabase → Authentication → Redirect URLs, and set up a real SMTP sender (Supabase's built-in sender is limited to a few emails an hour). The link works in the browser that asked for it.
- **Auth callback fix:** after an email link it redirected to the server's own address (behind a proxy, e.g. `localhost:3100`), where the sign-in cookie doesn't reach; it now uses the address the person came from (`x-forwarded-host`). Affects reset links, sign-up confirmation and staff invites.
- **Cancel asks first** (see Step 0).
- **Chat requests get the answer in the chat:** lesson requests remember their chat (`bookings.chat_conversation_id`, migration `20261127060000_chat_request_reply.sql`). Approving a visitor's request, or declining any chat request, posts a message in that chat (sent on LINE for LINE chats). Members still get the usual confirmation notice when approved. The message is in English for now.
- `sessions_test` makes its own camp 5 days ahead (the demo's camps are on fixed November dates).

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
