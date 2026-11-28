-- Front-desk fixes (Julian, 28 Nov 2026):
-- 1. Scheduled pauses: a pause from a future date leaves the package active until that day; the
--    hourly job starts it. Packages don't cover bookings inside a planned pause. Staff can cancel
--    a planned pause, or end a running one early (the end date moves back by the unused days).
-- 2. Check-ins at the desk: a paused package asks first; a second check-in within 2 hours is
--    ignored (it would have used a second session-pack credit).
-- 3. "Court 2 is already booked" now says what holds it: "Court 2 is held by Open play (08:30–11:30)".

-- ---------------------------------------------------------------------------
-- 1. Pauses
-- ---------------------------------------------------------------------------

-- True when the package is (or will be) paused on that day.
create or replace function public.paused_on(p_from date, p_until date, p_day date)
returns boolean language sql immutable set search_path = '' as $$
  select p_from is not null and p_until is not null and p_day >= p_from and p_day < p_until;
$$;

create or replace function public.pause_membership(p_membership uuid, p_from date, p_until date)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_m     public.memberships;
  v_today date;
begin
  select * into v_m from public.memberships where id = p_membership;
  if not found then raise exception 'Package not found'; end if;
  select (now() at time zone o.timezone)::date into v_today from public.orgs o where o.id = v_m.org_id;
  if p_from is null or p_until is null then raise exception 'Choose both pause dates'; end if;
  if p_until <= p_from then raise exception 'Pause must end after it starts'; end if;
  if p_from < v_today then raise exception 'A pause can''t start in the past'; end if;
  if v_m.status <> 'active' then raise exception 'Only an active membership can be paused'; end if;
  if v_m.paused_until is not null and v_m.paused_until > v_today then
    raise exception 'A pause is already planned for this package. Cancel it first to change the dates';
  end if;
  if v_m.ends_on is not null and p_from > v_m.ends_on then
    raise exception 'The pause must start before the package ends (%)', to_char(v_m.ends_on, 'DD Mon YYYY');
  end if;
  update public.memberships
     set paused_from = p_from, paused_until = p_until,
         ends_on = case when ends_on is null then null else ends_on + (p_until - p_from) end,
         status = case when p_from <= v_today then 'paused'::public.membership_status else status end
   where id = p_membership;
  if not found then raise exception 'Package not found'; end if;
end;
$$;

