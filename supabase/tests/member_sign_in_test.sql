-- Member sign-in test (members book on the public page with a one-time code).
-- Run on a FRESH local database after all migrations. "expect:" lines should fail.
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
insert into members (org_id, full_name, skill_level, phone) values (:'org', 'Eve Evenings', 3.0, '+66 81 111 2222') returning id as eve \gset
insert into members (org_id, full_name, skill_level, phone, email) values (:'org', 'Nina Nopackage', 3.0, '081-333-4444', 'Nina@Example.com') returning id as nina \gset
select id as pk_evenings from package_types where org_id = :'org' and name = 'Unlimited evenings (30 days)' \gset
select sell_membership(:'eve', :'pk_evenings') as ms_eve \gset
-- She paid for the package at the desk.
select mark_order_paid((select order_id from order_items where membership_id = :'ms_eve'), 'cash');
select id as evening_open from session_overview where org_id = :'org' and type_name = 'Open play'
   and to_char(starts_at at time zone 'Asia/Bangkok', 'HH24:MI') = '18:00' and starts_at > now() + interval '30 hours'
 order by starts_at limit 1 \gset
select id as clinic from session_overview where org_id = :'org' and type_name = 'Adult clinic'
   and starts_at > now() + interval '30 hours' order by starts_at limit 1 \gset
select register_for_session(:'clinic', :'nina') as r_nina \gset
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Chalong Padel','chalong') as other_org \gset
reset role;

-- The app would make and send these codes; here we store them the same way (hash only).
create function pg_temp.new_code(p_org uuid, p_member uuid, p_code text, p_channel text default 'sms') returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.member_login_codes (id, org_id, member_id, code_hash, channel)
  values (v, p_org, p_member, public.sha256_hex(v::text || ':' || p_code), p_channel);
  return v;
end $$;

\echo '--- 1. Wrong codes are counted; after 5 tries even the right code fails'
select pg_temp.new_code(:'org', :'eve', '123456') as code1 \gset
set role anon;
select test_check(member_verify_code('raccoon', '0811112222', '000000') is null, 'wrong code: no sign-in');
reset role;
select test_check((select attempts = 1 from member_login_codes where id = :'code1'), 'the wrong try was counted');
set role anon;
select member_verify_code('raccoon', '0811112222', '000001');
select member_verify_code('raccoon', '0811112222', '000002');
select member_verify_code('raccoon', '0811112222', '000003');
select member_verify_code('raccoon', '0811112222', '000004');
\echo 'expect: code used up after 5 tries'
select member_verify_code('raccoon', '0811112222', '123456');
reset role;

\echo '--- 2. A correct code signs the member in (any phone format)'
select pg_temp.new_code(:'org', :'eve', '424242') as code2 \gset
set role anon;
select member_verify_code('raccoon', '+66 81 111 2222', '424 242') as eve_token \gset
select test_check(length(:'eve_token') = 64, 'got a sign-in token');
\echo 'expect: a code works only once'
select member_verify_code('raccoon', '+66 81 111 2222', '424242');
select test_check((member_me('raccoon', :'eve_token'))->>'name' = 'Eve Evenings', 'member page knows who it is');
select test_check((member_me('raccoon', :'eve_token'))->'package'->>'name' = 'Unlimited evenings (30 days)', 'and their package');
reset role;
select test_check((select token_hash <> :'eve_token' from member_sessions limit 1), 'token stored only as a hash');

\echo '--- 3. Booking with their package; paid places go on the bill'
set role anon;
select member_book_session('raccoon', :'eve_token', :'evening_open') as b1 \gset
select test_check((:'b1'::jsonb->>'price')::numeric = 0 and (:'b1'::jsonb->>'covered')::boolean, 'evening open play covered: 0');
select member_book_session('raccoon', :'eve_token', :'clinic') as b2 \gset
select test_check((:'b2'::jsonb->>'price')::numeric = 500, 'clinic: 500, pay at the club');
select test_check(((member_me('raccoon', :'eve_token'))->>'to_pay')::numeric = 500, 'member page shows 500 to pay');
select test_check(jsonb_array_length((member_me('raccoon', :'eve_token'))->'sessions') = 2, 'both places listed');
select court_id as free_court, slot_start as free_start from public_court_slots('raccoon', :'loc', (now() at time zone 'Asia/Bangkok')::date + 2)
 where is_free order by slot_start limit 1 \gset
select member_book_court('raccoon', :'eve_token', :'free_court', :'free_start') as b3 \gset
select test_check(:'b3'::jsonb->>'kind' = 'member', 'court booked at the member rate');

\echo '--- 4. Cancelling: their own only'
select member_cancel('raccoon', :'eve_token', 'session', (:'b2'::jsonb->>'registration_id')::uuid);
select test_check(((member_me('raccoon', :'eve_token'))->>'to_pay')::numeric = 600, 'clinic cancelled: only the court (600) left to pay');
\echo 'expect: cannot cancel someone else''s place'
select member_cancel('raccoon', :'eve_token', 'session', :'r_nina');
select member_cancel('raccoon', :'eve_token', 'court', (:'b3'::jsonb->>'booking_id')::uuid);
select test_check(jsonb_array_length((member_me('raccoon', :'eve_token'))->'courts') = 0, 'court cancelled');

\echo '--- 5. Tokens belong to one club; signing out ends them'
\echo 'expect: token from another club'
select member_me('chalong', :'eve_token');
\echo 'expect: made-up token'
select member_me('raccoon', 'abc');
select member_sign_out('raccoon', :'eve_token');
\echo 'expect: signed out'
select member_me('raccoon', :'eve_token');
reset role;

\echo '--- 6. Email works too (any capitals)'
select pg_temp.new_code(:'org', :'nina', '777777', 'email') as code3 \gset
set role anon;
select member_verify_code('raccoon', 'nina@example.COM', '777777') as nina_token \gset
select test_check((member_me('raccoon', :'nina_token'))->>'name' = 'Nina Nopackage', 'signed in by email');
\echo 'expect: visitors cannot read codes'
select count(*) from member_login_codes;
\echo 'expect: visitors cannot read sign-ins'
select count(*) from member_sessions;
\echo 'expect: helper not callable by visitors'
select member_from_token('raccoon', :'nina_token');
\echo '--- done'
