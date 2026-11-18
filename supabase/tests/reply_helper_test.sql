-- Reply helper test: run on a FRESH local database after all migrations.
-- Lines labelled "expect:" should produce an error; everything else should succeed.
\set ON_ERROR_STOP 0
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','owner@raccoon'),('22222222-2222-2222-2222-222222222222','other@club');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select load_raccoon_demo(:'org') is not null as loaded;
insert into members (org_id, full_name, language) values (:'org', 'Mark Thompson', 'en') returning id as mark \gset
select id as unlimited from package_types where org_id = :'org' and name like 'Unlimited evenings%' \gset
select sell_membership(:'mark', :'unlimited') is not null as sold;

\echo '--- 1. Context has the facts Claude needs'
select inquiry_context(:'org') as ctx \gset
select (:'ctx'::jsonb -> 'club' ->> 'name') = 'Raccoon Pickleball' as club_name,
       jsonb_array_length(:'ctx'::jsonb -> 'locations') = 1 as one_location,
       jsonb_array_length(:'ctx'::jsonb -> 'upcoming_sessions') > 10 as has_sessions,
       (select bool_and((s ? 'spots_left') and (s ? 'price') and (s ? 'day') and (s ? 'start'))
          from jsonb_array_elements(:'ctx'::jsonb -> 'upcoming_sessions') s) as sessions_have_spots_and_prices,
       (select count(*) from jsonb_array_elements(:'ctx'::jsonb -> 'packages') p where p->>'name' like 'Unlimited evenings%') = 1 as has_package,
       jsonb_array_length(:'ctx'::jsonb -> 'court_hire') >= 1 as has_court_hire,
       (:'ctx'::jsonb -> 'member') = 'null'::jsonb as no_member_without_id;

\echo '--- 2. Cancelled and past sessions are left out'
select id as first_session from sessions where org_id = :'org' and starts_at > now() order by starts_at limit 1 \gset
select cancel_session(:'first_session', 'Rain') is not null as cancelled;
select not exists (
  select 1 from jsonb_array_elements(inquiry_context(:'org') -> 'upcoming_sessions') s, session_overview x
   where x.id = :'first_session'
     and s->>'name' = x.name
     and s->>'day' = to_char(x.starts_at at time zone x.location_timezone, 'Dy DD Mon')
     and s->>'start' = to_char(x.starts_at at time zone x.location_timezone, 'HH24:MI')
) as cancelled_session_hidden;

\echo '--- 3. Member facts'
select inquiry_context(:'org', null, :'mark') -> 'member' as m \gset
select (:'m'::jsonb ->> 'first_name') = 'Mark' as first_name,
       (:'m'::jsonb ->> 'package') like 'Unlimited evenings%' as package,
       (:'m'::jsonb ? 'package_ends') as has_end_date;

\echo '--- 4. Saving a draft reply'
insert into inquiry_replies (org_id, member_id, incoming, reply, context)
values (:'org', :'mark', 'Any open play tomorrow evening?', 'Yes, 18:00-21:00, 350 THB.', '{}') returning id as reply \gset
insert into inquiry_replies (org_id, contact_name, contact_phone, incoming, reply)
values (:'org', 'Visitor Vic', '+66 81 000 0000', 'How much is a clinic?', 'Adult clinic is 500 THB.');
select count(*) = 2 as two_drafts, bool_and(created_by = '11111111-1111-1111-1111-111111111111') as created_by_me
  from inquiry_replies where org_id = :'org' and status = 'draft';
update inquiry_replies set status = 'sent', channel = 'line', sent_at = now() where id = :'reply';
select status = 'sent' and channel = 'line' as marked_sent from inquiry_replies where id = :'reply';
\echo 'expect: empty incoming message rejected'
insert into inquiry_replies (org_id, incoming, reply) values (:'org', '   ', 'x');
\echo 'expect: unknown channel rejected'
update inquiry_replies set channel = 'pigeon' where id = :'reply';

\echo '--- 5. Another club sees nothing'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Chalong Padel','chalong') as org_b \gset
select count(*) as other_club_sees_replies from inquiry_replies;
select (inquiry_context(:'org') -> 'club') = 'null'::jsonb as other_club_gets_no_club,
       jsonb_array_length(inquiry_context(:'org') -> 'upcoming_sessions') = 0 as other_club_gets_no_sessions;
select (inquiry_context(:'org_b', null, :'mark') -> 'member') = 'null'::jsonb as cannot_read_other_clubs_member;
\echo 'expect: cannot save a reply into another club'
insert into inquiry_replies (org_id, incoming, reply) values (:'org', 'hi', 'hello');
\echo 'expect: cannot point at another club''s member'
insert into inquiry_replies (org_id, member_id, incoming, reply) values (:'org_b', :'mark', 'hi', 'hello');

\echo '--- 6. Anonymous gets nothing'
set role anon;
\echo 'expect: anon cannot read replies'
select count(*) from public.inquiry_replies;
\echo 'expect: anon cannot call inquiry_context'
select public.inquiry_context(:'org');
reset role;
