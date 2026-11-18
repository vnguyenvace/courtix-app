-- Owners and managers can edit one session, a session type, and the weekly timetable.
--
-- Rules (front desk safety):
--   * Places already booked keep the price they signed up at.
--   * A session's place limit can't go below the people already booked.
--   * Raising the limit moves people up from the waitlist (and uses their package, as usual).
--   * Moving a session moves its court holds.
--   * A session edited by hand (edited_at) is left alone by later type/timetable changes.
--   * Timetable changes rebuild only upcoming sessions nobody has signed up for. Sessions with
--     sign-ups keep their time; the function lists them so staff can move or cancel them.

-- ---------------------------------------------------------------------------
-- Sessions remember which timetable slot made them, separately from their (editable) start.
-- Without this, moving a generated session would make the hourly job recreate it at the old time.
-- ---------------------------------------------------------------------------
alter table public.sessions add column schedule_slot timestamptz;
alter table public.sessions add column edited_at timestamptz;
update public.sessions set schedule_slot = starts_at where schedule_id is not null;
alter table public.sessions drop constraint sessions_schedule_id_starts_at_key;
alter table public.sessions add constraint sessions_schedule_slot_key unique (schedule_id, schedule_slot);

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

      insert into public.sessions (org_id, session_type_id, schedule_id, schedule_slot, location_id, starts_at, ends_at,
                                   price, min_players, max_players, level_min, level_max)
      values (p_org, r.session_type_id, r.id, v_start, r.location_id, v_start,
              v_start + make_interval(mins => r.duration_minutes),
              r.price, r.min_players, r.max_players, r.level_min, r.level_max)
      on conflict (schedule_id, schedule_slot) do nothing
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

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Moves people up from the waitlist while there's room. Returns how many moved up.
create or replace function public.fill_from_waitlist(p_session uuid)
returns int language plpgsql security invoker set search_path = '' as $$
declare
  v_s     public.sessions;
  v_moved int := 0;
  v_next  uuid;
begin
  select * into v_s from public.sessions where id = p_session;
  if v_s.status = 'cancelled' or now() >= v_s.starts_at then return 0; end if;
  loop
    exit when (select count(*) from public.session_registrations
                where session_id = p_session and status in ('booked', 'attended')) >= v_s.max_players;
    select id into v_next from public.session_registrations
     where session_id = p_session and status = 'waitlisted' order by created_at limit 1;
    exit when v_next is null;
    update public.session_registrations set status = 'booked' where id = v_next;
    perform public.apply_session_coverage(v_next);
    v_moved := v_moved + 1;
    v_next := null;
  end loop;
  return v_moved;
end;
$$;

-- Replaces a session's court holds (after a time or court change). Returns a note about
-- courts that couldn't be held (already booked), or null.
create or replace function public.rehold_session_courts(p_session uuid, p_courts uuid[])
returns text language plpgsql security invoker set search_path = '' as $$
begin
  update public.bookings set status = 'cancelled' where session_id = p_session and status = 'confirmed';
  return public.hold_courts_for_session(p_session, p_courts);
end;
$$;

create or replace function public.session_court_ids(p_session uuid)
returns uuid[] language sql stable security invoker set search_path = '' as $$
  select coalesce(array_agg(court_id order by court_id), '{}')
    from public.bookings where session_id = p_session and status = 'confirmed';
$$;

