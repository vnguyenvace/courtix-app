-- Locations: one club, several sites. Members and packages belong to the club;
-- courts, sessions, prices and check-ins belong to a site.
-- Packages work at every location unless they're limited to chosen sites.
-- Existing clubs get one location automatically, so nothing changes for single-site clubs.

-- ---------------------------------------------------------------------------
-- Locations
-- ---------------------------------------------------------------------------
create table public.locations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  address      text,
  timezone     text not null default 'Asia/Bangkok',
  opens_at     time not null default '07:00',
  closes_at    time not null default '22:00',
  slot_minutes int  not null default 60 check (slot_minutes between 15 and 240),
  whatsapp     text,
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, name),
  check (closes_at > opens_at)
);

-- Rejects time zone names Postgres doesn't know.
create or replace function public.check_location_timezone()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform now() at time zone new.timezone;
  return new;
exception when others then
  raise exception 'Unknown time zone: %. Use a name like Asia/Bangkok or Asia/Makassar.', new.timezone;
end;
$$;
create trigger locations_check_timezone before insert or update of timezone on public.locations
  for each row execute function public.check_location_timezone();

-- One location for every existing club, using its current hours.
insert into public.locations (org_id, name, timezone, opens_at, closes_at, slot_minutes)
select id, name, timezone, opens_at, closes_at, slot_minutes from public.orgs;

-- New clubs get their first location automatically.
create or replace function public.create_first_location()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.locations (org_id, name, timezone, opens_at, closes_at, slot_minutes)
  values (new.id, new.name, new.timezone, new.opens_at, new.closes_at, new.slot_minutes);
  return new;
end;
$$;
create trigger orgs_create_first_location after insert on public.orgs
  for each row execute function public.create_first_location();

create or replace function public.default_location(p_org uuid)
returns uuid language sql stable set search_path = '' as $$
  select id from public.locations
   where org_id = p_org
   order by is_active desc, sort_order, created_at
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Courts belong to a location. Court names only need to be unique within a site.
-- ---------------------------------------------------------------------------
alter table public.courts add column location_id uuid;
update public.courts set location_id = public.default_location(org_id);
alter table public.courts alter column location_id set not null;
alter table public.courts add constraint courts_location_fk
  foreign key (org_id, location_id) references public.locations(org_id, id) on delete cascade;
alter table public.courts drop constraint courts_org_id_name_key;
alter table public.courts add constraint courts_location_name_key unique (location_id, name);
create index courts_location_idx on public.courts(location_id, sort_order);

create or replace function public.courts_default_location()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.location_id is null then
    new.location_id := public.default_location(new.org_id);
  end if;
  return new;
end;
$$;
create trigger courts_default_location before insert on public.courts
  for each row execute function public.courts_default_location();

-- ---------------------------------------------------------------------------
-- Bookings carry their court's location (kept in sync by trigger).
-- ---------------------------------------------------------------------------
alter table public.bookings add column location_id uuid;
update public.bookings b set location_id = c.location_id from public.courts c where c.id = b.court_id;
alter table public.bookings alter column location_id set not null;
alter table public.bookings add constraint bookings_location_fk
  foreign key (org_id, location_id) references public.locations(org_id, id) on delete cascade;
create index bookings_location_idx on public.bookings(location_id);

create or replace function public.bookings_set_location()
returns trigger language plpgsql set search_path = '' as $$
begin
  select location_id into new.location_id from public.courts where id = new.court_id;
  return new;
end;
$$;
create trigger bookings_set_location before insert or update of court_id on public.bookings
  for each row execute function public.bookings_set_location();

-- ---------------------------------------------------------------------------
-- Timetable and sessions belong to a location.
-- ---------------------------------------------------------------------------
alter table public.session_schedules add column location_id uuid;
update public.session_schedules s
   set location_id = coalesce(
     (select c.location_id from public.courts c where c.id = s.court_ids[1]),
     public.default_location(s.org_id));
alter table public.session_schedules alter column location_id set not null;
alter table public.session_schedules add constraint session_schedules_location_fk
  foreign key (org_id, location_id) references public.locations(org_id, id) on delete cascade;

alter table public.sessions add column location_id uuid;
update public.sessions s
   set location_id = coalesce(
     (select x.location_id from public.session_schedules x where x.id = s.schedule_id),
     (select b.location_id from public.bookings b where b.session_id = s.id limit 1),
     public.default_location(s.org_id));
alter table public.sessions alter column location_id set not null;
alter table public.sessions add constraint sessions_location_fk
  foreign key (org_id, location_id) references public.locations(org_id, id) on delete cascade;
create index sessions_location_time_idx on public.sessions(location_id, starts_at);

create or replace function public.schedules_default_location()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.location_id is null then
    new.location_id := coalesce(
      (select c.location_id from public.courts c where c.id = new.court_ids[1]),
      public.default_location(new.org_id));
  end if;
  return new;
end;
$$;
create trigger session_schedules_default_location before insert on public.session_schedules
  for each row execute function public.schedules_default_location();

create or replace function public.sessions_default_location()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.location_id is null then
    new.location_id := coalesce(
      (select x.location_id from public.session_schedules x where x.id = new.schedule_id),
      public.default_location(new.org_id));
  end if;
  return new;
end;
$$;
create trigger sessions_default_location before insert on public.sessions
  for each row execute function public.sessions_default_location();

