-- Step 2: packages that cover sessions.
--
-- Decided with Julian (18 Nov 2026):
--   * A class-pack credit is used when the place is BOOKED (sign-up, or moving up from the waitlist).
--   * Cancelling before the club's cut-off (orgs.late_cancel_hours, default 24) refunds the credit.
--     Later cancels and no-shows lose it. If the CLUB cancels the session, everyone gets it back.
--   * Unlimited (time-based) packages are preferred over credits when both cover a session.
--   * A package with no coverage rules covers court booking only (as before).
--
-- Also fixes a double charge: until now every check-in used a class-pack credit, including
-- the check-in that "Attended" records for a session. Session check-ins no longer use credits;
-- covered sign-ups do. Desk check-ins still use one, as before.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
alter table public.orgs add column late_cancel_hours int not null default 24
  check (late_cancel_hours between 0 and 168);

-- Priority booking: members with this package may sign up this many days before everyone else.
alter table public.package_types add column priority_days int not null default 0
  check (priority_days between 0 and 30);

-- Sign-ups open this many days before the session (null = any time, as before).
alter table public.session_types add column signup_opens_days int
  check (signup_opens_days between 0 and 90);

-- ---------------------------------------------------------------------------
-- Which sessions a package covers. One row = one rule; a session is covered if any rule matches.
--   session_type_id / category: what (both null = every session)
--   days_of_week:               0 = Sunday (null = every day)
--   start_time / end_time:      the session must START in [start_time, end_time) local time
-- ---------------------------------------------------------------------------
create table public.package_coverage (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  package_type_id uuid not null,
  session_type_id uuid,
  category        public.session_category,
  days_of_week    smallint[],
  start_time      time,
  end_time        time,
  created_at      timestamptz not null default now(),
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, package_type_id) references public.package_types(org_id, id) on delete cascade,
  foreign key (org_id, session_type_id) references public.session_types(org_id, id) on delete cascade,
  check (session_type_id is null or category is null),
  check (days_of_week is null or (cardinality(days_of_week) > 0 and days_of_week <@ '{0,1,2,3,4,5,6}')),
  check ((start_time is null) = (end_time is null)),
  check (end_time is null or end_time > start_time)
);
create index package_coverage_package_idx on public.package_coverage(package_type_id);

alter table public.package_coverage enable row level security;
create policy package_coverage_select on public.package_coverage for select to authenticated
  using (public.is_org_staff(org_id));
create policy package_coverage_write on public.package_coverage for all to authenticated
  using (public.has_org_role(org_id, '{owner,manager}'))
  with check (public.has_org_role(org_id, '{owner,manager}'));
grant select, insert, update, delete on public.package_coverage to authenticated;
revoke all on public.package_coverage from anon;

-- ---------------------------------------------------------------------------
-- Sign-ups remember which membership covered them and whether a credit was taken.
-- ---------------------------------------------------------------------------
alter table public.memberships add constraint memberships_org_id_key unique (org_id, id);
alter table public.session_registrations add column membership_id uuid;
alter table public.session_registrations add column credit_used boolean not null default false;
alter table public.session_registrations add constraint session_regs_membership_fk
  foreign key (org_id, membership_id) references public.memberships(org_id, id) on delete set null (membership_id);
create index session_regs_membership_idx on public.session_registrations(membership_id) where membership_id is not null;

-- ---------------------------------------------------------------------------
-- Does this package type cover this session? (pure rule check, no membership state)
-- ---------------------------------------------------------------------------
create or replace function public.package_covers_session(p_package uuid, p_session uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1
      from public.sessions s
      join public.session_types t on t.id = s.session_type_id
      join public.locations l on l.id = s.location_id
      join public.package_types p on p.id = p_package and p.org_id = s.org_id
      join public.package_coverage c on c.package_type_id = p.id
     where s.id = p_session
       and public.package_valid_at(p.location_ids, s.location_id)
       and (c.session_type_id is null or c.session_type_id = s.session_type_id)
       and (c.category is null or c.category = t.category)
       and (c.days_of_week is null
            or extract(dow from s.starts_at at time zone l.timezone)::smallint = any (c.days_of_week))
       and (c.start_time is null
            or ((s.starts_at at time zone l.timezone)::time >= c.start_time
                and (s.starts_at at time zone l.timezone)::time < c.end_time))
  );
$$;

