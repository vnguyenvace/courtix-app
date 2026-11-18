-- AI follow-ups test: run on a FRESH local database after all migrations.
-- Lines labelled "expect:" should produce an error; everything else should succeed.
\set ON_ERROR_STOP 0
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','owner@raccoon'),('22222222-2222-2222-2222-222222222222','other@club');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select add_demo_data(:'org') is not null as members_loaded;
select load_raccoon_demo(:'org') is not null as timetable_loaded;
-- Give members phones and levels
update members set whatsapp = '+66 81 234 ' || lpad((row_number)::text, 4, '0')
  from (select id, row_number() over (order by full_name) from members) x where x.id = members.id;
update members set skill_level = 3.5 where full_name in ('Dmitri Volkov','Elena Sokolova','Mark Thompson');
update members set marketing_consent = false where full_name = 'Li Wei';

\echo '--- 1. Candidates (Li Wei has no consent, so is skipped)'
select (select full_name from members where id = c.member_id) as name, reason, language, phone,
       context->>'days_since_last_visit' as days_away, context->>'days_until_package_ends' as ends_in,
       jsonb_array_length(context->'suggested_sessions') as suggestions
  from followup_candidates(:'org') c;

\echo '--- 2. Full context for Dmitri'
select jsonb_pretty(context) from followup_candidates(:'org') c
 where member_id = (select id from members where full_name='Dmitri Volkov');

\echo '--- 3. Drafts stop repeats; cooldown after sending'
insert into ai_messages (org_id, member_id, reason, language, body)
select :'org', member_id, reason, language, 'test draft' from followup_candidates(:'org') limit 2;
select count(*) as candidates_after_2_drafts from followup_candidates(:'org');
\echo 'expect: duplicate open draft'
insert into ai_messages (org_id, member_id, reason, language, body)
select org_id, member_id, reason, language, 'dup' from ai_messages limit 1;
update ai_messages set status='sent', sent_at=now();
select count(*) as candidates_after_sending from followup_candidates(:'org');

\echo '--- 4. Sessions needing players and who to invite'
select name, to_char(starts_at at time zone 'Asia/Bangkok','Dy HH24:MI') at, booked, min_players
  from sessions_needing_players order by starts_at limit 3;
select id as s from sessions_needing_players where category='open_play' order by starts_at limit 1 \gset
select (select full_name from members where id=c.member_id) as invite, context->'session'->>'name' as session,
       context->'session'->>'players_still_needed' as needed
  from fill_session_candidates(:'s') c;
\echo 'kids clinic invites go only to people who booked it before (expect 0):'
select id as kids from sessions_needing_players where name='Kids clinic' limit 1 \gset
select count(*) from fill_session_candidates(:'kids');
\echo 'level-limited match play (3.5+) only invites 3.5+ or unknown level:'
select id as mp from session_overview where type_name like 'Social match play%' and status<>'cancelled' order by starts_at limit 1 \gset
select (select full_name || ' ' || coalesce(skill_level::text,'?') from members where id=c.member_id) from fill_session_candidates(:'mp', 20) c;

\echo '--- 5. Outcome tracking'
select id as dm from members where full_name='Dmitri Volkov' \gset
reset role;
delete from ai_messages;
insert into ai_messages (org_id, member_id, reason, language, body, status, sent_at)
  values (:'org', :'dm', 'at_risk', 'ru', 'Привет!', 'sent', now() - interval '2 days');
insert into check_ins (org_id, member_id) values (:'org', :'dm');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select came_in, signed_up, package_revenue from ai_message_outcomes;
select drafts_waiting, sent_30d, responded_30d from ai_followup_stats where org_id = :'org';

\echo '--- 6. Another club sees nothing'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select count(*) as other_sees_messages from ai_messages;
select count(*) as other_sees_candidates from followup_candidates(:'org');
