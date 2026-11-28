-- Demo requests from the landing page. Run on a FRESH local database.
-- Lines labelled "expect:" should produce an error.
\set ON_ERROR_STOP 0
create function public.test_check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'CHECK FAILED: %', what; end if;
  return 'ok: ' || what;
end $$;
grant execute on function public.test_check(boolean, text) to anon, authenticated;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','owner@raccoon'),
  ('44444444-4444-4444-4444-444444444444','admin@courtix');
insert into platform_staff (user_id, role) values ('44444444-4444-4444-4444-444444444444', 'super_admin');

\echo '--- 1. A visitor asks for a demo'
set role anon;
select request_demo('Kai', 'Chalong Pickleball', '0812345678', 'kai@example.com', '{pickleball,padel,squash}', 6, 'Two locations', 'th') as d1 \gset
\echo 'expect: name needed'
select request_demo('', 'Club', '0812345678', null, '{}', null, null, 'en');
\echo 'expect: a way to reach them'
select request_demo('Kai', 'Club', 'x', null, '{}', null, null, 'en');
select request_demo('Kai', 'Chalong Pickleball', '0812345678', null, '{}', null, null, 'en');
select request_demo('Kai', 'Chalong Pickleball', '0812345678', null, '{}', null, null, 'en');
\echo 'expect: fourth from the same contact in a day'
select request_demo('Kai', 'Chalong Pickleball', '0812345678', null, '{}', null, null, 'en');
\echo 'expect: visitors cannot read requests'
select count(*) from demo_requests;
\echo 'expect: visitors cannot insert directly'
insert into demo_requests (name, club_name, contact) values ('x', 'y', 'zzz');

\echo '--- 2. Club staff see nothing; the Courtix team sees and updates'
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select test_check((select count(*) = 0 from demo_requests), 'club owner sees no demo requests');
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select test_check((select count(*) = 3 from demo_requests), 'team sees all three');
select test_check((select sports = '{padel,pickleball}' and courts = 6 and language = 'th' from demo_requests where id = :'d1'),
                  'unknown sports dropped, details kept');
update demo_requests set status = 'contacted', note = 'Called, demo Tuesday' where id = :'d1';
select test_check((select status = 'contacted' from demo_requests where id = :'d1'), 'team marks it contacted');
\echo '--- done'
