-- Package coverage test (Step 2): run on a FRESH local database after all migrations.
-- Lines labelled "expect:" should produce an error; everything else should succeed.
-- check() raises an error when a value is wrong, so a wrong number fails the test run.
\set ON_ERROR_STOP 0
create function public.test_check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'CHECK FAILED: %', what; end if;
  return 'ok: ' || what;
end $$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','owner@raccoon'),
  ('33333333-3333-3333-3333-333333333333','desk@raccoon'),
  ('22222222-2222-2222-2222-222222222222','other@club');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select load_raccoon_demo(:'org');
select generate_sessions(:'org', 28) >= 0 as more_sessions;  -- four weeks, so there are enough match-play mornings
select test_check((select count(*) from package_coverage where org_id = :'org') = 6, 'demo loads 6 coverage rules');

-- Test members, one per package, plus one with nothing.
insert into members (org_id, full_name, skill_level) values (:'org', 'Eve Evenings', 3.0) returning id as eve \gset
insert into members (org_id, full_name, skill_level) values (:'org', 'Ana Any', 3.0) returning id as ana \gset
insert into members (org_id, full_name, skill_level) values (:'org', 'Mo Mornings', 4.0) returning id as mo \gset
insert into members (org_id, full_name, skill_level) values (:'org', 'Nina Nopackage', 3.0) returning id as nina \gset
select id as pk_evenings from package_types where org_id = :'org' and name = 'Unlimited evenings (30 days)' \gset
select id as pk_any from package_types where org_id = :'org' and name = 'Unlimited any session (30 days)' \gset
select id as pk_mornings from package_types where org_id = :'org' and name like 'Match play mornings%' \gset
select sell_membership(:'eve', :'pk_evenings') as ms_eve \gset
select sell_membership(:'ana', :'pk_any') as ms_ana \gset
select sell_membership(:'mo', :'pk_mornings') as ms_mo \gset

-- Sessions to use (all more than a day away so sign-ups are open).
select id as evening_open from session_overview where type_name = 'Open play'
   and to_char(starts_at at time zone 'Asia/Bangkok', 'HH24:MI') = '18:00' and starts_at > now() + interval '30 hours'
 order by starts_at limit 1 \gset
select id as morning_open from session_overview where type_name = 'Open play'
   and to_char(starts_at at time zone 'Asia/Bangkok', 'HH24:MI') = '08:30' and starts_at > now() + interval '30 hours'
 order by starts_at limit 1 \gset
select id as clinic from session_overview where type_name = 'Adult clinic'
   and starts_at > now() + interval '30 hours' order by starts_at limit 1 \gset
select id as mp1 from session_overview where type_name = 'Social match play (tennis)'
   and starts_at > now() + interval '30 hours' order by starts_at limit 1 \gset
select id as mp2 from session_overview where type_name = 'Social match play (tennis)'
   and starts_at > now() + interval '30 hours' order by starts_at offset 1 limit 1 \gset

\echo '--- 1. Unlimited evenings: evening open play is covered, morning open play and clinics are not'
select register_for_session(:'evening_open', :'eve') as r_eve_evening \gset
select test_check(price = 0 and membership_id = :'ms_eve' and not credit_used, 'evening open play costs 0, covered by the evenings package')
  from session_registrations where id = :'r_eve_evening';
select register_for_session(:'morning_open', :'eve') as r_eve_morning \gset
select test_check(price = 350 and membership_id is null, 'morning open play is the drop-in price')
  from session_registrations where id = :'r_eve_morning';
select register_for_session(:'clinic', :'eve') as r_eve_clinic \gset
select test_check(price = 500 and membership_id is null, 'clinic is the drop-in price (500)')
  from session_registrations where id = :'r_eve_clinic';
select test_check(covered_by = 'Unlimited evenings (30 days)', 'roster shows what covered the place')
  from session_roster where id = :'r_eve_evening';

\echo '--- 2. Unlimited any session: clinic covered, no credits involved'
select register_for_session(:'clinic', :'ana') as r_ana_clinic \gset
select test_check(price = 0 and membership_id = :'ms_ana', 'clinic covered by any-session package')
  from session_registrations where id = :'r_ana_clinic';

