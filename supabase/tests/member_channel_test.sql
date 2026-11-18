-- Member channel test: run on a FRESH local database after all migrations.
-- Lines labelled "expect:" should produce an error; everything else should succeed.
\set ON_ERROR_STOP 0
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','owner@club'),('22222222-2222-2222-2222-222222222222','other@club');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Island Racquet Club','island') as org \gset

\echo '--- 1. Automatic channel'
insert into members (org_id, full_name, language, whatsapp) values (:'org', 'Dmitri', 'ru', '+7 912 345 6789') returning id as dmitri \gset
insert into members (org_id, full_name, language) values (:'org', 'Somchai', 'th') returning id as somchai \gset
insert into members (org_id, full_name, language, line_user_id) values (:'org', 'Anna', 'en', 'U123') returning id as anna \gset
insert into members (org_id, full_name, language, phone, line_user_id) values (:'org', 'Mark', 'en', '081 234 5678', 'U456') returning id as mark \gset
select full_name, member_channel(m) as channel,
       member_channel(m) = case full_name when 'Dmitri' then 'whatsapp' when 'Somchai' then 'line'
                                          when 'Anna' then 'line' when 'Mark' then 'whatsapp' end as ok
  from members m order by full_name;

\echo '--- 2. Staff choice wins'
update members set preferred_channel = 'whatsapp' where id = :'somchai';
update members set preferred_channel = 'line' where id = :'dmitri';
select full_name, member_channel(m) as channel from members m where id in (:'somchai', :'dmitri') order by full_name;
select member_channel(m) = 'whatsapp' as somchai_whatsapp from members m where id = :'somchai';
select member_channel(m) = 'line' as dmitri_line from members m where id = :'dmitri';

\echo '--- 3. Through the API (PostgREST computed field uses the same function)'
select count(*) = 4 as all_have_channel from members m where member_channel(m) in ('whatsapp', 'line');

\echo 'expect: only whatsapp or line'
update members set preferred_channel = 'sms' where id = :'anna';

\echo '--- 4. Another club cannot see or change it'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select count(*) as other_club_sees from members where org_id = :'org';
update members set preferred_channel = 'whatsapp' where id = :'anna';
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select preferred_channel is null as anna_unchanged from members where id = :'anna';

\echo '--- 5. Anonymous cannot call it'
set role anon;
\echo 'expect: permission denied for anon'
select public.member_channel(m) from public.members m;
reset role;
