-- Club OS: initial schema
-- Multi-club (multi-tenant) membership and court booking system.
-- Every row belongs to an org (a club). Row-level security keeps clubs apart.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.staff_role as enum ('owner', 'manager', 'staff');
create type public.package_kind as enum ('time_based', 'class_pack');
create type public.membership_status as enum ('active', 'paused', 'expired', 'cancelled');
create type public.booking_kind as enum ('member', 'drop_in', 'open_play', 'coaching', 'maintenance');
create type public.booking_status as enum ('confirmed', 'cancelled', 'no_show', 'completed');

-- ---------------------------------------------------------------------------
-- Clubs and staff
-- ---------------------------------------------------------------------------
create table public.orgs (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (length(trim(name)) > 0),
  slug                 text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  sport                text not null default 'pickleball',
  timezone             text not null default 'Asia/Bangkok',
  currency             text not null default 'THB',
  default_language     text not null default 'en',
  opens_at             time not null default '07:00',
  closes_at            time not null default '22:00',
  slot_minutes         int  not null default 60 check (slot_minutes between 15 and 240),
  booking_advance_days int  not null default 7  check (booking_advance_days between 0 and 90),
  max_active_bookings  int  not null default 2  check (max_active_bookings between 1 and 50),
  at_risk_days         int  not null default 10 check (at_risk_days between 1 and 90),
  renewal_window_days  int  not null default 7  check (renewal_window_days between 1 and 60),
  created_at           timestamptz not null default now(),
  check (closes_at > opens_at)
);

create table public.org_staff (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.staff_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_staff_user_idx on public.org_staff(user_id);

-- ---------------------------------------------------------------------------
-- Club setup: courts, prices, packages
-- ---------------------------------------------------------------------------
create table public.courts (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  name       text not null,
  is_covered boolean not null default false,
  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, name)
);

-- Price per slot by time of day. First matching rule (lowest priority number) wins.
create table public.rate_rules (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  label         text not null,                       -- e.g. 'Peak evening'
  days_of_week  smallint[] not null default '{0,1,2,3,4,5,6}', -- 0 = Sunday
  start_time    time not null,
  end_time      time not null,
  drop_in_price numeric(10,2) not null default 0,
  member_price  numeric(10,2) not null default 0,
  priority      int not null default 100,
  check (end_time > start_time)
);
create index rate_rules_org_idx on public.rate_rules(org_id, priority);

create table public.package_types (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  name                text not null,                 -- e.g. 'Monthly unlimited'
  kind                public.package_kind not null default 'time_based',
  duration_days       int check (duration_days > 0), -- time-based: 30, 90 ...
  sessions            int check (sessions > 0),      -- class packs: 10, 20 ...
  price               numeric(10,2) not null default 0,
  max_active_bookings int check (max_active_bookings > 0), -- overrides the club default
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (org_id, id),
  check (kind <> 'time_based' or duration_days is not null),
  check (kind <> 'class_pack' or sessions is not null)
);

-- ---------------------------------------------------------------------------
-- Members, memberships, check-ins
-- ---------------------------------------------------------------------------
create table public.members (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  full_name         text not null check (length(trim(full_name)) > 0),
  phone             text,
  email             text,
  line_user_id      text,           -- filled when they add the club's LINE account
  whatsapp          text,
  language          text not null default 'en',  -- en, th, ru, zh ...
  skill_level       numeric(2,1) check (skill_level between 1 and 6), -- e.g. DUPR-style 3.5
  usual_play_time   text,           -- free text for now: '7am open play'
  notes             text,
  marketing_consent boolean not null default false,  -- PDPA: may we message them?
  consent_at        timestamptz,
  created_at        timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, line_user_id)
);
create index members_org_name_idx on public.members(org_id, full_name);

create table public.memberships (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  member_id       uuid not null,
  package_type_id uuid not null,
  status          public.membership_status not null default 'active',
  starts_on       date not null default current_date,
  ends_on         date,           -- null for open-ended class packs
  sessions_left   int check (sessions_left >= 0),
  price_paid      numeric(10,2) not null default 0,
  paused_from     date,
  paused_until    date,
  created_at      timestamptz not null default now(),
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, member_id) references public.members(org_id, id) on delete cascade,
  foreign key (org_id, package_type_id) references public.package_types(org_id, id),
  check (ends_on is null or ends_on >= starts_on)
);
create index memberships_member_idx on public.memberships(org_id, member_id, status);
create index memberships_ends_idx on public.memberships(org_id, ends_on);

