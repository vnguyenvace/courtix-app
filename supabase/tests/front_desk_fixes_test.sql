-- Front-desk fixes: scheduled pauses, desk check-ins (paused, repeats), court clash message.
-- Run on a FRESH local database. Lines labelled "expect:" should produce an error.
\set ON_ERROR_STOP 0
create function public.test_check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'CHECK FAILED: %', what; end if;
  return 'ok: ' || what;
end $$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','owner@raccoon'),
  ('22222222-2222-2222-2222-222222222222','other@club');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select load_raccoon_demo(:'org');
select id as loc, timezone as tz from locations where org_id = :'org' limit 1 \gset
insert into members (org_id, full_name, skill_level) values (:'org', 'Ana Any', 3.0) returning id as ana \gset
insert into members (org_id, full_name, skill_level) values (:'org', 'Ben Pack', 3.0) returning id as ben \gset
select id as pk_any from package_types where org_id = :'org' and name = 'Unlimited any session (30 days)' \gset
select id as pk_pack from package_types where org_id = :'org' and kind = 'class_pack' limit 1 \gset
select sell_membership(:'ana', :'pk_any') as ms_ana \gset
select sell_membership(:'ben', :'pk_pack') as ms_ben \gset
select (now() at time zone :'tz')::date as today \gset
select ends_on as ana_end from memberships where id = :'ms_ana' \gset

\echo '--- 1. A pause from next week leaves the package active until then'
select pause_membership(:'ms_ana', (:'today'::date + 7), (:'today'::date + 17));
select test_check((select status = 'active' and ends_on = :'ana_end'::date + 10 from memberships where id = :'ms_ana'),
                  'still active; end date moved out 10 days');
\echo 'expect: a second pause while one is planned'
select pause_membership(:'ms_ana', (:'today'::date + 20), (:'today'::date + 22));
\echo 'expect: a pause in the past'
select pause_membership(:'ms_ben', (:'today'::date - 1), (:'today'::date + 3));
-- Sessions: covered this week, not inside the planned pause
select id as s_soon from session_overview where org_id = :'org' and type_name = 'Open play'
   and starts_at > now() + interval '30 hours' and (starts_at at time zone :'tz')::date < :'today'::date + 7
 order by starts_at limit 1 \gset
select id as s_paused from sessions where org_id = :'org'
   and (starts_at at time zone :'tz')::date between :'today'::date + 8 and :'today'::date + 12
 order by starts_at limit 1 \gset
select test_check(session_coverage(:'ana', :'s_soon') = :'ms_ana', 'covers a session before the pause');
select test_check(session_coverage(:'ana', :'s_paused') is null, 'no cover inside the planned pause');
select test_check(public.paused_on((:'today'::date + 7), (:'today'::date + 17), (:'today'::date + 7)), 'pause day counts');

\echo '--- 2. The hourly job starts it on the day; ending early gives back the unused days'
reset role;
update memberships set paused_from = :'today'::date, paused_until = :'today'::date + 10, ends_on = :'ana_end'::date + 10 where id = :'ms_ana';
select refresh_membership_statuses();
select test_check((select status = 'paused' from memberships where id = :'ms_ana'), 'job started the pause');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select test_check(end_pause(:'ms_ana') = 'ended', 'end the pause today');
select test_check((select status = 'active' and ends_on = :'ana_end'::date and paused_until = :'today'::date
                     from memberships where id = :'ms_ana'), 'active again; the 10 unused days are taken back');
reset role; select refresh_membership_statuses(); set role authenticated;
select test_check((select status = 'active' from memberships where id = :'ms_ana'), 'the job does not pause it again');
-- Cancel a planned pause
select pause_membership(:'ms_ana', (:'today'::date + 3), (:'today'::date + 5));
select test_check(end_pause(:'ms_ana') = 'cancelled', 'cancel the planned pause');
select test_check((select ends_on = :'ana_end'::date and paused_from is null from memberships where id = :'ms_ana'), 'end date back');
\echo 'expect: nothing to cancel'
select end_pause(:'ms_ana');

\echo '--- 3. Desk check-ins'
select test_check((check_in_member(:'ben', :'loc'))->>'status' = 'checked_in', 'Ben checks in');
select sessions_left as ben_left from memberships where id = :'ms_ben' \gset
select test_check((check_in_member(:'ben', :'loc'))->>'status' = 'already', 'second tap: already checked in');
select test_check((select sessions_left = :ben_left from memberships where id = :'ms_ben'), 'no second credit used');
select test_check((select count(*) = 1 from check_ins where member_id = :'ben'), 'one check-in recorded');
\echo 'expect: a direct second insert is refused too'
insert into check_ins (org_id, member_id, source, location_id) values (:'org', :'ben', 'desk', :'loc');
-- An old check-in (back-dated) is fine
insert into check_ins (org_id, member_id, source, location_id, checked_in_at) values (:'org', :'ben', 'desk', :'loc', now() - interval '3 days');
-- Paused package: ask first
select pause_membership(:'ms_ana', :'today'::date, (:'today'::date + 5));
select test_check((check_in_member(:'ana', :'loc'))->>'status' = 'paused', 'paused: staff are asked');
select test_check((select count(*) = 0 from check_ins where member_id = :'ana'), 'nothing recorded yet');
select test_check((check_in_member(:'ana', :'loc', true))->>'status' = 'checked_in', 'confirmed: checked in');
select test_check((select status = 'paused' from memberships where id = :'ms_ana'), 'the pause is left alone');

\echo '--- 4. Court clash names what holds the court'
select b.court_id as hc, lower(b.during) as hs from bookings b join sessions s on s.id = b.session_id
 where b.org_id = :'org' and b.status = 'confirmed' and lower(b.during) > now() + interval '1 day'
 order by lower(b.during) limit 1 \gset
select test_check(court_clash_text(:'hc', tstzrange(:'hs'::timestamptz, :'hs'::timestamptz + interval '1 hour')) like '% is held by % (%–%) at that time',
                  'held by the session, with its times');
\echo 'expect: booking that court names the session'
select create_booking(:'hc', :'hs'::timestamptz, null, 'Walk-in', 'drop_in');
\echo '--- done'
