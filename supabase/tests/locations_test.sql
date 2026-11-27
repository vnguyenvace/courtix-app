-- Locations test: run on a FRESH local database after all migrations.
-- Lines labelled "expect:" should produce an error; everything else should succeed.
\set ON_ERROR_STOP 0
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','owner@club'),('33333333-3333-3333-3333-333333333333','desk@chalong');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Island Racquet Club','island') as org \gset
select id as rawai from locations where org_id = :'org' \gset
update locations set name = 'Rawai' where id = :'rawai';

\echo '--- 1. New club starts with one location; courts go there'
select l.name, count(c.*) as courts from locations l left join courts c on c.location_id = l.id group by l.name;

\echo '--- 2. Add Chalong and a Bali site (different time zone)'
insert into locations (org_id, name, opens_at, closes_at) values (:'org', 'Chalong', '06:00', '23:00') returning id as chalong \gset
insert into locations (org_id, name, timezone, opens_at, closes_at) values (:'org', 'Canggu', 'Asia/Makassar', '07:00', '21:00') returning id as bali \gset
\echo 'expect: bad time zone'
insert into locations (org_id, name, timezone) values (:'org', 'Nowhere', 'Mars/Olympus');
\echo 'same court name at another location is fine:'
insert into courts (org_id, location_id, name) values (:'org', :'chalong', 'Court 1') returning id as ch1 \gset
insert into courts (org_id, location_id, name) values (:'org', :'bali', 'Court 1') returning id as bali1 \gset
select id as rw1 from courts where location_id = :'rawai' and name = 'Court 1' \gset
\echo 'expect: duplicate name at the same location'
insert into courts (org_id, location_id, name) values (:'org', :'chalong', 'Court 1');

\echo '--- 3. Opening hours and time zone per location'
-- 06:00 tomorrow: open at Chalong (06-23), closed at Rawai (07-22)
select ((org_today(:'org')+1)::timestamp + time '06:00') at time zone 'Asia/Bangkok' as early \gset
select create_booking(:'ch1', :'early', null, 'Early bird') is not null as chalong_6am_ok;
\echo 'expect: Rawai closed at 6am'
select create_booking(:'rw1', :'early', null, 'Early bird');
-- 07:00 Bali time is 06:00 Bangkok time: Bali court should accept 07:00 local
select ((org_today(:'org')+1)::timestamp + time '07:00') at time zone 'Asia/Makassar' as bali7 \gset
select create_booking(:'bali1', :'bali7', null, 'Surfer Sam') is not null as bali_7am_local_ok;
select location_name, court_name, to_char(start_at at time zone 'Asia/Makassar', 'HH24:MI') as bali_local_time from booking_calendar where location_name = 'Canggu';

\echo '--- 4. Prices per location (location rule beats club-wide rule)'
insert into rate_rules (org_id, location_id, label, start_time, end_time, drop_in_price, member_price, priority)
values (:'org', :'chalong', 'Chalong all day', '06:00', '23:00', 800, 100, 50);
select ((org_today(:'org')+1)::timestamp + time '18:00') at time zone 'Asia/Bangkok' as eve \gset
select slot_price(:'org', :'eve', false, :'rawai') as rawai_peak_dropin, slot_price(:'org', :'eve', false, :'chalong') as chalong_dropin;

