-- Editing sessions, session types and the weekly timetable. Run on a FRESH local database.
-- Lines labelled "expect:" should produce an error; test_check() fails the run on a wrong value.
\set ON_ERROR_STOP 0
create function public.test_check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'CHECK FAILED: %', what; end if;
  return 'ok: ' || what;
end $$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','owner@raccoon'),
  ('33333333-3333-3333-3333-333333333333','desk@raccoon');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select add_demo_data(:'org') is not null as demo;
select load_raccoon_demo(:'org');
select id as tz_loc from locations where org_id = :'org' limit 1 \gset
select count(*) as sessions_before from sessions where org_id = :'org' \gset

\echo '--- 1. Move one session 30 minutes later: courts follow, the timetable does not recreate it'
select id as clinic, starts_at as clinic_start from session_overview
 where type_name = 'Adult clinic' and starts_at > now() + interval '30 hours' order by starts_at limit 1 \gset
select update_session(:'clinic', null, :'clinic_start'::timestamptz + interval '30 minutes',
                      :'clinic_start'::timestamptz + interval '90 minutes',
                      null, null, null, null, null, 'Coach Mai', null, null, null) as r1 \gset
select test_check(starts_at = :'clinic_start'::timestamptz + interval '30 minutes' and edited_at is not null
                  and schedule_slot = :'clinic_start'::timestamptz and coach_name = 'Coach Mai', 'moved, marked edited, slot kept')
  from sessions where id = :'clinic';
select test_check(lower(during) = :'clinic_start'::timestamptz + interval '30 minutes', 'court hold moved too')
  from bookings where session_id = :'clinic' and status = 'confirmed';
select generate_sessions(:'org', 14);
select test_check((select count(*) from sessions where org_id = :'org') = :sessions_before, 'hourly job does not recreate it at the old time');

\echo '--- 2. Player limits: not below people booked; raising the limit moves the waitlist up'
update sessions set min_players = 1, max_players = 2 where id = :'clinic';
select id as m1 from members where org_id = :'org' order by full_name limit 1 \gset
select id as m2 from members where org_id = :'org' order by full_name offset 1 limit 1 \gset
select id as m3 from members where org_id = :'org' order by full_name offset 2 limit 1 \gset
select register_for_session(:'clinic', :'m1') is not null, register_for_session(:'clinic', :'m2') is not null;
select register_for_session(:'clinic', :'m3') as r_m3 \gset
select test_check(status = 'waitlisted', 'third person waitlisted') from session_registrations where id = :'r_m3';
\echo 'expect: limit below the 2 people booked'
select update_session(:'clinic', null, null, null, null, 1, 1, null, null, null, null, null, null);
select test_check((update_session(:'clinic', null, null, null, null, 1, 3, null, null, null, null, null, null)->>'moved_up')::int = 1, 'raised to 3: one moved up');
select test_check(status = 'booked', 'waitlisted person is now booked') from session_registrations where id = :'r_m3';

\echo '--- 3. Price change: booked places keep their price'
select update_session(:'clinic', null, null, null, 650, null, 4, null, null, null, null, null, null);
select test_check((select price from session_registrations where id = :'r_m3') = 500, 'existing place keeps 500');
select register_for_session(:'clinic', null, 'New Ned') as r_ned \gset
select test_check((select price from session_registrations where id = :'r_ned') = 650, 'new sign-up pays 650');

\echo '--- 4. Bad edits are refused'
\echo 'expect: end before start'
select update_session(:'clinic', null, null, :'clinic_start'::timestamptz, null, null, null, null, null, null, null, null, null);
\echo 'expect: moved into the past'
select update_session(:'clinic', null, now() - interval '2 hours', now() - interval '1 hour', null, null, null, null, null, null, null, null, null);
reset role;
insert into org_staff (org_id, user_id, role) values (:'org', '33333333-3333-3333-3333-333333333333', 'staff');
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo 'expect: desk staff cannot edit sessions'
select update_session(:'clinic', 'Hacked', null, null, null, null, null, null, null, null, null, null, null);
\echo 'expect: desk staff cannot change the timetable'
select update_schedule((select id from session_schedules where org_id = :'org' limit 1), '{1}', '10:00', '{}');
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo '--- 5. Edit a session type and update its upcoming sessions (not the hand-edited one)'
select id as clinic_type from session_types where org_id = :'org' and name = 'Adult clinic' \gset
update session_types set price = 550, duration_minutes = 90 where id = :'clinic_type';
select apply_session_type(:'clinic_type') as applied \gset
select test_check(((:'applied'::jsonb)->>'updated')::int > 0, 'upcoming clinics updated');
select test_check(bool_and(price = 550 and ends_at - starts_at = interval '90 minutes'), 'price 550 and 90 minutes on untouched clinics')
  from sessions where session_type_id = :'clinic_type' and starts_at > now() and status <> 'cancelled' and edited_at is null;
select test_check(price = 650, 'hand-edited clinic keeps its own price') from sessions where id = :'clinic';
select test_check(bool_and(upper(b.during) = s.ends_at), 'court holds follow the longer clinics')
  from sessions s join bookings b on b.session_id = s.id and b.status = 'confirmed'
 where s.session_type_id = :'clinic_type' and s.starts_at > now() and s.edited_at is null;

\echo '--- 6. Timetable: evening open play 18:00 -> 18:30'
select sc.id as evening from session_schedules sc join session_types t on t.id = sc.session_type_id
 where sc.org_id = :'org' and t.name = 'Open play' and sc.start_time = '18:00' \gset
select id as busy_open from sessions where schedule_id = :'evening' and starts_at > now() + interval '30 hours' order by starts_at limit 1 \gset
select register_for_session(:'busy_open', :'m1') is not null as signed_up;
select update_schedule(:'evening', '{0,1,2,3,4,5,6}', '18:30',
                       (select court_ids from session_schedules where id = :'evening')) as moved \gset
select test_check(jsonb_array_length((:'moved'::jsonb)->'kept') >= 1, 'session with people is kept and listed');
select test_check((:'moved'::jsonb)->'kept' @> jsonb_build_array(jsonb_build_object('id', :'busy_open')), 'the busy one is listed');
select test_check(to_char(starts_at at time zone 'Asia/Bangkok', 'HH24:MI') = '18:00', 'busy session stays at 18:00')
  from sessions where id = :'busy_open';
select test_check(count(*) > 0, 'empty sessions rebuilt at 18:30')
  from sessions where schedule_id = :'evening' and to_char(starts_at at time zone 'Asia/Bangkok', 'HH24:MI') = '18:30';
select test_check(count(*) = 0, 'no empty 18:00 sessions left')
  from sessions s where s.schedule_id = :'evening' and s.starts_at > now() and s.id <> :'busy_open'
   and to_char(s.starts_at at time zone 'Asia/Bangkok', 'HH24:MI') = '18:00';
select count(*) as after_move from sessions where org_id = :'org' \gset
select generate_sessions(:'org', 14);
select test_check((select count(*) from sessions where org_id = :'org') = :after_move, 'hourly job adds nothing more');
\echo 'expect: no days picked'
select update_schedule(:'evening', '{}', '18:30', '{}');
\echo '--- done'
