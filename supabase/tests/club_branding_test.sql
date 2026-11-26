-- Club branding test: logo and colours. Run on a FRESH local database after all migrations.
-- Lines labelled "expect:" should produce an error; everything else should succeed.
\set ON_ERROR_STOP 0
-- Storage blocks plain SQL deletes unless this is set (its own API sets it). RLS still applies.
set storage.allow_delete_query = 'true';
create function public.test_check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'CHECK FAILED: %', what; end if;
  return 'ok: ' || what;
end $$;
grant execute on function public.test_check(boolean, text) to anon, authenticated;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','owner@raccoon'),
  ('22222222-2222-2222-2222-222222222222','other@club'),
  ('33333333-3333-3333-3333-333333333333','desk@raccoon');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Chalong Padel','chalong') as other_org \gset
reset role;
insert into org_staff (org_id, user_id, role) values (:'org', '33333333-3333-3333-3333-333333333333', 'staff');

\echo '--- 1. The owner uploads a logo into the club''s own folder and saves colours'
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into storage.objects (bucket_id, name) values ('club-logos', :'org' || '/logo-1.png');
update orgs set logo_path = :'org' || '/logo-1.png', brand_primary = '#d94f1e', brand_secondary = '#1b3a5c',
       brand_palette = '{#d94f1e,#1b3a5c,#f2c14e}'
 where id = :'org';
select test_check((select brand_primary from orgs where id = :'org') = '#d94f1e', 'colours saved');
select test_check((select count(*) from storage.objects where bucket_id = 'club-logos') = 1, 'owner sees own logo file');

\echo '--- 2. Bad values are refused'
\echo 'expect: colour must be #rrggbb'
update orgs set brand_primary = 'red' where id = :'org';
\echo 'expect: colour must be lower-case hex'
update orgs set brand_primary = '#D94F1E' where id = :'org';
\echo 'expect: logo must be in the club''s own folder'
update orgs set logo_path = :'other_org' || '/logo-1.png' where id = :'org';
\echo 'expect: palette entries must be colours'
update orgs set brand_palette = '{#d94f1e,"url(x)"}' where id = :'org';
update orgs set brand_primary = null, brand_secondary = null where id = :'org';
select test_check((select brand_primary is null from orgs where id = :'org'), 'colours can be reset');
update orgs set brand_primary = '#d94f1e', brand_secondary = '#1b3a5c' where id = :'org';

\echo '--- 3. Another club can''t touch this club''s logo or colours'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo 'expect: other club cannot upload into this club''s folder'
insert into storage.objects (bucket_id, name) values ('club-logos', :'org' || '/logo-2.png');
select test_check((select count(*) from storage.objects where bucket_id = 'club-logos') = 0, 'other club sees no files of ours');
delete from storage.objects where bucket_id = 'club-logos' and name like :'org' || '/%';
update orgs set brand_primary = '#000000' where id = :'org';
reset role;
select test_check((select count(*) from storage.objects where bucket_id = 'club-logos') = 1, 'logo file still there');
select test_check((select brand_primary from orgs where id = :'org') = '#d94f1e', 'colours unchanged');

\echo '--- 4. Desk staff can see but not change branding'
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select test_check((select count(*) from storage.objects where bucket_id = 'club-logos') = 1, 'staff see the logo file');
\echo 'expect: desk staff cannot upload a logo'
insert into storage.objects (bucket_id, name) values ('club-logos', :'org' || '/logo-3.png');
delete from storage.objects where bucket_id = 'club-logos';
update orgs set brand_primary = '#000000' where id = :'org';
reset role;
select test_check((select count(*) from storage.objects where bucket_id = 'club-logos') = 1, 'staff delete changed nothing');
select test_check((select brand_primary from orgs where id = :'org') = '#d94f1e', 'staff update changed nothing');

\echo '--- 5. Visitors get the logo and colours from public_club, and nothing else'
set role anon; reset request.jwt.claim.sub;
select test_check(public_club('raccoon')->>'logo_path' = :'org' || '/logo-1.png', 'logo path on the public page');
select test_check(public_club('raccoon')->>'brand_primary' = '#d94f1e', 'primary colour on the public page');
select test_check(public_club('raccoon')->>'brand_secondary' = '#1b3a5c', 'secondary colour on the public page');
select test_check(public_club('chalong')->>'logo_path' is null, 'club without a logo');
select test_check((select count(*) from storage.objects) = 0, 'visitors cannot list storage');
\echo 'expect: visitors cannot upload'
insert into storage.objects (bucket_id, name) values ('club-logos', :'org' || '/logo-4.png');
reset role;

\echo '--- 6. The owner removes the logo'
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
delete from storage.objects where bucket_id = 'club-logos' and name = :'org' || '/logo-1.png';
update orgs set logo_path = null where id = :'org';
reset role;
select test_check((select count(*) from storage.objects where bucket_id = 'club-logos') = 0, 'logo file removed');
\echo '--- done'
