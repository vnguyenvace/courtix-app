-- Step 8: import members from a spreadsheet (Julian, 27 Nov 2026).
-- The app reads the CSV/XLSX file into rows of text (member_imports). import_members() checks
-- every row with the column mapping the owner chose and returns what would happen to each row;
-- with p_commit it imports them, all in one transaction: either every good row goes in or none.
-- Decided with Julian:
--   * Marketing consent comes from a consent column if the file has one (yes/no). Default no.
--   * Imported packages are treated as already paid before Courtix: price_paid 0, so no order
--     to collect and no revenue counted (orders are only made for amounts above 0).
-- Phones are stored as +<country><number> (Thai 08x -> +668x). A phone already used by a member
-- of the club is skipped ("already a member"); the same phone twice in the file is an error.

create table public.member_imports (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  file_name   text check (char_length(file_name) <= 200),
  headers     text[] not null,
  rows        jsonb not null check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) <= 2000),
  imported_at timestamptz,
  result      jsonb,
  created_at  timestamptz not null default now(),
  unique (org_id, id)
);
create index member_imports_org_idx on public.member_imports(org_id, created_at desc);

alter table public.member_imports enable row level security;
create policy member_imports_all on public.member_imports for all to authenticated
  using (public.has_org_permission(org_id, 'club.setup'))
  with check (public.has_org_permission(org_id, 'club.setup'));
grant select, insert, delete on public.member_imports to authenticated;
revoke all on public.member_imports from anon;

-- A date as clubs write it: 2026-12-15, 15/12/2026, 15.12.26, 15 Dec 2026, Buddhist years
-- (15/12/2569), or an Excel day number (46371). Day before month. Null if it can't be read.
create or replace function public.import_date(p text)
returns date language plpgsql immutable set search_path = '' as $$
declare
  t text := btrim(coalesce(p, ''));
  m text[];
  y int;
  d date;
begin
  if t = '' then return null; end if;
  if t ~ '^\d{4,5}(\.0+)?$' and t::numeric between 20000 and 80000 then
    return date '1899-12-30' + floor(t::numeric)::int;          -- Excel day number
  end if;
  m := regexp_match(t, '^(\d{4})-(\d{1,2})-(\d{1,2})');
  if m is not null then
    y := m[1]::int;
    if y > 2400 then y := y - 543; end if;
    return make_date(y, m[2]::int, m[3]::int);
  end if;
  m := regexp_match(t, '^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$');
  if m is not null then
    y := m[3]::int;
    if y < 100 then y := y + case when y > 60 then 2500 else 2000 end; end if;  -- 69 -> 2569 (Buddhist), 26 -> 2026
    if y > 2400 then y := y - 543; end if;
    return make_date(y, m[2]::int, m[1]::int);
  end if;
  begin
    d := to_date(t, 'DD Mon YYYY');
    if extract(year from d) > 2400 then d := d - interval '543 years'; end if;
    return d;
  exception when others then
    return null;
  end;
exception when others then
  return null;
end;
$$;

-- Language names and codes people type -> our codes. Null if not recognised.
create or replace function public.import_language(p text)
returns text language sql immutable set search_path = '' as $$
  select case lower(btrim(coalesce(p, '')))
    when '' then null
    when 'en' then 'en' when 'english' then 'en' when 'eng' then 'en' when 'อังกฤษ' then 'en'
    when 'th' then 'th' when 'thai' then 'th' when 'ไทย' then 'th' when 'ภาษาไทย' then 'th'
    when 'ru' then 'ru' when 'russian' then 'ru' when 'русский' then 'ru' when 'รัสเซีย' then 'ru'
    when 'zh' then 'zh' when 'chinese' then 'zh' when 'mandarin' then 'zh' when '中文' then 'zh' when 'จีน' then 'zh'
    when 'de' then 'de' when 'german' then 'de' when 'deutsch' then 'de'
    when 'fr' then 'fr' when 'french' then 'fr' when 'français' then 'fr'
    when 'ko' then 'ko' when 'korean' then 'ko' when '한국어' then 'ko'
    when 'ja' then 'ja' when 'japanese' then 'ja' when '日本語' then 'ja'
    when 'es' then 'es' when 'spanish' then 'es' when 'español' then 'es'
    when 'it' then 'it' when 'italian' then 'it'
    when 'nl' then 'nl' when 'dutch' then 'nl'
    when 'sv' then 'sv' when 'swedish' then 'sv'
    when 'uk' then 'uk' when 'ukrainian' then 'uk'
    when 'he' then 'he' when 'hebrew' then 'he'
    when 'ar' then 'ar' when 'arabic' then 'ar'
    when 'hi' then 'hi' when 'hindi' then 'hi'
    else null end;
