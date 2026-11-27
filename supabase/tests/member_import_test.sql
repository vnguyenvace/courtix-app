-- Member import test. Run on a FRESH local database after all migrations.
-- Lines labelled "expect:" should produce an error; everything else should succeed.
\set ON_ERROR_STOP 0
create function public.test_check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'CHECK FAILED: %', what; end if;
  return 'ok: ' || what;
end $$;
grant execute on function public.test_check(boolean, text) to anon, authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111','owner@raccoon.test', now()),
  ('22222222-2222-2222-2222-222222222222','owner@padel.test', now()),
  ('33333333-3333-3333-3333-333333333333','desk@raccoon.test', now());
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_org('Raccoon Pickleball','raccoon') as org \gset
select load_raccoon_demo(:'org');
insert into members (org_id, full_name, phone) values (:'org', 'Existing Eve', '081-111-2222');
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_org('Chalong Padel','chalong') as org2 \gset
reset role;
insert into org_staff (org_id, user_id, role) values (:'org', '33333333-3333-3333-3333-333333333333', 'front_desk');
set role authenticated;

\echo '--- 1. Reading dates and languages'
select test_check(import_date('2026-12-15') = date '2026-12-15', 'ISO date');
select test_check(import_date('15/12/2026') = date '2026-12-15', 'day first');
select test_check(import_date('15.12.26') = date '2026-12-15', 'short year');
select test_check(import_date('15/12/2569') = date '2026-12-15', 'Buddhist year');
select test_check(import_date('15/12/69') = date '2026-12-15', 'short Buddhist year');
select test_check(import_date('46371') = date '2026-12-15', 'Excel day number');
select test_check(import_date('15 Dec 2026') = date '2026-12-15', 'month name');
select test_check(import_date('31/02/2026') is null and import_date('soon') is null, 'nonsense gives null');
select test_check(import_language('Thai') = 'th' and import_language('русский') = 'ru' and import_language('Klingon') is null, 'languages');

\echo '--- 2. A 200-row file with problems: nothing is imported until they are fixed or left out'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
-- Columns: Name, Mobile, Email, Lang, Package, Start, End, Credits, Consent, Location
insert into member_imports (org_id, file_name, headers, rows)
select :'org', 'members.xlsx',
  array['Name','Mobile','Email','Lang','Package','Start','End','Credits','Consent','Location'],
  jsonb_agg(r order by n)
from (
  select n, case
    when n = 1 then jsonb_build_array('Anna Becker', '+49 151 2345 6703', 'anna@example.com', 'German', 'Unlimited evenings (30 days)', '01/12/2026', '', '', 'yes', '')
    when n = 2 then jsonb_build_array('Somchai Jaidee', '089-123-4567', '', 'ไทย', '10-session pack', '', '', '7', 'no', '')
    when n = 3 then jsonb_build_array('', '0812223333', '', '', '', '', '', '', '', '')                       -- no name
    when n = 4 then jsonb_build_array('Bad Phone', '12', '', '', '', '', '', '', '', '')                       -- phone
    when n = 5 then jsonb_build_array('Twin', '089-123-4567', '', '', '', '', '', '', '', '')                  -- same phone as row 2
    when n = 6 then jsonb_build_array('Eve Again', '+66 81 111 2222', '', '', '', '', '', '', '', '')         -- already a member
    when n = 7 then jsonb_build_array('No Package', '0815556666', '', '', 'Platinum VIP', '', '', '', '', '')  -- unknown package
    when n = 8 then jsonb_build_array('Bad Date', '0815557777', '', '', 'Unlimited evenings (30 days)', 'next week', '', '', '', '')
    when n = 9 then jsonb_build_array('Old Pack', '0815558888', '', 'Klingon', 'Unlimited evenings (30 days)', '01/01/2026', '30/01/2026', '', '', '')
    when n = 10 then jsonb_build_array('', '', '', '', '', '', '', '', '', '')                                -- empty line
    when n = 11 then jsonb_build_array('Excel Phone', '812224444', '', '', '', '', '', '', '', '')             -- lost its 0
    else jsonb_build_array('Player ' || n, '08' || lpad((70000000 + n)::text, 8, '0'), '', 'en', '', '', '', '', '', '')
  end as r
  from generate_series(1, 200) n
) x
returning id as imp \gset

