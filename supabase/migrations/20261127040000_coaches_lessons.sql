-- Step 5: coaches and private lessons (27 Nov 2026).
--   coaches       the club's coaches (name, contact, which locations, active)
--   lesson_rates  lesson prices by length and group size: club-wide (coach_id null) or for one
--                 coach (wins over the club-wide price). Each club enters its own prices.
--   coach_busy    when each coach is teaching (lessons and sessions); no overlaps, like courts.
--   A private lesson is a court booking of kind 'coaching' with coach_id, group_size and the
--   lesson price; book_lesson() books the coach and the court in one step. Paid lessons become
--   orders like other paid bookings.
--   Sessions can name a coach from the list (sessions.coach_id). coach_name stays: it's filled
--   from the coach, and keeps working for coaches who aren't on the list.
-- Not in this step: hour packages / lesson credits, members booking lessons themselves.

create table public.coaches (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  phone        text check (char_length(phone) <= 40),
  about        text check (char_length(about) <= 500),
  location_ids uuid[],               -- null = every location
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (org_id, id)
);
create unique index coaches_name_idx on public.coaches(org_id, lower(btrim(name)));
create trigger coaches_check_locations before insert or update of location_ids on public.coaches
  for each row execute function public.check_location_ids();

create table public.lesson_rates (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  coach_id   uuid,
  minutes    int not null check (minutes between 15 and 240),
  group_size int not null check (group_size between 1 and 12),
  price      numeric(10,2) not null check (price >= 0),
  created_at timestamptz not null default now(),
  foreign key (org_id, coach_id) references public.coaches(org_id, id) on delete cascade,
  unique nulls not distinct (org_id, coach_id, minutes, group_size)
);

alter table public.bookings
  add column coach_id   uuid,
  add column group_size int check (group_size between 1 and 12),
  add constraint bookings_coach_fk foreign key (org_id, coach_id) references public.coaches(org_id, id),
  add constraint bookings_coach_kind check (coach_id is null or kind = 'coaching');

alter table public.sessions
  add column coach_id uuid,
  add constraint sessions_coach_fk foreign key (org_id, coach_id) references public.coaches(org_id, id) on delete set null (coach_id);

create table public.coach_busy (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  coach_id   uuid not null,
  during     tstzrange not null,
  booking_id uuid unique,
  session_id uuid unique,
  foreign key (org_id, coach_id) references public.coaches(org_id, id) on delete cascade,
  foreign key (booking_id) references public.bookings(id) on delete cascade,
  foreign key (session_id) references public.sessions(id) on delete cascade,
  check (num_nonnulls(booking_id, session_id) = 1),
  constraint coach_busy_no_overlap exclude using gist (coach_id with =, during with &&)
);
create index coach_busy_org_idx on public.coach_busy using gist (org_id, during);

-- RLS: staff read; setup people (club.setup) change coaches and prices. coach_busy is kept in
-- step by triggers only.
alter table public.coaches enable row level security;
alter table public.lesson_rates enable row level security;
alter table public.coach_busy enable row level security;
create policy coaches_select on public.coaches for select to authenticated using (public.is_org_staff(org_id));
create policy coaches_write on public.coaches for all to authenticated
  using (public.has_org_permission(org_id, 'club.setup')) with check (public.has_org_permission(org_id, 'club.setup'));
create policy lesson_rates_select on public.lesson_rates for select to authenticated using (public.is_org_staff(org_id));
create policy lesson_rates_write on public.lesson_rates for all to authenticated
  using (public.has_org_permission(org_id, 'club.setup')) with check (public.has_org_permission(org_id, 'club.setup'));
create policy coach_busy_select on public.coach_busy for select to authenticated using (public.is_org_staff(org_id));
-- Courtix support during an allowed session, like the other club tables.
create policy coaches_support_view on public.coaches for select to authenticated using (public.support_can_view(org_id));
create policy lesson_rates_support_view on public.lesson_rates for select to authenticated using (public.support_can_view(org_id));
create policy coach_busy_support_view on public.coach_busy for select to authenticated using (public.support_can_view(org_id));
grant select, insert, update, delete on public.coaches, public.lesson_rates to authenticated;
grant select on public.coach_busy to authenticated;
revoke all on public.coaches, public.lesson_rates, public.coach_busy from anon;

