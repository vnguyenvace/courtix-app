-- Online approval test: club setting "Request, staff approve" (orgs.online_signups = 'approve').
-- Run on a FRESH local database after all migrations.
-- Lines labelled "expect:" should produce an error; test_check() fails the run on a wrong value.
\set ON_ERROR_STOP 0
create function public.test_check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'CHECK FAILED: %', what; end if;
  return 'ok: ' || what;
end $$;
grant execute on function public.test_check(boolean, text) to anon;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','owner@raccoon'),
  ('33333333-3333-3333-3333-333333333333','desk@raccoon');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select load_raccoon_demo(:'org');
select id as clinic from session_overview where type_name = 'Adult clinic' and starts_at > now() + interval '30 hours' order by starts_at limit 1 \gset
select id as clinic2 from session_overview where type_name = 'Adult clinic' and starts_at > now() + interval '30 hours' order by starts_at offset 1 limit 1 \gset
update sessions set min_players = 1, max_players = 2 where id = :'clinic';
select test_check((select online_signups from orgs where id = :'org') = 'instant', 'default: online sign-ups take the spot');

\echo '--- 1. Approval mode: online sign-ups wait as requests and take no spot'
update orgs set online_signups = 'approve' where id = :'org';
reset role; set role anon; reset request.jwt.claim.sub;
select test_check(public_club('raccoon')->>'online_signups' = 'approve', 'public page knows the mode');
select public_register('raccoon', :'clinic', 'Req One', '+44 7700 900001', true, false) as q1 \gset
select public_register('raccoon', :'clinic', 'Req Two', '+44 7700 900002', true, false) as q2 \gset
select public_register('raccoon', :'clinic', 'Req Three', '+44 7700 900003', true, false) as q3 \gset
select public_register('raccoon', :'clinic2', 'Req Four', '+44 7700 900004', true, false) as q4 \gset
select test_check((:'q1'::jsonb)->>'status' = 'requested', 'status is requested');
select test_check((select spots_left from public_sessions('raccoon') where id = :'clinic') = 2, 'requests take no spot');
\echo 'expect: the same number cannot request twice'
select public_register('raccoon', :'clinic', 'Req One again', '+44 7700 900001', true, false);

reset role;
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo '--- 2. Staff approve: booked while there is room, then waitlisted'
-- Someone signs up at the desk while the requests wait.
select register_for_session(:'clinic', null, 'Desk Dora') is not null as desk_signup;
select test_check(approve_online_request(((:'q1'::jsonb)->>'registration_id')::uuid) = 'booked', 'first approval: booked (2 of 2)');
select test_check(approve_online_request(((:'q2'::jsonb)->>'registration_id')::uuid) = 'waitlisted', 'session full now: waitlisted');
\echo 'expect: a request cannot be approved twice'
select approve_online_request(((:'q1'::jsonb)->>'registration_id')::uuid);

\echo '--- 3. Decline'
select decline_online_request(((:'q3'::jsonb)->>'registration_id')::uuid);
select test_check(status = 'cancelled', 'declined request is cancelled')
  from session_registrations where id = ((:'q3'::jsonb)->>'registration_id')::uuid;
\echo 'expect: a declined request cannot be declined again'
select decline_online_request(((:'q3'::jsonb)->>'registration_id')::uuid);

\echo '--- 4. Desk staff can approve too; requests close when the club cancels the session'
reset role;
insert into org_staff (org_id, user_id, role) values (:'org', '33333333-3333-3333-3333-333333333333', 'staff');
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select cancel_session(:'clinic2', 'Coach unwell');
select test_check(status = 'cancelled', 'open request closed with the session')
  from session_registrations where id = ((:'q4'::jsonb)->>'registration_id')::uuid;

\echo '--- 5. Back to instant: the spot is taken straight away again'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update orgs set online_signups = 'instant' where id = :'org';
\echo 'expect: only instant or approve'
update orgs set online_signups = 'maybe' where id = :'org';
select id as open_play from session_overview where type_name = 'Open play' and starts_at > now() + interval '30 hours' order by starts_at limit 1 \gset
reset role; set role anon;
select test_check(public_register('raccoon', :'open_play', 'Insta Ina', '+44 7700 900009', true, false)->>'status' = 'booked', 'instant again: booked');
\echo 'expect: visitors cannot approve requests'
select approve_online_request(((:'q2'::jsonb)->>'registration_id')::uuid);
\echo '--- done'