create table public.check_ins (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  member_id     uuid not null,
  checked_in_at timestamptz not null default now(),
  source        text not null default 'desk' check (source in ('desk', 'qr', 'booking', 'import')),
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, member_id) references public.members(org_id, id) on delete cascade
);
create index check_ins_member_idx on public.check_ins(org_id, member_id, checked_in_at desc);

-- ---------------------------------------------------------------------------
-- Court bookings
-- ---------------------------------------------------------------------------
create table public.bookings (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  court_id   uuid not null,
  member_id  uuid,
  guest_name text,
  kind       public.booking_kind not null default 'member',
  status     public.booking_status not null default 'confirmed',
  during     tstzrange not null,
  price      numeric(10,2) not null default 0,
  notes      text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, court_id) references public.courts(org_id, id) on delete cascade,
  foreign key (org_id, member_id) references public.members(org_id, id) on delete set null (member_id),
  check (not isempty(during) and lower_inc(during) and not upper_inc(during)),
  check (kind <> 'member' or member_id is not null),
  check (kind <> 'drop_in' or member_id is not null or guest_name is not null),
  -- No double bookings: confirmed bookings on one court can't overlap.
  constraint bookings_no_overlap exclude using gist (court_id with =, during with &&)
    where (status = 'confirmed')
);
create index bookings_org_time_idx on public.bookings using gist (org_id, during);
create index bookings_member_idx on public.bookings(org_id, member_id);

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_org_staff(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_staff s
    where s.org_id = p_org and s.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_roles public.staff_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_staff s
    where s.org_id = p_org and s.user_id = auth.uid() and s.role = any (p_roles)
  );
$$;

-- Today's date in the club's own time zone.
create or replace function public.org_today(p_org uuid)
returns date language sql stable set search_path = '' as $$
  select (now() at time zone o.timezone)::date from public.orgs o where o.id = p_org;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.orgs          enable row level security;
alter table public.org_staff     enable row level security;
alter table public.courts        enable row level security;
alter table public.rate_rules    enable row level security;
alter table public.package_types enable row level security;
alter table public.members       enable row level security;
alter table public.memberships   enable row level security;
alter table public.check_ins     enable row level security;
alter table public.bookings      enable row level security;

-- Clubs: staff can read; owners and managers can edit. New clubs go through create_org().
create policy orgs_select on public.orgs for select to authenticated
  using (public.is_org_staff(id));
create policy orgs_update on public.orgs for update to authenticated
  using (public.has_org_role(id, '{owner,manager}'))
  with check (public.has_org_role(id, '{owner,manager}'));

-- Staff list: staff can see colleagues; only owners manage it.
create policy org_staff_select on public.org_staff for select to authenticated
  using (public.is_org_staff(org_id));
create policy org_staff_write on public.org_staff for all to authenticated
  using (public.has_org_role(org_id, '{owner}'))
  with check (public.has_org_role(org_id, '{owner}'));

-- Club setup tables: all staff read, owners/managers write.
create policy courts_select on public.courts for select to authenticated
  using (public.is_org_staff(org_id));
create policy courts_write on public.courts for all to authenticated
  using (public.has_org_role(org_id, '{owner,manager}'))
  with check (public.has_org_role(org_id, '{owner,manager}'));

create policy rate_rules_select on public.rate_rules for select to authenticated
  using (public.is_org_staff(org_id));
create policy rate_rules_write on public.rate_rules for all to authenticated
  using (public.has_org_role(org_id, '{owner,manager}'))
  with check (public.has_org_role(org_id, '{owner,manager}'));

create policy package_types_select on public.package_types for select to authenticated
  using (public.is_org_staff(org_id));
create policy package_types_write on public.package_types for all to authenticated
  using (public.has_org_role(org_id, '{owner,manager}'))
  with check (public.has_org_role(org_id, '{owner,manager}'));

