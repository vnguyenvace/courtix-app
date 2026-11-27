-- Lessons booked online (booking page, members) and requested by chat. Run on a FRESH local database.
-- Lines labelled "expect:" should produce an error; everything else should succeed.
\set ON_ERROR_STOP 0
create function public.test_check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'CHECK FAILED: %', what; end if;
  return 'ok: ' || what;
end $$;
grant execute on function public.test_check(boolean, text) to anon, authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111','owner@raccoon.test', now()),
  ('22222222-2222-2222-2222-222222222222','owner@padel.test', now());

set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
update orgs set public_booking = true, chat_mode = 'book', online_signups = 'instant',
                auto_notices = array['booking_confirmed'] where id = :'org';
select id as loc, timezone as tz from locations where org_id = :'org' limit 1 \gset
insert into members (org_id, full_name, phone) values (:'org', 'Eve Evenings', '+66 81 111 2222') returning id as eve \gset
insert into coaches (org_id, name, about) values (:'org', 'Coach Kimo', 'IPTPA') returning id as kimo \gset
insert into coaches (org_id, name) values (:'org', 'Coach Noprice') returning id as noprice \gset
insert into lesson_rates (org_id, coach_id, minutes, group_size, price) values
  (:'org', null, 60, 1, 1500), (:'org', :'kimo', 60, 1, 2800), (:'org', null, 60, 2, 2000);
delete from lesson_rates where coach_id is null and minutes = 60 and group_size = 1;  -- only Kimo has a 1-person price now
select ((now() at time zone :'tz')::date + 2) as day2 \gset
select ((:'day2'::date + time '10:00') at time zone :'tz') as t10 \gset
select ((:'day2'::date + time '11:00') at time zone :'tz') as t11 \gset
select ((:'day2'::date + time '14:00') at time zone :'tz') as t14 \gset
select ((:'day2'::date + time '16:00') at time zone :'tz') as t16 \gset
select chat_open_conversation(:'org', 'test', '0811112222', 'Eve') as c_eve \gset
select chat_open_conversation(:'org', 'test', '+44 7700 900123', 'Tom Visitor') as c_tom \gset
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Chalong Padel','chalong') as org2 \gset
reset role;
-- Clear demo court bookings on day 2 (none expected in a fresh club, but be safe)
delete from bookings where org_id = :'org';

\echo '--- 1. The booking page shows coaches with prices and free times'
set role anon;
select test_check(jsonb_array_length(public_lessons('raccoon')) = 2, 'both coaches have a price (the club''s 2-person one)');
select test_check(public_lesson_price('raccoon', :'noprice', 60, 1) is null, 'Noprice has no 1-person price');
select test_check((public_lessons('raccoon'))->0->>'name' = 'Coach Kimo', 'Kimo listed');
select test_check(jsonb_array_length((public_lessons('raccoon'))->0->'prices') = 2, 'Kimo: his own 1-person price and the club''s 2-person price');
select test_check(public_lesson_price('raccoon', :'kimo', 60, 1) = 2800, 'price shown before booking');
select count(*) as free_before from public_lesson_times('raccoon', :'kimo', :'loc', :'day2', 60) \gset
select test_check(:free_before > 10, 'many free start times');
select test_check(exists (select 1 from public_lesson_times('raccoon', :'kimo', :'loc', :'day2', 60) t where t = :'t10'::timestamptz), '10:00 is free');
select test_check(not exists (select 1 from public_lesson_times('chalong', :'kimo', :'loc', :'day2', 60)), 'another club''s page shows nothing');
\echo 'expect: anonymous visitors cannot call the staff version'
select * from lesson_free_times(:'kimo', :'loc', :'day2', 60);

\echo '--- 2. Visitor books (instant mode)'
select public_book_lesson('raccoon', :'kimo', :'t10', 60, 1, :'loc', 'Tourist Tom', '+44 7700 900123', true, false) as r1 \gset
select test_check((:'r1'::jsonb->>'pending_approval')::boolean = false and (:'r1'::jsonb->>'price')::numeric = 2800, 'booked straight away at Kimo''s price');
select test_check(not exists (select 1 from public_lesson_times('raccoon', :'kimo', :'loc', :'day2', 60) t where t in (:'t10'::timestamptz, :'t10'::timestamptz + interval '30 minutes')), '10:00 and 10:30 no longer offered');
\echo 'expect: Kimo is already teaching'
select public_book_lesson('raccoon', :'kimo', :'t10', 60, 1, :'loc', 'Other', '+44 7700 900999', true, false);
\echo 'expect: no price for that coach'
select public_book_lesson('raccoon', :'noprice', :'t14', 60, 1, :'loc', 'Other', '+44 7700 900999', true, false);
\echo 'expect: consent needed'
select public_book_lesson('raccoon', :'kimo', :'t14', 60, 1, :'loc', 'Other', '+44 7700 900999', false, false);
\echo 'expect: another club''s coach'
select public_book_lesson('chalong', :'kimo', :'t14', 60, 1, :'loc', 'Other', '+44 7700 900999', true, false);
reset role;
select test_check((select source = 'online' and kind = 'coaching' and guest_phone = '+447700900123' and not pending_approval
                   from bookings where id = (:'r1'::jsonb->>'booking_id')::uuid), 'saved as an online lesson');
