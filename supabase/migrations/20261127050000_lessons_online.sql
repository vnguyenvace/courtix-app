-- Members and visitors book private lessons themselves (Julian, 27 Nov 2026):
--   Booking page: follows the club's online setting (orgs.online_signups), like online court
--   bookings: booked straight away (pay at the club), or held as a request staff approve.
--   Chat: Claude may hold a lesson as a REQUEST only (pending_approval); staff approve it with one
--   tap on the dashboard, and the member gets the usual confirmation. Claude never confirms a
--   paid lesson by itself (the 18 Nov rule for paid bookings by chat still holds).
-- Lesson confirmations: lessons booked at the desk for a member, and approved lesson requests,
-- send the usual "booking confirmed" notice.

-- ---------------------------------------------------------------------------
-- create_lesson: the lesson rules without the staff permission check, for book_lesson (desk),
-- the booking page and chat. Called directly by staff, the bookings RLS still applies.
-- ---------------------------------------------------------------------------
create or replace function public.create_lesson(
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

  v_id := public.create_booking(v_court, p_start, p_member, p_guest_name, 'coaching', p_minutes,
    coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'Lesson with ' || v_coach.name));
  update public.bookings set coach_id = p_coach, group_size = p_group_size, price = v_price where id = v_id;
  return v_id;
end;
$$;

-- Desk: same as before, now through create_lesson.
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
declare v_org uuid;
begin
  select org_id into v_org from public.coaches where id = p_coach;
  if v_org is null then raise exception 'Coach not found'; end if;
  if not public.has_org_permission(v_org, 'bookings.manage') then
    raise exception 'Your role can''t book lessons';
  end if;
  return public.create_lesson(p_coach, p_start, p_minutes, p_group_size, p_court, p_location, p_member, p_guest_name, p_notes);
end;
$$;

-- ---------------------------------------------------------------------------
-- When a coach can teach: start times on one day (every 30 minutes) when the coach is free and
-- a court at the location is free for the whole lesson, within opening hours.
-- For the club's staff and the chat service; the booking page uses public_lesson_times.
-- ---------------------------------------------------------------------------
create or replace function public.lesson_times_core(p_coach uuid, p_location uuid, p_day date, p_minutes int)
returns setof timestamptz language plpgsql stable security definer set search_path = '' as $$
declare
  v_coach public.coaches;
  v_loc   public.locations;
begin
  select * into v_coach from public.coaches where id = p_coach and is_active;
  if not found then return; end if;
  select * into v_loc from public.locations where id = p_location and org_id = v_coach.org_id and is_active;
  if not found then return; end if;
  if v_coach.location_ids is not null and not (v_loc.id = any (v_coach.location_ids)) then return; end if;
  if p_minutes is null or p_minutes < 15 or p_minutes > 240 then return; end if;

  return query
    select t.s from (
      select (g.t at time zone v_loc.timezone) as s
        from generate_series(p_day + v_loc.opens_at, p_day + v_loc.closes_at - make_interval(mins => p_minutes),
                             interval '30 minutes') g(t)
    ) t
    where t.s > now()
      and not exists (select 1 from public.coach_busy cb
                       where cb.coach_id = p_coach
                         and cb.during && tstzrange(t.s, t.s + make_interval(mins => p_minutes), '[)'))
      and exists (select 1 from public.courts c
                   where c.location_id = v_loc.id and c.is_active
                     and not exists (select 1 from public.bookings b
                                      where b.court_id = c.id and b.status = 'confirmed'
                                        and b.during && tstzrange(t.s, t.s + make_interval(mins => p_minutes), '[)')))
    order by t.s;
end;
$$;

-- Staff of the coach's club, or the server's own chat service (nobody signed in).
create or replace function public.lesson_free_times(p_coach uuid, p_location uuid, p_day date, p_minutes int)
returns setof timestamptz language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is not null
     and not exists (select 1 from public.coaches c where c.id = p_coach and public.is_org_staff(c.org_id)) then
    return;
  end if;
  return query select * from public.lesson_times_core(p_coach, p_location, p_day, p_minutes);
end;
$$;

