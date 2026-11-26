-- Guest court booking on the public page. Run on a FRESH local database after all migrations.
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
  ('22222222-2222-2222-2222-222222222222','other@club');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select load_raccoon_demo(:'org');
select id as loc from locations where org_id = :'org' limit 1 \gset
reset role;
-- Five free slots two days ahead to work with.
select court_id as c1, slot_start as t1 from public_court_slots('raccoon', :'loc', (now() at time zone 'Asia/Bangkok')::date + 2) where is_free order by slot_start, court_name offset 0 limit 1 \gset
select court_id as c2, slot_start as t2 from public_court_slots('raccoon', :'loc', (now() at time zone 'Asia/Bangkok')::date + 2) where is_free order by slot_start, court_name offset 1 limit 1 \gset
select court_id as c3, slot_start as t3 from public_court_slots('raccoon', :'loc', (now() at time zone 'Asia/Bangkok')::date + 2) where is_free order by slot_start, court_name offset 2 limit 1 \gset
select court_id as c4, slot_start as t4 from public_court_slots('raccoon', :'loc', (now() at time zone 'Asia/Bangkok')::date + 2) where is_free order by slot_start, court_name offset 3 limit 1 \gset
select court_id as c5, slot_start as t5 from public_court_slots('raccoon', :'loc', (now() at time zone 'Asia/Bangkok')::date + 2) where is_free order by slot_start, court_name offset 4 limit 1 \gset

\echo '--- 1. A visitor books a free court: drop-in price, paid at the club'
set role anon;
select public_book_court('raccoon', :'c1', :'t1', 'Tom Visitor', '+44 7700 900123', true, true) as b1 \gset
select test_check((:'b1'::jsonb->>'price')::numeric = 600 and not (:'b1'::jsonb->>'pending_approval')::boolean, 'booked at 600, no approval needed');
select test_check(not (select is_free from public_court_slots('raccoon', :'loc', (now() at time zone 'Asia/Bangkok')::date + 2)
                        where court_id = :'c1' and slot_start = :'t1'), 'the slot now shows as taken');
reset role;
select test_check((select source = 'online' and guest_phone = '+447700900123' and guest_marketing_consent and kind = 'drop_in'
                     from bookings where id = (:'b1'::jsonb->>'booking_id')::uuid), 'saved as an online guest booking with consent');
select test_check((select o.status = 'pending' and o.total = 600 and o.guest_phone = '+447700900123'
                     from orders o join order_items i on i.order_id = o.id where i.booking_id = (:'b1'::jsonb->>'booking_id')::uuid),
                  'order to pay at the club, with the guest''s phone');

\echo '--- 2. Rules and spam limits'
set role anon;
\echo 'expect: already booked'
select public_book_court('raccoon', :'c1', :'t1', 'Ann', '0812345678', true);
\echo 'expect: consent tick needed'
select public_book_court('raccoon', :'c2', :'t2', 'Ann', '0812345678', false);
\echo 'expect: phone number needed'
select public_book_court('raccoon', :'c2', :'t2', 'Ann', '123', true);
\echo 'expect: too far ahead'
select public_book_court('raccoon', :'c2', :'t2' ::timestamptz + interval '20 days', 'Ann', '0812345678', true);
select public_book_court('raccoon', :'c2', :'t2', 'Ann', '0812345678', true);
select public_book_court('raccoon', :'c3', :'t3', 'Ann', '081 234 5678', true);
select public_book_court('raccoon', :'c4', :'t4', 'Ann', '+66812345678', true);
\echo 'expect: 4th booking for one number today'
select public_book_court('raccoon', :'c5', :'t5', 'Ann', '0812345678', true);
reset role;

\echo '--- 3. Approve mode: the court is held until staff decide'
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update orgs set online_signups = 'approve' where id = :'org';
update bookings set status = 'cancelled' where id in (select id from bookings where org_id = :'org' and guest_name = 'Ann');
reset role; set role anon;
select public_book_court('raccoon', :'c2', :'t2', 'Rita Request', '+7 900 555 1122', true) as b2 \gset
select test_check((:'b2'::jsonb->>'pending_approval')::boolean, 'waiting for approval');
select test_check(not (select is_free from public_court_slots('raccoon', :'loc', (now() at time zone 'Asia/Bangkok')::date + 2)
                        where court_id = :'c2' and slot_start = :'t2'), 'held: nobody else can take it');
\echo 'expect: visitors cannot approve'
select decide_online_court((:'b2'::jsonb->>'booking_id')::uuid, true);
select public_book_court('raccoon', :'c3', :'t3', 'Rex Request', '+7 900 555 3344', true) as b3 \gset
reset role;

set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Chalong Padel','chalong') as other_org \gset
\echo 'expect: another club cannot decide'
select decide_online_court((:'b2'::jsonb->>'booking_id')::uuid, true);

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select decide_online_court((:'b2'::jsonb->>'booking_id')::uuid, false);
select test_check((select status = 'cancelled' and not pending_approval from bookings where id = (:'b2'::jsonb->>'booking_id')::uuid), 'declined: cancelled');
select test_check((select is_free from public_court_slots('raccoon', :'loc', (now() at time zone 'Asia/Bangkok')::date + 2)
                    where court_id = :'c2' and slot_start = :'t2'), 'declined: the court is free again');
select test_check((select o.status = 'cancelled' from orders o join order_items i on i.order_id = o.id
                    where i.booking_id = (:'b2'::jsonb->>'booking_id')::uuid), 'declined: nothing to pay');
select decide_online_court((:'b3'::jsonb->>'booking_id')::uuid, true);
select test_check((select status = 'confirmed' and not pending_approval and notes = 'Booked online' from bookings
                    where id = (:'b3'::jsonb->>'booking_id')::uuid), 'approved: booked');
\echo 'expect: already decided'
select decide_online_court((:'b3'::jsonb->>'booking_id')::uuid, false);

\echo '--- 4. Online booking switched off'
update orgs set public_booking = false where id = :'org';
reset role; set role anon;
\echo 'expect: club takes bookings by WhatsApp or at the desk'
select public_book_court('raccoon', :'c4', :'t4', 'Zed', '0899999999', true);
\echo '--- done'
