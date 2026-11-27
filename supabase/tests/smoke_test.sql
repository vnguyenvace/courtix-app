-- Smoke test: run on a FRESH local database only (creates test users and clubs).
-- Lines labelled "expect:" should produce an error; everything else should succeed.
\set ON_ERROR_STOP 0
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','owner_a@test'),('22222222-2222-2222-2222-222222222222','owner_b@test');

-- Owner A creates Rawai club
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Rawai Pickleball Club','rawai') as org_a \gset
-- Owner B creates another club
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Chalong Padel','chalong') as org_b \gset
insert into members (org_id, full_name) values (:'org_b','B secret member');

\echo '--- 1. Isolation: A sees only own club'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select name from orgs;
select count(*) as b_members_visible_to_a from members where org_id = :'org_b';
\echo '--- 1b. A cannot insert into B'
\echo 'expect: row-level security error'
insert into members (org_id, full_name) values (:'org_b','sneaky');

\echo '--- 2. Members and packages'
insert into members (org_id, full_name, language) values (:'org_a','Dmitri','ru') returning id as dmitri \gset
insert into members (org_id, full_name, language) values (:'org_a','Somchai','th') returning id as somchai \gset
insert into members (org_id, full_name, language) values (:'org_a','Anna','en') returning id as anna \gset
select id as monthly from package_types where org_id=:'org_a' and name='Monthly unlimited' \gset
select id as pack from package_types where org_id=:'org_a' and name='10-session pack' \gset
select sell_membership(:'dmitri', :'monthly') is not null as sold_dmitri;
select sell_membership(:'somchai', :'monthly', org_today(:'org_a') - 25) is not null as sold_somchai;
select sell_membership(:'anna', :'pack') is not null as sold_anna;

\echo '--- 3. Bookings'
select id as c1 from courts where org_id=:'org_a' and name='Court 1' \gset
-- tomorrow 09:00 and 18:00 Bangkok time
select ((org_today(:'org_a')+1)::timestamp + time '09:00') at time zone 'Asia/Bangkok' as t9 \gset
select ((org_today(:'org_a')+1)::timestamp + time '18:00') at time zone 'Asia/Bangkok' as t18 \gset
select ((org_today(:'org_a')+1)::timestamp + time '10:00') at time zone 'Asia/Bangkok' as t10 \gset
select create_booking(:'c1', :'t9', :'dmitri') is not null as member_booked;
\echo 'expect: double-booking error'
select create_booking(:'c1', :'t9', null, 'Tourist Tom');
select create_booking(:'c1', :'t18', null, 'Tourist Tom') is not null as dropin_booked_peak;
select create_booking(:'c1', :'t10', :'dmitri') is not null as member_second;
\echo 'expect: limit reached error'
select create_booking(:'c1', (:'t10'::timestamptz + interval '2 hours'), :'dmitri');
\echo 'expect: opening hours error'
select create_booking(:'c1', ((org_today(:'org_a')+1)::timestamp + time '21:30') at time zone 'Asia/Bangkok', null, 'Late');
\echo 'expect: advance window error'
select create_booking(:'c1', ((org_today(:'org_a')+20)::timestamp + time '09:00') at time zone 'Asia/Bangkok', :'somchai', null, 'member');
select kind, guest_name, price, to_char(lower(during) at time zone 'Asia/Bangkok','HH24:MI') as at from bookings order by lower(during);

\echo '--- 4. Check-ins and class pack'
insert into check_ins (org_id, member_id, checked_in_at) values (:'org_a', :'somchai', now() - interval '14 days');
insert into check_ins (org_id, member_id) values (:'org_a', :'anna');
select sessions_left from memberships where member_id = :'anna';

\echo '--- 5. Member status / dashboard'
select full_name, package_name, days_to_expiry, sessions_left, days_since_visit, upcoming_bookings, is_at_risk, is_renewing_soon from member_status order by full_name;
select active_members, at_risk, renewing_soon, bookings_today, package_sales_this_month from org_dashboard;

\echo '--- 6. Pause'
select id as sm from memberships where member_id=:'somchai' \gset
select ends_on as before from memberships where id=:'sm';
select pause_membership(:'sm', org_today(:'org_a'), org_today(:'org_a') + 30);
select status, ends_on as after from memberships where id=:'sm';

\echo '--- 7. Staff role cannot change prices'
reset role;
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','desk@test');
insert into org_staff values (:'org_a','33333333-3333-3333-3333-333333333333', 'front_desk');
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
update package_types set price = 1 where org_id = :'org_a';
select count(*) as cheap_packages from package_types where price = 1;
select count(*) as staff_sees_members from members;

\echo '--- 8. Anonymous sees nothing'
set role anon;
\echo 'expect: permission denied for anon'
select count(*) from members;
