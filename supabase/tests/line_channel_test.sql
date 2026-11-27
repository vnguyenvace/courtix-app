-- LINE channel test (Step 9). Run on a FRESH local database after all migrations.
-- Lines labelled "expect:" should produce an error; everything else should succeed.
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
insert into members (org_id, full_name) values (:'org', 'Dmitri Volkov') returning id as dmitri \gset
insert into members (org_id, full_name) values (:'org', 'Nong Siriporn') returning id as nong \gset
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Chalong Padel','chalong') as other_org \gset
reset role;
insert into org_staff (org_id, user_id, role) values (:'org', '33333333-3333-3333-3333-333333333333', 'front_desk');

\echo '--- 1. The owner connects LINE; the webhook key is made for them'
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into messaging_channels (org_id, provider, secret_enc, token_enc, account_name, account_id)
values (:'org', 'line', 'v1:enc-secret', 'v1:enc-token', 'Raccoon Pickleball', '@raccoon') returning id as ch, webhook_key as wk \gset
select test_check(length(:'wk') = 36, 'unguessable webhook key');
\echo 'expect: one LINE account per club'
insert into messaging_channels (org_id, provider, secret_enc, token_enc) values (:'org', 'line', 'x', 'y');

\echo '--- 2. Desk staff see it but cannot change it; other clubs see nothing'
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select test_check((select count(*) from messaging_channels) = 1, 'desk staff see their club''s channel');
update messaging_channels set is_enabled = false where id = :'ch';
delete from messaging_channels where id = :'ch';
\echo 'expect: desk staff cannot connect LINE'
insert into messaging_channels (org_id, provider, secret_enc, token_enc, location_id) values (:'org', 'whatsapp', 'x', 'y', null);
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select test_check((select count(*) from messaging_channels) = 0, 'other club sees no LINE channel');
reset role;
select test_check((select is_enabled from messaging_channels where id = :'ch'), 'desk update and delete changed nothing');

\echo '--- 3. The webhook (service identity) opens LINE chats'
set role service_role;
select chat_open_line_conversation(:'org', 'U1234567890abcdef', 'Dima') as c1 \gset
select test_check(chat_open_line_conversation(:'org', 'U1234567890abcdef', 'Dima V') = :'c1', 'same open chat reused');
select test_check((select contact_name = 'Dima V' and member_id is null and contact_phone is null from chat_conversations where id = :'c1'),
                  'unknown LINE user starts as a visitor, name kept fresh');
reset role;

\echo '--- 4. Staff link the chat to a member; the next chat is recognised'
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select chat_link_member(:'c1', :'dmitri');
select test_check((select member_id = :'dmitri' from chat_conversations where id = :'c1'), 'chat linked to Dmitri');
select test_check((select line_user_id = 'U1234567890abcdef' from members where id = :'dmitri'), 'link saved on the member');
\echo 'expect: same LINE account cannot be another member'
select chat_link_member(:'c1', :'nong');
update chat_conversations set status = 'closed' where id = :'c1';
reset role; set role service_role;
select chat_open_line_conversation(:'org', 'U1234567890abcdef', 'Dima') as c2 \gset
select test_check((select member_id = :'dmitri' from chat_conversations where id = :'c2'), 'next LINE chat recognised as Dmitri');
reset role;

\echo '--- 5. Rules'
\echo 'expect: a LINE chat needs a LINE user id'
insert into chat_conversations (org_id, channel, contact_name) values (:'org', 'line', 'Nobody');
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo 'expect: another club cannot open chats in this club'
select chat_open_line_conversation(:'org', 'Uother', 'X');
\echo 'expect: another club cannot link this club''s chat'
select chat_link_member(:'c2', :'nong');
reset role; set role anon;
\echo 'expect: visitors cannot read channels'
select count(*) from messaging_channels;
\echo '--- done'
