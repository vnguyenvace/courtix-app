-- Automatic slip verification: the database step (apply_verified_slip). Run on a FRESH database.
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
select id as clinic from session_overview where org_id = :'org' and type_name = 'Adult clinic'
   and starts_at > now() + interval '30 hours' order by starts_at limit 1 \gset
select test_check((select slip_autoverify from orgs where id = :'org'), 'automatic slip checks on by default');
reset role;
set role anon;
select (public_register('raccoon', :'clinic', 'Olga', '+7 900 111 2233', true, false))->>'registration_id' as r1 \gset
select (public_register('raccoon', :'clinic', 'Petra', '+7 900 444 5566', true, false))->>'registration_id' as r2 \gset
select public_order_for('raccoon', :'r1') as o1 \gset
select public_order_for('raccoon', :'r2') as o2 \gset

\echo '--- 1. Only the server may apply a verified slip'
\echo 'expect: visitors cannot mark orders paid this way'
select apply_verified_slip(:'o1', 'REF1', 500, '{}');
reset role;
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo 'expect: staff cannot either (they use Mark paid)'
select apply_verified_slip(:'o1', 'REF1', 500, '{}');
reset role;

\echo '--- 2. A verified slip pays the order once'
set role service_role;
select apply_verified_slip(:'o1', 'REF1', 500, '{"status":"verified"}');
select test_check((select status = 'paid' and method = 'promptpay' and paid_amount = 500 and received_by is null
                     and slip_check->>'status' = 'verified' from orders where id = :'o1'), 'paid automatically by PromptPay');
\echo 'expect: the same slip cannot pay another order'
select apply_verified_slip(:'o2', 'REF1', 500, '{}');
select test_check((select status = 'pending' from orders where id = :'o2'), 'second order still to pay');
\echo 'expect: wrong amount'
select apply_verified_slip(:'o2', 'REF2', 400, '{}');
\echo 'expect: already paid'
select apply_verified_slip(:'o1', 'REF3', 500, '{}');
select test_check((select count(*) = 1 from slip_refs), 'one transfer reference recorded');
reset role;
\echo '--- done'
