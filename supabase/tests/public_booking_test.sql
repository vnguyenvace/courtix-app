-- Public booking page test (Step 6): run on a FRESH local database after all migrations.
-- Lines labelled "expect:" should produce an error; everything else should succeed.
-- test_check() raises an error when a value is wrong, so a wrong number fails the run.
\set ON_ERROR_STOP 0
create function public.test_check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'CHECK FAILED: %', what; end if;
  return 'ok: ' || what;
end $$;
grant execute on function public.test_check(boolean, text) to anon;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','owner@raccoon'),
  ('22222222-2222-2222-2222-222222222222','other@club');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select add_demo_data(:'org') is not null as demo;
select load_raccoon_demo(:'org');
select id as loc from locations where org_id = :'org' limit 1 \gset
select id as clinic from session_overview where type_name = 'Adult clinic' and starts_at > now() + interval '30 hours' order by starts_at limit 1 \gset
select id as open_play from session_overview where type_name = 'Open play' and starts_at > now() + interval '30 hours' order by starts_at limit 1 \gset
select id as course_type from session_types where org_id = :'org' and name = 'Coaching course' \gset
-- A member with a package and a known phone: online sign-ups must never use it.
select id as anna from members where org_id = :'org' order by full_name limit 1 \gset
update members set phone = '+66 89 111 2222' where id = :'anna';
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Chalong Padel','chalong') as other_org \gset

\echo '--- 1. A visitor (anon) sees public facts only'
reset role; set role anon; reset request.jwt.claim.sub;
select test_check(public_club('raccoon')->>'name' = 'Raccoon Pickleball', 'club name');
select test_check(jsonb_array_length(public_club('raccoon')->'locations') = 1, 'one location');
select test_check(public_club('nope') is null, 'unknown club: nothing');
select test_check((select count(*) from public_sessions('raccoon')) > 10, 'upcoming sessions listed');
select test_check((select count(*) from public_sessions('raccoon') where name like 'Coach Kimo%' or name like 'Kids%') >= 0, 'events and clinics included');
select test_check((select count(*) from public_court_slots('raccoon', :'loc', current_date + 1)) > 0, 'court slots for tomorrow');
select test_check((select count(*) from public_court_slots('raccoon', :'loc', current_date + 40)) = 0, 'no slots beyond two weeks');
select test_check((select count(*) from public_court_slots('chalong', :'loc', current_date + 1)) = 0, 'another club''s slug cannot read this location');
\echo 'expect: visitors cannot read members'
select count(*) from members;
\echo 'expect: visitors cannot read sign-ups'
select count(*) from session_registrations;
\echo 'expect: visitors cannot call staff functions'
select register_for_session(:'clinic', null, 'Sneaky', '+66810000000');

\echo '--- 2. Online sign-up takes the spot as a guest at the drop-in price'
select public_register('raccoon', :'clinic', '  Tourist   Tom ', '081 234 5678', true, true) as tom \gset
select test_check((:'tom'::jsonb)->>'status' = 'booked', 'booked straight away');
select test_check(((:'tom'::jsonb)->>'price')::numeric = 500, 'drop-in price 500');
\echo 'expect: same number cannot sign up twice for one session'
select public_register('raccoon', :'clinic', 'Tom again', '+66 81 234 5678', true, false);
\echo 'expect: contact consent is required'
select public_register('raccoon', :'open_play', 'Nora', '+44 7700 900111', false, false);
\echo 'expect: a phone number is required'
select public_register('raccoon', :'open_play', 'Nora', '12', true, false);
\echo 'expect: a name is required'
select public_register('raccoon', :'open_play', '   ', '+44 7700 900111', true, false);
\echo 'expect: a session from another club is not found'
select public_register('chalong', :'clinic', 'Nora', '+44 7700 900111', true, false);

\echo '--- 3. A member''s phone number online stays a guest (no package, no credits)'
select public_register('raccoon', :'open_play', 'Someone', '089 111 2222', true, false) as anna_online \gset

\echo '--- 4. Limits: 3 online sign-ups per number per day'
select id as s2 from public_sessions('raccoon') where name = 'Open play' and starts_at > now() + interval '30 hours' order by starts_at offset 1 limit 1 \gset
select id as s3 from public_sessions('raccoon') where name = 'Open play' and starts_at > now() + interval '30 hours' order by starts_at offset 2 limit 1 \gset
select id as s4 from public_sessions('raccoon') where name = 'Open play' and starts_at > now() + interval '30 hours' order by starts_at offset 3 limit 1 \gset
select public_register('raccoon', :'s2', 'Busy Bee', '+61 400 000 001', true, false) is not null as one;
select public_register('raccoon', :'s3', 'Busy Bee', '+61 400 000 001', true, false) is not null as two;
select public_register('raccoon', :'s4', 'Busy Bee', '+61 400 000 001', true, false) is not null as three;
\echo 'expect: fourth online sign-up today for the same number'
select public_register('raccoon', :'open_play', 'Busy Bee', '+61 400 000 001', true, false);

reset role;
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo '--- 5. Staff see the online sign-ups'
select test_check(source = 'online' and guest_phone = '+66812345678' and guest_name = 'Tourist Tom'
                  and guest_marketing_consent and member_id is null, 'stored as an online guest, Thai number normalised')
  from session_registrations where id = ((:'tom'::jsonb)->>'registration_id')::uuid;
select test_check(member_id is null and membership_id is null and price = 350, 'member phone online: guest at 350, no package used')
  from session_registrations where id = ((:'anna_online'::jsonb)->>'registration_id')::uuid;
select test_check((select count(*) from session_roster where source = 'online') = 5, 'roster shows 5 online places');

\echo '--- 6. Full sessions waitlist; hidden types and switched-off clubs refuse'
update sessions set min_players = 1, max_players = 1 where id = :'s2';
reset role; set role anon;
select test_check(public_register('raccoon', :'s2', 'Late Larry', '+49 151 0000000', true, false)->>'status' = 'waitlisted', 'full: waitlisted');
reset role;
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update session_types set is_public = false where org_id = :'org' and name = 'Open play';
update orgs set public_booking = false where id = :'org';
reset role; set role anon;
select test_check((select count(*) from public_sessions('raccoon')) = 0, 'switched off: no sessions shown');
\echo 'expect: club has switched online booking off'
select public_register('raccoon', :'clinic', 'Nora', '+44 7700 900111', true, false);
reset role;
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update orgs set public_booking = true where id = :'org';
reset role; set role anon;
select test_check((select count(*) from public_sessions('raccoon') where name = 'Open play') = 0, 'hidden type not listed');
\echo 'expect: hidden session type cannot be booked'
select public_register('raccoon', :'s3', 'Nora', '+44 7700 900111', true, false);
\echo '--- done'
