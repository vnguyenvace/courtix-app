-- Sessions: open play, clinics, match play, camps, tournaments, courses.
-- A session has spots that people sign up for (unlike a court booking, which is the whole court).
-- Regular sessions come from a weekly schedule; one-off events are created directly.

create type public.session_category as enum ('open_play', 'clinic', 'match_play', 'camp', 'tournament', 'course', 'other');
create type public.session_status as enum ('scheduled', 'confirmed', 'cancelled');
create type public.registration_status as enum ('booked', 'waitlisted', 'cancelled', 'attended', 'no_show');

-- Check-ins can now come from a session too.
alter table public.check_ins drop constraint check_ins_source_check;
alter table public.check_ins add constraint check_ins_source_check
  check (source in ('desk', 'qr', 'booking', 'session', 'import'));

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.session_types (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  name                text not null,                      -- 'Open play', 'Adult clinic'
  category            public.session_category not null default 'open_play',
  description         text,
  price               numeric(10,2) not null default 0,   -- per person, drop-in
  duration_minutes    int not null default 60 check (duration_minutes between 15 and 1440),
  min_players         int not null default 1 check (min_players >= 1),
  max_players         int not null default 8,
  min_age             int check (min_age between 3 and 99),
  level_min           numeric(2,1) check (level_min between 1 and 6),
  level_max           numeric(2,1) check (level_max between 1 and 6),
  book_by_minutes     int not null default 60 check (book_by_minutes >= 0),  -- sign-ups close this long before start
  min_check_hours     int not null default 3 check (min_check_hours >= 0),   -- go / no-go decision this long before start
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (org_id, id),
  check (max_players >= min_players),
  check (level_max is null or level_min is null or level_max >= level_min)
);

create table public.session_schedules (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  session_type_id uuid not null,
  days_of_week    smallint[] not null,         -- 0 = Sunday
  start_time      time not null,
  court_ids       uuid[] not null default '{}', -- courts held while the session runs
  valid_from      date not null default current_date,
  valid_until     date,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, session_type_id) references public.session_types(org_id, id) on delete cascade,
  check (cardinality(days_of_week) > 0),
  check (valid_until is null or valid_until >= valid_from)
);

create table public.sessions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  session_type_id uuid not null,
  schedule_id     uuid references public.session_schedules(id) on delete set null,
  title           text,                         -- overrides the type name, e.g. 'Coach Kimo camp: 3.0–3.5'
  description     text,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  price           numeric(10,2) not null default 0,
  min_players     int not null default 1,
  max_players     int not null default 8,
  level_min       numeric(2,1),
  level_max       numeric(2,1),
  coach_name      text,                         -- replaced by a coaches table in a later step
  status          public.session_status not null default 'scheduled',
  cancel_reason   text,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (org_id, id),
  unique (schedule_id, starts_at),
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, session_type_id) references public.session_types(org_id, id) on delete cascade,
  check (ends_at > starts_at),
  check (max_players >= min_players)
);
create index sessions_org_time_idx on public.sessions(org_id, starts_at);

create table public.session_registrations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  session_id  uuid not null,
  member_id   uuid,
  guest_name  text,
  guest_phone text,
  status      public.registration_status not null default 'booked',
  price       numeric(10,2) not null default 0,
  notes       text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, session_id) references public.sessions(org_id, id) on delete cascade,
  foreign key (org_id, member_id) references public.members(org_id, id) on delete set null (member_id),
  check (member_id is not null or guest_name is not null)
);
create index session_regs_session_idx on public.session_registrations(session_id, status, created_at);
create index session_regs_member_idx on public.session_registrations(org_id, member_id);
-- A member can only hold one live place per session.
create unique index session_regs_one_live_per_member
  on public.session_registrations(session_id, member_id)
  where member_id is not null and status in ('booked', 'waitlisted');

-- Courts held by a session show on the court calendar.
alter table public.bookings add column session_id uuid;
alter table public.bookings add constraint bookings_session_fk
  foreign key (org_id, session_id) references public.sessions(org_id, id) on delete cascade;
create index bookings_session_idx on public.bookings(session_id);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.session_types         enable row level security;
alter table public.session_schedules     enable row level security;
alter table public.sessions              enable row level security;
alter table public.session_registrations enable row level security;

create policy session_types_select on public.session_types for select to authenticated
  using (public.is_org_staff(org_id));
create policy session_types_write on public.session_types for all to authenticated
  using (public.has_org_role(org_id, '{owner,manager}'))
  with check (public.has_org_role(org_id, '{owner,manager}'));