\echo '--- 3. Class pack: 11 -> 10 on sign-up, back to 11 on an early cancel'
update orgs set late_cancel_hours = 24 where id = :'org';
select register_for_session(:'mp1', :'mo') as r_mo1 \gset
select test_check(price = 0 and credit_used, 'match play covered by a credit') from session_registrations where id = :'r_mo1';
select test_check(sessions_left = 10, 'credits 11 -> 10') from memberships where id = :'ms_mo';
select cancel_registration(:'r_mo1');
select test_check(sessions_left = 11, 'early cancel refunds: back to 11') from memberships where id = :'ms_mo';
select test_check(not credit_used and status = 'cancelled', 'cancelled place no longer holds a credit')
  from session_registrations where id = :'r_mo1';

\echo '--- 4. Late cancel keeps the credit used'
update orgs set late_cancel_hours = 168 where id = :'org';  -- one week: every test session is "late"
select register_for_session(:'mp1', :'mo') as r_mo2 \gset
select test_check(sessions_left = 10, 'signed up again: 10') from memberships where id = :'ms_mo';
select cancel_registration(:'r_mo2');
select test_check(sessions_left = 10, 'late cancel: still 10') from memberships where id = :'ms_mo';
update orgs set late_cancel_hours = 24 where id = :'org';

\echo '--- 5. Attending does not use a second credit; a desk check-in still uses one'
select register_for_session(:'mp2', :'mo') as r_mo3 \gset
select test_check(sessions_left = 9, 'second session: 9') from memberships where id = :'ms_mo';
select mark_attendance(:'r_mo3', true);
select test_check(sessions_left = 9, 'attended: still 9 (no double charge)') from memberships where id = :'ms_mo';
insert into check_ins (org_id, member_id, source) values (:'org', :'mo', 'desk');
select test_check(sessions_left = 8, 'desk check-in uses a credit: 8') from memberships where id = :'ms_mo';

\echo '--- 6. Club cancels a session: credits come back even inside the cut-off'
select id as mp3 from session_overview where type_name = 'Social match play (tennis)'
   and starts_at > now() + interval '30 hours' and id not in (:'mp1', :'mp2') order by starts_at limit 1 \gset
select register_for_session(:'mp3', :'mo') as r_mo4 \gset
select test_check(sessions_left = 7, 'third session: 7') from memberships where id = :'ms_mo';
update orgs set late_cancel_hours = 168 where id = :'org';
select cancel_session(:'mp3', 'Rain');
select test_check(sessions_left = 8, 'club cancelled: back to 8') from memberships where id = :'ms_mo';
update orgs set late_cancel_hours = 24 where id = :'org';

\echo '--- 7. Waitlist: the credit is taken when the member moves up, not before'
update sessions set min_players = 1, max_players = 1 where id = :'mp1';
select register_for_session(:'mp1', null, 'Tourist Tom') as r_tom \gset
select register_for_session(:'mp1', :'mo') as r_mo5 \gset
select test_check(status = 'waitlisted' and not credit_used and price = 0, 'waitlisted: no credit yet, shown as covered')
  from session_registrations where id = :'r_mo5';
select test_check(sessions_left = 8, 'waitlisted: still 8') from memberships where id = :'ms_mo';
select test_check(cancel_registration(:'r_tom') = :'r_mo5', 'Mo moves up when Tom cancels');
select test_check(status = 'booked' and credit_used, 'moved up: credit taken') from session_registrations where id = :'r_mo5';
select test_check(sessions_left = 7, 'moved up: 7') from memberships where id = :'ms_mo';

\echo '--- 8. Out of credits: pays the drop-in price, and the pack comes back on a refund'
update memberships set sessions_left = 1 where id = :'ms_mo';
select id as mp4 from session_overview where type_name = 'Social match play (tennis)'
   and starts_at > now() + interval '30 hours' and id not in (:'mp1', :'mp2', :'mp3') order by starts_at limit 1 \gset
