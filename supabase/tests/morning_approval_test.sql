-- Morning approval test (Step 9b). Run on a FRESH local database after all migrations.
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
  ('33333333-3333-3333-3333-333333333333','desk@raccoon');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select add_demo_data(:'org') is not null as demo;
reset role;
insert into org_staff (org_id, user_id, role) values (:'org', '33333333-3333-3333-3333-333333333333', 'staff');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select test_check((select followup_mode = 'approve' and morning_drafts from orgs where id = :'org'), 'new clubs default to morning approval');

-- Two drafts, as the morning job would write them.
select member_id as m1, reason as r1 from followup_candidates(:'org', 20) limit 1 \gset
select id as m2 from members where org_id = :'org' and id <> :'m1' order by full_name limit 1 \gset
insert into ai_messages (org_id, member_id, reason, body, model) values (:'org', :'m1', :'r1', 'Hi! Renew?', 'test') returning id as d1 \gset
insert into ai_messages (org_id, member_id, reason, body, model) values (:'org', :'m2', 'at_risk', 'We miss you', 'test') returning id as d2 \gset

\echo '--- 1. Desk staff can''t send or approve unapproved drafts'
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo 'expect: needs approval before it goes out'
update ai_messages set status = 'sent', sent_at = now() where id = :'d1';
\echo 'expect: only owners and managers approve'
update ai_messages set status = 'approved' where id = :'d1';
\echo 'expect: approve all is for owners and managers'
select approve_all_drafts(:'org');
update ai_messages set status = 'dismissed' where id = :'d2';
select test_check((select status = 'dismissed' from ai_messages where id = :'d2'), 'desk staff can still skip a draft');

\echo '--- 2. The owner approves all; approval is recorded'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select test_check(approve_all_drafts(:'org') = 1, 'one waiting draft approved');
select test_check((select status = 'approved' and approved_by = '11111111-1111-1111-1111-111111111111' and approved_at is not null
                     from ai_messages where id = :'d1'), 'who approved and when');

\echo '--- 3. Desk staff send approved messages as they are'
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo 'expect: approved text cannot be changed by desk staff'
update ai_messages set body = 'Something else' where id = :'d1';
update ai_messages set status = 'sent', sent_at = now(), channel = 'whatsapp' where id = :'d1';
select test_check((select status = 'sent' from ai_messages where id = :'d1'), 'approved message sent by the desk');

\echo '--- 4. An approved message counts as open: no second draft, no new candidate'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into ai_messages (org_id, member_id, reason, body, model, status) values (:'org', :'m2', 'renewal', 'Renew?', 'test', 'draft') returning id as d3 \gset
update ai_messages set status = 'approved' where id = :'d3';
\echo 'expect: one open message per member and reason'
insert into ai_messages (org_id, member_id, reason, body, model) values (:'org', :'m2', 'renewal', 'Renew again?', 'test');
select test_check(not exists (select 1 from followup_candidates(:'org', 50) where member_id = :'m2' and reason = 'renewal'),
                  'member with an approved message is not a candidate again');

\echo '--- 5. Clubs that let the desk send: no approval needed'
update orgs set followup_mode = 'desk' where id = :'org';
insert into ai_messages (org_id, member_id, reason, body, model) values (:'org', :'m2', 'at_risk', 'Come back', 'test') returning id as d4 \gset
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
update ai_messages set status = 'sent', sent_at = now() where id = :'d4';
select test_check((select status = 'sent' from ai_messages where id = :'d4'), 'desk mode: staff send drafts directly');
insert into ai_messages (org_id, member_id, reason, body, model) values (:'org', :'m1', 'drop_in_lead', 'Try a package?', 'test') returning id as d5 \gset
\echo 'expect: still only owners and managers approve'
update ai_messages set status = 'approved' where id = :'d5';
\echo '--- done'