-- The owner maps the columns (column numbers start at 0).
select '{"full_name":0,"phone":1,"email":2,"language":3,"package":4,"starts_on":5,"ends_on":6,"sessions_left":7,"marketing_consent":8,"home_location":9}' as map \gset
select import_members(:'imp', :'map'::jsonb) as check1 \gset
select test_check((:'check1'::jsonb->'counts'->>'rows')::int = 199, '199 rows (the empty line is left out quietly)');
select test_check((:'check1'::jsonb->'counts'->>'error')::int = 5, '5 rows with problems');
select test_check((:'check1'::jsonb->'counts'->>'skip')::int = 1, '1 already a member');
select test_check((:'check1'::jsonb->'counts'->>'ok')::int = 193, '193 good rows');
select test_check((select r->>'message' from jsonb_array_elements(:'check1'::jsonb->'rows') r where (r->>'row')::int = 5) = 'Same phone as row 2', 'duplicate phone named');
select test_check((select r->>'message' like 'No package called "Platinum VIP". Yours:%' from jsonb_array_elements(:'check1'::jsonb->'rows') r where (r->>'row')::int = 7), 'unknown package lists the real ones');
select test_check((select r->>'message' like '%already ended%' and r->>'message' like '%Klingon%' from jsonb_array_elements(:'check1'::jsonb->'rows') r where (r->>'row')::int = 9), 'notes on an OK row');
select test_check((select count(*) from members where org_id = :'org') = 1, 'checking imports nothing');
\echo 'expect: problems stop the import'
select import_members(:'imp', :'map'::jsonb, true);
select test_check((select count(*) from members where org_id = :'org') = 1, 'no partial import');

\echo '--- 3. Leave the bad rows out: everything else goes in, in one go'
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo 'expect: front desk cannot import'
select import_members(:'imp', :'map'::jsonb, true, true);
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo 'expect: another club cannot see the upload'
select import_members(:'imp', :'map'::jsonb, true, true);
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select (import_members(:'imp', :'map'::jsonb, true, true))->'counts' as done \gset
select test_check((select count(*) from members where org_id = :'org') = 194, '193 new members + Eve');
select test_check((select phone = '+66891234567' and language = 'th' and not marketing_consent from members where full_name = 'Somchai Jaidee'), 'Thai phone stored as +66, language, no consent');
select test_check((select phone = '+66812224444' from members where full_name = 'Excel Phone'), 'Thai mobile without its 0 (Excel)');
select test_check((select marketing_consent and consent_at is not null and language = 'de' and email = 'anna@example.com' from members where full_name = 'Anna Becker'), 'consent from the column');
select test_check((select m.starts_on = date '2026-12-01' and m.ends_on = date '2026-12-30' and m.price_paid = 0 and m.status = 'active'
                   from memberships m join members x on x.id = m.member_id where x.full_name = 'Anna Becker'), 'time package: end from its length, paid before');
select test_check((select m.sessions_left = 7 and m.ends_on is null from memberships m join members x on x.id = m.member_id where x.full_name = 'Somchai Jaidee'), 'class pack: sessions left from the file');
select test_check((select m.status = 'expired' from memberships m join members x on x.id = m.member_id where x.full_name = 'Old Pack'), 'ended package saved as expired');
select test_check(not exists (select 1 from orders where org_id = :'org'), 'imported packages create nothing to pay');
select test_check((select imported_at is not null and rows = '[]'::jsonb and (result->>'imported')::int = 193 from member_imports where id = :'imp'), 'upload marked done, contents not kept');
\echo 'expect: the same upload cannot be imported twice'
select import_members(:'imp', :'map'::jsonb, true, true);

\echo '--- 4. Mapping first + last name; a second file skips people already in'
insert into member_imports (org_id, headers, rows) values (:'org', array['First','Last','Tel'],
  '[["Mai","Srisuk","0899990000"],["Player","Twelve","0870000012"]]'::jsonb) returning id as imp2 \gset
\echo 'expect: a name column is needed'
select import_members(:'imp2', '{"phone":2}'::jsonb);
select test_check((select (import_members(:'imp2', '{"first_name":0,"last_name":1,"phone":2}'::jsonb))->'counts' = '{"ok":1,"rows":2,"skip":1,"error":0}'::jsonb), 'first + last name; row 2 already imported');
\echo '--- done'
