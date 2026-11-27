-- Club roles and staff invites test. Run on a FRESH local database after all migrations.
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
  ('22222222-2222-2222-2222-222222222222','other@club.test', now()),
  ('33333333-3333-3333-3333-333333333333','desk@raccoon.test', now()),
  ('44444444-4444-4444-4444-444444444444','marketing@raccoon.test', now()),
  ('55555555-5555-5555-5555-555555555555','office@raccoon.test', now()),
  ('66666666-6666-6666-6666-666666666666','New.Person@Raccoon.test', now());
insert into auth.users (id, email) values ('77777777-7777-7777-7777-777777777777','unconfirmed@raccoon.test');

set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select load_raccoon_demo(:'org');
select id as loc from locations where org_id = :'org' limit 1 \gset
select id as court from courts where org_id = :'org' limit 1 \gset
insert into members (org_id, full_name, skill_level) values (:'org', 'Eve Evenings', 3.0) returning id as eve \gset
select id as pk_evenings from package_types where org_id = :'org' and name = 'Unlimited evenings (30 days)' \gset
select sell_membership(:'eve', :'pk_evenings') as ms_eve \gset
select o.id as o_pkg from orders o join order_items i on i.order_id = o.id where i.membership_id = :'ms_eve' \gset
insert into ai_messages (org_id, member_id, reason, language, body) values (:'org', :'eve', 'at_risk', 'en', 'We miss you');
insert into chat_conversations (org_id, channel, contact_name, contact_phone) values (:'org', 'whatsapp', 'Somebody', '+66812345678');
reset role;
insert into org_staff (org_id, user_id, role) values
  (:'org', '33333333-3333-3333-3333-333333333333', 'front_desk'),
  (:'org', '44444444-4444-4444-4444-444444444444', 'marketing'),
  (:'org', '55555555-5555-5555-5555-555555555555', 'back_office');
set role authenticated;

\echo '--- 1. Permissions per role'
select test_check(has_org_permission(:'org', 'staff.manage') and has_org_permission(:'org', 'members.export'), 'owner can do everything');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select test_check(has_org_permission(:'org', 'bookings.manage') and has_org_permission(:'org', 'payments.record')
  and not has_org_permission(:'org', 'payments.refund') and not has_org_permission(:'org', 'settings.manage'), 'front desk: bookings and payments, no refunds or settings');
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select test_check(has_org_permission(:'org', 'followups.manage') and not has_org_permission(:'org', 'payments.record')
  and not has_org_permission(:'org', 'bookings.manage'), 'marketing: follow-ups, no payments or bookings');
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select test_check(has_org_permission(:'org', 'payments.refund') and not has_org_permission(:'org', 'chats.reply'), 'back office: refunds, no chats');
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select test_check(not has_org_permission(:'org', 'members.view'), 'someone from another club has no permissions here');

\echo '--- 2. Marketing'
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select test_check((select count(*) from members where org_id = :'org') > 0, 'marketing sees members');
select test_check((select count(*) from orders where org_id = :'org') = 0, 'marketing sees no payments');
select test_check((select count(*) from chat_conversations where org_id = :'org') = 1, 'marketing sees chats');
\echo 'expect: marketing cannot add members'
insert into members (org_id, full_name) values (:'org', 'Not allowed');
update members set full_name = 'Renamed' where id = :'eve';
select test_check((select full_name from members where id = :'eve') = 'Eve Evenings', 'marketing cannot rename members');
\echo 'expect: marketing cannot book courts'
select create_booking(:'org', :'court', null, now() + interval '3 days', now() + interval '3 days 1 hour', 'drop_in');
update orgs set name = 'Hacked' where id = :'org';
select test_check((select name from orgs where id = :'org') = 'Raccoon Pickleball', 'marketing cannot change club settings');
select update_message_voice(:'org', 'Warm and short', 'Team Raccoon', '10% off renewals this week');
select test_check((select ai_offers from orgs where id = :'org') = '10% off renewals this week', 'marketing edits offers');
select test_check(approve_all_drafts(:'org') = 1, 'marketing approves follow-ups');

