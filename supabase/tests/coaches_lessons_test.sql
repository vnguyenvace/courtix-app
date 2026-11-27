-- Coaches and private lessons test. Run on a FRESH local database after all migrations.
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
  ('22222222-2222-2222-2222-222222222222','owner@padel.test', now()),
  ('33333333-3333-3333-3333-333333333333','desk@raccoon.test', now()),
  ('44444444-4444-4444-4444-444444444444','promo@raccoon.test', now());

set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select add_demo_data(:'org') is not null as demo;
select load_raccoon_demo(:'org');
select id as loc, timezone as tz from locations where org_id = :'org' limit 1 \gset
select id as court1 from courts where location_id = :'loc' order by sort_order limit 1 \gset
select id as m1 from members where org_id = :'org' order by full_name limit 1 \gset
-- Tomorrow 10:00 and 10:30 at the location
select ((now() at time zone :'tz')::date + 1 + time '10:00') at time zone :'tz' as t10 \gset
select ((now() at time zone :'tz')::date + 1 + time '10:30') at time zone :'tz' as t1030 \gset
select ((now() at time zone :'tz')::date + 1 + time '12:00') at time zone :'tz' as t12 \gset
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Chalong Padel','chalong') as org2 \gset
reset role;
-- Clear tomorrow morning at this location (demo bookings and session court holds) for the lessons.
delete from bookings where location_id = :'loc' and during && tstzrange(:'t10'::timestamptz - interval '1 hour', :'t12'::timestamptz + interval '1 hour');
insert into org_staff (org_id, user_id, role) values
  (:'org', '33333333-3333-3333-3333-333333333333', 'front_desk'),
  (:'org', '44444444-4444-4444-4444-444444444444', 'marketing');
set role authenticated;

\echo '--- 1. Coaches and prices'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into coaches (org_id, name, phone) values (:'org', 'Coach Kimo', '0811111111') returning id as kimo \gset
insert into coaches (org_id, name) values (:'org', 'Coach Ploy') returning id as ploy \gset
\echo 'expect: same name twice'
insert into coaches (org_id, name) values (:'org', 'coach kimo');
-- Club-wide prices, and Kimo's own price for 1 person, 60 minutes
insert into lesson_rates (org_id, coach_id, minutes, group_size, price) values
  (:'org', null, 60, 1, 1500), (:'org', null, 60, 2, 2000), (:'org', :'kimo', 60, 1, 2800);
\echo 'expect: same price row twice'
insert into lesson_rates (org_id, coach_id, minutes, group_size, price) values (:'org', null, 60, 1, 1200);
select test_check(lesson_price(:'kimo', 60, 1) = 2800, 'coach''s own price wins');
select test_check(lesson_price(:'ploy', 60, 1) = 1500, 'club-wide price otherwise');
select test_check(lesson_price(:'kimo', 60, 2) = 2000, 'club-wide price for 2 people');
select test_check(lesson_price(:'kimo', 30, 1) is null, 'no price for 30 minutes');

set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo 'expect: front desk cannot add coaches'
insert into coaches (org_id, name) values (:'org', 'Desk coach');
select test_check(not exists (select 1 from coaches where name = 'Desk coach'), 'front desk cannot add coaches');
select test_check((select count(*) from coaches) = 2, 'front desk sees the coaches');
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select test_check((select count(*) from coaches) = 0 and (select count(*) from lesson_rates) = 0, 'other clubs see nothing');
\echo 'expect: another club cannot book our coach'
select book_lesson(:'kimo', :'t10', 60, 1, null, :'loc', null, 'Tom', null);

\echo '--- 2. Booking a lesson: coach and court in one step'
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select book_lesson(:'kimo', :'t10', 60, 1, :'court1', null, :'m1', null, null) as l1 \gset
select test_check((select kind = 'coaching' and coach_id = :'kimo' and price = 2800 and group_size = 1 and member_id = :'m1'
                   from bookings where id = :'l1'), 'lesson booked with Kimo''s price');
select test_check((select count(*) from coach_busy where booking_id = :'l1') = 1, 'Kimo is busy');
select test_check((select i.amount = 2800 and o.status = 'pending' and i.description like 'Lesson with Coach Kimo, %'
                   from order_items i join orders o on o.id = i.order_id where i.booking_id = :'l1'), 'an order to pay');
\echo 'expect: Kimo is already teaching'
select book_lesson(:'kimo', :'t1030', 60, 1, null, :'loc', null, 'Tom', null);
\echo 'expect: the court is already booked'
select book_lesson(:'ploy', :'t1030', 60, 2, :'court1', null, null, 'Tom', null);
select book_lesson(:'ploy', :'t1030', 60, 2, null, :'loc', null, 'Tourist Tom', null) as l2 \gset
select test_check((select court_id <> :'court1' and price = 2000 and guest_name = 'Tourist Tom' from bookings where id = :'l2'),
                  'any free court: picked another one, 2-person price');
\echo 'expect: no price for 30 minutes'
select book_lesson(:'ploy', :'t12', 30, 1, null, :'loc', null, 'Tom', null);
\echo 'expect: needs a member or a guest'
select book_lesson(:'ploy', :'t12', 60, 1, null, :'loc', null, null, null);
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
\echo 'expect: marketing cannot book lessons'
select book_lesson(:'ploy', :'t12', 60, 1, null, :'loc', null, 'Tom', null);

\echo '--- 3. Cancelling frees the coach and cancels the order'
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
update bookings set status = 'cancelled' where id = :'l1';
select test_check(not exists (select 1 from coach_busy where booking_id = :'l1'), 'Kimo is free again');
select test_check((select o.status = 'cancelled' from order_items i join orders o on o.id = i.order_id where i.booking_id = :'l1'), 'order cancelled');
select book_lesson(:'kimo', :'t1030', 60, 1, null, :'loc', :'m1', null, null) is not null as rebooked;

\echo '--- 4. Sessions with a coach from the list'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select id as clinic from sessions where org_id = :'org' and status <> 'cancelled' and starts_at > now() + interval '2 days'
 order by starts_at limit 1 \gset
select set_session_coach(:'clinic', :'ploy');
select test_check((select coach_name = 'Coach Ploy' from sessions where id = :'clinic'), 'session shows the coach''s name');
select test_check((select count(*) from coach_busy where session_id = :'clinic') = 1, 'Ploy is busy during the session');
select starts_at as clinic_start from sessions where id = :'clinic' \gset
\echo 'expect: Ploy is teaching the session'
select book_lesson(:'ploy', :'clinic_start', 60, 1, null, :'loc', null, 'Tom', null);
select cancel_session(:'clinic', 'rain');
select test_check(not exists (select 1 from coach_busy where session_id = :'clinic'), 'cancelled session frees the coach');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo 'expect: front desk cannot change a session''s coach'
select set_session_coach(:'clinic', :'kimo');
select test_check((select count(*) from coach_schedule where coach_id = :'kimo') = 1, 'Kimo''s schedule lists the lesson');
\echo '--- done'