-- ---------------------------------------------------------------------------
-- Keeping coach_busy in step (runs as the owner: it only mirrors the row that changed)
-- ---------------------------------------------------------------------------
create or replace function public.bookings_coach_busy()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  delete from public.coach_busy where booking_id = new.id;
  if new.coach_id is not null and new.status = 'confirmed' then
    begin
      insert into public.coach_busy (org_id, coach_id, during, booking_id)
      values (new.org_id, new.coach_id, new.during, new.id);
    exception when exclusion_violation then
      select name into v_name from public.coaches where id = new.coach_id;
      raise exception '% is already teaching at that time', v_name;
    end;
  end if;
  return null;
end;
$$;
create trigger bookings_coach_busy after insert or update of coach_id, during, status on public.bookings
  for each row execute function public.bookings_coach_busy();

create or replace function public.sessions_coach()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The coach's name follows the coach picked from the list.
  if new.coach_id is not null then
    select name into new.coach_name from public.coaches where id = new.coach_id;
  end if;
  return new;
end;
$$;
create trigger sessions_coach before insert or update of coach_id on public.sessions
  for each row execute function public.sessions_coach();

create or replace function public.sessions_coach_busy()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  delete from public.coach_busy where session_id = new.id;
  if new.coach_id is not null and new.status <> 'cancelled' then
    begin
      insert into public.coach_busy (org_id, coach_id, during, session_id)
      values (new.org_id, new.coach_id, tstzrange(new.starts_at, new.ends_at, '[)'), new.id);
    exception when exclusion_violation then
      select name into v_name from public.coaches where id = new.coach_id;
      raise exception '% is already teaching at that time', v_name;
    end;
  end if;
  return null;
end;
$$;
create trigger sessions_coach_busy after insert or update of coach_id, starts_at, ends_at, status on public.sessions
  for each row execute function public.sessions_coach_busy();

-- ---------------------------------------------------------------------------
-- Prices
-- ---------------------------------------------------------------------------
-- The lesson price: the coach's own price, else the club-wide one. Null = no price set.
create or replace function public.lesson_price(p_coach uuid, p_minutes int, p_group_size int)
returns numeric language sql stable security invoker set search_path = '' as $$
  select r.price from public.lesson_rates r
    join public.coaches c on c.id = p_coach and c.org_id = r.org_id
   where (r.coach_id = p_coach or r.coach_id is null)
     and r.minutes = p_minutes and r.group_size = p_group_size
   order by (r.coach_id is null)
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Book a private lesson: coach + court in one step.
-- p_court null: the first free court at p_location. One payer: a member or a guest name.
-- ---------------------------------------------------------------------------
create or replace function public.book_lesson(
  p_coach      uuid,
  p_start      timestamptz,
  p_minutes    int,
  p_group_size int,
  p_court      uuid default null,
  p_location   uuid default null,
  p_member     uuid default null,
  p_guest_name text default null,
  p_notes      text default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_coach public.coaches;
  v_loc   uuid;
  v_price numeric;
  v_court uuid;
  v_id    uuid;
  v_end   timestamptz := p_start + make_interval(mins => coalesce(p_minutes, 0));
begin
  select * into v_coach from public.coaches where id = p_coach;
  if not found then raise exception 'Coach not found'; end if;
  if not public.has_org_permission(v_coach.org_id, 'bookings.manage') then
    raise exception 'Your role can''t book lessons';
  end if;
  if not v_coach.is_active then raise exception '% isn''t taking lessons right now', v_coach.name; end if;
  if p_minutes is null or p_minutes < 15 then raise exception 'Choose how long the lesson is'; end if;
  if p_group_size is null or p_group_size < 1 or p_group_size > 12 then
    raise exception 'Choose how many people are in the lesson';
  end if;
  if p_member is null and nullif(btrim(coalesce(p_guest_name, '')), '') is null then
    raise exception 'Choose a member or enter the guest''s name';
  end if;

  v_price := public.lesson_price(p_coach, p_minutes, p_group_size);
  if v_price is null then
    raise exception 'No price set for a % minute lesson for % with %. Add it on the Coaches page',
      p_minutes, case when p_group_size = 1 then '1 person' else p_group_size || ' people' end, v_coach.name;
  end if;

  if p_court is not null then
    select location_id into v_loc from public.courts where id = p_court and org_id = v_coach.org_id;
    if not found then raise exception 'Court not found'; end if;
    v_court := p_court;
  else
    v_loc := p_location;
    if v_loc is null then raise exception 'Choose a court or a location'; end if;
    select c.id into v_court from public.courts c
     where c.location_id = v_loc and c.org_id = v_coach.org_id and c.is_active
       and not exists (select 1 from public.bookings b
                        where b.court_id = c.id and b.status = 'confirmed'
                          and b.during && tstzrange(p_start, v_end, '[)'))
     order by c.sort_order, c.name limit 1;
    if v_court is null then raise exception 'No court is free at that time'; end if;
  end if;
  if v_coach.location_ids is not null and not (v_loc = any (v_coach.location_ids)) then
    raise exception '% doesn''t teach at this location', v_coach.name;
  end if;

  -- Opening hours, the past and the court's other bookings are checked by create_booking.
  v_id := public.create_booking(v_court, p_start, p_member, p_guest_name, 'coaching', p_minutes,
    coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'Lesson with ' || v_coach.name));
  -- The coach can't be in two places: checked by the coach_busy trigger.
  update public.bookings set coach_id = p_coach, group_size = p_group_size, price = v_price where id = v_id;
  return v_id;
