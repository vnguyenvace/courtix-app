-- Step 4: event tickets (Julian, 28 Nov 2026).
--   * Price tiers (session_price_tiers): e.g. early bird 2,500 until 15 Nov, then 3,300. At sign-up
--     the cheapest tier still open wins: open until its date and, if set, until N places are sold at
--     that price. People keep the price they signed up at. No tiers = the session price.
--   * Divisions (session_divisions): an event's places split into divisions (beginner / open), each
--     with its own places and optional level range. Price comes from the tiers (not per division).
--   * Pairs (sessions.allow_pairs): one sign-up with a partner's name takes 2 places and costs 2 x the
--     per-person price, paid by the person signing up (one payment). Packages don't cover pairs.
--   * Registration deadline (sessions.registration_deadline), separate from the type's book_by.
-- Every count of booked places is now a sum of session_registrations.spots. Moving up the waitlist
-- takes the first person who fits (a pair waits if only 1 place is free; a single behind it may go).

alter table public.sessions
  add column allow_pairs boolean not null default false,
  add column registration_deadline timestamptz;

create table public.session_divisions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  session_id  uuid not null,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  max_players int not null check (max_players between 1 and 500),
  level_min   numeric(2,1) check (level_min between 1 and 6),
  level_max   numeric(2,1) check (level_max between 1 and 6),
  sort_order  int not null default 0,
  unique (org_id, id),
  unique (session_id, name),
  foreign key (org_id, session_id) references public.sessions(org_id, id) on delete cascade
);

create table public.session_price_tiers (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  session_id      uuid not null,
  label           text not null check (char_length(btrim(label)) between 1 and 60),
  price           numeric(10,2) not null check (price >= 0),
  available_until timestamptz,          -- null = no end date
  max_qty         int check (max_qty between 1 and 1000),   -- places at this price; null = no limit
  sort_order      int not null default 0,
  unique (org_id, id),
  foreign key (org_id, session_id) references public.sessions(org_id, id) on delete cascade
);
create index session_price_tiers_session_idx on public.session_price_tiers(session_id);

alter table public.session_registrations
  add column spots int not null default 1 check (spots in (1, 2)),
  add column partner_name text check (char_length(partner_name) <= 80),
  add column division_id uuid,
  add column tier_id uuid,
  add constraint session_regs_division_fk foreign key (org_id, division_id) references public.session_divisions(org_id, id) on delete set null (division_id),
  add constraint session_regs_tier_fk foreign key (org_id, tier_id) references public.session_price_tiers(org_id, id) on delete set null (tier_id),
  add constraint session_regs_pair_partner check (spots = 1 or partner_name is not null);

alter table public.session_divisions enable row level security;
alter table public.session_price_tiers enable row level security;
create policy session_divisions_select on public.session_divisions for select to authenticated using (public.is_org_staff(org_id));
create policy session_divisions_write on public.session_divisions for all to authenticated
  using (public.has_org_permission(org_id, 'club.setup')) with check (public.has_org_permission(org_id, 'club.setup'));
create policy session_price_tiers_select on public.session_price_tiers for select to authenticated using (public.is_org_staff(org_id));
create policy session_price_tiers_write on public.session_price_tiers for all to authenticated
  using (public.has_org_permission(org_id, 'club.setup')) with check (public.has_org_permission(org_id, 'club.setup'));
create policy session_divisions_support_view on public.session_divisions for select to authenticated using (public.support_can_view(org_id));
create policy session_price_tiers_support_view on public.session_price_tiers for select to authenticated using (public.support_can_view(org_id));
grant select, insert, update, delete on public.session_divisions, public.session_price_tiers to authenticated;
revoke all on public.session_divisions, public.session_price_tiers from anon;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- The price for a new sign-up of p_spots places: the cheapest tier still open, else the session
-- price. No row (null price) when the event has tiers and none is open any more (sold out).
create or replace function public.event_price(p_session uuid, p_spots int default 1)
returns table (tier_id uuid, price numeric, label text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.session_price_tiers t where t.session_id = p_session) then
    return query select null::uuid, s.price, null::text from public.sessions s where s.id = p_session;
    return;
  end if;
  return query
    select t.id, t.price, t.label
      from public.session_price_tiers t
     where t.session_id = p_session
       and (t.available_until is null or t.available_until > now())
       and (t.max_qty is null or
            (select coalesce(sum(r.spots), 0) from public.session_registrations r
              where r.tier_id = t.id and r.status in ('booked', 'waitlisted', 'requested', 'attended', 'no_show'))
            + coalesce(p_spots, 1) <= t.max_qty)
     order by t.price, t.sort_order
     limit 1;