-- Lesson prices as members see them: per coach, the coach's own price or the club-wide one.
create or replace function public.coach_lesson_prices(p_org uuid)
returns table (coach_id uuid, minutes int, group_size int, price numeric)
language sql stable security definer set search_path = '' as $$
  select distinct on (c.id, r.minutes, r.group_size) c.id, r.minutes, r.group_size, r.price
    from public.coaches c
    join public.lesson_rates r on r.org_id = c.org_id and (r.coach_id = c.id or r.coach_id is null)
   where c.org_id = p_org and c.is_active
   order by c.id, r.minutes, r.group_size, (r.coach_id is null);
$$;

-- ---------------------------------------------------------------------------
-- Booking page
-- ---------------------------------------------------------------------------
-- Coaches taking lessons, with their prices (only coaches that have at least one price).
create or replace function public.public_lessons(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org public.orgs;
begin
  select * into v_org from public.orgs where slug = lower(trim(p_slug));
  if not found or not v_org.public_booking then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'name', c.name, 'about', c.about, 'location_ids', c.location_ids,
             'prices', (select jsonb_agg(jsonb_build_object('minutes', p.minutes, 'group_size', p.group_size, 'price', p.price)
                                         order by p.minutes, p.group_size)
                          from public.coach_lesson_prices(v_org.id) p where p.coach_id = c.id))
           order by c.name)
      from public.coaches c
     where c.org_id = v_org.id and c.is_active
       and exists (select 1 from public.coach_lesson_prices(v_org.id) p where p.coach_id = c.id)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.public_lesson_times(p_slug text, p_coach uuid, p_location uuid, p_day date, p_minutes int)
returns setof timestamptz language plpgsql stable security definer set search_path = '' as $$
declare v_org public.orgs;
begin
  select * into v_org from public.orgs where slug = lower(trim(p_slug));
  if not found or not v_org.public_booking then return; end if;
  if not exists (select 1 from public.coaches where id = p_coach and org_id = v_org.id) then return; end if;
  if p_day > (now() at time zone v_org.timezone)::date + 14 then return; end if;
  return query select * from public.lesson_times_core(p_coach, p_location, p_day, p_minutes);
end;
$$;

-- The lesson price shown before booking (null: no price for that length and group size).
create or replace function public.public_lesson_price(p_slug text, p_coach uuid, p_minutes int, p_group_size int)
returns numeric language sql stable security definer set search_path = '' as $$
  select public.lesson_price(c.id, p_minutes, p_group_size)
    from public.coaches c join public.orgs o on o.id = c.org_id
   where c.id = p_coach and o.slug = lower(trim(p_slug)) and o.public_booking and c.is_active;
$$;