end;
$$;

-- Paid lessons become orders like court bookings (same as 20261126080000, plus coaching lessons).
create or replace function public.bookings_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  b record;
  v_desc text;
begin
  select bc.*, l.timezone, bk.guest_phone, bk.coach_id, bk.group_size, co.name as coach_name into b
    from public.booking_calendar bc
    join public.locations l on l.id = bc.location_id
    join public.bookings bk on bk.id = bc.id
    left join public.coaches co on co.id = bk.coach_id
   where bc.id = new.id;
  if not found then return null; end if;
  if b.kind in ('member', 'drop_in') then
    v_desc := b.court_name;
  elsif b.kind = 'coaching' and b.coach_id is not null then
    v_desc := 'Lesson with ' || b.coach_name
              || case when b.group_size > 1 then ' (' || b.group_size || ' people)' else '' end
              || ', ' || b.court_name;
  else
    return null;
  end if;
  perform public.sync_order_item(b.org_id, 'court', b.id, b.location_id, b.member_id, b.guest_name, b.guest_phone,
    v_desc || ', ' || to_char(b.start_at at time zone b.timezone, 'Dy DD Mon HH24:MI'),
    b.price, b.status = 'confirmed');
  return null;
end;
$$;

-- Staff: pick a coach from the list for a session (null: none, or the typed name stays).
create or replace function public.set_session_coach(p_session uuid, p_coach uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_s public.sessions;
begin
  select * into v_s from public.sessions where id = p_session;
  if not found then raise exception 'Session not found'; end if;
  if not public.has_org_permission(v_s.org_id, 'club.setup') then
    raise exception 'Only the owner or an admin can change the coach';
  end if;
  if p_coach is not null and not exists (select 1 from public.coaches where id = p_coach and org_id = v_s.org_id) then
    raise exception 'Coach not found';
  end if;
  update public.sessions set coach_id = p_coach where id = p_session;
end;
$$;

-- Upcoming lessons and sessions per coach, for the Coaches page.
create or replace view public.coach_schedule with (security_invoker = true) as
select cb.id, cb.org_id, cb.coach_id, co.name as coach_name, lower(cb.during) as start_at, upper(cb.during) as end_at,
       cb.booking_id, cb.session_id,
       coalesce(b.location_id, s.location_id) as location_id,
       ct.name as court_name,
       coalesce(m.full_name, b.guest_name) as student,
       b.group_size, b.price,
       coalesce(s.title, st.name) as session_name
  from public.coach_busy cb
  join public.coaches co on co.id = cb.coach_id
  left join public.bookings b on b.id = cb.booking_id
  left join public.courts ct on ct.id = b.court_id
  left join public.members m on m.id = b.member_id
  left join public.sessions s on s.id = cb.session_id
  left join public.session_types st on st.id = s.session_type_id;
grant select on public.coach_schedule to authenticated;
revoke all on public.coach_schedule from anon;

grant execute on function
  public.lesson_price(uuid, int, int),
  public.book_lesson(uuid, timestamptz, int, int, uuid, uuid, uuid, text, text),
  public.set_session_coach(uuid, uuid)
to authenticated;
revoke execute on function
  public.lesson_price(uuid, int, int),
  public.book_lesson(uuid, timestamptz, int, int, uuid, uuid, uuid, text, text),
  public.set_session_coach(uuid, uuid)
from anon, public;