$$;

-- Check (and with p_commit, import) an uploaded file.
-- p_mapping: {"full_name": 0, "first_name": .., "last_name": .., "phone": 2, "email": .., "language": ..,
--   "skill_level": .., "notes": .., "marketing_consent": .., "home_location": .., "package": ..,
--   "starts_on": .., "ends_on": .., "sessions_left": ..} -> column number (0-based); missing = not in the file.
-- p_skip_bad: import the good rows and leave out rows with problems (otherwise problems stop it).
-- Returns {counts: {rows, ok, skip, error}, rows: [{row, status: ok|skip|error, message, name, phone, package}]}.
create or replace function public.import_members(
  p_import uuid, p_mapping jsonb, p_commit boolean default false, p_skip_bad boolean default false
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_imp    public.member_imports;
  v_org    public.orgs;
  v_today  date;
  r        jsonb;
  i        int := 0;
  v_out    jsonb := '[]'::jsonb;
  v_ok     int := 0;
  v_skip   int := 0;
  v_err    int := 0;
  v_seen   jsonb := '{}'::jsonb;    -- phone key -> first row number
  -- one row
  v_problems text[];
  v_notes    text[];
  v_name   text; v_phone text; v_key text; v_email text; v_lang text; v_level numeric; v_note text;
  v_consent boolean; v_loc uuid; v_pkg public.package_types; v_start date; v_end date; v_left int;
  v_raw    text;
  v_existing text;
  v_member uuid;
  v_status public.membership_status;
  v_good   jsonb := '[]'::jsonb;    -- rows to insert
  g        jsonb;

begin
  select * into v_imp from public.member_imports where id = p_import;
  if not found then raise exception 'That upload is gone. Upload the file again'; end if;
  if not public.has_org_permission(v_imp.org_id, 'club.setup') then
    raise exception 'Only the owner or an admin can import members';
  end if;
  if v_imp.imported_at is not null then raise exception 'This file was already imported'; end if;
  if not (p_mapping ? 'full_name' or p_mapping ? 'first_name') then
    raise exception 'Choose which column has the member''s name';
  end if;
  select * into v_org from public.orgs where id = v_imp.org_id;
  v_today := public.org_today(v_org.id);

  for r in select value from jsonb_array_elements(v_imp.rows) loop
    i := i + 1;
    v_problems := '{}'; v_notes := '{}';
    v_name := null; v_phone := null; v_key := null; v_email := null; v_lang := null; v_level := null; v_note := null;
    v_consent := false; v_loc := null; v_pkg := null; v_start := null; v_end := null; v_left := null; v_existing := null;

    -- Name (or first + last name)
    v_name := btrim(regexp_replace(concat_ws(' ',
      nullif(btrim(coalesce(r ->> (p_mapping ->> 'full_name')::int, '')), ''),
      nullif(btrim(coalesce(r ->> (p_mapping ->> 'first_name')::int, '')), ''),
      nullif(btrim(coalesce(r ->> (p_mapping ->> 'last_name')::int, '')), '')), '\s+', ' ', 'g'));
    -- A completely empty line: leave it out quietly.
    if (select bool_and(btrim(coalesce(x, '')) = '') from jsonb_array_elements_text(r) x) then
      continue;
    end if;
    if v_name = '' then v_problems := array_append(v_problems, 'No name');
    elsif char_length(v_name) > 120 then v_problems := array_append(v_problems, 'Name is too long');
    end if;

    -- Phone
    v_raw := btrim(coalesce(r ->> (p_mapping ->> 'phone')::int, ''));
    if v_raw <> '' then
      -- Excel drops the leading 0 of numbers typed as numbers: 812223333 is a Thai mobile.
      v_key := case when regexp_replace(v_raw, '\D', '', 'g') ~ '^[689]\d{8}$' and v_raw !~ '^\s*\+'
                    then '66' || regexp_replace(v_raw, '\D', '', 'g')
                    else public.phone_key(v_raw) end;
      if v_key is null or length(v_key) < 8 or length(v_key) > 15 then
        v_problems := array_append(v_problems, ('Phone number "' || left(v_raw, 30) || '" looks wrong'));
        v_key := null;
      else
        v_phone := '+' || v_key;
        if v_seen ? v_key then
          v_problems := array_append(v_problems, ('Same phone as row ' || (v_seen ->> v_key)));
        else
          v_seen := v_seen || jsonb_build_object(v_key, i);
          select m.full_name into v_existing from public.members m
           where m.org_id = v_org.id and public.phone_key(m.phone) = v_key limit 1;
        end if;
      end if;
    end if;

    -- Email
    v_raw := btrim(coalesce(r ->> (p_mapping ->> 'email')::int, ''));
    if v_raw <> '' then
      if v_raw !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_problems := array_append(v_problems, ('Email "' || left(v_raw, 40) || '" looks wrong'));
      else v_email := lower(v_raw); end if;
    end if;

    -- Language
    v_raw := btrim(coalesce(r ->> (p_mapping ->> 'language')::int, ''));
    v_lang := public.import_language(v_raw);
    if v_raw <> '' and v_lang is null then
      v_notes := array_append(v_notes, ('Language "' || left(v_raw, 20) || '" not recognised, set to ' || v_org.default_language));
    end if;
    v_lang := coalesce(v_lang, v_org.default_language);

    -- Level
    v_raw := btrim(coalesce(r ->> (p_mapping ->> 'skill_level')::int, ''));
    if v_raw <> '' then
      if v_raw ~ '^\d(\.\d+)?$' and v_raw::numeric between 1 and 6 then v_level := round(v_raw::numeric, 1);
      else v_problems := array_append(v_problems, ('Level "' || left(v_raw, 10) || '" should be a number from 1 to 6')); end if;
    end if;

    v_note := nullif(left(btrim(coalesce(r ->> (p_mapping ->> 'notes')::int, '')), 1000), '');

    -- Consent (PDPA): only an explicit yes.
    v_raw := lower(btrim(coalesce(r ->> (p_mapping ->> 'marketing_consent')::int, '')));
    if v_raw in ('yes', 'y', 'true', '1', 'x', '✓', 'ใช่', 'да', '是', 'ok') then v_consent := true;
    elsif v_raw in ('', 'no', 'n', 'false', '0', '-', 'ไม่', 'нет', '否') then v_consent := false;
    else v_problems := array_append(v_problems, ('Consent "' || left(v_raw, 10) || '" should be yes or no'));
    end if;

    -- Home location
    v_raw := btrim(coalesce(r ->> (p_mapping ->> 'home_location')::int, ''));
    if v_raw <> '' then
      select l.id into v_loc from public.locations l
       where l.org_id = v_org.id and lower(l.name) = lower(v_raw) limit 1;
      if v_loc is null then
        v_problems := array_append(v_problems, 'No location called "' || left(v_raw, 40) || '". Yours: '
          || (select string_agg(name, ', ' order by sort_order, name) from public.locations where org_id = v_org.id));
      end if;
    end if;

    -- Package, dates, sessions left
    v_raw := btrim(coalesce(r ->> (p_mapping ->> 'package')::int, ''));
    if v_raw <> '' then
      select * into v_pkg from public.package_types p
       where p.org_id = v_org.id and lower(btrim(p.name)) = lower(v_raw)
       order by p.is_active desc limit 1;
      if v_pkg.id is null then
        v_problems := array_append(v_problems, 'No package called "' || left(v_raw, 60) || '". Yours: '
          || coalesce((select string_agg(name, ', ' order by name) from public.package_types where org_id = v_org.id and is_active), 'none yet'));
      end if;
    end if;
    v_raw := btrim(coalesce(r ->> (p_mapping ->> 'starts_on')::int, ''));
    if v_raw <> '' then
      v_start := public.import_date(v_raw);
      if v_start is null then v_problems := array_append(v_problems, ('Start date "' || left(v_raw, 20) || '" can''t be read (use 15/12/2026)')); end if;
    end if;
    v_raw := btrim(coalesce(r ->> (p_mapping ->> 'ends_on')::int, ''));
    if v_raw <> '' then
      v_end := public.import_date(v_raw);
      if v_end is null then v_problems := array_append(v_problems, ('End date "' || left(v_raw, 20) || '" can''t be read (use 15/12/2026)')); end if;
    end if;
    v_raw := btrim(coalesce(r ->> (p_mapping ->> 'sessions_left')::int, ''));
    if v_raw <> '' then
      if v_raw ~ '^\d+(\.0+)?$' and v_raw::numeric <= 1000 then v_left := v_raw::numeric::int;
      else v_problems := array_append(v_problems, ('Sessions left "' || left(v_raw, 10) || '" should be a whole number')); end if;
    end if;
    if v_pkg.id is null and (v_start is not null or v_end is not null or v_left is not null)
       and btrim(coalesce(r ->> (p_mapping ->> 'package')::int, '')) = '' then
      v_problems := array_append(v_problems, 'Package dates or sessions, but no package');
    end if;
    if v_pkg.id is not null then
      v_start := coalesce(v_start, case when v_end is not null and v_pkg.kind = 'time_based'
                                        then v_end - v_pkg.duration_days + 1 else v_today end);
      if v_pkg.kind = 'time_based' then
        v_end := coalesce(v_end, v_start + v_pkg.duration_days - 1);
        if v_left is not null then v_notes := array_append(v_notes, 'Sessions left ignored (not a class pack)'); v_left := null; end if;
      else
        v_left := coalesce(v_left, v_pkg.sessions);
      end if;
      if v_end is not null and v_end < v_start then v_problems := array_append(v_problems, 'End date is before the start date'); end if;
      if v_end is not null and v_end < v_today then v_notes := array_append(v_notes, 'Package already ended: saved as expired'); end if;
    end if;

    -- Result for this row
    if cardinality(v_problems) > 0 then
      v_err := v_err + 1;
      v_out := v_out || jsonb_build_object('row', i, 'status', 'error', 'message', array_to_string(v_problems, '. '),
                                           'name', v_name, 'phone', v_phone, 'package', v_pkg.name);
    elsif v_existing is not null then
      v_skip := v_skip + 1;
      v_out := v_out || jsonb_build_object('row', i, 'status', 'skip', 'message', 'Already a member (' || v_existing || ')',
                                           'name', v_name, 'phone', v_phone, 'package', v_pkg.name);
    else
      v_ok := v_ok + 1;
      v_out := v_out || jsonb_build_object('row', i, 'status', 'ok', 'message', nullif(array_to_string(v_notes, '. '), ''),
                                           'name', v_name, 'phone', v_phone, 'package', v_pkg.name);
      v_good := v_good || jsonb_build_object(
        'name', v_name, 'phone', v_phone, 'email', v_email, 'language', v_lang, 'level', v_level, 'notes', v_note,
        'consent', v_consent, 'location', v_loc, 'package', v_pkg.id, 'start', v_start, 'end', v_end, 'left', v_left);
    end if;
  end loop;

  if p_commit then
    if v_err > 0 and not p_skip_bad then
      raise exception '% rows have problems. Fix them in the file, or tick "Leave those rows out"', v_err;
    end if;
    if v_ok = 0 then raise exception 'There''s nobody new to import'; end if;
    for g in select value from jsonb_array_elements(v_good) loop
      insert into public.members (org_id, full_name, phone, email, language, skill_level, notes,
                                  marketing_consent, consent_at, home_location_id)
      values (v_org.id, g ->> 'name', g ->> 'phone', g ->> 'email', g ->> 'language', (g ->> 'level')::numeric,
              g ->> 'notes', (g ->> 'consent')::boolean, case when (g ->> 'consent')::boolean then now() end,
              (g ->> 'location')::uuid)
      returning id into v_member;
      if g ->> 'package' is not null then
        v_status := case when (g ->> 'end')::date < v_today then 'expired'
                         when (g ->> 'left')::int = 0 then 'expired'
                         else 'active' end;
        -- Already paid before Courtix: price_paid 0 (no order to collect).
        insert into public.memberships (org_id, member_id, package_type_id, status, starts_on, ends_on, sessions_left, price_paid)
        values (v_org.id, v_member, (g ->> 'package')::uuid, v_status, (g ->> 'start')::date, (g ->> 'end')::date,
                (g ->> 'left')::int, 0);
      end if;
    end loop;
    update public.member_imports
       set imported_at = now(), rows = '[]'::jsonb,   -- the file's contents aren't kept after import
           result = jsonb_build_object('imported', v_ok, 'skipped', v_skip, 'left_out', v_err)
     where id = p_import;
  end if;

  return jsonb_build_object('counts', jsonb_build_object('rows', v_ok + v_skip + v_err, 'ok', v_ok, 'skip', v_skip, 'error', v_err),
                            'rows', v_out);
end;
$$;

grant execute on function public.import_members(uuid, jsonb, boolean, boolean) to authenticated;
revoke execute on function public.import_members(uuid, jsonb, boolean, boolean) from anon, public;
grant execute on function public.import_date(text), public.import_language(text) to authenticated;
revoke execute on function public.import_date(text), public.import_language(text) from anon, public;