end;
$$;

-- Do p_spots more places fit in the session (and in the division, if any)?
create or replace function public.places_fit(p_session uuid, p_division uuid, p_spots int)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select coalesce(sum(r.spots), 0) from public.session_registrations r
           where r.session_id = p_session and r.status in ('booked', 'attended')) + coalesce(p_spots, 1)
         <= (select s.max_players from public.sessions s where s.id = p_session)
     and (p_division is null or
          (select coalesce(sum(r.spots), 0) from public.session_registrations r
            where r.division_id = p_division and r.status in ('booked', 'attended')) + coalesce(p_spots, 1)
          <= (select d.max_players from public.session_divisions d where d.id = p_division));
$$;

-- Move people up from the waitlist while places are free: in sign-up order, the first who fits.
create or replace function public.fill_from_waitlist(p_session uuid)
returns int language plpgsql security invoker set search_path = '' as $$
declare
  v_s     public.sessions;
  v_moved int := 0;
  r       record;
begin
  select * into v_s from public.sessions where id = p_session;
  if v_s.status = 'cancelled' or now() >= v_s.starts_at then return 0; end if;
  for r in select id, division_id, spots from public.session_registrations
            where session_id = p_session and status = 'waitlisted' order by created_at
  loop
    if public.places_fit(p_session, r.division_id, r.spots) then
      update public.session_registrations set status = 'booked' where id = r.id;
      if r.spots = 1 then perform public.apply_session_coverage(r.id); end if;
      v_moved := v_moved + 1;
    end if;
  end loop;
  return v_moved;
end;
$$;

-- Owner/admin: pairs on or off and the registration deadline for one session.
create or replace function public.set_event_options(p_session uuid, p_allow_pairs boolean, p_deadline timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_s public.sessions;
begin
  select * into v_s from public.sessions where id = p_session;
  if not found then raise exception 'Session not found'; end if;
  if not public.has_org_permission(v_s.org_id, 'club.setup') then
    raise exception 'Only the owner or an admin can change event tickets';
  end if;
  if p_deadline is not null and p_deadline > v_s.starts_at then
    raise exception 'The registration deadline must be before the event starts';
  end if;
  if not coalesce(p_allow_pairs, false) and exists (
       select 1 from public.session_registrations where session_id = p_session and spots = 2
          and status in ('booked', 'waitlisted', 'requested')) then
    raise exception 'Pairs are already signed up. Cancel their places before turning pairs off';
  end if;
  update public.sessions set allow_pairs = coalesce(p_allow_pairs, false), registration_deadline = p_deadline,
         edited_at = coalesce(edited_at, now())
   where id = p_session;
end;
$$;

-- Booking page: an event's tiers (with the current one), divisions with places left, pairs, deadline.
create or replace function public.public_event_options(p_slug text, p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_s   public.sessions;
  v_cur record;
begin
  select s.* into v_s from public.sessions s join public.orgs o on o.id = s.org_id
    join public.session_types t on t.id = s.session_type_id
   where s.id = p_session and o.slug = lower(trim(p_slug)) and o.public_booking and t.is_public;
  if not found then return null; end if;
  select * into v_cur from public.event_price(v_s.id, 1);
  return jsonb_build_object(
    'allow_pairs', v_s.allow_pairs,
    'registration_deadline', v_s.registration_deadline,
    'current_tier', v_cur.tier_id,
    'current_price', v_cur.price,
    'tiers', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label, 'price', t.price,
                                       'available_until', t.available_until, 'max_qty', t.max_qty)
                                       order by t.price, t.sort_order)
                        from public.session_price_tiers t where t.session_id = v_s.id), '[]'::jsonb),
    'divisions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'level_min', d.level_min,
                                       'level_max', d.level_max,
                                       'places_left', greatest(d.max_players - (select coalesce(sum(r.spots), 0)
                                           from public.session_registrations r
                                          where r.division_id = d.id and r.status in ('booked', 'attended')), 0))
                                       order by d.sort_order, d.name)
                            from public.session_divisions d where d.session_id = v_s.id), '[]'::jsonb));