-- ---------------------------------------------------------------------------
-- Prices can be per location (null = every location). Location rules win over club-wide ones.
-- ---------------------------------------------------------------------------
alter table public.rate_rules add column location_id uuid;
alter table public.rate_rules add constraint rate_rules_location_fk
  foreign key (org_id, location_id) references public.locations(org_id, id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Packages: valid everywhere (null) or at chosen locations only.
-- ---------------------------------------------------------------------------
alter table public.package_types add column location_ids uuid[];

create or replace function public.check_location_ids()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.location_ids is not null then
    if cardinality(new.location_ids) = 0 then
      new.location_ids := null;  -- none ticked means everywhere
    elsif exists (
      select 1 from unnest(new.location_ids) as l(id)
       where not exists (select 1 from public.locations x where x.id = l.id and x.org_id = new.org_id)
    ) then
      raise exception 'One of the chosen locations doesn''t belong to this club';
    end if;
  end if;
  return new;
end;
$$;
create trigger package_types_check_locations before insert or update of location_ids on public.package_types
  for each row execute function public.check_location_ids();

create or replace function public.package_valid_at(p_location_ids uuid[], p_location uuid)
returns boolean language sql immutable as $$
  select p_location_ids is null or p_location = any (p_location_ids);
$$;

-- ---------------------------------------------------------------------------
-- Members have a home location; check-ins record where they happened.
-- ---------------------------------------------------------------------------
alter table public.members add column home_location_id uuid;
alter table public.members add constraint members_home_location_fk
  foreign key (org_id, home_location_id) references public.locations(org_id, id) on delete set null (home_location_id);

alter table public.check_ins add column location_id uuid;
alter table public.check_ins add constraint check_ins_location_fk
  foreign key (org_id, location_id) references public.locations(org_id, id) on delete set null (location_id);
create index check_ins_location_idx on public.check_ins(location_id, checked_in_at desc);

-- ---------------------------------------------------------------------------
-- Staff can be limited to some locations (null = all). Owners and managers always see everything.
-- ---------------------------------------------------------------------------
alter table public.org_staff add column location_ids uuid[];
create trigger org_staff_check_locations before insert or update of location_ids on public.org_staff
  for each row execute function public.check_location_ids();

create or replace function public.can_use_location(p_org uuid, p_location uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_staff s
     where s.org_id = p_org and s.user_id = auth.uid()
       and (s.role in ('owner', 'manager') or s.location_ids is null
            or p_location is null or p_location = any (s.location_ids))
  );
$$;

-- Everyone on the staff can see every site's calendar; changes need access to that site.
drop policy bookings_all on public.bookings;
create policy bookings_select on public.bookings for select to authenticated
  using (public.is_org_staff(org_id));
create policy bookings_write on public.bookings for insert to authenticated
  with check (public.can_use_location(org_id, location_id));
create policy bookings_update on public.bookings for update to authenticated
  using (public.can_use_location(org_id, location_id))
  with check (public.can_use_location(org_id, location_id));
create policy bookings_delete on public.bookings for delete to authenticated
  using (public.can_use_location(org_id, location_id));

drop policy sessions_update on public.sessions;
create policy sessions_update on public.sessions for update to authenticated
  using (public.can_use_location(org_id, location_id))
  with check (public.can_use_location(org_id, location_id));

drop policy session_regs_all on public.session_registrations;
create policy session_regs_select on public.session_registrations for select to authenticated
  using (public.is_org_staff(org_id));
create policy session_regs_write on public.session_registrations for insert to authenticated
  with check (public.can_use_location(org_id, (select s.location_id from public.sessions s where s.id = session_id)));
create policy session_regs_update on public.session_registrations for update to authenticated
  using (public.can_use_location(org_id, (select s.location_id from public.sessions s where s.id = session_id)))
  with check (public.can_use_location(org_id, (select s.location_id from public.sessions s where s.id = session_id)));
create policy session_regs_delete on public.session_registrations for delete to authenticated
  using (public.can_use_location(org_id, (select s.location_id from public.sessions s where s.id = session_id)));

alter table public.locations enable row level security;
create policy locations_select on public.locations for select to authenticated
  using (public.is_org_staff(org_id));
create policy locations_write on public.locations for all to authenticated
  using (public.has_org_role(org_id, '{owner,manager}'))
  with check (public.has_org_role(org_id, '{owner,manager}'));

-- ---------------------------------------------------------------------------
-- Booking rules now use the court's location: its hours, time zone and prices,
-- and whether the member's package is valid there.
-- ---------------------------------------------------------------------------
drop function public.slot_price(uuid, timestamptz, boolean);
create or replace function public.slot_price(
  p_org uuid, p_start timestamptz, p_is_member boolean, p_location uuid default null
) returns numeric language sql stable set search_path = '' as $$
  select coalesce((
    select case when p_is_member then r.member_price else r.drop_in_price end
      from public.rate_rules r
      cross join lateral (
        select coalesce((select l.timezone from public.locations l where l.id = p_location),
                        (select o.timezone from public.orgs o where o.id = p_org)) as tz
      ) z
     where r.org_id = p_org
       and (r.location_id is null or r.location_id = p_location)
       and extract(dow from (p_start at time zone z.tz))::smallint = any (r.days_of_week)
       and (p_start at time zone z.tz)::time >= r.start_time
       and (p_start at time zone z.tz)::time <  r.end_time
     order by (r.location_id is null), r.priority
     limit 1
  ), 0);
$$;

create or replace function public.create_booking(
  p_court      uuid,
  p_start      timestamptz,
  p_member     uuid default null,
  p_guest_name text default null,
  p_kind       public.booking_kind default null,
  p_minutes    int default null,
  p_notes      text default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_court  public.courts;
  v_org    public.orgs;
  v_loc    public.locations;
  v_kind   public.booking_kind;
  v_mins   int;
  v_local  timestamp;
  v_end    timestamptz;
  v_limit  int;
  v_active int;
  v_valid_here boolean;
  v_valid_elsewhere boolean;
  v_id     uuid;
begin
  select * into v_court from public.courts where id = p_court;
  if not found then raise exception 'Court not found'; end if;
  if not v_court.is_active then raise exception '% is closed for booking', v_court.name; end if;
  select * into v_org from public.orgs where id = v_court.org_id;
  select * into v_loc from public.locations where id = v_court.location_id;
  if not v_loc.is_active then raise exception '% is closed', v_loc.name; end if;

  v_mins  := coalesce(p_minutes, v_loc.slot_minutes);
  v_end   := p_start + make_interval(mins => v_mins);
  v_local := p_start at time zone v_loc.timezone;

  if p_start < now() - interval '5 minutes' then
    raise exception 'That time has already passed';
  end if;
  if v_local::time < v_loc.opens_at or (v_end at time zone v_loc.timezone)::time > v_loc.closes_at
     or (v_end at time zone v_loc.timezone)::date <> v_local::date then
    raise exception 'Bookings at % must be within opening hours (% to %)', v_loc.name,
      to_char(v_loc.opens_at, 'HH24:MI'), to_char(v_loc.closes_at, 'HH24:MI');
  end if;

  -- Does the member have an active package for that day, and is it valid at this location?
  v_valid_here := false;
  v_valid_elsewhere := false;
  if p_member is not null then
    select coalesce(bool_or(public.package_valid_at(pt.location_ids, v_loc.id)), false),
           coalesce(bool_or(not public.package_valid_at(pt.location_ids, v_loc.id)), false)
      into v_valid_here, v_valid_elsewhere
      from public.memberships m
      join public.package_types pt on pt.id = m.package_type_id
     where m.org_id = v_org.id and m.member_id = p_member and m.status = 'active'
       and m.starts_on <= v_local::date
       and (m.ends_on is null or m.ends_on >= v_local::date)
       and (m.sessions_left is null or m.sessions_left > 0);
  end if;

  v_kind := coalesce(p_kind, case when v_valid_here then 'member'::public.booking_kind
                                  else 'drop_in'::public.booking_kind end);

  if v_kind = 'member' then
    if not v_valid_here then
      if v_valid_elsewhere then
        raise exception 'This member''s package isn''t valid at %. Book them as a drop-in instead.', v_loc.name;
      end if;
      raise exception 'This member has no active package for that date';
    end if;

    if v_local::date > (now() at time zone v_loc.timezone)::date + v_org.booking_advance_days then
      raise exception 'Members can book up to % days ahead', v_org.booking_advance_days;
    end if;

    select coalesce(min(pt.max_active_bookings), v_org.max_active_bookings) into v_limit
      from public.memberships m join public.package_types pt on pt.id = m.package_type_id
     where m.org_id = v_org.id and m.member_id = p_member and m.status = 'active';

    -- The limit counts upcoming bookings at every location.
    select count(*) into v_active from public.bookings b
     where b.org_id = v_org.id and b.member_id = p_member
       and b.status = 'confirmed' and upper(b.during) > now();

    if v_active >= v_limit then
      raise exception 'Limit reached: % upcoming bookings allowed at a time', v_limit;
    end if;
  end if;

  insert into public.bookings (org_id, court_id, member_id, guest_name, kind, during, price, notes)
  values (
    v_org.id, v_court.id, p_member, nullif(trim(p_guest_name), ''), v_kind,
    tstzrange(p_start, v_end, '[)'),
    case
      when v_kind in ('member', 'drop_in') then public.slot_price(v_org.id, p_start, v_kind = 'member', v_loc.id)
      else 0
    end,
    p_notes
  ) returning id into v_id;

  return v_id;
exception
  when exclusion_violation then
    raise exception '% is already booked at that time', v_court.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sessions: courts must be at the session's location; generation uses the
-- location's time zone; events take a location.
-- ---------------------------------------------------------------------------
create or replace function public.hold_courts_for_session(p_session uuid, p_courts uuid[])
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_s     public.sessions;
  v_kind  public.booking_kind;
  v_court uuid;
  v_name  text;
  v_clash text[] := '{}';
  v_wrong text[] := '{}';
  v_note  text[] := '{}';
begin
  select * into v_s from public.sessions where id = p_session;
  select public.session_booking_kind(t.category) into v_kind
    from public.session_types t where t.id = v_s.session_type_id;

  foreach v_court in array coalesce(p_courts, '{}') loop
    if not exists (select 1 from public.courts c where c.id = v_court and c.location_id = v_s.location_id) then
      select name into v_name from public.courts where id = v_court;
      v_wrong := v_wrong || coalesce(v_name, 'unknown court');
      continue;
    end if;
    begin
      insert into public.bookings (org_id, court_id, session_id, kind, during, price, notes)
      values (v_s.org_id, v_court, v_s.id, v_kind, tstzrange(v_s.starts_at, v_s.ends_at, '[)'), 0,
              coalesce(v_s.title, (select name from public.session_types where id = v_s.session_type_id)));
    exception when exclusion_violation then
      select name into v_name from public.courts where id = v_court;
      v_clash := v_clash || v_name;
    end;
  end loop;

  if cardinality(v_clash) > 0 then
    v_note := v_note || ('Already booked, not held: ' || array_to_string(v_clash, ', '));
  end if;
  if cardinality(v_wrong) > 0 then
    v_note := v_note || ('At another location, not held: ' || array_to_string(v_wrong, ', '));
  end if;
  return nullif(array_to_string(v_note, '. '), '');
end;
$$;

create or replace function public.generate_sessions(p_org uuid, p_days int default 14)
returns int language plpgsql security invoker set search_path = '' as $$
declare
  v_today   date;
  v_day     date;
  v_start   timestamptz;
  v_id      uuid;
  v_note    text;
  v_created int := 0;
  r         record;
begin
  -- Signed-in users must be managers. No user means the trusted scheduler (pg_cron).
  if auth.uid() is not null and not public.has_org_role(p_org, '{owner,manager}') then
    raise exception 'Only owners and managers can generate sessions';
  end if;

  for r in
    select s.*, l.timezone as tz, t.price, t.duration_minutes, t.min_players, t.max_players, t.level_min, t.level_max
      from public.session_schedules s
      join public.session_types t on t.id = s.session_type_id
      join public.locations l on l.id = s.location_id
     where s.org_id = p_org and s.is_active and t.is_active and l.is_active
  loop
    v_today := (now() at time zone r.tz)::date;
    for v_day in select generate_series(greatest(v_today, r.valid_from),
                                        least(v_today + p_days - 1, coalesce(r.valid_until, v_today + p_days - 1)),
                                        interval '1 day')::date
    loop
      continue when not (extract(dow from v_day)::smallint = any (r.days_of_week));
      v_start := (v_day + r.start_time) at time zone r.tz;
      continue when v_start < now();

      insert into public.sessions (org_id, session_type_id, schedule_id, location_id, starts_at, ends_at, price,
                                   min_players, max_players, level_min, level_max)
      values (p_org, r.session_type_id, r.id, r.location_id, v_start,
              v_start + make_interval(mins => r.duration_minutes),
              r.price, r.min_players, r.max_players, r.level_min, r.level_max)
      on conflict (schedule_id, starts_at) do nothing
      returning id into v_id;

      if v_id is not null then
        v_note := public.hold_courts_for_session(v_id, r.court_ids);
        if v_note is not null then
          update public.sessions set notes = v_note where id = v_id;
        end if;
        v_created := v_created + 1;
        v_id := null;
      end if;
    end loop;
  end loop;

  return v_created;
end;
$$;

drop function public.create_event(uuid, timestamptz, timestamptz, text, numeric, int, int, numeric, numeric, uuid[], text, text);
create or replace function public.create_event(
  p_type        uuid,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_title       text default null,
  p_price       numeric default null,
  p_min_players int default null,
  p_max_players int default null,
  p_level_min   numeric default null,
  p_level_max   numeric default null,
  p_courts      uuid[] default '{}',
  p_description text default null,
  p_coach_name  text default null,
  p_location    uuid default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_t    public.session_types;
  v_loc  uuid;
  v_id   uuid;
  v_note text;
begin
  select * into v_t from public.session_types where id = p_type;
  if not found then raise exception 'Session type not found'; end if;
  if p_ends_at <= p_starts_at then raise exception 'The event must end after it starts'; end if;

  v_loc := coalesce(
    p_location,
    (select c.location_id from public.courts c where c.id = p_courts[1]),
    public.default_location(v_t.org_id));
  if not exists (select 1 from public.locations where id = v_loc and org_id = v_t.org_id) then
    raise exception 'Location not found';
  end if;

  insert into public.sessions (org_id, session_type_id, location_id, title, description, starts_at, ends_at, price,
                               min_players, max_players, level_min, level_max, coach_name)
  values (v_t.org_id, v_t.id, v_loc, nullif(trim(p_title), ''), p_description, p_starts_at, p_ends_at,
          coalesce(p_price, v_t.price),
          coalesce(p_min_players, v_t.min_players), coalesce(p_max_players, v_t.max_players),
          coalesce(p_level_min, v_t.level_min), coalesce(p_level_max, v_t.level_max), p_coach_name)
  returning id into v_id;

  v_note := public.hold_courts_for_session(v_id, p_courts);
  if v_note is not null then
    update public.sessions set notes = v_note where id = v_id;
  end if;
  return v_id;
end;
$$;

-- Attendance records a check-in at the session's location.
create or replace function public.mark_attendance(p_registration uuid, p_attended boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_r public.session_registrations;
begin
  select * into v_r from public.session_registrations where id = p_registration;
  if not found then raise exception 'Sign-up not found'; end if;
  if v_r.status not in ('booked', 'attended', 'no_show') then
    raise exception 'Only booked places can be marked';
  end if;

  update public.session_registrations
     set status = case when p_attended then 'attended'::public.registration_status
                       else 'no_show'::public.registration_status end
   where id = p_registration;

  if p_attended and v_r.status <> 'attended' and v_r.member_id is not null then
    insert into public.check_ins (org_id, member_id, source, location_id)
    values (v_r.org_id, v_r.member_id, 'session',
            (select s.location_id from public.sessions s where s.id = v_r.session_id));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Views: add location columns at the end (existing columns unchanged).
-- ---------------------------------------------------------------------------
create or replace view public.session_overview with (security_invoker = true) as
select
  s.id, s.org_id, s.session_type_id, s.schedule_id,
  coalesce(s.title, t.name) as name,
  t.name as type_name, t.category,
  s.description, s.starts_at, s.ends_at, s.price,
  s.min_players, s.max_players, s.level_min, s.level_max, t.min_age,
  s.coach_name, s.status, s.cancel_reason, s.notes,
  coalesce(rc.booked, 0)     as booked,
  coalesce(rc.waitlisted, 0) as waitlisted,
  greatest(s.max_players - coalesce(rc.booked, 0), 0) as spots_left,
  coalesce(rc.booked, 0) >= s.min_players as min_reached,
  s.starts_at - make_interval(mins => t.book_by_minutes) as book_by,
  (select string_agg(c.name, ', ' order by c.sort_order)
     from public.bookings b join public.courts c on c.id = b.court_id
    where b.session_id = s.id and b.status = 'confirmed') as courts,
  s.location_id,
  l.name as location_name,
  l.timezone as location_timezone
from public.sessions s
join public.session_types t on t.id = s.session_type_id
join public.locations l on l.id = s.location_id
left join (
  select r.session_id,
         count(*) filter (where r.status in ('booked', 'attended')) as booked,
         count(*) filter (where r.status = 'waitlisted') as waitlisted
    from public.session_registrations r
   group by r.session_id
) rc on rc.session_id = s.id;

create or replace view public.sessions_needing_players with (security_invoker = true) as
select o.*
from public.session_overview o
where o.status = 'scheduled'
  and not o.min_reached
  and o.book_by > now()
  and o.starts_at < now() + interval '3 days';

create or replace view public.booking_calendar with (security_invoker = true) as
select
  b.id, b.org_id, b.court_id, c.name as court_name, c.sort_order as court_order,
  b.member_id, m.full_name as member_name, b.guest_name,
  b.kind, b.status, lower(b.during) as start_at, upper(b.during) as end_at,
  b.price, b.notes, b.session_id,
  b.location_id,
  l.name as location_name
from public.bookings b
join public.courts c on c.id = b.court_id
join public.locations l on l.id = b.location_id
left join public.members m on m.id = b.member_id;

-- Side-by-side numbers for each location.
create or replace view public.location_dashboard with (security_invoker = true) as
select
  l.id as location_id, l.org_id, l.name, l.sort_order, l.is_active,
  (select count(*) from public.courts c where c.location_id = l.id and c.is_active) as courts,
  (select count(*) from public.members m where m.home_location_id = l.id) as home_members,
  (select count(*) from public.sessions s
    where s.location_id = l.id and s.status <> 'cancelled'
      and (s.starts_at at time zone l.timezone)::date = (now() at time zone l.timezone)::date) as sessions_today,
  (select count(*) from public.bookings b
    where b.location_id = l.id and b.status = 'confirmed' and b.session_id is null
      and (lower(b.during) at time zone l.timezone)::date = (now() at time zone l.timezone)::date) as bookings_today,
  (select count(distinct c.member_id) from public.check_ins c
    where c.location_id = l.id and c.checked_in_at > now() - interval '30 days') as players_30d,
  (select count(*) from public.check_ins c
    where c.location_id = l.id and c.checked_in_at > now() - interval '30 days') as visits_30d,
  (select round(100.0 * sum(least(o.booked, o.max_players)) / nullif(sum(o.max_players), 0))
     from public.session_overview o
    where o.location_id = l.id and o.status <> 'cancelled'
      and o.starts_at between now() - interval '30 days' and now()) as session_fill_pct_30d,
  (select coalesce(sum(r.price), 0) from public.session_registrations r
     join public.sessions s on s.id = r.session_id
    where s.location_id = l.id and r.status in ('booked', 'attended', 'no_show')
      and s.starts_at between now() - interval '30 days' and now()) as session_revenue_30d,
  (select coalesce(sum(b.price), 0) from public.bookings b
    where b.location_id = l.id and b.status in ('confirmed', 'completed', 'no_show')
      and lower(b.during) between now() - interval '30 days' and now()) as court_revenue_30d
from public.locations l;

-- ---------------------------------------------------------------------------
-- AI follow-ups: suggest sessions at the member's home location first, and say where.
-- ---------------------------------------------------------------------------
create or replace function public.member_session_suggestions(p_member uuid, p_days int default 4, p_limit int default 3)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with m as (
    select id, org_id, skill_level, home_location_id from public.members where id = p_member
  ),
  played as (
    select s.session_type_id, count(*) as n
      from public.session_registrations r
      join public.sessions s on s.id = r.session_id
     where r.member_id = p_member and r.status in ('booked', 'attended')
     group by s.session_type_id
  ),
  usual_place as (
    -- Where they actually play most, if they have no home location set.
    select c.location_id from public.check_ins c
     where c.member_id = p_member and c.location_id is not null
     group by c.location_id order by count(*) desc limit 1
  ),
  picks as (
    select o.id, o.name, o.starts_at, o.price, o.spots_left, o.category, o.location_name, o.location_timezone,
           coalesce(p.n, 0) as played_before,
           o.location_id = coalesce(m.home_location_id, (select location_id from usual_place)) as at_home
      from public.session_overview o
      join m on m.org_id = o.org_id
      left join played p on p.session_type_id = o.session_type_id
     where o.status <> 'cancelled'
       and o.spots_left > 0
       and o.book_by > now()
       and o.starts_at < now() + make_interval(days => p_days)
       and (m.skill_level is null
            or (m.skill_level >= coalesce(o.level_min, 0) and m.skill_level <= coalesce(o.level_max, 9)))
       and (p.n is not null or (o.category in ('open_play', 'match_play', 'clinic') and o.min_age is null))
       and not exists (
         select 1 from public.session_registrations x
          where x.session_id = o.id and x.member_id = p_member and x.status in ('booked', 'waitlisted')
       )
     order by (o.location_id = coalesce(m.home_location_id, (select location_id from usual_place))) desc nulls last,
              coalesce(p.n, 0) desc, o.starts_at
     limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'session_id', p.id,
           'name', p.name,
           'location', p.location_name,
           'when', to_char(p.starts_at at time zone p.location_timezone, 'Dy DD Mon HH24:MI'),
           'price', p.price,
           'spots_left', p.spots_left,
           'played_before', p.played_before > 0
         ) order by p.at_home desc nulls last, p.played_before desc, p.starts_at), '[]'::jsonb)
    from picks p;
$$;

create or replace function public.followup_candidates(p_org uuid, p_limit int default 20)
returns table (member_id uuid, reason public.followup_reason, language text, phone text, context jsonb)
language sql stable security invoker set search_path = '' as $$
  with o as (
    select * from public.orgs where id = p_org
  ),
  flagged as (
    select s.*, 'renewal'::public.followup_reason as reason, 1 as priority
      from public.member_status s where s.org_id = p_org and s.is_renewing_soon
    union all
    select s.*, 'at_risk'::public.followup_reason, 2
      from public.member_status s where s.org_id = p_org and s.is_at_risk and not s.is_renewing_soon
    union all
    select s.*, 'drop_in_lead'::public.followup_reason, 3
      from public.member_status s where s.org_id = p_org and s.is_drop_in_lead
  )
  select
    f.member_id,
    f.reason,
    f.language,
    coalesce(m.whatsapp, m.phone),
    jsonb_strip_nulls(jsonb_build_object(
      'reason', f.reason,
      'first_name', split_part(f.full_name, ' ', 1),
      'language', f.language,
      'package', f.package_name,
      'package_ends', to_char(f.ends_on, 'Dy DD Mon'),
      'days_until_package_ends', f.days_to_expiry,
      'sessions_left', f.sessions_left,
      'days_since_last_visit', f.days_since_visit,
      'never_visited', f.last_check_in is null,
      'usual_play_time', m.usual_play_time,
      'skill_level', m.skill_level,
      'member_notes', m.notes,
      'member_since', to_char(m.created_at at time zone o.timezone, 'Mon YYYY'),
      'home_location', (select l.name from public.locations l where l.id = m.home_location_id),
      'club_locations', (select jsonb_agg(l.name order by l.sort_order) from public.locations l
                          where l.org_id = p_org and l.is_active),
      'suggested_sessions', public.member_session_suggestions(f.member_id),
      'packages_for_sale', (
        select jsonb_agg(jsonb_build_object(
                 'name', p.name, 'price', p.price,
                 'valid_at', case when p.location_ids is null then 'all locations'
                                  else (select string_agg(l.name, ', ') from public.locations l
                                         where l.id = any (p.location_ids)) end)
               order by p.price)
          from public.package_types p where p.org_id = p_org and p.is_active
      )
    ))
  from flagged f
  join public.members m on m.id = f.member_id
  cross join o
  where m.marketing_consent
    and not exists (
      select 1 from public.ai_messages a
       where a.member_id = f.member_id
         and a.reason = f.reason
         and (a.status = 'draft'
              or (a.status = 'sent' and a.sent_at > now() - make_interval(days => o.followup_cooldown_days)))
    )
  order by f.priority, f.days_to_expiry nulls last, f.days_since_visit desc nulls last
  limit p_limit;
$$;

create or replace function public.fill_session_candidates(p_session uuid, p_limit int default 6)
returns table (member_id uuid, language text, phone text, context jsonb)
language sql stable security invoker set search_path = '' as $$
  with s as (
    select v.*, org.followup_cooldown_days
      from public.session_overview v join public.orgs org on org.id = v.org_id
     where v.id = p_session
  ),
  history as (
    select r.member_id, count(*) as same_type_played
      from public.session_registrations r
      join public.sessions x on x.id = r.session_id
      join s on s.session_type_id = x.session_type_id
     where r.status in ('booked', 'attended')
     group by r.member_id
  ),
  plays_here as (
    select c.member_id, count(*) as visits
      from public.check_ins c join s on s.location_id = c.location_id
     group by c.member_id
  )
  select
    m.id,
    m.language,
    coalesce(m.whatsapp, m.phone),
    jsonb_strip_nulls(jsonb_build_object(
      'reason', 'fill_session',
      'first_name', split_part(m.full_name, ' ', 1),
      'language', m.language,
      'usual_play_time', m.usual_play_time,
      'skill_level', m.skill_level,
      'played_this_session_type_before', coalesce(h.same_type_played, 0) > 0,
      'package', ms.package_name,
      'session', jsonb_build_object(
        'session_id', s.id,
        'name', s.name,
        'location', s.location_name,
        'when', to_char(s.starts_at at time zone s.location_timezone, 'Dy DD Mon HH24:MI'),
        'price', s.price,
        'spots_left', s.spots_left,
        'players_still_needed', greatest(s.min_players - s.booked, 0),
        'coach', s.coach_name,
        'description', s.description
      )
    ))
  from s
  join public.members m on m.org_id = s.org_id
  left join history h on h.member_id = m.id
  left join plays_here ph on ph.member_id = m.id
  left join public.member_status ms on ms.member_id = m.id
  where m.marketing_consent
    and (m.skill_level is null
         or (m.skill_level >= coalesce(s.level_min, 0) and m.skill_level <= coalesce(s.level_max, 9)))
    and (s.min_age is null or h.same_type_played is not null)
    -- Members based at another site are only invited if they've played at this one.
    and (m.home_location_id is null or m.home_location_id = s.location_id or ph.visits is not null)
    and not exists (
      select 1 from public.session_registrations r
       where r.session_id = s.id and r.member_id = m.id and r.status in ('booked', 'waitlisted', 'attended')
    )
    and not exists (
      select 1 from public.ai_messages a
       where a.member_id = m.id
         and (a.session_id = s.id
              or (a.status = 'sent' and a.sent_at > now() - interval '2 days'))
    )
  order by (m.home_location_id = s.location_id) desc nulls last,
           coalesce(ph.visits, 0) desc,
           coalesce(h.same_type_played, 0) desc,
           ms.days_since_visit asc nulls last,
           m.full_name
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.locations to authenticated;
grant select on public.session_overview, public.sessions_needing_players, public.booking_calendar,
  public.location_dashboard to authenticated;
grant execute on function
  public.slot_price(uuid, timestamptz, boolean, uuid),
  public.create_event(uuid, timestamptz, timestamptz, text, numeric, int, int, numeric, numeric, uuid[], text, text, uuid),
  public.can_use_location(uuid, uuid),
  public.default_location(uuid),
  public.package_valid_at(uuid[], uuid)
to authenticated;
revoke all on public.locations, public.location_dashboard, public.session_overview,
  public.sessions_needing_players, public.booking_calendar from anon;
revoke execute on function
  public.slot_price(uuid, timestamptz, boolean, uuid),
  public.create_event(uuid, timestamptz, timestamptz, text, numeric, int, int, numeric, numeric, uuid[], text, text, uuid),
  public.can_use_location(uuid, uuid),
  public.default_location(uuid),
  public.create_first_location()
from anon, public;

-- ---------------------------------------------------------------------------
-- Raccoon demo, location-aware: their venue becomes the first location.
-- ---------------------------------------------------------------------------
create or replace function public.load_raccoon_demo(p_org uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_tz      text;
  v_loc     uuid;
  v_c       uuid[] := '{}';
  v_tennis  uuid;
  v_id      uuid;
  v_open    uuid;
  v_adult   uuid;
  v_kids    uuid;
  v_match   uuid;
  v_camp    uuid;
  v_course  uuid;
  v_year    int;
  v_created int;
  i         int;
  r         record;
begin
  if not public.has_org_role(p_org, '{owner,manager}') then
    raise exception 'Only owners and managers can load the demo timetable';
  end if;
  if exists (select 1 from public.session_types where org_id = p_org) then
    raise exception 'This club already has session types. The demo timetable is for a fresh club.';
  end if;

  update public.orgs set opens_at = '08:00', closes_at = '22:00', timezone = 'Asia/Bangkok', currency = 'THB'
   where id = p_org;

  -- Their home venue becomes the club's first location.
  v_loc := public.default_location(p_org);
  update public.locations
     set name = 'The Peak Racquet Park', address = 'Si Sunthon, Thalang, Phuket',
         opens_at = '08:00', closes_at = '22:00', timezone = 'Asia/Bangkok', whatsapp = '+66 65 650 5195'
   where id = v_loc
  returning timezone into v_tz;

  -- Courts: four covered pickleball courts plus a tennis court for match play.
  for i in 1..4 loop
    select id into v_id from public.courts where location_id = v_loc and name = 'Court ' || i;
    if v_id is null then
      insert into public.courts (org_id, location_id, name, is_covered, sort_order)
      values (p_org, v_loc, 'Court ' || i, true, i) returning id into v_id;
    else
      update public.courts set is_covered = true, is_active = true where id = v_id;
    end if;
    v_c := v_c || v_id;
    v_id := null;
  end loop;
  insert into public.courts (org_id, location_id, name, is_covered, sort_order)
  values (p_org, v_loc, 'Tennis court', false, 10)
  on conflict (location_id, name) do update set is_active = true
  returning id into v_tennis;

  -- Court rental: 600 per hour for everyone.
  delete from public.rate_rules where org_id = p_org;
  insert into public.rate_rules (org_id, label, start_time, end_time, drop_in_price, member_price, priority)
  values (p_org, 'Court rental', '08:00', '22:00', 600, 600, 10);

  -- Packages from the flyers. The starter packages are hidden, not deleted.
  update public.package_types set is_active = false where org_id = p_org;
  insert into public.package_types (org_id, name, kind, duration_days, sessions, price) values
    (p_org, 'Unlimited evenings (30 days)',          'time_based', 30, null, 3500),
    (p_org, 'Unlimited any session (30 days)',       'time_based', 30, null, 4000),
    (p_org, 'Match play mornings: buy 10 get 1 free', 'class_pack', null, 11, 4500),
    (p_org, 'Match play nights: buy 10 get 1 free',   'class_pack', null, 11, 3800);

  -- Session types
  insert into public.session_types (org_id, name, category, description, price, duration_minutes,
                                    min_players, max_players, min_age, book_by_minutes, min_check_hours)
  values (p_org, 'Open play', 'open_play',
          'Social doubles on covered courts. Come alone or with friends. All levels welcome. Balls provided; bring your own paddle or hire one on site.',
          350, 180, 4, 16, null, 60, 3)
  returning id into v_open;

  insert into public.session_types (org_id, name, category, description, price, duration_minutes,
                                    min_players, max_players, book_by_minutes, min_check_hours)
  values (p_org, 'Adult clinic', 'clinic',
          'A coached hour for beginners and improvers: drills on basic technique and tactics, plus game rules, followed by guided play.',
          500, 60, 2, 8, 60, 3)
  returning id into v_adult;

  insert into public.session_types (org_id, name, category, description, price, duration_minutes,
                                    min_players, max_players, min_age, book_by_minutes, min_check_hours)
  values (p_org, 'Kids clinic', 'clinic',
          'A coached hour for juniors: basic technique, fun games and small groups. Age 8+.',
          600, 60, 2, 6, 8, 60, 3)
  returning id into v_kids;

  insert into public.session_types (org_id, name, category, description, price, duration_minutes,
                                    min_players, max_players, level_min, book_by_minutes, min_check_hours)
  values (p_org, 'Social match play (tennis)', 'match_play',
          'Intermediate to advanced match play. Mornings 450, nights 380 per session.',
          450, 120, 4, 8, 3.5, 120, 6)
  returning id into v_match;

  insert into public.session_types (org_id, name, category, description, price, duration_minutes,
                                    min_players, max_players, book_by_minutes, min_check_hours)
  values (p_org, 'Camp', 'camp', 'Two-hour coaching camp with a visiting coach.', 3300, 120, 4, 12, 0, 24)
  returning id into v_camp;

  insert into public.session_types (org_id, name, category, description, price, duration_minutes,
                                    min_players, max_players, book_by_minutes, min_check_hours)
  values (p_org, 'Coaching course', 'course', 'Certification course.', 0, 480, 6, 30, 0, 48)
  returning id into v_course;

  -- Weekly timetable. Court plan: open play on courts 1–2, clinics on court 3.
  insert into public.session_schedules (org_id, session_type_id, days_of_week, start_time, court_ids) values
    (p_org, v_open,  '{0,1,2,3,4,5,6}', '08:30', array[v_c[1], v_c[2]]),
    (p_org, v_open,  '{0,1,2,3,4,5,6}', '18:00', array[v_c[1], v_c[2]]),
    (p_org, v_adult, '{1,2,3,4,5}',     '09:00', array[v_c[3]]),
    (p_org, v_adult, '{1,2,3,4,5,6}',   '17:00', array[v_c[3]]),
    (p_org, v_kids,  '{1,2,3,4,5,6}',   '16:00', array[v_c[3]]),
    (p_org, v_kids,  '{6}',             '09:00', array[v_c[3]]),
    (p_org, v_match, '{2,4}',           '09:00', array[v_tennis]);

  -- Thursday-night match play is cheaper, so it gets its own schedule entry and price.
  insert into public.session_types (org_id, name, category, description, price, duration_minutes,
                                    min_players, max_players, level_min, book_by_minutes, min_check_hours)
  values (p_org, 'Social match play night (tennis)', 'match_play',
          'Intermediate to advanced match play under lights.', 380, 120, 4, 8, 3.5, 120, 6)
  returning id into v_id;
  insert into public.session_schedules (org_id, session_type_id, days_of_week, start_time, court_ids)
  values (p_org, v_id, '{4}', '19:00', array[v_tennis]);

  v_created := public.generate_sessions(p_org, 14);

  -- One-off events from the flyers (only those still in the future).
  v_year := extract(year from public.org_today(p_org))::int;
  for r in select * from (values
      (make_date(v_year, 11, 21), time '12:00', time '14:00', 'Coach Kimo camp: kids',           null::numeric, null::numeric),
      (make_date(v_year, 11, 21), time '14:00', time '16:00', 'Coach Kimo camp: 3.0–3.5',         3.0, 3.5),
      (make_date(v_year, 11, 21), time '18:00', time '20:00', 'Coach Kimo camp: 3.5–4.0',         3.5, 4.0),
      (make_date(v_year, 11, 23), time '13:00', time '15:00', 'Coach Kimo Championship Edge camp: 4.0–4.5', 4.0, 4.5)
    ) as t(d, s, e, title, lmin, lmax)
  loop
    if (r.d + r.s) at time zone v_tz > now() then
      perform public.create_event(
        v_camp, (r.d + r.s) at time zone v_tz, (r.d + r.e) at time zone v_tz, r.title,
        2500, 4, 12, r.lmin, r.lmax, array[v_c[4]],
        'Coach Kimo, IPTPA Master Teaching Professional. Early bird 2,500 until 15 Nov, then 3,300. Start time is a placeholder.',
        'Coach Kimo');
    end if;
  end loop;

  if (make_date(v_year, 11, 28) + time '09:00') at time zone v_tz > now() then
    perform public.create_event(
      v_course,
      (make_date(v_year, 11, 28) + time '09:00') at time zone v_tz,
      (make_date(v_year, 11, 29) + time '17:00') at time zone v_tz,
      'IPTPA certified coach workshop', 0, 6, 30, null, null, '{}',
      'Become an IPTPA certified pickleball coach. Register online at iptpa.com and finish the online course first, then attend this 2-day on-court workshop. Limited to 30 spots. Price to confirm.',
      null);
  end if;

  return format('Loaded the timetable: %s sessions over the next 14 days, plus upcoming camps and events.', v_created);
end;
$$;

