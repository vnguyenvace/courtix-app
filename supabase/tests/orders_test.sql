-- Orders and payments test (Step 3). Run on a FRESH local database after all migrations.
-- Lines labelled "expect:" should produce an error; everything else should succeed.
\set ON_ERROR_STOP 0
create function public.test_check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'CHECK FAILED: %', what; end if;
  return 'ok: ' || what;
end $$;
grant execute on function public.test_check(boolean, text) to anon, authenticated;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','owner@raccoon'),
  ('22222222-2222-2222-2222-222222222222','other@club'),
  ('33333333-3333-3333-3333-333333333333','desk@raccoon');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select load_raccoon_demo(:'org');
select id as loc from locations where org_id = :'org' limit 1 \gset
insert into members (org_id, full_name, skill_level) values (:'org', 'Eve Evenings', 3.0) returning id as eve \gset
insert into members (org_id, full_name, skill_level) values (:'org', 'Nina Nopackage', 3.0) returning id as nina \gset
select id as pk_evenings from package_types where org_id = :'org' and name = 'Unlimited evenings (30 days)' \gset
reset role;
insert into org_staff (org_id, user_id, role) values (:'org', '33333333-3333-3333-3333-333333333333', 'front_desk');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select id as evening_open from session_overview where org_id = :'org' and type_name = 'Open play'
   and to_char(starts_at at time zone 'Asia/Bangkok', 'HH24:MI') = '18:00' and starts_at > now() + interval '30 hours'
 order by starts_at limit 1 \gset
select id as clinic from session_overview where org_id = :'org' and type_name = 'Adult clinic'
   and starts_at > now() + interval '30 hours' order by starts_at limit 1 \gset
select id as clinic2 from session_overview where org_id = :'org' and type_name = 'Adult clinic'
   and starts_at > now() + interval '30 hours' order by starts_at offset 1 limit 1 \gset
select id as evening_open2 from session_overview where org_id = :'org' and type_name = 'Open play'
   and to_char(starts_at at time zone 'Asia/Bangkok', 'HH24:MI') = '18:00' and starts_at > now() + interval '30 hours'
 order by starts_at offset 1 limit 1 \gset
select id as clinic3 from session_overview where org_id = :'org' and type_name = 'Adult clinic'
   and starts_at > now() + interval '30 hours' order by starts_at offset 2 limit 1 \gset

\echo '--- 1. Selling a package makes an order; the desk marks it paid'
select sell_membership(:'eve', :'pk_evenings') as ms_eve \gset
select o.id as o_pkg from orders o join order_items i on i.order_id = o.id where i.membership_id = :'ms_eve' \gset
select test_check((select status = 'pending' and total = 3500 and member_id = :'eve' from orders where id = :'o_pkg'), 'package order: 3500 to pay');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select mark_order_paid(:'o_pkg', 'transfer', 'KBank slip 14:02');
select test_check((select status = 'paid' and method = 'transfer' and paid_amount = 3500
                     and received_by = '33333333-3333-3333-3333-333333333333' from orders where id = :'o_pkg'), 'paid by transfer, who took it recorded');
\echo 'expect: already paid'
select mark_order_paid(:'o_pkg', 'cash');
\echo 'expect: desk staff cannot undo a payment'
select mark_order_unpaid(:'o_pkg');
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo '--- 2. Covered places cost nothing (no order); a paid place does, and cancelling it cancels the order'
select register_for_session(:'evening_open', :'eve') as r_covered \gset
select test_check(not exists (select 1 from order_items where registration_id = :'r_covered'), 'covered place: no order');
select register_for_session(:'clinic', :'nina') as r_paid \gset
select o.id as o_clinic from orders o join order_items i on i.order_id = o.id where i.registration_id = :'r_paid' \gset
select test_check((select status = 'pending' and total = 500 and location_id = :'loc' from orders where id = :'o_clinic'), 'clinic place: 500 to pay at this location');
select cancel_registration(:'r_paid');
select test_check((select status = 'cancelled' and total = 0 from orders where id = :'o_clinic'), 'cancelled before paying: nothing due');