select register_for_session(:'mp4', :'mo') as r_mo6 \gset
select test_check(sessions_left = 0, 'last credit used: 0') from memberships where id = :'ms_mo';
reset role;
select refresh_membership_statuses();
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select test_check(status = 'expired', 'pack with 0 credits expires') from memberships where id = :'ms_mo';
select cancel_registration(:'r_mo6');
select test_check(status = 'active' and sessions_left = 1, 'early cancel brings the pack back to life')
  from memberships where id = :'ms_mo';
update memberships set sessions_left = 0, status = 'expired' where id = :'ms_mo';
select register_for_session(:'mp4', :'mo') as r_mo7 \gset
select test_check(price = 450 and membership_id is null, 'no credits left: drop-in price 450')
  from session_registrations where id = :'r_mo7';

\echo '--- 9. Priority booking: sign-ups open 1 day before; any-session members get 2 extra days'
update session_types set signup_opens_days = 1 where org_id = :'org' and name = 'Open play';
select id as far_open from session_overview where type_name = 'Open play'
   and starts_at between now() + interval '50 hours' and now() + interval '70 hours' order by starts_at limit 1 \gset
\echo 'expect: not open yet for a member without priority'
select register_for_session(:'far_open', :'nina');
select test_check(register_for_session(:'far_open', :'ana') is not null, 'any-session member can sign up early (priority)');
select test_check(register_for_session(:'far_open', :'nina', null, null, true) is not null, 'desk override lets anyone in early');

\echo '--- 10. Paused membership does not cover'
select id as eve_open2 from session_overview where type_name = 'Open play'
   and to_char(starts_at at time zone 'Asia/Bangkok', 'HH24:MI') = '18:00' and id <> :'evening_open'
   and starts_at > now() + interval '30 hours' order by starts_at limit 1 \gset
update session_types set signup_opens_days = null where org_id = :'org' and name = 'Open play';
select pause_membership(:'ms_eve', current_date, current_date + 20);
select register_for_session(:'eve_open2', :'eve') as r_eve_paused \gset
select test_check(price = 350 and membership_id is null, 'paused: drop-in price')
  from session_registrations where id = :'r_eve_paused';

\echo '--- 10b. Go / no-go cancels for too few players: the credit comes back'
update memberships set sessions_left = 5, status = 'active' where id = :'ms_mo';
select id as mp5 from session_overview where type_name = 'Social match play (tennis)'
   and starts_at > now() + interval '30 hours' and status <> 'cancelled'
   and id not in (:'mp1', :'mp2', :'mp3', :'mp4') order by starts_at limit 1 \gset
select register_for_session(:'mp5', :'mo') as r_mo8 \gset
select test_check(sessions_left = 4, 'go / no-go test: 5 -> 4') from memberships where id = :'ms_mo';
update session_types set min_check_hours = 720 where org_id = :'org' and name = 'Social match play (tennis)';
select count(*) as decided from check_session_minimums(:'org');
select test_check(status = 'cancelled', 'session with 1 of 4 players is cancelled') from sessions where id = :'mp5';
select test_check(sessions_left = 5, 'go / no-go cancel: credit back, 5') from memberships where id = :'ms_mo';

\echo '--- 11. Coverage rules are managers-only, and private to the club'
reset role;
insert into org_staff (org_id, user_id, role) values (:'org', '33333333-3333-3333-3333-333333333333', 'staff');
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select test_check((select count(*) from package_coverage) = 6, 'desk staff can read coverage');
\echo 'expect: desk staff cannot add coverage'
insert into package_coverage (org_id, package_type_id, category) values (:'org', :'pk_evenings', 'clinic');
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Other Club', 'otherclub') as other_org \gset
select test_check((select count(*) from package_coverage) = 0, 'other club sees no coverage');
\echo 'expect: other club cannot attach coverage to Raccoon packages'
insert into package_coverage (org_id, package_type_id, category) values (:'other_org', :'pk_evenings', 'clinic');
select test_check(session_coverage(:'ana', :'clinic') is null, 'other club cannot see Raccoon coverage through the function');
\echo '--- done'
