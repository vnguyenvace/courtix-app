-- Member notices test (automatic service messages). Run on a FRESH local database after all migrations.
-- Lines labelled "expect:" should produce an error; everything else should succeed.
\set ON_ERROR_STOP 0
create function public.test_check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'CHECK FAILED: %', what; end if;
  return 'ok: ' || what;
end $$;
grant execute on function public.test_check(boolean, text) to authenticated;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','owner@raccoon'),
  ('22222222-2222-2222-2222-222222222222','other@club');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select load_raccoon_demo(:'org');
select id as loc from locations where org_id = :'org' limit 1 \gset
insert into members (org_id, full_name, skill_level) values (:'org', 'Eve Evenings', 3.0) returning id as eve \gset
insert into members (org_id, full_name, skill_level) values (:'org', 'Nina Nopackage', 3.0) returning id as nina \gset
insert into members (org_id, full_name, skill_level) values (:'org', 'Pat Pack', 3.0) returning id as pat \gset
select id as pk_evenings from package_types where org_id = :'org' and name = 'Unlimited evenings (30 days)' \gset
select id as pk_pack from package_types where org_id = :'org' and kind = 'class_pack' order by price limit 1 \gset
select sell_membership(:'eve', :'pk_evenings') as ms_eve \gset
select sell_membership(:'pat', :'pk_pack') as ms_pat \gset

select test_check((select cardinality(auto_notices) = 5 from orgs where id = :'org'), 'all five notices on by default (with booking confirmations)');

select id as clinic from session_overview where org_id = :'org' and type_name = 'Adult clinic'
   and starts_at > now() + interval '30 hours' order by starts_at limit 1 \gset
select id as clinic2 from session_overview where org_id = :'org' and type_name = 'Adult clinic'
   and starts_at > now() + interval '30 hours' order by starts_at offset 1 limit 1 \gset
select id as clinic3 from session_overview where org_id = :'org' and type_name = 'Adult clinic'
   and starts_at > now() + interval '30 hours' order by starts_at offset 2 limit 1 \gset

\echo '--- 1. Waitlist moved up: the member who gets the place is told'
update sessions set min_players = 1, max_players = 1 where id = :'clinic';
select register_for_session(:'clinic', :'nina') as r_nina \gset
select register_for_session(:'clinic', :'eve') as r_eve \gset
select test_check((select status = 'waitlisted' from session_registrations where id = :'r_eve'), 'Eve on the waitlist');
select cancel_registration(:'r_nina');
select test_check((select count(*) = 1 from member_notices where member_id = :'eve' and kind = 'waitlist_moved_up'
                     and payload->>'session' = 'Adult clinic' and status = 'pending'), 'Eve gets a waitlist notice');
select test_check((select count(*) = 0 from member_notices where member_id = :'nina' and kind <> 'booking_confirmed'), 'Nina cancelling her own place: no notice (only her booking confirmation)');

\echo '--- 2. Session cancelled: everyone still booked is told'
select cancel_session(:'clinic', 'Coach is ill');
select test_check((select count(*) = 1 from member_notices where member_id = :'eve' and kind = 'session_cancelled'
                     and payload->>'reason' = 'Coach is ill'), 'Eve gets a cancellation notice with the reason');

\echo '--- 3. Opted-out members and switched-off kinds get nothing'
update members set notices_opt_out = true where id = :'nina';
select count(*) as nina_before from member_notices where member_id = :'nina' \gset
select register_for_session(:'clinic2', :'nina');
select cancel_session(:'clinic2', 'Rain');
select test_check((select count(*) from member_notices where member_id = :'nina') = :'nina_before'::int, 'opted-out member not queued (no confirmation, no cancellation)');
update orgs set auto_notices = '{booking_confirmed,booking_reminder,package_ending,waitlist_moved_up}' where id = :'org';
select register_for_session(:'clinic3', :'eve');
select cancel_session(:'clinic3', 'Rain');
select test_check((select count(*) = 1 from member_notices where member_id = :'eve' and kind = 'session_cancelled'),
                  'club switched cancellation notices off: no new one');
update orgs set auto_notices = '{booking_confirmed,booking_reminder,package_ending,waitlist_moved_up,session_cancelled}' where id = :'org';
\echo 'expect: unknown notice kind'
update orgs set auto_notices = '{booking_reminder,spam}' where id = :'org';

\echo '--- 4. Evening job: tomorrow''s bookings and packages ending'
select id as tomorrow_open from session_overview where org_id = :'org' and type_name = 'Open play' and status <> 'cancelled'
   and (starts_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date + 1
 order by starts_at desc limit 1 \gset
select register_for_session(:'tomorrow_open', :'eve');
select court_id as free_court, slot_start as free_start from public_court_slots('raccoon', :'loc', (now() at time zone 'Asia/Bangkok')::date + 1)
 where is_free order by slot_start limit 1 \gset
select create_booking(:'free_court', :'free_start', :'eve') as court_booking \gset
update memberships set ends_on = (now() at time zone 'Asia/Bangkok')::date + 2 where id = :'ms_eve';
update memberships set sessions_left = 1 where id = :'ms_pat';
select queue_evening_notices(:'org') as queued \gset
select test_check(:'queued'::int = 4, 'queued: session reminder, court reminder, package ending, last credit');
select test_check((select count(*) = 1 from member_notices where member_id = :'eve' and kind = 'booking_reminder' and payload->>'type' = 'session'), 'session reminder');
select test_check((select count(*) = 1 from member_notices where member_id = :'eve' and kind = 'booking_reminder' and payload->>'type' = 'court'), 'court reminder');
select test_check((select count(*) = 1 from member_notices where member_id = :'eve' and kind = 'package_ending' and payload->>'type' = 'ending'), 'package ending soon');
select test_check((select count(*) = 1 from member_notices where member_id = :'pat' and kind = 'package_ending' and payload->>'type' = 'last_credit'), 'last credit');
select test_check(queue_evening_notices(:'org') = 0, 'running it again queues nothing new');

\echo '--- 5. Marketing auto-send is a club setting'
update orgs set followup_mode = 'auto' where id = :'org';
select test_check((select followup_mode = 'auto' from orgs where id = :'org'), 'club can choose automatic follow-ups');

\echo '--- 6. Clubs stay apart'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Chalong Padel','chalong') as other_org \gset
select test_check((select count(*) from member_notices) = 0, 'other club sees no notices');
select test_check(queue_evening_notices(:'org') = 0, 'other club queues nothing for this club');
reset role; set role anon;
\echo 'expect: visitors cannot read notices'
select count(*) from member_notices;
\echo '--- done'