select test_check((select o.total = 2800 from order_items i join orders o on o.id = i.order_id
                   where i.booking_id = (:'r1'::jsonb->>'booking_id')::uuid), 'an order to pay at the club');

\echo '--- 3. Approve mode: a request holds coach and court'
update orgs set online_signups = 'approve' where id = :'org';
set role anon;
select public_book_lesson('raccoon', :'kimo', :'t14', 60, 2, :'loc', 'Pair Pat', '0812223333', true, false) as r2 \gset
select test_check((:'r2'::jsonb->>'pending_approval')::boolean and (:'r2'::jsonb->>'price')::numeric = 2000, 'held as a request, 2-person price');
reset role;

\echo '--- 4. Signed-in member books a lesson'
insert into member_sessions (org_id, member_id, token_hash, expires_at)
values (:'org', :'eve', public.sha256_hex('evetoken'), now() + interval '1 day');
set role anon;
select member_book_lesson('raccoon', 'evetoken', :'kimo', :'t16', 60, 1, :'loc') as r3 \gset
select test_check((:'r3'::jsonb->>'pending_approval')::boolean, 'member request in approve mode');
\echo 'expect: wrong token'
select member_book_lesson('raccoon', 'nope', :'kimo', :'t16', 60, 1, :'loc');
reset role;
select test_check((select member_id = :'eve' from bookings where id = (:'r3'::jsonb->>'booking_id')::uuid), 'booked for Eve');

\echo '--- 5. Chat: Claude can only request; staff approve; Eve is told'
-- The chat service runs with nobody signed in.
set request.jwt.claim.sub = '';
set role service_role;
select test_check(exists (select 1 from lesson_free_times(:'kimo', :'loc', :'day2', 60)), 'the chat service sees free times');
select chat_request_lesson(:'c_eve', :'kimo', :'t11', 60, 1) as r4 \gset
select test_check(:'r4'::jsonb->>'status' = 'requested' and :'r4'::jsonb->>'coach' = 'Coach Kimo', 'chat: requested, not booked');
select chat_request_lesson(:'c_tom', :'kimo', :'t10' ::timestamptz + interval '8 hours', 60, 1) as r5 \gset
reset role;
select test_check((select source = 'chat' and pending_approval and member_id = :'eve' from bookings where id = (:'r4'::jsonb->>'booking_id')::uuid), 'held for Eve, waiting for staff');
select test_check((select guest_name = 'Tom Visitor' and pending_approval from bookings where id = (:'r5'::jsonb->>'booking_id')::uuid), 'visitors can request too');
update orgs set chat_mode = 'answer' where id = :'org';
set role service_role;
\echo 'expect: answer-only chats cannot request lessons'
select chat_request_lesson(:'c_eve', :'kimo', :'t16' ::timestamptz + interval '2 hours', 60, 1);
reset role;

set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select decide_online_court((:'r4'::jsonb->>'booking_id')::uuid, true);
select test_check((select not pending_approval from bookings where id = (:'r4'::jsonb->>'booking_id')::uuid), 'approved');
select test_check((select payload->>'court' like 'Lesson with Coach Kimo%' from member_notices
                   where member_id = :'eve' and kind = 'booking_confirmed'), 'Eve gets a lesson confirmation');
select decide_online_court((:'r5'::jsonb->>'booking_id')::uuid, false);
select test_check((select status = 'cancelled' from bookings where id = (:'r5'::jsonb->>'booking_id')::uuid), 'declined: cancelled');
select test_check(not exists (select 1 from coach_busy where booking_id = (:'r5'::jsonb->>'booking_id')::uuid), 'declined: coach free again');

\echo '--- 6. Desk lesson for a member sends a confirmation'
update orgs set online_signups = 'instant' where id = :'org';
select book_lesson(:'kimo', :'t16' ::timestamptz + interval '2 hours', 60, 1, null, :'loc', :'eve', null, null) as l6 \gset
select test_check((select count(*) from member_notices where member_id = :'eve' and kind = 'booking_confirmed') = 2, 'desk lesson confirmation queued');
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select test_check(not exists (select 1 from lesson_free_times(:'kimo', :'loc', :'day2', 60)), 'other club''s staff see no times');
\echo '--- done'
