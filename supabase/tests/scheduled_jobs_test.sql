-- Scheduled jobs test: run on a FRESH local database after all migrations.
-- Lines labelled "expect:" should produce an error; everything else should succeed.
\set ON_ERROR_STOP 0
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','owner@raccoon'),('22222222-2222-2222-2222-222222222222','owner@chalong');

\echo '--- 1. Jobs are scheduled'
select count(*) = 1 as housekeeping_hourly from cron.job where jobname = 'club-os-housekeeping' and schedule = '5 * * * *';
select count(*) = 1 as history_cleanup from cron.job where jobname = 'club-os-cron-history-cleanup';
select count(*) = 0 as go_no_go_not_scheduled_yet from cron.job where command ilike '%check_session_minimums%';

\echo '--- 2. Two clubs with timetables; housekeeping fills both'
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org_a \gset
select load_raccoon_demo(:'org_a') is not null as loaded_a;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Chalong Padel','chalong') as org_b \gset
insert into session_types (org_id, name, category, price) values (:'org_b', 'Open play', 'open_play', 300) returning id as type_b \gset
insert into session_schedules (org_id, session_type_id, days_of_week, start_time) values (:'org_b', :'type_b', '{0,1,2,3,4,5,6}', '18:00');
reset role;
-- The scheduler has no signed-in user.
select set_config('request.jwt.claim.sub', '', false);
delete from sessions where org_id = :'org_a' and starts_at > now() + interval '7 days';
select count(*) as a_before from sessions where org_id = :'org_a' \gset
select count(*) = 0 as b_has_none_yet from sessions where org_id = :'org_b';
select public.run_housekeeping() as result \gset
select (:'result'::jsonb ->> 'clubs_failed')::int = 0 as no_failures,
       (:'result'::jsonb ->> 'sessions_created')::int > 0 as created_some;
select count(*) > :a_before as a_refilled from sessions where org_id = :'org_a';
select count(*) >= 13 as b_two_weeks from sessions where org_id = :'org_b';

\echo '--- 3. Running it again changes nothing'
select count(*) as total_before from sessions \gset
select (public.run_housekeeping() ->> 'sessions_created')::int = 0 as nothing_new;
select count(*) = :total_before as same_count from sessions;

\echo '--- 4. Packages expire and pauses end'
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into members (org_id, full_name) values (:'org_a', 'Old Olga') returning id as olga \gset
insert into members (org_id, full_name) values (:'org_a', 'Paused Pete') returning id as pete \gset
select id as unlimited from package_types where org_id = :'org_a' and name like 'Unlimited evenings%' \gset
select sell_membership(:'olga', :'unlimited', org_today(:'org_a') - 40) as olga_ms \gset
select sell_membership(:'pete', :'unlimited', org_today(:'org_a') - 5) as pete_ms \gset
reset role;
-- Olga's package ended 10 days ago but is still marked active; Pete's pause ended yesterday.
update memberships set status = 'active' where id = :'olga_ms';
update memberships set status = 'paused', paused_from = current_date - 10, paused_until = current_date - 1 where id = :'pete_ms';
select set_config('request.jwt.claim.sub', '', false);
select public.run_housekeeping() is not null as ran;
select status = 'expired' as olga_expired from memberships where id = :'olga_ms';
select status = 'active' as pete_back from memberships where id = :'pete_ms';

\echo '--- 5. Staff and anonymous cannot run it'
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo 'expect: staff cannot run housekeeping directly'
select public.run_housekeeping();
set role anon;
\echo 'expect: anon cannot run housekeeping'
select public.run_housekeeping();
reset role;
