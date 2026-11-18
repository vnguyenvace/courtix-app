-- Online sign-ups: each club chooses (Settings → Booking page):
--   'instant' (default): the visitor's sign-up takes the spot straight away.
--   'approve':           it waits as a 'requested' place. Requests don't take a spot; staff
--                        approve (booked, or waitlisted if it has filled up since) or decline.
alter table public.orgs add column online_signups text not null default 'instant'
  check (online_signups in ('instant', 'approve'));

-- The public page needs to know which wording to show ("Book my place" vs "Request a place").
create or replace function public.public_club(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'currency', o.currency,
    'public_booking', o.public_booking,
    'online_signups', o.online_signups,
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'name', l.name, 'address', l.address, 'whatsapp', l.whatsapp,
               'timezone', l.timezone, 'opens_at', l.opens_at, 'closes_at', l.closes_at,
               'slot_minutes', l.slot_minutes)
             order by l.sort_order, l.name)
        from public.locations l where l.org_id = o.id and l.is_active), '[]'::jsonb)
  )
  from public.orgs o where o.slug = lower(trim(p_slug));
$$;

-- Same checks as before. In 'approve' mode the place is saved as 'requested' after the same
-- timing rules as a normal sign-up (cancelled, finished, closed, not open yet), but without
-- taking a spot. Returns {registration_id, status: 'booked' | 'waitlisted' | 'requested', price}.
create or replace function public.public_register(
  p_slug      text,
  p_session   uuid,
  p_name      text,
  p_phone     text,
  p_contact_ok boolean,
  p_marketing boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org    public.orgs;
  v_s      public.sessions;
  v_t      public.session_types;
  v_name   text := nullif(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_phone  text;
  v_tz     text;
  v_id     uuid;
  v_r      public.session_registrations;
begin
  select * into v_org from public.orgs where slug = lower(trim(p_slug));
  if not found then raise exception 'Club not found'; end if;
  if not v_org.public_booking then raise exception 'This club takes bookings by WhatsApp or at the desk'; end if;

  select s.* into v_s from public.sessions s where s.id = p_session and s.org_id = v_org.id;
  if not found then raise exception 'Session not found'; end if;
  select * into v_t from public.session_types where id = v_s.session_type_id;
  if not v_t.is_public then raise exception 'Session not found'; end if;

  if v_name is null or length(v_name) > 80 then raise exception 'Please enter your name'; end if;
  if length(v_digits) < 8 or length(v_digits) > 15 then
    raise exception 'Please enter a WhatsApp number, with country code if you are not on a Thai number';
  end if;
  if not coalesce(p_contact_ok, false) then
    raise exception 'Please tick the box so the club can contact you about this booking';
  end if;
  v_phone := case when v_digits ~ '^0[0-9]{8,9}$' then '+66' || substr(v_digits, 2) else '+' || v_digits end;

  if exists (select 1 from public.session_registrations r
              where r.session_id = v_s.id and r.guest_phone = v_phone
                and r.status in ('booked', 'waitlisted', 'requested')) then
    raise exception 'You''re already signed up for this session';
  end if;
  if (select count(*) from public.session_registrations r
       where r.org_id = v_org.id and r.source = 'online' and r.guest_phone = v_phone
         and r.created_at > now() - interval '1 day') >= 3 then
    raise exception 'That''s the most online sign-ups for one number today. Please message the club on WhatsApp';
  end if;
  if (select count(*) from public.session_registrations r
       where r.org_id = v_org.id and r.source = 'online' and r.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Online sign-ups are busy right now. Please try again in a few minutes or message the club';
  end if;

  if v_org.online_signups = 'approve' then
    -- The same timing rules register_for_session applies to everyone.
    if v_s.status = 'cancelled' then raise exception 'This session has been cancelled'; end if;
    if now() >= v_s.ends_at then raise exception 'This session has already finished'; end if;
    if now() > v_s.starts_at - make_interval(mins => v_t.book_by_minutes) then
      raise exception 'Sign-ups closed % minutes before the start', v_t.book_by_minutes;
    end if;
    if v_t.signup_opens_days is not null and now() < v_s.starts_at - make_interval(days => v_t.signup_opens_days) then
      select timezone into v_tz from public.locations where id = v_s.location_id;
      raise exception 'Sign-ups for this session open on %',
        to_char((v_s.starts_at - make_interval(days => v_t.signup_opens_days)) at time zone v_tz, 'Dy DD Mon HH24:MI');
    end if;
    insert into public.session_registrations
      (org_id, session_id, guest_name, guest_phone, status, price, source, guest_marketing_consent)
    values (v_org.id, v_s.id, v_name, v_phone, 'requested', v_s.price, 'online', coalesce(p_marketing, false))
    returning * into v_r;
  else
    -- Same rules as the desk, as a guest (never matched to a member).
    v_id := public.register_for_session(v_s.id, null, v_name, v_phone, false, false);
    update public.session_registrations
       set source = 'online', guest_marketing_consent = coalesce(p_marketing, false)
     where id = v_id
    returning * into v_r;
  end if;

  return jsonb_build_object('registration_id', v_r.id, 'status', v_r.status, 'price', v_r.price);
end;
$$;

-- Staff approve a request: booked if there's room, otherwise waitlisted. Returns the new status.
create or replace function public.approve_online_request(p_registration uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_r      public.session_registrations;
  v_s      public.sessions;
  v_booked int;
  v_status public.registration_status;
begin
  select * into v_r from public.session_registrations where id = p_registration;
  if not found then raise exception 'Sign-up not found'; end if;
  if v_r.status <> 'requested' then raise exception 'This request has already been dealt with'; end if;
  -- Lock the session so two approvals can't both take the last spot.
  select * into v_s from public.sessions where id = v_r.session_id for update;
  if v_s.status = 'cancelled' then raise exception 'This session has been cancelled'; end if;
  if now() >= v_s.ends_at then raise exception 'This session has already finished'; end if;

  select count(*) into v_booked from public.session_registrations
   where session_id = v_s.id and status in ('booked', 'attended');
  v_status := case when v_booked >= v_s.max_players then 'waitlisted' else 'booked' end;
  -- Moving up the waitlist goes by sign-up time, so an approved request joins at the back.
  update public.session_registrations set status = v_status, created_at = now() where id = v_r.id;
  return v_status::text;
end;
$$;

create or replace function public.decline_online_request(p_registration uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.session_registrations set status = 'cancelled'
   where id = p_registration and status = 'requested';
  if not found then raise exception 'This request has already been dealt with'; end if;
end;
$$;

-- A cancelled session (by staff or go / no-go) also closes its open requests.
create or replace function public.sessions_close_requests()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.session_registrations set status = 'cancelled'
   where session_id = new.id and status = 'requested';
  return new;
end;
$$;
create trigger sessions_close_requests after update of status on public.sessions
  for each row when (new.status = 'cancelled' and old.status <> 'cancelled')
  execute function public.sessions_close_requests();
revoke execute on function public.sessions_close_requests() from public, anon, authenticated;

grant execute on function public.approve_online_request(uuid), public.decline_online_request(uuid) to authenticated;
revoke execute on function public.approve_online_request(uuid), public.decline_online_request(uuid) from public, anon;
