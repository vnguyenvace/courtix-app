-- Help requests test. Run on a FRESH local database after all migrations.
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
  ('22222222-2222-2222-2222-222222222222','owner@padel.test', now()),
  ('33333333-3333-3333-3333-333333333333','desk@raccoon.test', now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','boss@courtix.test', now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','help@courtix.test', now()),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','sell@courtix.test', now());
insert into public.platform_staff (user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'super_admin'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'support'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'sales');

set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Chalong Padel','chalong') as org2 \gset
reset role;
insert into org_staff (org_id, user_id, role) values (:'org', '33333333-3333-3333-3333-333333333333', 'front_desk');
set role authenticated;

\echo '--- 1. Asking for help'
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select request_support(:'org', 'The LINE bot stopped answering', 'LINE @nong', 24) as desk_req \gset
select test_check((select grant_id is null and created_by_email = 'desk@raccoon.test' from support_requests where id = :'desk_req'), 'front desk can ask, but cannot let support in');
select test_check(not exists (select 1 from support_grants where org_id = :'org'), 'no support session from front desk');
select test_check((select count(*) from support_request_notify_list(:'desk_req')) = 2, 'sender gets the super admin and support emails to notify');
\echo 'expect: empty message'
select request_support(:'org', '   ', null, null);
\echo 'expect: not staff of another club'
select request_support(:'org2', 'hello', null, null);

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select request_support(:'org', 'Prices look wrong on the booking page', null, 24) as owner_req \gset
select test_check((select grant_id is not null from support_requests where id = :'owner_req'), 'owner request opens a support session');
select test_check(support_can_view(:'org') is false, 'the owner is not support');
select test_check((select count(*) from support_request_notify_list(:'desk_req')) = 0, 'others cannot use the notify list');
select request_support(:'org', 'One more thing', null, 2) as owner_req2 \gset
select test_check((select count(*) from support_grants where org_id = :'org') = 1, 'an open session is kept, not replaced');
select test_check((select count(*) from support_requests) = 3, 'owner sees all of the club''s requests');

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select test_check((select count(*) from support_requests) = 0, 'other clubs see none');

\echo '--- 2. The Courtix team'
set request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select test_check((select count(*) from support_requests) = 0, 'sales cannot see requests');
\echo 'expect: sales cannot list requests'
select * from platform_support_requests();
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select test_check((select count(*) from platform_support_requests()) = 3, 'support sees open requests');
select test_check((select support_until is not null and club_slug = 'raccoon' from platform_support_requests() where id = :'owner_req'), 'support sees the session is open');
select test_check((select email = 'desk@raccoon.test' from platform_reply_support_request(:'desk_req', 'Reconnected your LINE channel, try now', false)), 'reply returns who to email');
select test_check((select status = 'open' and reply is not null from support_requests where id = :'desk_req'), 'replied, still open');
\echo 'expect: reply needs text unless closing'
select platform_reply_support_request(:'owner_req', '  ', false);
select test_check((select count(*) from platform_reply_support_request(:'owner_req', null, true)) = 0, 'closing without a reply emails nobody');
select test_check((select count(*) from platform_support_requests()) = 2, 'closed requests leave the open list');
select test_check((select count(*) from platform_support_requests(null)) = 3, 'all requests');
\echo 'expect: support cannot ask for help as a club'
select request_support(:'org', 'hi', null, null);
update support_requests set message = 'changed' where id = :'desk_req';

\echo '--- 3. The club closes its own request'
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select test_check((select message = 'The LINE bot stopped answering' and reply = 'Reconnected your LINE channel, try now' from support_requests where id = :'desk_req'), 'club sees the reply; nobody changed the message');
select close_support_request(:'desk_req');
\echo 'expect: already closed'
select close_support_request(:'desk_req');
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo 'expect: other clubs cannot close it'
select close_support_request(:'owner_req2');

\echo '--- 4. Limit'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select request_support(:'org', 'a', null, null);
select request_support(:'org', 'b', null, null);
select request_support(:'org', 'c', null, null);
\echo 'expect: 5 an hour'
select request_support(:'org', 'd', null, null);
\echo '--- done'
