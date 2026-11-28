-- LINE invite: staff make a code for a member; the member sends "LINK <code>" on LINE and is linked.
-- Run on a FRESH local database. Lines labelled "expect:" should produce an error.
\set ON_ERROR_STOP 0
create function public.test_check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'CHECK FAILED: %', what; end if;
  return 'ok: ' || what;
end $$;
grant execute on function public.test_check(boolean, text) to authenticated, service_role;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','owner@raccoon'),
  ('22222222-2222-2222-2222-222222222222','other@club'),
  ('33333333-3333-3333-3333-333333333333','desk@raccoon');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
insert into members (org_id, full_name, language) values (:'org', 'Dmitri Volkov', 'ru') returning id as dmitri \gset
insert into members (org_id, full_name) values (:'org', 'Nong Siriporn') returning id as nong \gset
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Chalong Padel','chalong') as other_org \gset
reset role;
insert into org_staff (org_id, user_id, role) values (:'org', '33333333-3333-3333-3333-333333333333', 'front_desk');

\echo '--- 1. The front desk makes an invite code'
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select member_line_invite(:'dmitri') as code \gset
select test_check(:'code' ~ '^[A-Z2-9]{6}$', 'six-letter code');
select test_check(member_line_invite(:'dmitri') = :'code', 'same code again until it is used');
select member_line_invite(:'nong') as code_nong \gset
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo 'expect: another club cannot invite this member'
select member_line_invite(:'dmitri');
\echo 'expect: staff cannot link by code themselves'
select line_link_by_code(gen_random_uuid(), 'LINK ' || :'code');
reset role;

\echo '--- 2. The member sends the code on LINE'
set role service_role;
select chat_open_line_conversation(:'org', 'Udmitri', 'Dima') as c1 \gset
select test_check(line_link_by_code(:'c1', 'hello') is null, 'a normal message is not a link');
select test_check(line_link_by_code(:'c1', 'LINK ZZZZZZ') is null, 'a wrong code links nothing');
select test_check((line_link_by_code(:'c1', 'link ' || lower(:'code')))->>'name' = 'Dmitri Volkov', 'code links Dmitri (any case)');
select test_check((select line_user_id = 'Udmitri' and line_link_code is null from members where id = :'dmitri'), 'LINE saved, code used up');
select test_check((select member_id = :'dmitri' from chat_conversations where id = :'c1'), 'the chat now knows him');
select test_check(line_link_by_code(:'c1', 'LINK ' || :'code') is null, 'the code works once');
\echo '--- 3. The same LINE account cannot take another member'
select test_check((line_link_by_code(:'c1', 'LINK ' || :'code_nong'))->>'error' = 'other_member', 'refused: already Dmitri');
select test_check((select line_user_id is null from members where id = :'nong'), 'Nong unchanged');
reset role;
\echo '--- done'
