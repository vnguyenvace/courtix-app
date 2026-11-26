-- PromptPay QR payments test. Run on a FRESH local database after all migrations.
-- Lines labelled "expect:" should produce an error; everything else should succeed.
\set ON_ERROR_STOP 0
create function public.test_check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'CHECK FAILED: %', what; end if;
  return 'ok: ' || what;
end $$;
grant execute on function public.test_check(boolean, text) to anon, authenticated;

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','owner@raccoon');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select load_raccoon_demo(:'org');
select id as loc from locations where org_id = :'org' limit 1 \gset
select id as clinic from session_overview where org_id = :'org' and type_name = 'Adult clinic'
   and starts_at > now() + interval '30 hours' order by starts_at limit 1 \gset

\echo '--- 1. The club sets its PromptPay ID'
update orgs set promptpay_id = '0812345678', promptpay_name = 'Raccoon Pickleball Co.' where id = :'org';
\echo 'expect: not a PromptPay ID'
update orgs set promptpay_id = '12345' where id = :'org';
update orgs set promptpay_id = '0105556123456' where id = :'org';
update orgs set promptpay_id = '0812345678' where id = :'org';
reset role;

\echo '--- 2. A guest books; the pay page shows the amount and the club''s PromptPay, nothing personal'
set role anon;
select (public_register('raccoon', :'clinic', 'Olga Online', '+7 900 111 2233', true, false))->>'registration_id' as reg \gset
select public_order_for('raccoon', :'reg') as ord \gset
select test_check(:'ord' <> '', 'pay link found for the booking just made');
select public_order('raccoon', :'ord') as po \gset
select test_check((:'po'::jsonb->>'total')::numeric = 500 and :'po'::jsonb->>'status' = 'pending', 'pay page: 500 to pay');
select test_check(:'po'::jsonb->>'promptpay_id' = '0812345678' and :'po'::jsonb->>'promptpay_name' = 'Raccoon Pickleball Co.', 'club''s PromptPay shown');
select test_check(:'po'::jsonb::text not like '%Olga%' and :'po'::jsonb::text not like '%2233%', 'no name or phone on the pay page');
select test_check(public_order('chalong', :'ord') is null, 'another club''s address shows nothing');
reset role;

\echo '--- 3. Payer slips: only a file that exists, only for an unpaid order'
insert into storage.objects (bucket_id, name) values ('payment-slips', :'org' || '/' || :'ord' || '/payer-1.jpg');
set role anon;
\echo 'expect: slip that was never uploaded'
select public_attach_slip('raccoon', :'ord', :'org' || '/' || :'ord' || '/payer-2.jpg');
\echo 'expect: path outside this order'
select public_attach_slip('raccoon', :'ord', :'org' || '/other/payer-1.jpg');
select public_attach_slip('raccoon', :'ord', :'org' || '/' || :'ord' || '/payer-1.jpg');
select test_check((public_order('raccoon', :'ord'))->>'slip_sent' = 'true', 'slip received');
\echo 'expect: visitors cannot use the internal slip check'
select order_accepts_slip(:'org' || '/' || :'ord' || '/payer-3.jpg');
select test_check((select count(*) from storage.objects where bucket_id = 'payment-slips') = 0, 'visitors see no slips');
reset role;
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select mark_order_paid(:'ord', 'promptpay');
reset role; set role anon;
select test_check((public_order('raccoon', :'ord'))->>'status' = 'paid', 'pay page shows it''s paid');
\echo 'expect: no slips for a paid order'
select public_attach_slip('raccoon', :'ord', :'org' || '/' || :'ord' || '/payer-1.jpg');
reset role;

\echo '--- 4. Court requests waiting for approval: no payment asked yet'
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update orgs set online_signups = 'approve' where id = :'org';
reset role;
select court_id as c1, slot_start as t1 from public_court_slots('raccoon', :'loc', (now() at time zone 'Asia/Bangkok')::date + 2) where is_free order by slot_start limit 1 \gset
set role anon;
select (public_book_court('raccoon', :'c1', :'t1', 'Rita', '0899998888', true))->>'booking_id' as bk \gset
select public_order_for('raccoon', null, :'bk') as ord2 \gset
select test_check((public_order('raccoon', :'ord2'))->>'awaiting_approval' = 'true', 'held court: pay once confirmed');
reset role;
\echo '--- done'
