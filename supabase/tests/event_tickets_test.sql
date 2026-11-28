-- Event tickets: price tiers, divisions, pairs, registration deadline. Run on a FRESH local database.
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
  ('33333333-3333-3333-3333-333333333333','desk@raccoon.test', now());
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select load_raccoon_demo(:'org');
update orgs set public_booking = true, online_signups = 'instant' where id = :'org';
select id as loc from locations where org_id = :'org' limit 1 \gset
select id as camp_type from session_types where org_id = :'org' and name = 'Camp' \gset
update session_types set is_public = true where id = :'camp_type';
insert into members (org_id, full_name, phone, skill_level) values
  (:'org', 'Anna', '0810000001', 3.0), (:'org', 'Ben', '0810000002', 3.0), (:'org', 'Cara', '0810000003', 4.0),
  (:'org', 'Dan', '0810000004', 2.5), (:'org', 'Eve', '0810000005', 3.5);
select id as anna from members where full_name = 'Anna' \gset
select id as ben from members where full_name = 'Ben' \gset
select id as cara from members where full_name = 'Cara' \gset
select id as dan from members where full_name = 'Dan' \gset
select id as eve from members where full_name = 'Eve' \gset
-- A camp 10 days ahead, 6 places
select create_event(:'camp_type', now() + interval '10 days', now() + interval '10 days 2 hours',
  'Coach Kimo camp', 3300, 2, 6, null, null, '{}', null, 'Coach Kimo', :'loc') as camp \gset
reset role;
insert into org_staff (org_id, user_id, role) values (:'org', '33333333-3333-3333-3333-333333333333', 'front_desk');
set role authenticated;

\echo '--- 1. Price tiers: early bird with a cap, then the regular price'
insert into session_price_tiers (org_id, session_id, label, price, available_until, max_qty) values
  (:'org', :'camp', 'Early bird', 2500, now() + interval '3 days', 2),
  (:'org', :'camp', 'Regular', 3300, null, null);
select test_check((select price = 2500 and label = 'Early bird' from event_price(:'camp')), 'early bird is the current price');
select register_for_session(:'camp', :'anna') as r_anna \gset
select test_check((select price = 2500 and tier_id is not null from session_registrations where id = :'r_anna'), 'Anna pays the early bird price');
select register_for_session(:'camp', :'ben') as r_ben \gset
select register_for_session(:'camp', :'cara') as r_cara \gset
select test_check((select price = 3300 from session_registrations where id = :'r_cara'), 'early bird capped at 2 places: Cara pays 3,300');
select test_check((select i.amount = 3300 from order_items i where i.registration_id = :'r_cara'), 'the order has the tier price');
reset role;
update session_price_tiers set available_until = now() - interval '1 minute', max_qty = null where label = 'Early bird';
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select test_check((select price = 3300 from event_price(:'camp')), 'after the date: regular price');
select test_check((select price = 2500 from session_registrations where id = :'r_anna'), 'Anna keeps the price she signed up at');
select test_check((select booked = 3 and spots_left = 3 and has_tiers from session_overview where id = :'camp'), 'overview: 3 of 6 taken');
select cancel_registration(:'r_ben');

\echo '--- 2. Pairs'
\echo 'expect: pairs are off'
select register_for_session(:'camp', null, 'Pair One', '0890000001', false, false, 2, 'Partner One', null);
select set_event_options(:'camp', true, null);
\echo 'expect: a pair needs the partner name'
select register_for_session(:'camp', null, 'Pair One', '0890000001', false, false, 2, null, null);
select register_for_session(:'camp', null, 'Pair One', '0890000001', false, false, 2, 'Partner One', null) as r_pair \gset
select test_check((select spots = 2 and price = 6600 and partner_name = 'Partner One' from session_registrations where id = :'r_pair'), 'a pair takes 2 places and pays 2 x 3,300');
select test_check((select booked = 4 from session_overview where id = :'camp'), '4 places taken');
select register_for_session(:'camp', :'dan') as r_dan \gset
select register_for_session(:'camp', :'eve') as r_eve \gset
select test_check((select booked = 6 and spots_left = 0 from session_overview where id = :'camp'), 'full');
-- Waitlist: a pair, then a single
select register_for_session(:'camp', null, 'Pair Two', '0890000002', false, false, 2, 'Partner Two', null) as r_pair2 \gset
select register_for_session(:'camp', :'ben') as r_ben2 \gset
select test_check((select count(*) = 2 from session_registrations where session_id = :'camp' and status = 'waitlisted'), 'pair and Ben on the waitlist');
select cancel_registration(:'r_dan');
select test_check((select status = 'waitlisted' from session_registrations where id = :'r_pair2'), 'one place free: the pair still waits');
select test_check((select status = 'booked' from session_registrations where id = :'r_ben2'), 'Ben (single) moves up');
select cancel_registration(:'r_eve');
select cancel_registration(:'r_ben2');
select test_check((select status = 'booked' from session_registrations where id = :'r_pair2'), 'two places free: the pair moves up');
\echo 'expect: cannot drop the limit below places taken'
select update_session(:'camp', null, null, null, null, null, 5, null, null, 'Coach Kimo', null, null, null);
\echo 'expect: pairs cannot be turned off while pairs are signed up'
select set_event_options(:'camp', false, null);