-- The member's best membership for this session: unlimited first, then the class pack that
-- ends soonest / was bought first. Class packs need a credit left. Null = not covered.
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
     and (p.kind = 'time_based' or coalesce(m.sessions_left, 0) > 0)
     and public.package_covers_session(p.id, s.id)
   order by (p.kind = 'time_based') desc, m.ends_on nulls last, m.starts_on, m.created_at
   limit 1;
$$;

-- Takes the place's credit (or unlimited cover) when it becomes BOOKED. Not covered: drop-in price.
create or replace function public.apply_session_coverage(p_registration uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_r    public.session_registrations;
  v_s    public.sessions;
  v_m    uuid;
  v_kind public.package_kind;
begin
  select * into v_r from public.session_registrations where id = p_registration;
  if v_r.member_id is null or v_r.status <> 'booked' or v_r.credit_used then return; end if;
  select * into v_s from public.sessions where id = v_r.session_id;

  v_m := public.session_coverage(v_r.member_id, v_r.session_id);
  if v_m is null then
    update public.session_registrations set membership_id = null, price = v_s.price where id = v_r.id;
    return;
  end if;

  select p.kind into v_kind
    from public.memberships m join public.package_types p on p.id = m.package_type_id
   where m.id = v_m;
  if v_kind = 'class_pack' then
    update public.memberships set sessions_left = sessions_left - 1
     where id = v_m and sessions_left > 0;
    if not found then
      update public.session_registrations set membership_id = null, price = v_s.price where id = v_r.id;
      return;
    end if;
  end if;

  update public.session_registrations
     set membership_id = v_m, price = 0, credit_used = (v_kind = 'class_pack')
   where id = v_r.id;
end;
$$;

-- Gives a credit back (club cancelled, or the member cancelled in time).
create or replace function public.refund_session_credit(p_registration uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_r public.session_registrations;
begin
  select * into v_r from public.session_registrations where id = p_registration;
  if not v_r.credit_used or v_r.membership_id is null then return false; end if;
  update public.memberships m
     set sessions_left = sessions_left + 1,
         -- A pack that ran out (expired at 0 credits) comes back to life.
         status = case when m.status = 'expired' and (m.ends_on is null or m.ends_on >= public.org_today(m.org_id))
                       then 'active'::public.membership_status else m.status end
   where id = v_r.membership_id;
  update public.session_registrations set credit_used = false where id = v_r.id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sign-up: same rules as before, plus sign-up windows, priority booking and coverage.
-- ---------------------------------------------------------------------------
create or replace function public.register_for_session(
  p_session     uuid,
  p_member      uuid default null,
  p_guest_name  text default null,
  p_guest_phone text default null,
  p_allow_late  boolean default false,  -- desk override for sign-up times ("closed" or "not open yet")
  p_ignore_level boolean default false  -- desk override for level limits
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

  -- Booked: use the package now. Waitlisted: only when they move up (see cancel_registration).
  -- Show the waitlist price the member would pay if covered right now.
  if v_status = 'booked' then
    perform public.apply_session_coverage(v_id);
  elsif p_member is not null and public.session_coverage(p_member, v_s.id) is not null then
    update public.session_registrations set price = 0 where id = v_id;
  end if;

  return v_id;
exception
  when unique_violation then
    raise exception 'This member is already signed up for this session';
end;
$$;

-- Cancels a place and moves the first person on the waitlist up. Returns who was moved up, if anyone.
-- The credit comes back when cancelled before the club's cut-off; later, it's used.
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

  if v_r.status = 'booked' and v_s.status <> 'cancelled' and now() < v_s.starts_at then
    update public.session_registrations set status = 'booked'
     where id = (
       select id from public.session_registrations
        where session_id = v_s.id and status = 'waitlisted'
        order by created_at limit 1
     )
    returning id into v_promoted;
    if v_promoted is not null then
      perform public.apply_session_coverage(v_promoted);
    end if;
  end if;

  return v_promoted;
end;
$$;

-- The club cancels a session: every place is cancelled and every credit comes back.
create or replace function public.cancel_session(p_session uuid, p_reason text default null)
returns int language plpgsql security invoker set search_path = '' as $$
declare
  v_count int;
  r       record;
begin
  update public.sessions set status = 'cancelled', cancel_reason = p_reason
   where id = p_session and status <> 'cancelled';
  if not found then raise exception 'Session not found or already cancelled'; end if;

  update public.bookings set status = 'cancelled'
   where session_id = p_session and status = 'confirmed';

  -- Only places that are being cancelled now (attended / no-show places keep theirs).
  for r in select id from public.session_registrations
            where session_id = p_session and credit_used and status = 'booked' loop
    perform public.refund_session_credit(r.id);
  end loop;

  with c as (
    update public.session_registrations set status = 'cancelled'
     where session_id = p_session and status in ('booked', 'waitlisted')
    returning 1
  ) select count(*) into v_count from c;

  return v_count;  -- people to tell
end;
$$;

-- Go / no-go: unchanged, except cancelled sessions refund credits.
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

-- ---------------------------------------------------------------------------
-- Check-ins: only desk/QR/booking check-ins use a class-pack credit. Session check-ins
-- (from "Attended") don't: the sign-up already did, if the pack covers that session.
-- ---------------------------------------------------------------------------
create or replace function public.use_class_pack_session()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source = 'session' then return new; end if;
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

-- ---------------------------------------------------------------------------
-- Roster: who covered each place (columns appended at the end).
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
  ms.sessions_left
from public.session_registrations r
left join public.members m on m.id = r.member_id
left join public.memberships ms on ms.id = r.membership_id
left join public.package_types p on p.id = ms.package_type_id;

-- ---------------------------------------------------------------------------
-- Raccoon demo: coverage for the flyer packages. The old loader is kept as
-- load_raccoon_demo_base and the public function adds coverage after it.
-- ---------------------------------------------------------------------------
create or replace function public.add_raccoon_coverage(p_org uuid)
returns int language plpgsql security invoker set search_path = '' as $$
declare
  v_evenings uuid;
  v_any      uuid;
  v_mornings uuid;
  v_nights   uuid;
  v_n        int;
begin
  select id into v_evenings from public.package_types where org_id = p_org and name = 'Unlimited evenings (30 days)';
  select id into v_any      from public.package_types where org_id = p_org and name = 'Unlimited any session (30 days)';
  select id into v_mornings from public.package_types where org_id = p_org and name = 'Match play mornings: buy 10 get 1 free';
  select id into v_nights   from public.package_types where org_id = p_org and name = 'Match play nights: buy 10 get 1 free';
  if v_evenings is null then return 0; end if;
  if exists (select 1 from public.package_coverage where org_id = p_org) then return 0; end if;

  insert into public.package_coverage (org_id, package_type_id, category, start_time, end_time)
  values (p_org, v_evenings, 'open_play', '17:00', '23:00');

  -- "Any session": open play, clinics and match play. Camps and courses are paid separately.
  insert into public.package_coverage (org_id, package_type_id, category)
  select p_org, v_any, c from unnest(array['open_play', 'clinic', 'match_play']::public.session_category[]) c;
  -- PLACEHOLDER (confirm with the club): how many days earlier "priority booking" means.
  update public.package_types set priority_days = 2 where id = v_any;

  insert into public.package_coverage (org_id, package_type_id, session_type_id)
  select p_org, v_mornings, id from public.session_types where org_id = p_org and name = 'Social match play (tennis)';
  insert into public.package_coverage (org_id, package_type_id, session_type_id)
  select p_org, v_nights, id from public.session_types where org_id = p_org and name = 'Social match play night (tennis)';

  select count(*) into v_n from public.package_coverage where org_id = p_org;
  return v_n;
end;
$$;

alter function public.load_raccoon_demo(uuid) rename to load_raccoon_demo_base;
create function public.load_raccoon_demo(p_org uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_result text;
begin
  v_result := public.load_raccoon_demo_base(p_org);
  perform public.add_raccoon_coverage(p_org);
  return v_result;
end;
$$;

-- Clubs that already loaded the demo get the coverage too (only if they have none yet).
do $$
declare r record;
begin
  for r in select distinct org_id from public.package_types where name = 'Unlimited evenings (30 days)' loop
    perform public.add_raccoon_coverage(r.org_id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant execute on function
  public.package_covers_session(uuid, uuid),
  public.session_coverage(uuid, uuid),
  public.apply_session_coverage(uuid),
  public.refund_session_credit(uuid),
  public.add_raccoon_coverage(uuid),
  public.load_raccoon_demo(uuid)
to authenticated;
revoke execute on function
  public.package_covers_session(uuid, uuid),
  public.session_coverage(uuid, uuid),
  public.apply_session_coverage(uuid),
  public.refund_session_credit(uuid),
  public.add_raccoon_coverage(uuid),
  public.load_raccoon_demo(uuid),
  public.load_raccoon_demo_base(uuid)
from anon, public;
