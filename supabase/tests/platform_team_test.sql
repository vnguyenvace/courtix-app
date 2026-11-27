-- Courtix team roles and support sessions test. Run on a FRESH local database after all migrations.
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
  ('33333333-3333-3333-3333-333333333333','desk@raccoon.test', now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','boss@courtix.test', now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','help@courtix.test', now()),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','sell@courtix.test', now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','promo@courtix.test', now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','nobody@else.test', now());
insert into public.platform_staff (user_id, role) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'super_admin');

set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
insert into members (org_id, full_name, phone) values (:'org', 'Eve Evenings', '0811111111');
reset role;
insert into org_staff (org_id, user_id, role) values (:'org', '33333333-3333-3333-3333-333333333333', 'front_desk');
set role authenticated;

\echo '--- 1. The team'
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select platform_set_staff('Help@Courtix.test', 'support');
select platform_set_staff('sell@courtix.test', 'sales');
select platform_set_staff('promo@courtix.test', 'marketing');
\echo 'expect: no account with that email'
select platform_set_staff('ghost@courtix.test', 'support');
select test_check((select count(*) from platform_team()) = 4, 'super admin sees the team');
\echo 'expect: last super admin cannot step down'
select platform_set_staff('boss@courtix.test', 'support');
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
\echo 'expect: support cannot change the team'
select platform_set_staff('nobody@else.test', 'super_admin');
\echo 'expect: support cannot see the team list'
select * from platform_team();
select test_check((select count(*) from platform_staff) = 1, 'support sees only its own team row');
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo 'expect: club owners cannot open the Courtix admin list'
select * from platform_clubs();

\echo '--- 2. Club list'
set request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select test_check((select owner_email = 'owner@raccoon.test' and members = 1 and staff = 2 from platform_clubs() where id = :'org'), 'sales sees the club, owner contact and counts');
set request.jwt.claim.sub = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
select test_check((select owner_email is null and members = 1 from platform_clubs() where id = :'org'), 'marketing sees counts but no owner contact');
select test_check((select count(*) from members) = 0, 'marketing sees no members');

\echo '--- 3. Support needs the owner''s OK'
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select test_check((select count(*) from members) = 0, 'support sees no members without a session');
select test_check(not support_can_view(:'org'), 'no support session yet');
\echo 'expect: support cannot log views without a session'
select log_support_view(:'org', '/members');
\echo 'expect: support cannot let itself in'
select allow_support_access(:'org', 24, 'please');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo 'expect: front desk cannot let support in'
select allow_support_access(:'org', 24, null);
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo 'expect: at most 7 days'
select allow_support_access(:'org', 500, null);
select allow_support_access(:'org', 24, 'LINE not answering') is not null as allowed;

set request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select test_check(support_can_view(:'org'), 'support can view during the session');
select test_check((select count(*) from members where org_id = :'org') = 1, 'support sees members');
select test_check((select count(*) from orgs where id = :'org') = 1, 'support sees the club');
update members set full_name = 'Changed by support' where org_id = :'org';
\echo 'expect: support cannot add members'
insert into members (org_id, full_name) values (:'org', 'Support added');
select log_support_view(:'org', '/members');
select log_support_view(:'org', '/members');
select log_support_view(:'org', '/payments');
set request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select test_check(not support_can_view(:'org') and (select count(*) from members) = 0, 'sales never sees member data');
set request.jwt.claim.sub = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
select test_check(not support_can_view(:'org') and (select count(*) from members) = 0, 'other people see nothing');

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select test_check((select full_name from members where org_id = :'org') = 'Eve Evenings', 'support changed nothing');
select test_check((select count(*) from support_access_log where org_id = :'org') = 2, 'owner sees 2 logged views (repeat within a minute counted once)');
select test_check((select email from support_access_log where org_id = :'org' limit 1) = 'help@courtix.test', 'the log names who looked');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select test_check((select count(*) from support_access_log) = 0, 'front desk does not see the log');

\echo '--- 4. Ending'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select end_support_access(:'org');
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select test_check(not support_can_view(:'org') and (select count(*) from members) = 0, 'support locked out after the owner ends it');
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select allow_support_access(:'org', 1, null) is not null as allowed_again;
reset role;
update support_grants set expires_at = now() - interval '1 second' where org_id = :'org' and ended_at is null;
set role authenticated; set request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select test_check(not support_can_view(:'org'), 'support locked out when the time runs out');
\echo '--- done'