-- A visitor books (or requests) a lesson: same checks and spam limits as online court bookings.
create or replace function public.public_book_lesson(
  p_slug       text,
  p_coach      uuid,
  p_start      timestamptz,
  p_minutes    int,
  p_group_size int,
  p_location   uuid,
  p_name       text,
  p_phone      text,
  p_contact_ok boolean,
  p_marketing  boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org    public.orgs;
  v_name   text := nullif(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_phone  text;
  v_id     uuid;
  v_b      public.bookings;
begin
  select * into v_org from public.orgs where slug = lower(trim(p_slug));
  if not found then raise exception 'Club not found'; end if;
  if not v_org.public_booking then raise exception 'This club takes bookings by WhatsApp or at the desk'; end if;
  if not exists (select 1 from public.coaches where id = p_coach and org_id = v_org.id and is_active) then
    raise exception 'Coach not found';
  end if;
  if not exists (select 1 from public.locations where id = p_location and org_id = v_org.id and is_active) then
    raise exception 'Location not found';
  end if;
  if (p_start at time zone v_org.timezone)::date > (now() at time zone v_org.timezone)::date + 14 then
    raise exception 'Lessons can be booked up to two weeks ahead online. Please message the club';
  end if;
  if v_name is null or length(v_name) > 80 then raise exception 'Please enter your name'; end if;
  if length(v_digits) < 8 or length(v_digits) > 15 then
    raise exception 'Please enter a WhatsApp number, with country code if you are not on a Thai number';
  end if;
  if not coalesce(p_contact_ok, false) then
    raise exception 'Please tick the box so the club can contact you about this booking';
  end if;
  v_phone := case when v_digits ~ '^0[0-9]{8,9}$' then '+66' || substr(v_digits, 2) else '+' || v_digits end;

  if (select count(*) from public.bookings b
       where b.org_id = v_org.id and b.source = 'online' and b.guest_phone = v_phone
         and b.created_at > now() - interval '1 day') >= 3 then
    raise exception 'That''s the most online bookings for one number today. Please message the club';
  end if;
  if (select count(*) from public.bookings b
       where b.org_id = v_org.id and b.source = 'online' and b.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Online bookings are busy right now. Please try again in a few minutes or message the club';
  end if;

  v_id := public.create_lesson(p_coach, p_start, p_minutes, p_group_size, null, p_location, null, v_name,
    case when v_org.online_signups = 'approve' then 'Online lesson request: waiting for approval' else 'Lesson booked online' end);
  update public.bookings
     set source = 'online', guest_phone = v_phone, guest_marketing_consent = coalesce(p_marketing, false),
         pending_approval = (v_org.online_signups = 'approve')
   where id = v_id
  returning * into v_b;
  return jsonb_build_object('booking_id', v_b.id, 'price', v_b.price, 'pending_approval', v_b.pending_approval);
end;
$$;

-- A signed-in member books (or requests) a lesson.
create or replace function public.member_book_lesson(
  p_slug text, p_token text, p_coach uuid, p_start timestamptz, p_minutes int, p_group_size int, p_location uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_m   public.members;
  v_org public.orgs;
  v_id  uuid;
  v_b   public.bookings;
begin
  v_m := public.member_from_token(p_slug, p_token);
  select * into v_org from public.orgs where id = v_m.org_id;
  if not v_org.public_booking then raise exception 'This club takes bookings by WhatsApp or at the desk'; end if;
  if not exists (select 1 from public.coaches where id = p_coach and org_id = v_org.id and is_active) then
    raise exception 'Coach not found';
  end if;
  if (p_start at time zone v_org.timezone)::date > (now() at time zone v_org.timezone)::date + 14 then
    raise exception 'Lessons can be booked up to two weeks ahead online. Please message the club';
  end if;
  v_id := public.create_lesson(p_coach, p_start, p_minutes, p_group_size, null, p_location, v_m.id, null,
    case when v_org.online_signups = 'approve' then 'Online lesson request: waiting for approval' else 'Lesson booked online by the member' end);
  update public.bookings set source = 'online', pending_approval = (v_org.online_signups = 'approve')
   where id = v_id returning * into v_b;
  return jsonb_build_object('booking_id', v_b.id, 'price', v_b.price, 'pending_approval', v_b.pending_approval);
end;
$$;

-- ---------------------------------------------------------------------------
-- Chat: Claude holds a lesson as a request for staff to approve. Never confirmed by Claude.
-- ---------------------------------------------------------------------------
create or replace function public.chat_request_lesson(
  p_conversation uuid, p_coach uuid, p_start timestamptz, p_minutes int, p_group_size int
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_c     public.chat_conversations;
  v_org   public.orgs;
  v_coach public.coaches;
  v_loc   public.locations;
  v_id    uuid;
  v_b     public.bookings;
  v_court text;
begin
  select * into v_c from public.chat_conversations where id = p_conversation;
  if not found then raise exception 'Conversation not found'; end if;
  select * into v_org from public.orgs where id = v_c.org_id;
  if v_org.chat_mode <> 'book' then
    raise exception 'The club arranges lessons itself. Tell them a team member will help';
  end if;
  if v_c.status = 'closed' or v_c.assistant_paused_until > now() then
    raise exception 'Staff are handling this chat';
  end if;
  select * into v_coach from public.coaches where id = p_coach and org_id = v_c.org_id and is_active;
  if not found then raise exception 'Coach not found'; end if;
  if v_c.member_id is null and nullif(btrim(coalesce(v_c.contact_name, '')), '') is null then
    raise exception 'Ask for their name first';
  end if;
  if (select count(*) from public.bookings b
       where b.org_id = v_c.org_id and b.source = 'chat' and b.pending_approval
         and (b.member_id = v_c.member_id or b.guest_phone = v_c.contact_phone)) >= 3 then
    raise exception 'They already have 3 lesson requests waiting. A team member will confirm those first';
  end if;
  -- The chat's location, else the coach's first one, else the club's first.
  select * into v_loc from public.locations l
   where l.org_id = v_c.org_id and l.is_active
     and (v_coach.location_ids is null or l.id = any (v_coach.location_ids))
   order by (l.id is distinct from v_c.location_id), l.sort_order, l.name limit 1;
  if not found then raise exception '% doesn''t teach at an open location', v_coach.name; end if;

  v_id := public.create_lesson(p_coach, p_start, p_minutes, p_group_size, null, v_loc.id, v_c.member_id,
    case when v_c.member_id is null then v_c.contact_name end, 'Lesson request by chat: waiting for approval');
  update public.bookings set source = 'chat', pending_approval = true, guest_phone = v_c.contact_phone
   where id = v_id returning * into v_b;
  select name into v_court from public.courts where id = v_b.court_id;
  return jsonb_build_object(
    'status', 'requested', 'booking_id', v_b.id, 'coach', v_coach.name, 'court', v_court, 'location', v_loc.name,
    'day', to_char(p_start at time zone v_loc.timezone, 'Dy DD Mon'),
    'start', to_char(p_start at time zone v_loc.timezone, 'HH24:MI'),
    'end', to_char(upper(v_b.during) at time zone v_loc.timezone, 'HH24:MI'),
    'price', v_b.price, 'currency', v_org.currency,
    'note', 'Held for them. A team member confirms it; pay at the club.');
end;
$$;

-- ---------------------------------------------------------------------------
-- Confirmations
-- ---------------------------------------------------------------------------
-- What a lesson is called in messages: "Lesson with Coach Kimo (Court 1)".
create or replace function public.lesson_label(p_booking uuid)
returns text language sql stable security definer set search_path = '' as $$
  select 'Lesson with ' || co.name || case when b.group_size > 1 then ' for ' || b.group_size || ' people' else '' end
         || ' (' || c.name || ')'
    from public.bookings b join public.coaches co on co.id = b.coach_id join public.courts c on c.id = b.court_id
   where b.id = p_booking;
$$;

-- Desk bookings for a member: court bookings as before, plus lessons.
create or replace function public.bookings_confirm()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  b record;
begin
  select bc.*, l.timezone, bk.source, bk.coach_id into b
    from public.booking_calendar bc
    join public.locations l on l.id = bc.location_id
    join public.bookings bk on bk.id = bc.id
   where bc.id = new.id;
  if not found or b.member_id is null or b.source <> 'desk' or b.status <> 'confirmed'
     or not (b.kind in ('member', 'drop_in') or (b.kind = 'coaching' and b.coach_id is not null)) then return null; end if;
  perform public.queue_member_notice(b.org_id, b.member_id, 'booking_confirmed', 'confirmed:court:' || b.id,
    jsonb_build_object('type', 'court',
      'court', case when b.coach_id is not null then public.lesson_label(b.id) else b.court_name end,
      'location', b.location_name,
      'date', to_char(b.start_at at time zone b.timezone, 'YYYY-MM-DD'),
      'start', to_char(b.start_at at time zone b.timezone, 'HH24:MI'),
      'end', to_char(b.end_at at time zone b.timezone, 'HH24:MI'),
      'amount', b.price,
      'covered_by', case when b.kind = 'member' and b.price = 0 then 'package' end));
  return null;
end;
$$;

-- Staff decide on an online or chat request (courts and lessons). Approving a member's request
-- sends them the usual confirmation.
create or replace function public.decide_online_court(p_booking uuid, p_approve boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare b record;
begin
  if p_approve then
    update public.bookings
       set pending_approval = false,
           notes = case when coach_id is not null then 'Lesson booked ' || case when source = 'chat' then 'by chat' else 'online' end
                        else 'Booked online' end
     where id = p_booking and pending_approval and status = 'confirmed';
  else
    update public.bookings
       set pending_approval = false, status = 'cancelled',
           notes = case when coach_id is not null then 'Lesson request declined' else 'Online request declined' end
     where id = p_booking and pending_approval and status = 'confirmed';
  end if;
  if not found then raise exception 'This request was already decided or cancelled'; end if;

  if p_approve then
    select bc.*, l.timezone, bk.coach_id into b
      from public.booking_calendar bc
      join public.locations l on l.id = bc.location_id
      join public.bookings bk on bk.id = bc.id
     where bc.id = p_booking;
    if b.member_id is not null then
      perform public.queue_member_notice(b.org_id, b.member_id, 'booking_confirmed', 'confirmed:court:' || b.id,
        jsonb_build_object('type', 'court',
          'court', case when b.coach_id is not null then public.lesson_label(b.id) else b.court_name end,
          'location', b.location_name,
          'date', to_char(b.start_at at time zone b.timezone, 'YYYY-MM-DD'),
          'start', to_char(b.start_at at time zone b.timezone, 'HH24:MI'),
          'end', to_char(b.end_at at time zone b.timezone, 'HH24:MI'),
          'amount', b.price));
    end if;
  end if;
end;
$$;

grant execute on function
  public.create_lesson(uuid, timestamptz, int, int, uuid, uuid, uuid, text, text),
  public.lesson_free_times(uuid, uuid, date, int),
  public.chat_request_lesson(uuid, uuid, timestamptz, int, int)
to authenticated, service_role;
grant execute on function
  public.public_lessons(text), public.public_lesson_times(text, uuid, uuid, date, int),
  public.public_lesson_price(text, uuid, int, int),
  public.public_book_lesson(text, uuid, timestamptz, int, int, uuid, text, text, boolean, boolean),
  public.member_book_lesson(text, text, uuid, timestamptz, int, int, uuid)
to anon, authenticated;
revoke execute on function
  public.create_lesson(uuid, timestamptz, int, int, uuid, uuid, uuid, text, text),
  public.lesson_free_times(uuid, uuid, date, int),
  public.chat_request_lesson(uuid, uuid, timestamptz, int, int),
  public.coach_lesson_prices(uuid), public.lesson_label(uuid), public.lesson_times_core(uuid, uuid, date, int)
from anon, public;
revoke execute on function public.lesson_times_core(uuid, uuid, date, int) from authenticated;
grant execute on function public.lesson_label(uuid) to authenticated, service_role;
revoke execute on function
  public.public_lessons(text), public.public_lesson_times(text, uuid, uuid, date, int),
  public.public_lesson_price(text, uuid, int, int),
  public.public_book_lesson(text, uuid, timestamptz, int, int, uuid, text, text, boolean, boolean),
  public.member_book_lesson(text, text, uuid, timestamptz, int, int, uuid)
from public;

-- The member's own page lists lessons as "Lesson with Coach Kimo (Court 3)" (same as 20261126090000, one line changed).
create or replace function public.member_me(p_slug text, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_m public.members;
begin
  v_m := public.member_from_token(p_slug, p_token);
  return jsonb_build_object(
    'name', v_m.full_name,
    'first_name', split_part(v_m.full_name, ' ', 1),
    'package', (select jsonb_strip_nulls(jsonb_build_object(
                  'name', ms.package_name, 'status', ms.membership_status, 'ends_on', ms.ends_on,
                  'sessions_left', ms.sessions_left))
                  from public.member_status ms where ms.member_id = v_m.id and ms.package_name is not null),
    'late_cancel_hours', (select late_cancel_hours from public.orgs where id = v_m.org_id),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'session_id', so.id, 'name', so.name, 'location', so.location_name,
               'starts_at', so.starts_at, 'ends_at', so.ends_at, 'timezone', so.location_timezone,
               'status', r.status, 'price', r.price, 'covered', r.membership_id is not null)
             order by so.starts_at)
        from public.session_registrations r join public.session_overview so on so.id = r.session_id
       where r.member_id = v_m.id and r.status in ('booked', 'waitlisted', 'requested') and so.ends_at > now()), '[]'),
    'courts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'court', coalesce(public.lesson_label(b.id), b.court_name), 'location', b.location_name,
               'starts_at', b.start_at, 'ends_at', b.end_at, 'timezone', l.timezone, 'price', b.price)
             order by b.start_at)
        from public.booking_calendar b join public.locations l on l.id = b.location_id
       where b.member_id = v_m.id and b.status = 'confirmed' and b.session_id is null and b.end_at > now()), '[]'),
    'to_pay', (select coalesce(sum(total), 0) from public.orders where member_id = v_m.id and status = 'pending'),
    -- Each unpaid item, with its order id for the pay page (PromptPay QR).
    'unpaid', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_id', o.id, 'total', o.total, 'slip_sent', o.payer_slip_at is not null,
               'description', (select string_agg(i.description, ' · ') from public.order_items i
                                where i.order_id = o.id and i.cancelled_at is null))
             order by o.created_at)
        from public.orders o where o.member_id = v_m.id and o.status = 'pending'), '[]'));
end;
$$;