create policy session_schedules_select on public.session_schedules for select to authenticated
  using (public.is_org_staff(org_id));
create policy session_schedules_write on public.session_schedules for all to authenticated
  using (public.has_org_role(org_id, '{owner,manager}'))
  with check (public.has_org_role(org_id, '{owner,manager}'));

-- Desk staff run sessions day to day (sign-ups, cancellations); managers create and price them.
create policy sessions_select on public.sessions for select to authenticated
  using (public.is_org_staff(org_id));
create policy sessions_insert on public.sessions for insert to authenticated
  with check (public.has_org_role(org_id, '{owner,manager}'));
create policy sessions_update on public.sessions for update to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));
create policy sessions_delete on public.sessions for delete to authenticated
  using (public.has_org_role(org_id, '{owner,manager}'));

create policy session_regs_all on public.session_registrations for all to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.session_booking_kind(p_category public.session_category)
returns public.booking_kind language sql immutable as $$
  select case when p_category in ('open_play', 'match_play') then 'open_play'::public.booking_kind
              else 'coaching'::public.booking_kind end;
$$;

-- Holds courts for a session. Returns a note listing courts that were already taken.
create or replace function public.hold_courts_for_session(p_session uuid, p_courts uuid[])
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_s     public.sessions;
  v_kind  public.booking_kind;
  v_court uuid;
  v_name  text;
  v_clash text[] := '{}';
begin
  select * into v_s from public.sessions where id = p_session;
  select public.session_booking_kind(t.category) into v_kind
    from public.session_types t where t.id = v_s.session_type_id;

  foreach v_court in array coalesce(p_courts, '{}') loop
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
    return 'Already booked, not held: ' || array_to_string(v_clash, ', ');
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Creating sessions
-- ---------------------------------------------------------------------------

