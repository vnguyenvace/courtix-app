-- Step 6: public booking page (<slug>.courtix.app/book).
--
-- Decided with Julian (18 Nov 2026):
--   * A visitor's online sign-up TAKES THE SPOT straight away (pay at the club). Staff see new
--     online sign-ups and can cancel any that look wrong. Online payment comes in Step 7.
--   * Courts: the page shows free court times, with "WhatsApp us to book". No online court booking yet.
--
-- Security: visitors (the anon role) never touch tables. Everything they see or do goes through
-- the security-definer functions below, which return only public facts (sessions, spots left,
-- busy court times) and never anyone's name or phone. Online sign-ups are always guests at the
-- drop-in price: a phone number is never matched to a member, so nobody can use someone else's
-- package credits by typing their number.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
alter table public.orgs add column public_booking boolean not null default true;
-- Hide a session type from the public page (private coaching, staff-only courses).
alter table public.session_types add column is_public boolean not null default true;

-- Where a sign-up came from, and the guest's own consent choices (PDPA).
alter table public.session_registrations add column source text not null default 'desk'
  check (source in ('desk', 'online'));
alter table public.session_registrations add column guest_marketing_consent boolean not null default false;
create index session_regs_online_idx on public.session_registrations(org_id, created_at desc)
  where source = 'online';

-- ---------------------------------------------------------------------------
-- The club and its locations, for the page header and WhatsApp buttons.
-- ---------------------------------------------------------------------------
create or replace function public.public_club(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'currency', o.currency,
    'public_booking', o.public_booking,
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

-- Upcoming public sessions with spots left. No names, no phones.
create or replace function public.public_sessions(p_slug text, p_location uuid default null, p_days int default 14)
returns table (
  id uuid, location_id uuid, location_name text, location_timezone text,
  name text, category public.session_category, description text,
  starts_at timestamptz, ends_at timestamptz, price numeric,
  max_players int, spots_left int, level_min numeric, level_max numeric, min_age int,
  coach_name text, book_by timestamptz, signups_open_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select s.id, s.location_id, l.name, l.timezone,
         coalesce(s.title, t.name), t.category, coalesce(s.description, t.description),
         s.starts_at, s.ends_at, s.price,
         s.max_players,
         greatest(s.max_players - (select count(*) from public.session_registrations r
                                    where r.session_id = s.id and r.status in ('booked', 'attended')), 0)::int,
         s.level_min, s.level_max, t.min_age,
         s.coach_name,
         s.starts_at - make_interval(mins => t.book_by_minutes),
         case when t.signup_opens_days is null then null
              else s.starts_at - make_interval(days => t.signup_opens_days) end
    from public.orgs o
    join public.sessions s on s.org_id = o.id
    join public.session_types t on t.id = s.session_type_id
    join public.locations l on l.id = s.location_id
   where o.slug = lower(trim(p_slug))
     and o.public_booking
     and t.is_public
     and l.is_active
     and s.status <> 'cancelled'
     and s.ends_at > now()
     and s.starts_at < now() + make_interval(days => least(greatest(coalesce(p_days, 14), 1), 31))
     and (p_location is null or s.location_id = p_location)
   order by s.starts_at, l.sort_order;
$$;

-- Court times for one day at one location: which slots are free. No booking details.
create or replace function public.public_court_slots(p_slug text, p_location uuid, p_day date)
returns table (court_id uuid, court_name text, slot_start timestamptz, slot_end timestamptz, is_free boolean)
language sql stable security definer set search_path = '' as $$
  with loc as (
    select l.* from public.locations l
      join public.orgs o on o.id = l.org_id
     where o.slug = lower(trim(p_slug)) and o.public_booking and l.id = p_location and l.is_active
       and p_day between (now() at time zone l.timezone)::date and (now() at time zone l.timezone)::date + 14
  ),
  slots as (
    -- Local wall-clock times on that day, turned into real moments in the location's time zone.
    select t at time zone loc.timezone as s0,
           (t + make_interval(mins => loc.slot_minutes)) at time zone loc.timezone as s1
      from loc,
           generate_series(p_day + loc.opens_at,
                           p_day + loc.closes_at - make_interval(mins => loc.slot_minutes),
                           make_interval(mins => loc.slot_minutes)) as t
  )
  select c.id, c.name, sl.s0, sl.s1,
         sl.s1 > now() and not exists (
           select 1 from public.bookings b
            where b.court_id = c.id and b.status = 'confirmed'
              and b.during && tstzrange(sl.s0, sl.s1, '[)'))
    from loc
    join public.courts c on c.location_id = loc.id and c.is_active
    cross join slots sl
   order by c.sort_order, c.name, sl.s0;
$$;

-- ---------------------------------------------------------------------------
-- A visitor signs up. Uses register_for_session, so every club rule still applies
-- (capacity and waitlist, cut-off, sign-up window, cancelled sessions).
-- Limits against spam: one live place per phone per session, 3 online sign-ups per phone
-- per day, and 60 online sign-ups per club per hour.
-- Returns {registration_id, status: 'booked' | 'waitlisted', price}.
-- ---------------------------------------------------------------------------
create or replace function public.public_register(
  p_slug      text,
  p_session   uuid,
  p_name      text,
  p_phone     text,
  p_contact_ok boolean,          -- required: the club may contact them about this booking
  p_marketing boolean default false  -- optional: news and offers
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org    public.orgs;
  v_s      public.sessions;
  v_t      public.session_types;
  v_name   text := nullif(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_phone  text;
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
  -- Thai numbers: 08x... becomes +668x...; anything else keeps its country code.
  v_phone := case when v_digits ~ '^0[0-9]{8,9}$' then '+66' || substr(v_digits, 2) else '+' || v_digits end;

  if exists (select 1 from public.session_registrations r
              where r.session_id = v_s.id and r.guest_phone = v_phone and r.status in ('booked', 'waitlisted')) then
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

  -- Same rules as the desk, as a guest (never matched to a member: see the note at the top).
  v_id := public.register_for_session(v_s.id, null, v_name, v_phone, false, false);
  update public.session_registrations
     set source = 'online', guest_marketing_consent = coalesce(p_marketing, false)
   where id = v_id
  returning * into v_r;

  return jsonb_build_object('registration_id', v_r.id, 'status', v_r.status, 'price', v_r.price);
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff: the roster shows where each place came from (columns appended at the end).
-- ---------------------------------------------------------------------------
create or replace view public.session_roster with (security_invoker = true) as
select
  r.id, r.org_id, r.session_id, r.member_id,
  coalesce(m.full_name, r.guest_name) as name,
  r.member_id is null as is_guest,
  coalesce(m.phone, r.guest_phone) as phone,
  m.language, m.skill_level,
  r.status, r.price, r.notes, r.created_at,
  r.membership_id,
  r.credit_used,
  p.name as covered_by,
  p.kind as covered_kind,
  ms.sessions_left,
  r.source
from public.session_registrations r
left join public.members m on m.id = r.member_id
left join public.memberships ms on ms.id = r.membership_id
left join public.package_types p on p.id = ms.package_type_id;

-- ---------------------------------------------------------------------------
-- Grants: these four are the only things visitors can call.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.public_club(text),
  public.public_sessions(text, uuid, int),
  public.public_court_slots(text, uuid, date),
  public.public_register(text, uuid, text, text, boolean, boolean)
from public;
grant execute on function
  public.public_club(text),
  public.public_sessions(text, uuid, int),
  public.public_court_slots(text, uuid, date),
  public.public_register(text, uuid, text, text, boolean, boolean)
to anon, authenticated;
