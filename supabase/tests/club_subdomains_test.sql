-- Club subdomains test: run on a FRESH local database after all migrations.
-- Lines labelled "expect:" should produce an error; everything else should succeed.
\set ON_ERROR_STOP 0
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','owner@raccoon'),('22222222-2222-2222-2222-222222222222','owner@other');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo '--- 1. Good links work (and are lowercased)'
select create_org('Raccoon Pickleball', 'Raccoon') as org \gset
select slug = 'raccoon' as lowercased from orgs where id = :'org';
select create_org('Rawai Padel', 'rawai-padel-2') is not null as dashes_and_digits;

\echo '--- 2. Bad links are refused with clear messages'
\echo 'expect: reserved link'
select create_org('Sneaky', 'www');
\echo 'expect: reserved link'
select create_org('Sneaky', 'api');
\echo 'expect: dash at the end'
select create_org('Bad', 'raccoon-');
\echo 'expect: dots would make a deeper subdomain'
select create_org('Bad', 'a.b');
\echo 'expect: one character is too short'
select create_org('Bad', 'x');
\echo 'expect: too long for a subdomain'
select create_org('Bad', repeat('a', 41));
\echo 'expect: already taken'
select create_org('Raccoon Two', 'raccoon');
\echo 'expect: club needs a name'
select create_org('  ', 'nameless');

\echo '--- 3. The table itself refuses reserved or invalid links too'
reset role;
\echo 'expect: table refuses reserved slug'
update orgs set slug = 'admin' where id = :'org';
\echo 'expect: table refuses invalid slug'
update orgs set slug = 'Has Spaces' where id = :'org';
select slug = 'raccoon' as unchanged from orgs where id = :'org';

\echo '--- 4. Anyone can look up a club name by its link (for its sign-in page), nothing more'
set role anon;
select name = 'Raccoon Pickleball' as anon_sees_name from public.club_by_slug('raccoon');
select name = 'Raccoon Pickleball' as case_insensitive from public.club_by_slug(' RACCOON ');
select count(*) = 0 as unknown_is_empty from public.club_by_slug('nope');
\echo 'expect: anon still cannot read orgs directly'
select count(*) from public.orgs;
reset role;

\echo '--- 5. Other clubs still cannot see each other'
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select count(*) = 0 as other_owner_sees_no_orgs from orgs;
select count(*) = 1 as but_lookup_by_link_works from public.club_by_slug('raccoon');
reset role;