-- ---------------------------------------------------------------------------
-- Edit one session. Null keeps the current title, times, price and player numbers. Levels, coach,
-- description and notes are set as given (null clears them; the form sends every field).
-- p_courts: null keeps the courts, '{}' releases them all. Returns {moved_up, court_note}.
-- ---------------------------------------------------------------------------
create or replace function public.update_session(
  p_session     uuid,
  p_title       text,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_price       numeric,
  p_min_players int,
  p_max_players int,
  p_level_min   numeric,
  p_level_max   numeric,
  p_coach_name  text,
  p_description text,
  p_notes       text,
  p_courts      uuid[] default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_s      public.sessions;
  v_booked int;
  v_note   text;
  v_moved  int;
begin
  select * into v_s from public.sessions where id = p_session for update;
  if not found then raise exception 'Session not found'; end if;
  if not public.has_org_role(v_s.org_id, '{owner,manager}') then
    raise exception 'Only owners and managers can edit sessions';
  end if;
  if v_s.status = 'cancelled' then raise exception 'This session has been cancelled'; end if;
  if now() >= v_s.ends_at then raise exception 'This session has already finished'; end if;

  if coalesce(p_ends_at, v_s.ends_at) <= coalesce(p_starts_at, v_s.starts_at) then
    raise exception 'The session must end after it starts';
  end if;
  if coalesce(p_starts_at, v_s.starts_at) <> v_s.starts_at and coalesce(p_starts_at, v_s.starts_at) < now() then
    raise exception 'A session can''t be moved into the past';
  end if;
  if coalesce(p_max_players, v_s.max_players) < coalesce(p_min_players, v_s.min_players) then
    raise exception 'Maximum players must be at least the minimum';
  end if;
  select count(*) into v_booked from public.session_registrations
   where session_id = p_session and status in ('booked', 'attended');
  if coalesce(p_max_players, v_s.max_players) < v_booked then
    raise exception '% people are booked. Allow at least % places, or cancel some places first', v_booked, v_booked;
  end if;

  update public.sessions set
    title       = nullif(trim(coalesce(p_title, title)), ''),
    starts_at   = coalesce(p_starts_at, starts_at),
    ends_at     = coalesce(p_ends_at, ends_at),
    price       = coalesce(p_price, price),
    min_players = coalesce(p_min_players, min_players),
    max_players = coalesce(p_max_players, max_players),
    level_min   = p_level_min,
    level_max   = p_level_max,
    coach_name  = nullif(trim(coalesce(p_coach_name, '')), ''),
    description = nullif(trim(coalesce(p_description, '')), ''),
    notes       = nullif(trim(coalesce(p_notes, '')), ''),
    edited_at   = now()
  where id = p_session;

  -- Courts follow the new time (or the new choice of courts).
  if p_courts is not null
     or coalesce(p_starts_at, v_s.starts_at) <> v_s.starts_at
     or coalesce(p_ends_at, v_s.ends_at) <> v_s.ends_at then
    v_note := public.rehold_session_courts(p_session, coalesce(p_courts, public.session_court_ids(p_session)));
  end if;

  v_moved := public.fill_from_waitlist(p_session);
  return jsonb_build_object('moved_up', v_moved, 'court_note', v_note);
end;
$$;

-- ---------------------------------------------------------------------------
-- After editing a session type: copy its price, players, levels and length onto upcoming
-- sessions of that type (not cancelled, not edited by hand). Returns {updated, kept_max, moved_up}.
-- kept_max: sessions whose new maximum would be below the people already booked (kept higher).
-- ---------------------------------------------------------------------------
create or replace function public.apply_session_type(p_type uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_t       public.session_types;
  r         record;
  v_booked  int;
  v_updated int := 0;
  v_kept    int := 0;
  v_moved   int := 0;
begin
  select * into v_t from public.session_types where id = p_type;
  if not found then raise exception 'Session type not found'; end if;
  if not public.has_org_role(v_t.org_id, '{owner,manager}') then
    raise exception 'Only owners and managers can edit sessions';
  end if;

  for r in select s.* from public.sessions s
            where s.session_type_id = p_type and s.status <> 'cancelled'
              and s.starts_at > now() and s.edited_at is null
            for update
  loop
    select count(*) into v_booked from public.session_registrations
     where session_id = r.id and status in ('booked', 'attended');
    if v_booked > v_t.max_players then v_kept := v_kept + 1; end if;
    update public.sessions set
      price       = v_t.price,
      min_players = least(v_t.min_players, greatest(v_t.max_players, v_booked)),
      max_players = greatest(v_t.max_players, v_booked),
      level_min   = v_t.level_min,
      level_max   = v_t.level_max,
      ends_at     = r.starts_at + make_interval(mins => v_t.duration_minutes)
    where id = r.id;
    if r.ends_at <> r.starts_at + make_interval(mins => v_t.duration_minutes) then
      perform public.rehold_session_courts(r.id, public.session_court_ids(r.id));
    end if;
    v_moved := v_moved + public.fill_from_waitlist(r.id);
    v_updated := v_updated + 1;
  end loop;
  return jsonb_build_object('updated', v_updated, 'kept_max', v_kept, 'moved_up', v_moved);
end;
$$;

-- ---------------------------------------------------------------------------
-- Edit a timetable entry, then rebuild its upcoming sessions.
--   * Upcoming sessions with nobody signed up (and not edited by hand) are removed and made
--     again from the new timetable.
--   * Sessions that already have people stay where they are. If only the courts changed and
--     the session still fits the timetable, its courts are updated.
-- Returns {rebuilt, created, kept: [{id, starts_at}]} (kept = left at their old time).
-- ---------------------------------------------------------------------------
create or replace function public.update_schedule(
  p_schedule    uuid,
  p_days        smallint[],
  p_start_time  time,
  p_courts      uuid[],
  p_valid_until date default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_sc      public.session_schedules;
  v_tz      text;
  v_removed int := 0;
  v_created int;
  v_kept    jsonb := '[]'::jsonb;
  r         record;
begin
  select * into v_sc from public.session_schedules where id = p_schedule for update;
  if not found then raise exception 'Timetable entry not found'; end if;
  if not public.has_org_role(v_sc.org_id, '{owner,manager}') then
    raise exception 'Only owners and managers can change the timetable';
  end if;
  if p_days is null or cardinality(p_days) = 0 then raise exception 'Pick at least one day'; end if;
  if p_start_time is null then raise exception 'Enter a start time'; end if;
  if p_valid_until is not null and p_valid_until < v_sc.valid_from then
    raise exception 'The end date must be after %', v_sc.valid_from;
  end if;

  update public.session_schedules
     set days_of_week = p_days, start_time = p_start_time, court_ids = coalesce(p_courts, '{}'),
         valid_until = p_valid_until
   where id = p_schedule;
  select timezone into v_tz from public.locations where id = v_sc.location_id;

  for r in select s.* from public.sessions s
            where s.schedule_id = p_schedule and s.status <> 'cancelled' and s.starts_at > now()
  loop
    if r.edited_at is null and not exists (
         select 1 from public.session_registrations g
          where g.session_id = r.id and g.status in ('booked', 'waitlisted', 'requested', 'attended')) then
      delete from public.sessions where id = r.id;   -- its court holds go with it
      v_removed := v_removed + 1;
    elsif (r.starts_at at time zone v_tz)::time = p_start_time
          and extract(dow from r.starts_at at time zone v_tz)::smallint = any (p_days)
          and (p_valid_until is null or (r.starts_at at time zone v_tz)::date <= p_valid_until) then
      -- Still fits the timetable: just follow the new courts.
      if r.edited_at is null then
        perform public.rehold_session_courts(r.id, coalesce(p_courts, '{}'));
      end if;
    else
      v_kept := v_kept || jsonb_build_object('id', r.id, 'starts_at', r.starts_at);
    end if;
  end loop;

  v_created := public.generate_sessions(v_sc.org_id, 14);
  return jsonb_build_object('rebuilt', v_removed, 'created', v_created, 'kept', v_kept);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant execute on function
  public.fill_from_waitlist(uuid),
  public.rehold_session_courts(uuid, uuid[]),
  public.session_court_ids(uuid),
  public.update_session(uuid, text, timestamptz, timestamptz, numeric, int, int, numeric, numeric, text, text, text, uuid[]),
  public.apply_session_type(uuid),
  public.update_schedule(uuid, smallint[], time, uuid[], date)
to authenticated;
revoke execute on function
  public.fill_from_waitlist(uuid),
  public.rehold_session_courts(uuid, uuid[]),
  public.session_court_ids(uuid),
  public.update_session(uuid, text, timestamptz, timestamptz, numeric, int, int, numeric, numeric, text, text, text, uuid[]),
  public.apply_session_type(uuid),
  public.update_schedule(uuid, smallint[], time, uuid[], date)
from public, anon;