\echo '--- 3. Paid, then cancelled: a refund to decide (owners/managers)'
select register_for_session(:'clinic2', :'nina') as r_paid2 \gset
select o.id as o_clinic2 from orders o join order_items i on i.order_id = o.id where i.registration_id = :'r_paid2' \gset
select mark_order_paid(:'o_clinic2', 'cash');
select cancel_registration(:'r_paid2');
select test_check((select status = 'refund_due' and paid_amount = 500 from orders where id = :'o_clinic2'), 'paid then cancelled: refund to check');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo 'expect: desk staff cannot decide refunds'
select resolve_refund(:'o_clinic2', true);
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select resolve_refund(:'o_clinic2', true, 'Cash back at desk');
select test_check((select status = 'refunded' from orders where id = :'o_clinic2'), 'refunded');

\echo '--- 4. Waitlisted places pay only when they move up'
update sessions set min_players = 1, max_players = 1 where id = :'clinic3';
insert into members (org_id, full_name, skill_level) values (:'org', 'Wanda Waitlist', 3.0) returning id as wanda \gset
select register_for_session(:'clinic3', :'nina') as r_first \gset
select register_for_session(:'clinic3', :'wanda') as r_wait \gset
select test_check(not exists (select 1 from order_items where registration_id = :'r_wait'), 'waitlisted: no order yet');
select cancel_registration(:'r_first');
select test_check((select o.status = 'pending' and o.total = 500 from orders o join order_items i on i.order_id = o.id
                    where i.registration_id = :'r_wait'), 'moved up: now 500 to pay');

\echo '--- 5. Court bookings and online guests'
select court_id as free_court, slot_start as free_start from public_court_slots('raccoon', :'loc', (now() at time zone 'Asia/Bangkok')::date + 2)
 where is_free order by slot_start limit 1 \gset
select create_booking(:'free_court', :'free_start', null, 'Walk-in Tom') as b_guest \gset
select test_check((select o.status = 'pending' and o.total = 600 and o.guest_name = 'Walk-in Tom' from orders o
                     join order_items i on i.order_id = o.id where i.booking_id = :'b_guest'), 'drop-in court: 600 to pay');
update bookings set status = 'cancelled' where id = :'b_guest';
select test_check((select o.status = 'cancelled' from orders o join order_items i on i.order_id = o.id where i.booking_id = :'b_guest'),
                  'court cancelled before paying: nothing due');
reset role; set role anon;
select (public_register('raccoon', :'clinic2', 'Online Olga', '+7 900 111 2233', true, false))->>'registration_id' as r_online \gset
reset role; set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select test_check((select o.status = 'pending' and o.guest_name = 'Online Olga' and o.total = 500 from orders o
                     join order_items i on i.order_id = o.id where i.registration_id = :'r_online'), 'online sign-up: pays at the club');

\echo '--- 6. Booking confirmations from the desk, with the amount due'
select test_check((select (payload->>'amount')::numeric = 500 from member_notices
                    where kind = 'booking_confirmed' and member_id = :'nina' order by created_at limit 1), 'desk sign-up: confirmation says 500 to pay');
select test_check((select (payload->>'amount')::numeric = 0 and payload->>'covered_by' = 'Unlimited evenings (30 days)'
                     from member_notices where kind = 'booking_confirmed' and member_id = :'eve'), 'covered place: confirmation says covered');
select chat_open_conversation(:'org', 'test', '+66 81 999 0000', 'Chat Eve') as c_chat \gset
update chat_conversations set member_id = :'eve' where id = :'c_chat';
update chat_conversations set status = 'bot' where id = :'c_chat';
select chat_book_session(:'c_chat', :'evening_open2') as r_chat \gset
select test_check(:'r_chat'::jsonb->>'status' = 'booked', 'chat booked a covered place');
select test_check((select count(*) = 1 from member_notices where kind = 'booking_confirmed' and member_id = :'eve'), 'chat bookings get no extra confirmation');

\echo '--- 7. Clubs stay apart'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Chalong Padel','chalong') as other_org \gset
select test_check((select count(*) from orders) = 0, 'other club sees no orders');
\echo 'expect: other club cannot mark this club''s order paid'
select mark_order_paid(:'o_clinic', 'cash');
reset role; set role anon;
\echo 'expect: visitors cannot read orders'
select count(*) from orders;
\echo '--- done'
