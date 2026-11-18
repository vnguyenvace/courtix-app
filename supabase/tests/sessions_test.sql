-- Sessions test: run on a FRESH local database after all migrations.
-- Lines labelled "expect:" should produce an error; everything else should succeed.
\set ON_ERROR_STOP 0
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','owner@raccoon'),('33333333-3333-3333-3333-333333333333','desk@raccoon'),('22222222-2222-2222-2222-222222222222','other@club');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select add_demo_data(:'org') as demo_members;
\echo '--- 1. Load Raccoon timetable'
select load_raccoon_demo(:'org');
\echo 'expect: second load refused'
select load_raccoon_demo(:'org');
select type_name, count(*) as sessions, min(to_char(starts_at at time zone 'Asia/Bangkok','Dy HH24:MI')) as example, max(courts) as courts from session_overview where schedule_id is not null group by type_name order by 1;
select name, to_char(starts_at at time zone 'Asia/Bangkok','DD Mon HH24:MI') as starts, price, max_players, level_min, level_max, courts, notes from session_overview where schedule_id is null order by starts_at;
\echo 'court clashes in generated sessions (expect none):'
select count(*) from sessions where notes like 'Already booked%';
select count(*) as packages_on_sale from package_types where org_id=:'org' and is_active;

\echo '--- 2. Sign-ups, capacity, waitlist'
-- a clinic on court 3 tomorrow, max 8: shrink to 2 for testing
select id as clinic from session_overview where type_name='Adult clinic' and starts_at > now() + interval '20 hours' order by starts_at limit 1 \gset
update sessions set max_players = 2 where id = :'clinic';
select id as m1 from members where full_name='Dmitri Volkov' \gset
select id as m2 from members where full_name='Anna Becker' \gset
select id as m3 from members where full_name='Somchai Rattana' \gset
select register_for_session(:'clinic', :'m1') as r1 \gset
select register_for_session(:'clinic', :'m2') as r2 \gset
select register_for_session(:'clinic', :'m3') as r3 \gset
select register_for_session(:'clinic', null, 'Tourist Tom', '+66 81 000 0000') as r4 \gset
\echo 'expect: duplicate error'
select register_for_session(:'clinic', :'m1');
select name, status from session_roster where session_id=:'clinic' order by created_at;
select booked, waitlisted, spots_left, min_reached from session_overview where id=:'clinic';
\echo 'Dmitri cancels -> Somchai promoted'
select (select name from session_roster where id = cancel_registration(:'r1')) as promoted;
select name, status from session_roster where session_id=:'clinic' order by created_at;

\echo '--- 3. Level rules (match play is 3.5+)'
select id as mp from session_overview where type_name like 'Social match play (tennis)' order by starts_at limit 1 \gset
update members set skill_level = 3.0 where id = :'m2';
\echo 'expect: level error'
select register_for_session(:'mp', :'m2');
select register_for_session(:'mp', :'m2', null, null, false, true) is not null as desk_override_ok;

\echo '--- 4. Booking cutoff and court holds'
select id as soon from session_overview where starts_at between now() and now() + interval '50 minutes' limit 1 \gset
select id as camp from session_overview where name like 'Coach Kimo camp: 3.0%' \gset
select court_name, kind, to_char(start_at at time zone 'Asia/Bangkok','DD Mon HH24:MI') s, notes from booking_calendar where session_id = :'camp';
\echo 'expect: court 4 already held for camp'
select create_booking((select id from courts where name='Court 4' and org_id=:'org'), (select starts_at from sessions where id=:'camp'), null, 'Walk-in');

\echo '--- 5. Go / no-go check'
-- move one open play to start in 2 hours with 1 player (min 4), and the clinic to 2 hours with 2 players (min 2)
select id as op from session_overview where type_name='Open play' order by starts_at desc limit 1 \gset
reset role;
update sessions set starts_at = now() + interval '2 hours', ends_at = now() + interval '5 hours' where id = :'op';
update sessions set starts_at = now() + interval '2 hours', ends_at = now() + interval '3 hours' where id = :'clinic';
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select register_for_session(:'op', :'m1', null, null, true) is not null as one_player;
select (select name from session_overview where id = c.session_id) as session, outcome, booked, min_players from check_session_minimums(:'org') c order by outcome;
select status, cancel_reason from sessions where id = :'op';
select count(*) as op_courts_still_held from bookings where session_id = :'op' and status='confirmed';
select status from session_roster where session_id = :'op';

\echo '--- 6. Attendance counts as a visit'
select id as reg from session_roster where session_id=:'clinic' and status='booked' limit 1 \gset
select mark_attendance(:'reg', true);
select status, (select count(*) from check_ins where source='session') as session_checkins from session_roster where id=:'reg';

\echo '--- 7. Cancel a whole event'
select cancel_session(:'camp', 'Coach delayed') as people_to_tell;
select count(*) as camp_court_holds from bookings where session_id=:'camp' and status='confirmed';

\echo '--- 8. Desk staff vs manager; other club'
reset role;
insert into org_staff values (:'org','33333333-3333-3333-3333-333333333333','staff');
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select register_for_session(:'mp', null, 'Guest Gina') is not null as desk_can_sign_up;
\echo 'expect: desk cannot generate sessions'
select generate_sessions(:'org');
update session_types set price = 1;
select count(*) as cheap_types from session_types where price = 1;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select count(*) as other_club_sees_sessions from session_overview;
\echo 'expect: other club cannot sign up'
select register_for_session(:'mp', null, 'Sneaky');
\echo '--- 9. Re-generating is safe'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select generate_sessions(:'org', 14) as new_sessions;