-- Turns weekly schedules into real sessions for the next p_days days. Safe to run repeatedly.
create or replace function public.generate_sessions(p_org uuid, p_days int default 14)
returns int language plpgsql security invoker set search_path = '' as $$
declare
  v_tz      text;
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
  select timezone into v_tz from public.orgs where id = p_org;
  v_today := public.org_today(p_org);

  for r in
    select s.*, t.price, t.duration_minutes, t.min_players, t.max_players, t.level_min, t.level_max
      from public.session_schedules s
      join public.session_types t on t.id = s.session_type_id
     where s.org_id = p_org and s.is_active and t.is_active
  loop
    for v_day in select generate_series(greatest(v_today, r.valid_from),
                                        least(v_today + p_days - 1, coalesce(r.valid_until, v_today + p_days - 1)),
                                        interval '1 day')::date
    loop
      continue when not (extract(dow from v_day)::smallint = any (r.days_of_week));
      v_start := (v_day + r.start_time) at time zone v_tz;
      continue when v_start < now();

      insert into public.sessions (org_id, session_type_id, schedule_id, starts_at, ends_at, price,
                                   min_players, max_players, level_min, level_max)
      values (p_org, r.session_type_id, r.id, v_start, v_start + make_interval(mins => r.duration_minutes),
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

-- One-off events: camps, tournaments, courses, special sessions.
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
  p_coach_name  text default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_t    public.session_types;
  v_id   uuid;
  v_note text;
begin
  select * into v_t from public.session_types where id = p_type;
  if not found then raise exception 'Session type not found'; end if;
  if p_ends_at <= p_starts_at then raise exception 'The event must end after it starts'; end if;

  insert into public.sessions (org_id, session_type_id, title, description, starts_at, ends_at, price,
                               min_players, max_players, level_min, level_max, coach_name)
  values (v_t.org_id, v_t.id, nullif(trim(p_title), ''), p_description, p_starts_at, p_ends_at,
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

-- ---------------------------------------------------------------------------
-- Sign-ups
-- ---------------------------------------------------------------------------
create or replace function public.register_for_session(
  p_session     uuid,
  p_member      uuid default null,
  p_guest_name  text default null,
  p_guest_phone text default null,
  p_allow_late  boolean default false,  -- desk override for "no walk-ins"
  p_ignore_level boolean default false  -- desk override for level limits
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_s      public.sessions;
  v_t      public.session_types;
  v_level  numeric;
  v_booked int;
  v_status public.registration_status;
  v_id     uuid;
begin
  -- Lock the session row so two people can't take the last spot at the same time.
  select * into v_s from public.sessions where id = p_session for update;
  if not found then raise exception 'Session not found'; end if;
  select * into v_t from public.session_types where id = v_s.session_type_id;

  if v_s.status = 'cancelled' then raise exception 'This session has been cancelled'; end if;
  if p_member is null and nullif(trim(p_guest_name), '') is null then
    raise exception 'Choose a member or enter a guest name';
  end if;
  if now() >= v_s.ends_at then raise exception 'This session has already finished'; end if;
  if not p_allow_late and now() > v_s.starts_at - make_interval(mins => v_t.book_by_minutes) then
    raise exception 'Sign-ups closed % minutes before the start', v_t.book_by_minutes;
  end if;

  if p_member is not null and not p_ignore_level and (v_s.level_min is not null or v_s.level_max is not null) then
    select skill_level into v_level from public.members where id = p_member;
    if v_level is not null and (v_level < coalesce(v_s.level_min, 0) or v_level > coalesce(v_s.level_max, 9)) then
      raise exception 'This session is for levels % to %, and this member is %',
        coalesce(v_s.level_min::text, 'any'), coalesce(v_s.level_max::text, 'any'), v_level;
    end if;
  end if;

  select count(*) into v_booked from public.session_registrations
   where session_id = v_s.id and status in ('booked', 'attended');
  v_status := case when v_booked >= v_s.max_players then 'waitlisted' else 'booked' end;

  insert into public.session_registrations (org_id, session_id, member_id, guest_name, guest_phone, status, price)
  values (v_s.org_id, v_s.id, p_member, nullif(trim(p_guest_name), ''), nullif(trim(p_guest_phone), ''),
          v_status, v_s.price)
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'This member is already signed up for this session';
end;
$$;

-- Cancels a place and moves the first person on the waitlist up. Returns who was moved up, if anyone.
create or replace function public.cancel_registration(p_registration uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_r        public.session_registrations;
  v_s        public.sessions;
  v_promoted uuid;
begin
  select * into v_r from public.session_registrations where id = p_registration;
  if not found then raise exception 'Sign-up not found'; end if;
  select * into v_s from public.sessions where id = v_r.session_id for update;

  update public.session_registrations set status = 'cancelled'
   where id = p_registration and status in ('booked', 'waitlisted');

  if v_r.status = 'booked' and v_s.status <> 'cancelled' and now() < v_s.starts_at then
    update public.session_registrations set status = 'booked'
     where id = (
       select id from public.session_registrations
        where session_id = v_s.id and status = 'waitlisted'
        order by created_at limit 1
     )
    returning id into v_promoted;
  end if;

  return v_promoted;
end;
$$;

-- Marks someone as attended (also counts as a visit) or a no-show.
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
    insert into public.check_ins (org_id, member_id, source) values (v_r.org_id, v_r.member_id, 'session');
  end if;
end;
$$;

create or replace function public.cancel_session(p_session uuid, p_reason text default null)
returns int language plpgsql security invoker set search_path = '' as $$
declare
  v_count int;
begin
  update public.sessions set status = 'cancelled', cancel_reason = p_reason
   where id = p_session and status <> 'cancelled';
  if not found then raise exception 'Session not found or already cancelled'; end if;

  update public.bookings set status = 'cancelled'
   where session_id = p_session and status = 'confirmed';

  with c as (
    update public.session_registrations set status = 'cancelled'
     where session_id = p_session and status in ('booked', 'waitlisted')
    returning 1
  ) select count(*) into v_count from c;

  return v_count;  -- people to tell
end;
$$;

-- Go / no-go: sessions inside their decision window are confirmed if they have
-- enough players, otherwise cancelled. Run by cron every 15 minutes, or from the
-- app for one club. Returns what happened so the messaging step can tell people.
create or replace function public.check_session_minimums(p_org uuid default null)
returns table (session_id uuid, outcome text, booked int, min_players int)
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if auth.uid() is not null and (p_org is null or not public.is_org_staff(p_org)) then
    raise exception 'Not allowed';
  end if;

  for r in
    select s.id, s.min_players as minp,
           (select count(*) from public.session_registrations g
             where g.session_id = s.id and g.status in ('booked', 'attended'))::int as n
      from public.sessions s
      join public.session_types t on t.id = s.session_type_id
     where s.status = 'scheduled'
       and (p_org is null or s.org_id = p_org)
       and s.starts_at > now()
       and s.starts_at <= now() + make_interval(hours => t.min_check_hours)
  loop
    if r.n >= r.minp then
      update public.sessions set status = 'confirmed' where id = r.id;
      session_id := r.id; outcome := 'confirmed'; booked := r.n; min_players := r.minp;
    else
      update public.sessions set status = 'cancelled',
             cancel_reason = format('Not enough players (%s of %s needed)', r.n, r.minp)
       where id = r.id;
      update public.bookings set status = 'cancelled' where bookings.session_id = r.id and status = 'confirmed';
      update public.session_registrations set status = 'cancelled'
       where session_registrations.session_id = r.id and status in ('booked', 'waitlisted');
      session_id := r.id; outcome := 'cancelled'; booked := r.n; min_players := r.minp;
    end if;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Views
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
    where b.session_id = s.id and b.status = 'confirmed') as courts
from public.sessions s
join public.session_types t on t.id = s.session_type_id
left join (
  select r.session_id,
         count(*) filter (where r.status in ('booked', 'attended')) as booked,
         count(*) filter (where r.status = 'waitlisted') as waitlisted
    from public.session_registrations r
   group by r.session_id
) rc on rc.session_id = s.id;

create or replace view public.session_roster with (security_invoker = true) as
select
  r.id, r.org_id, r.session_id, r.member_id,
  coalesce(m.full_name, r.guest_name) as name,
  r.member_id is null as is_guest,
  coalesce(m.phone, r.guest_phone) as phone,
  m.language, m.skill_level,
  r.status, r.price, r.notes, r.created_at
from public.session_registrations r
left join public.members m on m.id = r.member_id;

-- Booking calendar now shows which session holds a court.
create or replace view public.booking_calendar with (security_invoker = true) as
select
  b.id, b.org_id, b.court_id, c.name as court_name, c.sort_order as court_order,
  b.member_id, m.full_name as member_name, b.guest_name,
  b.kind, b.status, lower(b.during) as start_at, upper(b.during) as end_at,
  b.price, b.notes, b.session_id
from public.bookings b
join public.courts c on c.id = b.court_id
left join public.members m on m.id = b.member_id;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.session_types, public.session_schedules,
  public.sessions, public.session_registrations to authenticated;
grant select on public.session_overview, public.session_roster, public.booking_calendar to authenticated;
grant execute on function
  public.generate_sessions(uuid, int),
  public.create_event(uuid, timestamptz, timestamptz, text, numeric, int, int, numeric, numeric, uuid[], text, text),
  public.register_for_session(uuid, uuid, text, text, boolean, boolean),
  public.cancel_registration(uuid),
  public.mark_attendance(uuid, boolean),
  public.cancel_session(uuid, text),
  public.check_session_minimums(uuid)
to authenticated;
grant execute on function public.hold_courts_for_session(uuid, uuid[]) to authenticated;
revoke execute on function public.hold_courts_for_session(uuid, uuid[]) from public, anon;
revoke all on public.session_types, public.session_schedules, public.sessions,
  public.session_registrations from anon;
revoke execute on function
  public.generate_sessions(uuid, int),
  public.create_event(uuid, timestamptz, timestamptz, text, numeric, int, int, numeric, numeric, uuid[], text, text),
  public.register_for_session(uuid, uuid, text, text, boolean, boolean),
  public.cancel_registration(uuid),
  public.mark_attendance(uuid, boolean),
  public.cancel_session(uuid, text),
  public.check_session_minimums(uuid)
from anon, public;

-- Dashboard: court bookings now exclude session holds, and sessions get their own count.
drop view public.org_dashboard;
create view public.org_dashboard with (security_invoker = true) as
select
  o.id as org_id,
  count(*) filter (where s.membership_status = 'active')  as active_members,
  count(*) filter (where s.membership_status = 'paused')  as paused_members,
  count(*) filter (where s.is_at_risk)                    as at_risk,
  count(*) filter (where s.is_renewing_soon)              as renewing_soon,
  count(*) filter (where s.is_drop_in_lead)               as drop_in_leads,
  (select count(*) from public.bookings b
     where b.org_id = o.id and b.status = 'confirmed' and b.session_id is null
       and (lower(b.during) at time zone o.timezone)::date = (now() at time zone o.timezone)::date
  ) as bookings_today,
  (select count(*) from public.sessions x
     where x.org_id = o.id and x.status <> 'cancelled'
       and (x.starts_at at time zone o.timezone)::date = (now() at time zone o.timezone)::date
  ) as sessions_today,
  (select coalesce(sum(m.price_paid), 0) from public.memberships m
     where m.org_id = o.id
       and date_trunc('month', m.created_at at time zone o.timezone)
         = date_trunc('month', now() at time zone o.timezone)
  ) as package_sales_this_month
from public.orgs o
left join public.member_status s on s.org_id = o.id
group by o.id;
grant select on public.org_dashboard to authenticated;
revoke all on public.session_overview, public.session_roster, public.booking_calendar, public.org_dashboard from anon;