\echo '--- 3. Divisions'
select create_event(:'camp_type', now() + interval '12 days', now() + interval '12 days 3 hours',
  'Parents Pickleball Cup', 800, 2, 8, null, null, '{}', null, null, :'loc') as cup \gset
select set_event_options(:'cup', true, null);
insert into session_divisions (org_id, session_id, name, max_players, level_max) values (:'org', :'cup', 'Beginner', 2, 3.0) returning id as beg \gset
insert into session_divisions (org_id, session_id, name, max_players, level_min) values (:'org', :'cup', 'Open', 6, 3.0) returning id as opn \gset
\echo 'expect: choose a division'
select register_for_session(:'cup', :'dan');
\echo 'expect: Cara (4.0) is above the beginner division'
select register_for_session(:'cup', :'cara', null, null, false, false, 1, null, :'beg');
select register_for_session(:'cup', :'dan', null, null, false, false, 2, 'Dan''s kid', :'beg') as r_dan_pair \gset
select register_for_session(:'cup', :'anna', null, null, false, false, 1, null, :'beg') as r_anna_beg \gset
select test_check((select status = 'waitlisted' from session_registrations where id = :'r_anna_beg'), 'beginner division full: Anna waits');
select register_for_session(:'cup', :'cara', null, null, false, false, 1, null, :'opn') as r_cara_open \gset
select test_check((select status = 'booked' from session_registrations where id = :'r_cara_open'), 'open division still has places');
select test_check((select division_name = 'Beginner' and spots = 2 from session_roster where id = :'r_dan_pair'), 'roster shows division and pair');

\echo '--- 4. Registration deadline'
select set_event_options(:'cup', true, now() - interval '1 minute');
\echo 'expect: registration closed'
select register_for_session(:'cup', :'eve', null, null, false, false, 1, null, :'opn');
select register_for_session(:'cup', :'eve', null, null, true, false, 1, null, :'opn') is not null as desk_override;
\echo 'expect: deadline after the start'
select set_event_options(:'cup', true, now() + interval '20 days');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo 'expect: front desk cannot change event tickets'
select set_event_options(:'cup', false, null);
\echo 'expect: front desk cannot add tiers'
insert into session_price_tiers (org_id, session_id, label, price) values (:'org', :'cup', 'Cheap', 1);

\echo '--- 5. Booking page'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select set_event_options(:'cup', true, null);
set role anon;
select test_check((public_event_options('raccoon', :'cup'))->>'allow_pairs' = 'true', 'booking page sees pairs allowed');
select test_check(jsonb_array_length((public_event_options('raccoon', :'cup'))->'divisions') = 2, 'and the divisions');
select test_check((select ((public_event_options('raccoon', :'cup'))->'divisions'->1->>'places_left')::int = 4), 'open: 4 places left');
select test_check((select price = 3300 from public_sessions('raccoon') where id = :'camp'), 'session list shows the current tier price');
\echo 'expect: the booking page needs a division'
select public_register('raccoon', :'cup', 'Web Pair', '0891112222', true, false, 2, 'Web Partner', null);
select public_register('raccoon', :'cup', 'Web Pair', '0891112222', true, false, 2, 'Web Partner', :'opn') as web \gset
reset role;
select test_check((select spots = 2 and partner_name = 'Web Partner' and price = 1600 and source = 'online'
                   from session_registrations where id = (:'web'::jsonb->>'registration_id')::uuid), 'online pair: 2 places, 2 x 800');
update orgs set online_signups = 'approve' where id = :'org';
set role anon;
select public_register('raccoon', :'camp', 'Req Pair', '0893334444', true, false, 2, 'Req Partner', null) as req \gset
reset role;
select test_check((select status = 'requested' and spots = 2 and price = 6600 from session_registrations where id = (:'req'::jsonb->>'registration_id')::uuid), 'request keeps pair and price');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select test_check(approve_online_request((:'req'::jsonb->>'registration_id')::uuid) = 'waitlisted', 'approving a pair into a full camp waitlists it');
\echo '--- done'