-- Day-to-day tables: any staff member can work with them.
create policy members_all on public.members for all to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));
create policy memberships_all on public.memberships for all to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));
create policy check_ins_all on public.check_ins for all to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));
create policy bookings_all on public.bookings for all to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));

-- ---------------------------------------------------------------------------
-- Onboarding: create a club and make the caller its owner
-- ---------------------------------------------------------------------------
create or replace function public.create_org(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in to create a club';
  end if;

  insert into public.orgs (name, slug) values (trim(p_name), lower(trim(p_slug)))
  returning id into v_org;

  insert into public.org_staff (org_id, user_id, role) values (v_org, auth.uid(), 'owner');

  -- Sensible starting setup the owner can change later.
  insert into public.courts (org_id, name, sort_order) values
    (v_org, 'Court 1', 1), (v_org, 'Court 2', 2);
  insert into public.rate_rules (org_id, label, start_time, end_time, drop_in_price, member_price, priority) values
    (v_org, 'Off-peak', '07:00', '17:00', 300, 0, 20),
    (v_org, 'Peak',     '17:00', '22:00', 450, 0, 10);
  insert into public.package_types (org_id, name, kind, duration_days, sessions, price) values
    (v_org, 'Monthly unlimited', 'time_based', 30, null, 3500),
    (v_org, '3-month unlimited', 'time_based', 90, null, 9000),
    (v_org, '10-session pack',   'class_pack', null, 10, 2800);

  return v_org;
exception
  when unique_violation then
    raise exception 'That club link (%) is already taken', p_slug;
end;
$$;

-- ---------------------------------------------------------------------------
-- Selling a package: works out the end date or session count
-- ---------------------------------------------------------------------------
create or replace function public.sell_membership(
  p_member uuid, p_package uuid, p_starts_on date default null, p_price numeric default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_pkg   public.package_types;
  v_start date;
  v_id    uuid;
begin
  select * into v_pkg from public.package_types where id = p_package;
  if not found then raise exception 'Package not found'; end if;

  v_start := coalesce(p_starts_on, public.org_today(v_pkg.org_id));

  insert into public.memberships (org_id, member_id, package_type_id, starts_on, ends_on, sessions_left, price_paid)
  values (
    v_pkg.org_id, p_member, v_pkg.id, v_start,
    case when v_pkg.kind = 'time_based' then v_start + v_pkg.duration_days - 1 end,
    case when v_pkg.kind = 'class_pack' then v_pkg.sessions end,
    coalesce(p_price, v_pkg.price)
  ) returning id into v_id;

  return v_id;
end;
$$;

-- Pause a membership (for members leaving Phuket in low season). End date moves out by the pause length.
create or replace function public.pause_membership(p_membership uuid, p_from date, p_until date)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_until <= p_from then raise exception 'Pause must end after it starts'; end if;
  update public.memberships
     set status = 'paused', paused_from = p_from, paused_until = p_until,
         ends_on = case when ends_on is null then null else ends_on + (p_until - p_from) end
   where id = p_membership and status = 'active';
  if not found then raise exception 'Only an active membership can be paused'; end if;
end;
$$;

-- Daily housekeeping: expire finished memberships, resume finished pauses.
-- Schedule with pg_cron in Supabase (see README).
create or replace function public.refresh_membership_statuses()
returns void language sql security definer set search_path = '' as $$
  update public.memberships m set status = 'active'
    from public.orgs o
   where o.id = m.org_id and m.status = 'paused'
     and m.paused_until <= (now() at time zone o.timezone)::date;
  update public.memberships m set status = 'expired'
    from public.orgs o
   where o.id = m.org_id and m.status = 'active'
     and ((m.ends_on is not null and m.ends_on < (now() at time zone o.timezone)::date)
          or m.sessions_left = 0);
$$;
revoke execute on function public.refresh_membership_statuses() from public, anon, authenticated;

-- Class packs: each check-in uses one session.
create or replace function public.use_class_pack_session()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.memberships m
     set sessions_left = sessions_left - 1
   where m.id = (
     select m2.id from public.memberships m2
      where m2.org_id = new.org_id and m2.member_id = new.member_id
        and m2.status = 'active' and m2.sessions_left > 0
      order by m2.starts_on
      limit 1
   );
  return new;
end;
$$;
create trigger check_ins_use_session after insert on public.check_ins
  for each row execute function public.use_class_pack_session();

-- ---------------------------------------------------------------------------
-- Court booking with club rules
-- ---------------------------------------------------------------------------
create or replace function public.slot_price(p_org uuid, p_start timestamptz, p_is_member boolean)
returns numeric language sql stable set search_path = '' as $$
  select coalesce((
    select case when p_is_member then r.member_price else r.drop_in_price end
      from public.rate_rules r, public.orgs o
     where r.org_id = p_org and o.id = p_org
       and extract(dow from (p_start at time zone o.timezone))::smallint = any (r.days_of_week)
       and (p_start at time zone o.timezone)::time >= r.start_time
       and (p_start at time zone o.timezone)::time <  r.end_time
     order by r.priority
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
  v_kind   public.booking_kind;
  v_mins   int;
  v_local  timestamp;
  v_end    timestamptz;
  v_limit  int;
  v_active int;
  v_has_membership boolean;
  v_id     uuid;
begin
  select * into v_court from public.courts where id = p_court;
  if not found then raise exception 'Court not found'; end if;
  if not v_court.is_active then raise exception '% is closed for booking', v_court.name; end if;
  select * into v_org from public.orgs where id = v_court.org_id;

  v_mins  := coalesce(p_minutes, v_org.slot_minutes);
  v_end   := p_start + make_interval(mins => v_mins);
  v_local := p_start at time zone v_org.timezone;

  if p_start < now() - interval '5 minutes' then
    raise exception 'That time has already passed';
  end if;
  if v_local::time < v_org.opens_at or (v_end at time zone v_org.timezone)::time > v_org.closes_at
     or (v_end at time zone v_org.timezone)::date <> v_local::date then
    raise exception 'Bookings must be within opening hours (% to %)',
      to_char(v_org.opens_at, 'HH24:MI'), to_char(v_org.closes_at, 'HH24:MI');
  end if;

  -- Is this a paying member with an active package on that day?
  if p_member is not null then
    select exists (
      select 1 from public.memberships m
       where m.org_id = v_org.id and m.member_id = p_member and m.status = 'active'
         and m.starts_on <= v_local::date
         and (m.ends_on is null or m.ends_on >= v_local::date)
         and (m.sessions_left is null or m.sessions_left > 0)
    ) into v_has_membership;
  else
    v_has_membership := false;
  end if;

  v_kind := coalesce(p_kind, case when v_has_membership then 'member'::public.booking_kind
                                  else 'drop_in'::public.booking_kind end);

  if v_kind = 'member' then
    if not v_has_membership then
      raise exception 'This member has no active package for that date';
    end if;

    if v_local::date > public.org_today(v_org.id) + v_org.booking_advance_days then
      raise exception 'Members can book up to % days ahead', v_org.booking_advance_days;
    end if;

    select coalesce(min(pt.max_active_bookings), v_org.max_active_bookings) into v_limit
      from public.memberships m join public.package_types pt on pt.id = m.package_type_id
     where m.org_id = v_org.id and m.member_id = p_member and m.status = 'active';

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
      when v_kind in ('member', 'drop_in') then public.slot_price(v_org.id, p_start, v_kind = 'member')
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
-- Retention view: one row per member with the signals the AI will act on
-- ---------------------------------------------------------------------------
create or replace view public.member_status with (security_invoker = true) as
with today as (
  select o.id as org_id, (now() at time zone o.timezone)::date as d,
         o.at_risk_days, o.renewal_window_days
    from public.orgs o
),
current_ms as (
  select distinct on (m.member_id)
         m.member_id, m.id as membership_id, m.status, m.starts_on, m.ends_on,
         m.sessions_left, pt.name as package_name
    from public.memberships m
    join public.package_types pt on pt.id = m.package_type_id
   where m.status in ('active', 'paused')
   order by m.member_id, (m.status = 'active') desc, m.ends_on desc nulls first
),
last_visit as (
  select c.member_id, max(c.checked_in_at) as last_check_in
    from public.check_ins c
   group by c.member_id
),
upcoming as (
  select b.member_id, count(*) as upcoming_bookings
    from public.bookings b
   where b.status = 'confirmed' and upper(b.during) > now() and b.member_id is not null
   group by b.member_id
)
select
  mb.id as member_id,
  mb.org_id,
  mb.full_name,
  mb.language,
  mb.phone,
  mb.line_user_id,
  mb.marketing_consent,
  cm.membership_id,
  cm.package_name,
  cm.status as membership_status,
  cm.ends_on,
  cm.sessions_left,
  (cm.ends_on - t.d) as days_to_expiry,
  lv.last_check_in,
  (t.d - (lv.last_check_in at time zone o.timezone)::date) as days_since_visit,
  coalesce(up.upcoming_bookings, 0) as upcoming_bookings,
  -- Active member who has gone quiet and has nothing booked
  (cm.status = 'active'
     and coalesce(up.upcoming_bookings, 0) = 0
     and coalesce(t.d - (lv.last_check_in at time zone o.timezone)::date,
                  t.d - (mb.created_at at time zone o.timezone)::date) >= t.at_risk_days
  ) as is_at_risk,
  -- Package running out soon (by date, or 2 or fewer sessions left)
  (cm.status = 'active'
     and ((cm.ends_on is not null and cm.ends_on - t.d between 0 and t.renewal_window_days)
          or (cm.sessions_left is not null and cm.sessions_left <= 2))
  ) as is_renewing_soon,
  -- Visited at least once but never bought a package: a conversion lead
  (cm.membership_id is null
     and lv.last_check_in is not null
     and not exists (select 1 from public.memberships x where x.member_id = mb.id)
  ) as is_drop_in_lead
from public.members mb
join public.orgs o on o.id = mb.org_id
join today t on t.org_id = mb.org_id
left join current_ms cm on cm.member_id = mb.id
left join last_visit lv on lv.member_id = mb.id
left join upcoming up on up.member_id = mb.id;

-- Bookings in an app-friendly shape (plain start/end columns, names joined in).
create or replace view public.booking_calendar with (security_invoker = true) as
select
  b.id, b.org_id, b.court_id, c.name as court_name, c.sort_order as court_order,
  b.member_id, m.full_name as member_name, b.guest_name,
  b.kind, b.status, lower(b.during) as start_at, upper(b.during) as end_at,
  b.price, b.notes
from public.bookings b
join public.courts c on c.id = b.court_id
left join public.members m on m.id = b.member_id;

-- Headline numbers for the owner dashboard.
create or replace view public.org_dashboard with (security_invoker = true) as
select
  o.id as org_id,
  count(*) filter (where s.membership_status = 'active')  as active_members,
  count(*) filter (where s.membership_status = 'paused')  as paused_members,
  count(*) filter (where s.is_at_risk)                    as at_risk,
  count(*) filter (where s.is_renewing_soon)              as renewing_soon,
  count(*) filter (where s.is_drop_in_lead)               as drop_in_leads,
  (select count(*) from public.bookings b
     where b.org_id = o.id and b.status = 'confirmed'
       and (lower(b.during) at time zone o.timezone)::date = (now() at time zone o.timezone)::date
  ) as bookings_today,
  (select coalesce(sum(m.price_paid), 0) from public.memberships m
     where m.org_id = o.id
       and date_trunc('month', m.created_at at time zone o.timezone)
         = date_trunc('month', now() at time zone o.timezone)
  ) as package_sales_this_month
from public.orgs o
left join public.member_status s on s.org_id = o.id
group by o.id;

-- ---------------------------------------------------------------------------
-- Grants (Supabase exposes the public schema through its API)
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.member_status, public.org_dashboard, public.booking_calendar to authenticated;
grant execute on function
  public.create_org(text, text),
  public.sell_membership(uuid, uuid, date, numeric),
  public.pause_membership(uuid, date, date),
  public.create_booking(uuid, timestamptz, uuid, text, public.booking_kind, int, text),
  public.slot_price(uuid, timestamptz, boolean),
  public.org_today(uuid),
  public.is_org_staff(uuid),
  public.has_org_role(uuid, public.staff_role[])
to authenticated;
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