\echo '--- 3. Back office'
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select test_check((select count(*) from orders where id = :'o_pkg') = 1, 'back office sees payments');
select test_check((select count(*) from chat_conversations where org_id = :'org') = 0, 'back office sees no chats');
select mark_order_paid(:'o_pkg', 'cash');
select mark_order_unpaid(:'o_pkg');
select test_check((select status = 'pending' from orders where id = :'o_pkg'), 'back office can undo a payment');
\echo 'expect: back office cannot check people in'
insert into check_ins (org_id, member_id, location_id) values (:'org', :'eve', :'loc');

\echo '--- 4. Front desk'
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select mark_order_paid(:'o_pkg', 'cash');
\echo 'expect: front desk cannot undo a payment'
select mark_order_unpaid(:'o_pkg');
insert into members (org_id, full_name) values (:'org', 'Desk Added');
select test_check((select count(*) from members where full_name = 'Desk Added') = 1, 'front desk adds members');
\echo 'expect: front desk cannot add staff'
select invite_staff(:'org', 'someone@raccoon.test', 'front_desk');
\echo 'expect: front desk cannot see the staff list'
select * from club_staff(:'org');
update org_staff set role = 'owner' where user_id = '33333333-3333-3333-3333-333333333333' and org_id = :'org';
select test_check((select role = 'front_desk' from org_staff where user_id = '33333333-3333-3333-3333-333333333333'), 'front desk is still front desk');

\echo '--- 5. Invites'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select test_check((select count(*) from club_staff(:'org')) = 4, 'owner sees the staff list with emails');
\echo 'expect: already on the staff'
select invite_staff(:'org', 'Desk@Raccoon.test', 'marketing');
\echo 'expect: not an email address'
select invite_staff(:'org', 'not an email', 'marketing');
select invite_staff(:'org', ' new.person@raccoon.test ', 'front_desk') as tok_old \gset
select renew_staff_invite((select id from staff_invites where email = 'new.person@raccoon.test')) as tok \gset
select invite_staff(:'org', 'unconfirmed@raccoon.test', 'front_desk') as tok_unconf \gset
select test_check((select count(*) from staff_invites where org_id = :'org' and accepted_at is null) = 2, 'two open invites');

reset role; set role anon;
select test_check((select club_name = 'Raccoon Pickleball' and email = 'new.person@raccoon.test' and not expired from staff_invite_info(:'tok')), 'the join page can show the invite');
select test_check((select count(*) from staff_invite_info(:'tok_old')) = 0, 'the old link no longer works after a new one');
\echo 'expect: visitors cannot accept invites'
select accept_staff_invite(:'tok');
reset role; set role authenticated;

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo 'expect: invite is for a different email'
select accept_staff_invite(:'tok');
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
\echo 'expect: wrong token'
select accept_staff_invite('nope');
select test_check(accept_staff_invite(:'tok') = :'org', 'invited person joins');
select test_check((select role = 'front_desk' from org_staff where org_id = :'org' and user_id = '66666666-6666-6666-6666-666666666666'), 'joined as front desk');
select test_check(accept_staff_invite(:'tok') = :'org', 'opening the link again is fine');
set request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
\echo 'expect: email not confirmed'
select accept_staff_invite(:'tok_unconf');

reset role;
update staff_invites set expires_at = now() - interval '1 minute' where email = 'unconfirmed@raccoon.test';
update auth.users set email_confirmed_at = now() where id = '77777777-7777-7777-7777-777777777777';
set role authenticated; set request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
\echo 'expect: invite expired'
select accept_staff_invite(:'tok_unconf');

\echo '--- 6. A club keeps an owner'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo 'expect: last owner cannot step down'
update org_staff set role = 'manager' where org_id = :'org' and user_id = '11111111-1111-1111-1111-111111111111';
\echo 'expect: last owner cannot leave'
delete from org_staff where org_id = :'org' and user_id = '11111111-1111-1111-1111-111111111111';
update org_staff set role = 'owner' where org_id = :'org' and user_id = '55555555-5555-5555-5555-555555555555';
update org_staff set role = 'manager' where org_id = :'org' and user_id = '11111111-1111-1111-1111-111111111111';
select test_check((select count(*) from org_staff where org_id = :'org' and role = 'owner') = 1, 'ownership handed over');
\echo '--- done'
