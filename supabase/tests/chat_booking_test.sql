-- Chat booking test (Step 9, part 1). Run on a FRESH local database after all migrations.
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

insert into members (org_id, full_name, skill_level, phone) values (:'org', 'Eve Evenings', 3.0, '+66 81 111 2222') returning id as eve \gset
insert into members (org_id, full_name, skill_level, phone) values (:'org', 'Nina Nopackage', 3.0, '081-333-4444') returning id as nina \gset
select id as pk_evenings from package_types where org_id = :'org' and name = 'Unlimited evenings (30 days)' \gset
select sell_membership(:'eve', :'pk_evenings') as ms_eve \gset

select id as evening_open from session_overview where org_id = :'org' and type_name = 'Open play'
   and to_char(starts_at at time zone 'Asia/Bangkok', 'HH24:MI') = '18:00' and starts_at > now() + interval '30 hours'
 order by starts_at limit 1 \gset
select id as clinic from session_overview where org_id = :'org' and type_name = 'Adult clinic'
   and starts_at > now() + interval '30 hours' order by starts_at limit 1 \gset
select id as clinic2 from session_overview where org_id = :'org' and type_name = 'Adult clinic'
   and starts_at > now() + interval '30 hours' order by starts_at offset 1 limit 1 \gset
-- A free session for the visitor test.
update sessions set price = 0 where id = :'clinic2';

\echo '--- 1. Phone numbers match members, whatever the format'
select test_check(phone_key('081-333-4444') = '66813334444', 'Thai 08x becomes 668x');
select test_check(phone_key('+66 81 333 4444') = '66813334444', 'same number with country code');
select chat_open_conversation(:'org', 'test', '0811112222', 'Eve') as c_eve \gset
select test_check((select member_id from chat_conversations where id = :'c_eve') = :'eve', 'Eve recognised from her number');
select test_check(chat_open_conversation(:'org', 'test', '+66 81 111 2222') = :'c_eve', 'same open conversation reused');
select chat_open_conversation(:'org', 'test', '+44 7700 900123', 'Tom Visitor') as c_tom \gset
select test_check((select member_id is null from chat_conversations where id = :'c_tom'), 'unknown number is a visitor');
\echo 'expect: phone number too short'
select chat_open_conversation(:'org', 'test', '12345');

\echo '--- 2. A covered place is booked by chat at 0'
select chat_book_session(:'c_eve', :'evening_open') as r1 \gset
select test_check((:'r1'::jsonb)->>'status' = 'booked' and ((:'r1'::jsonb)->>'price')::numeric = 0, 'booked at 0');
select test_check((:'r1'::jsonb)->>'covered_by' = 'Unlimited evenings (30 days)', 'says what covered it');
select test_check((select source from session_registrations where id = ((:'r1'::jsonb)->>'registration_id')::uuid) = 'chat', 'marked as booked by chat');
\echo 'expect: already signed up'
select chat_book_session(:'c_eve', :'evening_open');

\echo '--- 3. A paid place is refused and nothing is booked'
\echo 'expect: clinic costs money, club confirms'
select chat_book_session(:'c_eve', :'clinic');
select test_check((select count(*) from session_registrations where session_id = :'clinic' and member_id = :'eve') = 0, 'no paid place left behind');
select chat_open_conversation(:'org', 'test', '0813334444') as c_nina \gset
\echo 'expect: member without a package pays for open play'
select chat_book_session(:'c_nina', :'evening_open');
select test_check((select count(*) from session_registrations where session_id = :'evening_open' and member_id = :'nina') = 0, 'still nothing for Nina');

\echo '--- 4. Visitors: free sessions yes, courts no'
select chat_book_session(:'c_tom', :'clinic2') as r2 \gset
select test_check((select guest_name = 'Tom Visitor' and guest_phone = '+447700900123' and price = 0
                     from session_registrations where id = ((:'r2'::jsonb)->>'registration_id')::uuid), 'visitor booked a free session as a guest');
select id as court1 from courts where org_id = :'org' order by sort_order limit 1 \gset
\echo 'expect: visitors cannot book courts by chat'
select chat_book_court(:'c_tom', :'court1', date_trunc('hour', now()) + interval '2 days 10 hours');

\echo '--- 5. Courts: Raccoon charges members 600, so chat refuses'
select court_id as free_court, slot_start as free_start from public_court_slots('raccoon', :'loc', current_date + 2)
 where is_free order by slot_start limit 1 \gset
\echo 'expect: court costs money (600)'
select chat_book_court(:'c_eve', :'free_court', :'free_start');
select test_check((select count(*) from bookings where member_id = :'eve') = 0, 'no court booking left behind');

\echo '--- 6. Handed off: Claude can no longer book in that chat'
select chat_hand_off(:'c_eve', 'Asked about a refund');
select test_check((select status = 'staff' and handoff_reason = 'Asked about a refund' from chat_conversations where id = :'c_eve'), 'chat waits for staff');
\echo 'expect: staff are handling this chat'
select chat_book_session(:'c_eve', :'clinic2');
update chat_conversations set status = 'bot' where id = :'c_eve';

\echo '--- 7. "Answer only" clubs: no booking by chat'
update orgs set chat_mode = 'answer' where id = :'org';
\echo 'expect: club books places itself'
select chat_book_session(:'c_eve', :'clinic2');
update orgs set chat_mode = 'book' where id = :'org';

\echo '--- 8. Another club (members pay 0 for courts) books a member court by chat'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Chalong Padel','chalong') as other_org \gset
insert into members (org_id, full_name, phone) values (:'other_org', 'Pat Padel', '0819998888') returning id as pat \gset
select id as pk_monthly from package_types where org_id = :'other_org' and name = 'Monthly unlimited' \gset
select sell_membership(:'pat', :'pk_monthly');
select chat_open_conversation(:'other_org', 'test', '+66819998888') as c_pat \gset
select id as pcourt from courts where org_id = :'other_org' order by sort_order limit 1 \gset
select chat_book_court(:'c_pat', :'pcourt', ((current_date + 2) + time '10:00') at time zone 'Asia/Bangkok') as rc \gset
select test_check(((:'rc'::jsonb)->>'price')::numeric = 0 and (:'rc'::jsonb)->>'when' like '%10:00', 'member court booked by chat at 0');

\echo '--- 9. Clubs stay apart'
select test_check((select count(*) from chat_conversations) = 1, 'other club sees only its own chat');
\echo 'expect: cannot open a chat in another club'
select chat_open_conversation(:'org', 'test', '+66 81 555 6666');
\echo 'expect: cannot book in another club''s conversation'
select chat_book_session(:'c_eve', :'clinic2');
reset role; set role anon;
\echo 'expect: visitors cannot read chats'
select count(*) from chat_conversations;
\echo 'expect: visitors cannot call chat booking'
select chat_book_session(:'c_eve', :'clinic2');
\echo '--- done'