-- Cancel a planned pause, or end a running one today. Returns 'cancelled' or 'ended'.
create or replace function public.end_pause(p_membership uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_m     public.memberships;
  v_today date;
begin
  select * into v_m from public.memberships where id = p_membership;
  if not found then raise exception 'Package not found'; end if;
  select (now() at time zone o.timezone)::date into v_today from public.orgs o where o.id = v_m.org_id;
  if v_m.status = 'active' and v_m.paused_from > v_today then
    update public.memberships
       set ends_on = case when ends_on is null then null else ends_on - (v_m.paused_until - v_m.paused_from) end,
           paused_from = null, paused_until = null
     where id = p_membership;
    if not found then raise exception 'Package not found'; end if;
    return 'cancelled';
  end if;
  if v_m.status = 'paused' then
    update public.memberships
       set ends_on = case when ends_on is null then null else ends_on - greatest(v_m.paused_until - v_today, 0) end,
           paused_until = v_today,
           status = 'active'
     where id = p_membership;
    if not found then raise exception 'Package not found'; end if;
    return 'ended';
  end if;
  raise exception 'This package has no pause to cancel';
end;
$$;
grant execute on function public.end_pause(uuid) to authenticated;
revoke execute on function public.end_pause(uuid) from anon, public;

-- Hourly housekeeping: resume finished pauses, start planned ones, expire finished packages.
create or replace function public.refresh_membership_statuses()
returns void language sql security definer set search_path = '' as $$
  update public.memberships m set status = 'active'
    from public.orgs o
   where o.id = m.org_id and m.status = 'paused'
     and m.paused_until <= (now() at time zone o.timezone)::date;
  update public.memberships m set status = 'paused'
    from public.orgs o
   where o.id = m.org_id and m.status = 'active'
     and public.paused_on(m.paused_from, m.paused_until, (now() at time zone o.timezone)::date);
  update public.memberships m set status = 'expired'
    from public.orgs o
   where o.id = m.org_id and m.status = 'active'
     and ((m.ends_on is not null and m.ends_on < (now() at time zone o.timezone)::date)
          or m.sessions_left = 0);
$$;
revoke execute on function public.refresh_membership_statuses() from public, anon, authenticated;

-- Packages don't cover sessions inside a planned pause.
create or replace function public.session_coverage(p_member uuid, p_session uuid)
returns uuid language sql stable security invoker set search_path = '' as $$
  select m.id
    from public.sessions s
    join public.locations l on l.id = s.location_id
    join public.memberships m on m.org_id = s.org_id and m.member_id = p_member
    join public.package_types p on p.id = m.package_type_id
   where s.id = p_session
     and m.status = 'active'
     and m.starts_on <= (s.starts_at at time zone l.timezone)::date
     and (m.ends_on is null or m.ends_on >= (s.starts_at at time zone l.timezone)::date)
     and not public.paused_on(m.paused_from, m.paused_until, (s.starts_at at time zone l.timezone)::date)
     and (p.kind = 'time_based' or coalesce(m.sessions_left, 0) > 0)
     and public.package_covers_session(p.id, s.id)
   order by (p.kind = 'time_based') desc, m.ends_on nulls last, m.starts_on, m.created_at
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. What holds a court (used by create_booking's message)
-- ---------------------------------------------------------------------------
create or replace function public.court_clash_text(p_court uuid, p_during tstzrange)
returns text language plpgsql stable security invoker set search_path = '' as $$
declare
  v_court text;
  v_tz    text;
  r       record;
begin
  select c.name, l.timezone into v_court, v_tz
    from public.courts c join public.locations l on l.id = c.location_id where c.id = p_court;
  select b.kind, b.during, s.id as session_id, coalesce(s.title, st.name) as session_name
    into r
    from public.bookings b
    left join public.sessions s on s.id = b.session_id
    left join public.session_types st on st.id = s.session_type_id
   where b.court_id = p_court and b.status = 'confirmed' and b.during && p_during
   order by lower(b.during) limit 1;
  if not found then return format('%s is already booked at that time', v_court); end if;
  if r.session_id is not null then
    return format('%s is held by %s (%s–%s) at that time', v_court, r.session_name,
      to_char(lower(r.during) at time zone v_tz, 'HH24:MI'), to_char(upper(r.during) at time zone v_tz, 'HH24:MI'));
  end if;
  return format('%s is already booked %s–%s%s', v_court,
    to_char(lower(r.during) at time zone v_tz, 'HH24:MI'), to_char(upper(r.during) at time zone v_tz, 'HH24:MI'),
    case r.kind when 'coaching' then ' (lesson)' when 'maintenance' then ' (maintenance)'
                when 'open_play' then ' (open play)' else '' end);
end;
$$;
grant execute on function public.court_clash_text(uuid, tstzrange) to authenticated;
revoke execute on function public.court_clash_text(uuid, tstzrange) from anon, public;

-- create_booking: as before, except packages don't count on days inside a planned pause,
-- and a clash says what holds the court.
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
       and not public.paused_on(m.paused_from, m.paused_until, v_local::date)
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
    raise exception '%', public.court_clash_text(v_court.id, tstzrange(p_start, v_end, '[)'));
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. Desk check-ins
-- ---------------------------------------------------------------------------
-- Returns {status: 'checked_in' | 'already' | 'paused', at, until}.
--   already: checked in (desk, QR or booking) in the last 2 hours; nothing recorded.
--   paused:  no package they can use today, and one is paused; staff confirm with p_confirm_paused.
create or replace function public.check_in_member(p_member uuid, p_location uuid, p_confirm_paused boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_m     public.members;
  v_tz    text;
  v_today date;
  v_last  timestamptz;
  v_until date;
begin
  select * into v_m from public.members where id = p_member;
  if not found then raise exception 'Member not found'; end if;
  select coalesce(l.timezone, o.timezone), (now() at time zone o.timezone)::date into v_tz, v_today
    from public.orgs o left join public.locations l on l.id = p_location and l.org_id = o.id
   where o.id = v_m.org_id;

  select max(checked_in_at) into v_last from public.check_ins
   where org_id = v_m.org_id and member_id = p_member and source <> 'session'
     and checked_in_at > now() - interval '2 hours';
  if v_last is not null then
    return jsonb_build_object('status', 'already', 'at', to_char(v_last at time zone v_tz, 'HH24:MI'));
  end if;

  if not p_confirm_paused
     and not exists (select 1 from public.memberships
                      where org_id = v_m.org_id and member_id = p_member and status = 'active'
                        and starts_on <= v_today and (ends_on is null or ends_on >= v_today)
                        and not public.paused_on(paused_from, paused_until, v_today)) then
    select max(paused_until) into v_until from public.memberships
     where org_id = v_m.org_id and member_id = p_member
       and (status = 'paused' or public.paused_on(paused_from, paused_until, v_today));
    if v_until is not null then
      return jsonb_build_object('status', 'paused', 'until', v_until);
    end if;
  end if;

  insert into public.check_ins (org_id, member_id, source, location_id)
  values (v_m.org_id, p_member, 'desk', p_location);
  return jsonb_build_object('status', 'checked_in');
end;
$$;
grant execute on function public.check_in_member(uuid, uuid, boolean) to authenticated;
revoke execute on function public.check_in_member(uuid, uuid, boolean) from anon, public;

-- Backstop for every other path (two staff at once, future QR check-in): a live check-in within
-- 2 hours of the last one is refused, so no second session-pack credit is used. Session
-- attendance ("Attended") and imported or back-dated rows aren't affected.
create or replace function public.check_ins_no_repeat()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_last timestamptz;
begin
  if new.source in ('session', 'import') or new.checked_in_at < now() - interval '5 minutes' then return new; end if;
  select max(checked_in_at) into v_last from public.check_ins
   where org_id = new.org_id and member_id = new.member_id and source <> 'session'
     and checked_in_at > new.checked_in_at - interval '2 hours';
  if v_last is not null then
    raise exception 'Already checked in at %',
      to_char(v_last at time zone (select timezone from public.orgs where id = new.org_id), 'HH24:MI');
  end if;
  return new;
end;
$$;
create trigger check_ins_no_repeat before insert on public.check_ins
  for each row execute function public.check_ins_no_repeat();