end;
$$;

-- Packages: an uncovered member pays the price they signed up at (their tier), not the base price.
create or replace function public.apply_session_coverage(p_registration uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_r    public.session_registrations;
  v_s    public.sessions;
  v_m    uuid;
  v_kind public.package_kind;
  v_price numeric;
begin
  select * into v_r from public.session_registrations where id = p_registration;
  if v_r.member_id is null or v_r.status <> 'booked' or v_r.credit_used then return; end if;
  select * into v_s from public.sessions where id = v_r.session_id;
  -- Not covered: the price they signed up at (their tier, if any), per person.
  v_price := coalesce((select t.price from public.session_price_tiers t where t.id = v_r.tier_id), v_s.price) * v_r.spots;

  v_m := public.session_coverage(v_r.member_id, v_r.session_id);
  if v_m is null then
    update public.session_registrations set membership_id = null, price = v_price where id = v_r.id;
    return;
  end if;

  select p.kind into v_kind
    from public.memberships m join public.package_types p on p.id = m.package_type_id
   where m.id = v_m;
  if v_kind = 'class_pack' then
    update public.memberships set sessions_left = sessions_left - 1
     where id = v_m and sessions_left > 0;
    if not found then
      update public.session_registrations set membership_id = null, price = v_price where id = v_r.id;
      return;
    end if;
  end if;

  update public.session_registrations
     set membership_id = v_m, price = 0, credit_used = (v_kind = 'class_pack')
   where id = v_r.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Everything that counted places now sums spots (same as before otherwise)
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
  least(coalesce(s.registration_deadline, 'infinity'::timestamptz), s.starts_at - make_interval(mins => t.book_by_minutes)) as book_by,
  (select string_agg(c.name, ', ' order by c.sort_order)
     from public.bookings b join public.courts c on c.id = b.court_id
    where b.session_id = s.id and b.status = 'confirmed') as courts,
  s.location_id,
  l.name as location_name,
  l.timezone as location_timezone,
  s.allow_pairs,
  s.registration_deadline,
  exists (select 1 from public.session_divisions d where d.session_id = s.id) as has_divisions,
  exists (select 1 from public.session_price_tiers pt where pt.session_id = s.id) as has_tiers
from public.sessions s
join public.session_types t on t.id = s.session_type_id
join public.locations l on l.id = s.location_id
left join (
  select r.session_id,
         coalesce(sum(r.spots) filter (where r.status in ('booked', 'attended')), 0) as booked,
         coalesce(sum(r.spots) filter (where r.status = 'waitlisted'), 0) as waitlisted
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
  r.status, r.price, r.notes, r.created_at,
  r.membership_id,
  r.credit_used,
  p.name as covered_by,
  p.kind as covered_kind,
  ms.sessions_left,
  r.source,
  r.spots,
  r.partner_name,
  r.division_id,
  d.name as division_name,
  pt.label as tier_label
from public.session_registrations r
left join public.members m on m.id = r.member_id
left join public.memberships ms on ms.id = r.membership_id
left join public.package_types p on p.id = ms.package_type_id
left join public.session_divisions d on d.id = r.division_id
left join public.session_price_tiers pt on pt.id = r.tier_id;

drop function public.register_for_session(uuid, uuid, text, text, boolean, boolean);
drop function public.public_register(text, uuid, text, text, boolean, boolean);
drop function public.member_book_session(text, text, uuid);

create or replace function public.register_for_session(
  p_session     uuid,
  p_member      uuid default null,
  p_guest_name  text default null,
  p_guest_phone text default null,
  p_allow_late  boolean default false,  -- desk override for sign-up times ("closed" or "not open yet")
  p_ignore_level boolean default false,  -- desk override for level limits
  p_spots        int default 1,          -- 2 = a pair (one sign-up, two places, paid by the person signing up)
  p_partner_name text default null,      -- the pair's second player
  p_division     uuid default null       -- required when the event has divisions
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_s        public.sessions;
  v_t        public.session_types;
  v_level    numeric;
  v_booked   int;
  v_status   public.registration_status;
  v_priority int := 0;
  v_opens    timestamptz;
  v_tz       text;
  v_id       uuid;
  v_div      public.session_divisions;
  v_tier     uuid;
  v_price    numeric;
  v_partner  text := nullif(btrim(coalesce(p_partner_name, '')), '');
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
  if not p_allow_late and v_s.registration_deadline is not null and now() > v_s.registration_deadline then
    select timezone into v_tz from public.locations where id = v_s.location_id;
    raise exception 'Registration closed on %', to_char(v_s.registration_deadline at time zone v_tz, 'Dy DD Mon HH24:MI');
  end if;
  -- Pairs and divisions.
  if coalesce(p_spots, 1) not in (1, 2) then raise exception 'A sign-up is for 1 person or a pair'; end if;
  if p_spots = 2 and not v_s.allow_pairs then raise exception 'This session takes single sign-ups only'; end if;
  if p_spots = 2 and v_partner is null then raise exception 'Enter the partner''s name'; end if;
  if p_spots = 1 then v_partner := null; end if;
  if exists (select 1 from public.session_divisions d where d.session_id = v_s.id) then
    select * into v_div from public.session_divisions where id = p_division and session_id = v_s.id;
    if not found then raise exception 'Choose a division'; end if;
  elsif p_division is not null then
    raise exception 'This session has no divisions';
  end if;
  if not p_allow_late and now() > v_s.starts_at - make_interval(mins => v_t.book_by_minutes) then
    raise exception 'Sign-ups closed % minutes before the start', v_t.book_by_minutes;
  end if;

  -- Sign-up window, with priority days for members whose package covers this session.
  if v_t.signup_opens_days is not null and not p_allow_late then
    if p_member is not null then
      select coalesce(max(p.priority_days), 0) into v_priority
        from public.memberships m
        join public.package_types p on p.id = m.package_type_id
       where m.member_id = p_member and m.org_id = v_s.org_id and m.status = 'active'
         and p.priority_days > 0
         and public.package_covers_session(p.id, v_s.id);
    end if;
    v_opens := v_s.starts_at - make_interval(days => v_t.signup_opens_days + v_priority);
    if now() < v_opens then
      select timezone into v_tz from public.locations where id = v_s.location_id;
      raise exception 'Sign-ups for this session open on %',
        to_char(v_opens at time zone v_tz, 'Dy DD Mon HH24:MI');
    end if;
  end if;

  -- Level: the division's range if it has one, else the session's.
  if p_member is not null and not p_ignore_level
     and (coalesce(v_div.level_min, v_s.level_min) is not null or coalesce(v_div.level_max, v_s.level_max) is not null) then
    select skill_level into v_level from public.members where id = p_member;
    if v_level is not null and (v_level < coalesce(v_div.level_min, v_s.level_min, 0) or v_level > coalesce(v_div.level_max, v_s.level_max, 9)) then
      raise exception 'This session is for levels % to %, and this member is %',
        coalesce(coalesce(v_div.level_min, v_s.level_min)::text, 'any'), coalesce(coalesce(v_div.level_max, v_s.level_max)::text, 'any'), v_level;
    end if;
  end if;

  -- Price: the cheapest price tier still open (early bird…), else the session price. Per person.
  select e.tier_id, e.price into v_tier, v_price from public.event_price(v_s.id, coalesce(p_spots, 1)) e;
  if v_price is null then raise exception 'This event is sold out'; end if;

  v_status := case when public.places_fit(v_s.id, v_div.id, coalesce(p_spots, 1)) then 'booked' else 'waitlisted' end;

  insert into public.session_registrations (org_id, session_id, member_id, guest_name, guest_phone, status, price,
                                            spots, partner_name, division_id, tier_id)
  values (v_s.org_id, v_s.id, p_member, nullif(trim(p_guest_name), ''), nullif(trim(p_guest_phone), ''),
          v_status, v_price * coalesce(p_spots, 1), coalesce(p_spots, 1), v_partner, v_div.id, v_tier)
  returning id into v_id;

  -- Booked: use the package now. Waitlisted: only when they move up (see cancel_registration).
  -- Show the waitlist price the member would pay if covered right now. A pair isn't covered
  -- by one member's package: they pay for both.
  if coalesce(p_spots, 1) = 1 then
    if v_status = 'booked' then
      perform public.apply_session_coverage(v_id);
    elsif p_member is not null and public.session_coverage(p_member, v_s.id) is not null then
      update public.session_registrations set price = 0 where id = v_id;
    end if;
  end if;

  return v_id;
exception
  when unique_violation then
    raise exception 'This member is already signed up for this session';
end;
$$;

create or replace function public.cancel_registration(p_registration uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_r        public.session_registrations;
  v_s        public.sessions;
  v_hours    int;
  v_promoted uuid;
begin
  select * into v_r from public.session_registrations where id = p_registration;
  if not found then raise exception 'Sign-up not found'; end if;
  select * into v_s from public.sessions where id = v_r.session_id for update;

  update public.session_registrations set status = 'cancelled'
   where id = p_registration and status in ('booked', 'waitlisted');

  select late_cancel_hours into v_hours from public.orgs where id = v_r.org_id;
  if v_r.status in ('booked', 'waitlisted')
     and now() <= v_s.starts_at - make_interval(hours => v_hours) then
    perform public.refund_session_credit(v_r.id);
  end if;

  -- Places freed: move people up from the waitlist (a pair needs 2 places; divisions fill separately).
  if v_r.status = 'booked' and v_s.status <> 'cancelled' and now() < v_s.starts_at then
    if public.fill_from_waitlist(v_s.id) > 0 then
      select id into v_promoted from public.session_registrations
       where session_id = v_s.id and status = 'booked' order by created_at desc limit 1;
    end if;
  end if;

  return v_promoted;
end;
$$;

create or replace function public.check_session_minimums(p_org uuid default null)
returns table (session_id uuid, outcome text, booked int, min_players int)
language plpgsql security definer set search_path = '' as $$
declare
  r     record;
  v_reg record;
begin
  if auth.uid() is not null and (p_org is null or not public.is_org_staff(p_org)) then
    raise exception 'Not allowed';
  end if;

  for r in
    select s.id, s.min_players as minp,
           (select coalesce(sum(g.spots), 0) from public.session_registrations g
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
      for v_reg in select sr.id from public.session_registrations sr
                    where sr.session_id = r.id and sr.credit_used and sr.status = 'booked' loop
        perform public.refund_session_credit(v_reg.id);
      end loop;
      update public.session_registrations set status = 'cancelled'
       where session_registrations.session_id = r.id and status in ('booked', 'waitlisted');
      session_id := r.id; outcome := 'cancelled'; booked := r.n; min_players := r.minp;
    end if;
    return next;
  end loop;
end;
$$;

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
  select coalesce(sum(spots), 0) into v_booked from public.session_registrations
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
    select coalesce(sum(spots), 0) into v_booked from public.session_registrations
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
         s.starts_at, s.ends_at, coalesce((select e.price from public.event_price(s.id) e), s.price),
         s.max_players,
         greatest(s.max_players - (select coalesce(sum(r.spots), 0) from public.session_registrations r
                                    where r.session_id = s.id and r.status in ('booked', 'attended')), 0)::int,
         s.level_min, s.level_max, t.min_age,
         s.coach_name,
         least(coalesce(s.registration_deadline, 'infinity'::timestamptz), s.starts_at - make_interval(mins => t.book_by_minutes)),
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

  v_status := case when public.places_fit(v_s.id, v_r.division_id, v_r.spots) then 'booked' else 'waitlisted' end;
  -- Moving up the waitlist goes by sign-up time, so an approved request joins at the back.
  update public.session_registrations set status = v_status, created_at = now() where id = v_r.id;
  return v_status::text;
end;
$$;

create or replace function public.public_register(
  p_slug      text,
  p_session   uuid,
  p_name      text,
  p_phone     text,
  p_contact_ok boolean,
  p_marketing boolean default false,
  p_spots     int default 1,
  p_partner_name text default null,
  p_division  uuid default null
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
  v_tier   uuid;
  v_price  numeric;
  v_partner text := nullif(btrim(coalesce(p_partner_name, '')), '');
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
    if v_s.registration_deadline is not null and now() > v_s.registration_deadline then
      select timezone into v_tz from public.locations where id = v_s.location_id;
      raise exception 'Registration closed on %', to_char(v_s.registration_deadline at time zone v_tz, 'Dy DD Mon HH24:MI');
    end if;
    if coalesce(p_spots, 1) not in (1, 2) then raise exception 'A sign-up is for 1 person or a pair'; end if;
    if p_spots = 2 and not v_s.allow_pairs then raise exception 'This session takes single sign-ups only'; end if;
    if p_spots = 2 and v_partner is null then raise exception 'Enter the partner''s name'; end if;
    if exists (select 1 from public.session_divisions d where d.session_id = v_s.id)
       and not exists (select 1 from public.session_divisions d where d.id = p_division and d.session_id = v_s.id) then
      raise exception 'Choose a division';
    end if;
    select e.tier_id, e.price into v_tier, v_price from public.event_price(v_s.id, coalesce(p_spots, 1)) e;
    if v_price is null then raise exception 'This event is sold out'; end if;
    if now() > v_s.starts_at - make_interval(mins => v_t.book_by_minutes) then
      raise exception 'Sign-ups closed % minutes before the start', v_t.book_by_minutes;
    end if;
    if v_t.signup_opens_days is not null and now() < v_s.starts_at - make_interval(days => v_t.signup_opens_days) then
      select timezone into v_tz from public.locations where id = v_s.location_id;
      raise exception 'Sign-ups for this session open on %',
        to_char((v_s.starts_at - make_interval(days => v_t.signup_opens_days)) at time zone v_tz, 'Dy DD Mon HH24:MI');
    end if;
    insert into public.session_registrations
      (org_id, session_id, guest_name, guest_phone, status, price, source, guest_marketing_consent,
       spots, partner_name, division_id, tier_id)
    values (v_org.id, v_s.id, v_name, v_phone, 'requested', v_price * coalesce(p_spots, 1), 'online', coalesce(p_marketing, false),
            coalesce(p_spots, 1), case when p_spots = 2 then v_partner end, p_division, v_tier)
    returning * into v_r;
  else
    -- Same rules as the desk, as a guest (never matched to a member).
    v_id := public.register_for_session(v_s.id, null, v_name, v_phone, false, false, coalesce(p_spots, 1), v_partner, p_division);
    update public.session_registrations
       set source = 'online', guest_marketing_consent = coalesce(p_marketing, false)
     where id = v_id
    returning * into v_r;
  end if;

  return jsonb_build_object('registration_id', v_r.id, 'status', v_r.status, 'price', v_r.price);
end;
$$;

create or replace function public.member_book_session(
  p_slug text, p_token text, p_session uuid, p_spots int default 1, p_partner_name text default null, p_division uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_m  public.members;
  v_t  public.session_types;
  v_id uuid;
  v_r  public.session_registrations;
begin
  v_m := public.member_from_token(p_slug, p_token);
  if not (select public_booking from public.orgs where id = v_m.org_id) then
    raise exception 'This club takes bookings by WhatsApp or at the desk';
  end if;
  select t.* into v_t from public.sessions s join public.session_types t on t.id = s.session_type_id
   where s.id = p_session and s.org_id = v_m.org_id;
  if not found or not v_t.is_public then raise exception 'Session not found'; end if;

  v_id := public.register_for_session(p_session, v_m.id, null, null, false, false, coalesce(p_spots, 1), p_partner_name, p_division);
  update public.session_registrations set source = 'online' where id = v_id returning * into v_r;
  return jsonb_build_object('registration_id', v_r.id, 'status', v_r.status, 'price', v_r.price,
                            'covered', v_r.membership_id is not null);
end;
$$;


grant execute on function
  public.register_for_session(uuid, uuid, text, text, boolean, boolean, int, text, uuid),
  public.set_event_options(uuid, boolean, timestamptz)
to authenticated;
revoke execute on function
  public.register_for_session(uuid, uuid, text, text, boolean, boolean, int, text, uuid),
  public.set_event_options(uuid, boolean, timestamptz),
  public.event_price(uuid, int), public.places_fit(uuid, uuid, int)
from public, anon;
grant execute on function public.event_price(uuid, int), public.places_fit(uuid, uuid, int) to authenticated, service_role;
revoke execute on function
  public.public_register(text, uuid, text, text, boolean, boolean, int, text, uuid),
  public.member_book_session(text, text, uuid, int, text, uuid),
  public.public_event_options(text, uuid)
from public;
grant execute on function
  public.public_register(text, uuid, text, text, boolean, boolean, int, text, uuid),
  public.member_book_session(text, text, uuid, int, text, uuid),
  public.public_event_options(text, uuid)
to anon, authenticated;