\echo '--- 5. Packages work everywhere unless limited'
insert into members (org_id, full_name, home_location_id) values (:'org', 'Anna Everywhere', :'rawai') returning id as anna \gset
insert into members (org_id, full_name, home_location_id) values (:'org', 'Ruslan Rawai-only', :'rawai') returning id as ruslan \gset
select id as monthly from package_types where org_id = :'org' and name = 'Monthly unlimited' \gset
insert into package_types (org_id, name, kind, duration_days, price, location_ids)
values (:'org', 'Rawai only monthly', 'time_based', 30, 2500, array[:'rawai']::uuid[]) returning id as rawai_only \gset
\echo 'empty location list means everywhere:'
insert into package_types (org_id, name, kind, duration_days, price, location_ids)
values (:'org', 'Ticked none', 'time_based', 30, 1, '{}') returning location_ids is null as treated_as_everywhere;
select sell_membership(:'anna', :'monthly') is not null, sell_membership(:'ruslan', :'rawai_only') is not null;
select create_booking(:'ch1', :'eve', :'anna') is not null as anna_member_at_chalong;
select kind, price from bookings where member_id = :'anna';
\echo 'Ruslan at Chalong, automatic kind -> drop-in at Chalong price:'
select create_booking(:'ch1', :'eve' ::timestamptz + interval '1 hour', :'ruslan') is not null as ruslan_booked;
select kind, price from bookings where member_id = :'ruslan';
\echo 'expect: package not valid at Chalong'
select create_booking(:'ch1', :'eve' ::timestamptz + interval '2 hours', :'ruslan', null, 'member');
select create_booking(:'rw1', :'eve', :'ruslan') is not null as ruslan_member_at_rawai;
select b.kind, l.name from bookings b join locations l on l.id = b.location_id where member_id = :'ruslan' order by 2;

\echo '--- 6. Events and courts at the wrong location'
insert into session_types (org_id, name, category, price) values (:'org', 'Clinic', 'clinic', 500) returning id as clinic \gset
select ((org_today(:'org')+2)::timestamp + time '10:00') at time zone 'Asia/Bangkok' as t10 \gset
select create_event(:'clinic', :'t10', :'t10'::timestamptz + interval '1 hour', 'Chalong clinic', null, null, null, null, null,
                    array[:'ch1', :'rw1']::uuid[], null, null, :'chalong') as ev \gset
select location_name, courts, notes from session_overview where id = :'ev';

\echo '--- 7. Timetable per location, generated in local time'
insert into session_schedules (org_id, session_type_id, days_of_week, start_time, court_ids)
values (:'org', :'clinic', '{0,1,2,3,4,5,6}', '08:00', array[:'bali1']::uuid[]);
select generate_sessions(:'org', 3) >= 2 as generated;
select distinct location_name, to_char(starts_at at time zone location_timezone, 'HH24:MI') as local_start, courts
  from session_overview where schedule_id is not null;

\echo '--- 8. Desk staff limited to Chalong'
reset role;
insert into org_staff (org_id, user_id, role, location_ids) values (:'org', '33333333-3333-3333-3333-333333333333', 'front_desk', array[:'chalong']::uuid[]);
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select count(distinct location_id) as locations_visible from booking_calendar;
select create_booking(:'ch1', :'eve'::timestamptz + interval '3 hours', null, 'Walk-in Wendy') is not null as can_book_chalong;
\echo 'expect: cannot book Rawai'
select create_booking(:'rw1', :'eve'::timestamptz + interval '3 hours', null, 'Walk-in Wendy');
select register_for_session(:'ev', null, 'Clinic Carl') is not null as can_sign_up_chalong_session;
\echo 'desk staff cannot change locations (RLS changes 0 rows, name stays Chalong):'
update locations set name = 'Mine' where id = :'chalong';
select name from locations where id = :'chalong';

\echo '--- 9. Location dashboard and AI suggestions prefer home location'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into check_ins (org_id, member_id, location_id) values (:'org', :'anna', :'chalong');
select name, courts, home_members, bookings_today, players_30d from location_dashboard where org_id = :'org' order by sort_order, name;
insert into session_schedules (org_id, session_type_id, days_of_week, start_time, court_ids)
values (:'org', :'clinic', '{0,1,2,3,4,5,6}', '09:00', array[:'rw1']::uuid[]);
select generate_sessions(:'org', 3) > 0 as more;
select s->>'location' as first_suggestion_for_rawai_member from jsonb_array_elements(member_session_suggestions(:'anna', 4, 3)) s limit 1;
