-- Reply helper: staff paste a message a member or visitor sent (WhatsApp, LINE, anywhere),
-- Claude drafts an answer from the club's real data, staff check it and send it.
-- No messaging API needed. Roadmap step 9 can reuse inquiry_context() for chat bots.

create table public.inquiry_replies (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  location_id   uuid,                 -- which site the question is about (null = any)
  member_id     uuid,                 -- known member, if staff picked one
  contact_name  text,                 -- visitor's name, when not a member
  contact_phone text,                 -- visitor's WhatsApp / phone, when not a member
  incoming      text not null check (length(trim(incoming)) between 1 and 4000),
  reply         text not null check (length(trim(reply)) > 0),
  context       jsonb not null default '{}',   -- the facts Claude was given, for checking its work
  model         text,                          -- null when Claude wasn't connected
  status        public.message_status not null default 'draft',
  channel       text check (channel in ('whatsapp', 'line', 'other')),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  sent_by       uuid,
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, member_id) references public.members(org_id, id) on delete cascade,
  foreign key (org_id, location_id) references public.locations(org_id, id) on delete set null (location_id)
);
create index inquiry_replies_org_status_idx on public.inquiry_replies(org_id, status, created_at desc);

alter table public.inquiry_replies enable row level security;
create policy inquiry_replies_all on public.inquiry_replies for all to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));

grant select, insert, update, delete on public.inquiry_replies to authenticated;
revoke all on public.inquiry_replies from anon;

-- ---------------------------------------------------------------------------
-- Everything Claude may use to answer a question, as JSON. Security invoker:
-- staff only ever get their own club's data (RLS), and a member id from another
-- club simply returns no member.
--   p_location: limit sessions to one site (null = every site)
--   p_member:   include this member's package and upcoming plans
--   p_days:     how far ahead to list sessions
-- ---------------------------------------------------------------------------
create or replace function public.inquiry_context(
  p_org uuid, p_location uuid default null, p_member uuid default null, p_days int default 7
) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with o as (select * from public.orgs where id = p_org)
  select jsonb_build_object(
    'club', (select jsonb_build_object('name', o.name, 'sport', o.sport, 'currency', o.currency) from o),
    'now', (select to_char(now() at time zone o.timezone, 'Dy DD Mon YYYY HH24:MI') from o),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', l.name, 'address', l.address, 'whatsapp', l.whatsapp,
               'opens', to_char(l.opens_at, 'HH24:MI'), 'closes', to_char(l.closes_at, 'HH24:MI'),
               'court_booking_minutes', l.slot_minutes)
             order by l.sort_order, l.name)
        from public.locations l
       where l.org_id = p_org and l.is_active), '[]'),
    'upcoming_sessions', coalesce((
      select jsonb_agg(x.j order by x.starts_at)
        from (
          select s.starts_at, jsonb_strip_nulls(jsonb_build_object(
                   'name', s.name,
                   'category', s.category,
                   'location', s.location_name,
                   'day', to_char(s.starts_at at time zone s.location_timezone, 'Dy DD Mon'),
                   'start', to_char(s.starts_at at time zone s.location_timezone, 'HH24:MI'),
                   'end', to_char(s.ends_at at time zone s.location_timezone, 'HH24:MI'),
                   'price', s.price,
                   'spots_left', s.spots_left,
                   'full_waitlist_open', case when s.spots_left = 0 then true end,
                   'level', case when s.level_min is not null or s.level_max is not null
                                 then concat_ws('-', s.level_min, s.level_max) end,
                   'min_age', s.min_age,
                   'coach', s.coach_name,
                   'sign_ups_close', to_char(s.book_by at time zone s.location_timezone, 'Dy DD Mon HH24:MI'))) as j
            from public.session_overview s
           where s.org_id = p_org
             and s.status <> 'cancelled'
             and s.starts_at > now()
             and s.starts_at < now() + make_interval(days => greatest(1, least(p_days, 31)))
             and (p_location is null or s.location_id = p_location)
           order by s.starts_at
           limit 80
        ) x), '[]'),
    'session_types', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'name', t.name, 'category', t.category, 'description', t.description,
               'price', t.price, 'minutes', t.duration_minutes, 'min_age', t.min_age)) order by t.name)
        from public.session_types t
       where t.org_id = p_org and t.is_active), '[]'),
    'packages', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'name', p.name,
               'kind', case p.kind when 'time_based' then 'unlimited for a period' else 'pack of sessions' end,
               'days', p.duration_days, 'sessions', p.sessions, 'price', p.price,
               'valid_at', case when p.location_ids is null or cardinality(p.location_ids) = 0 then 'every location'
                                else (select string_agg(l.name, ', ') from public.locations l where l.id = any(p.location_ids)) end))
             order by p.price)
        from public.package_types p
       where p.org_id = p_org and p.is_active), '[]'),
    'court_hire', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'label', r.label,
               'location', l.name,
               'days', case when r.days_of_week is null then 'every day' else (
                         select string_agg((array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[d + 1], ' ' order by d)
                           from unnest(r.days_of_week) d) end,
               'from', to_char(r.start_time, 'HH24:MI'), 'to', to_char(r.end_time, 'HH24:MI'),
               'price_per_slot', r.drop_in_price, 'member_price', r.member_price))
             order by r.priority desc)
        from public.rate_rules r left join public.locations l on l.id = r.location_id
       where r.org_id = p_org and (p_location is null or r.location_id is null or r.location_id = p_location)), '[]'),
    'member', (
      select jsonb_strip_nulls(jsonb_build_object(
               'first_name', split_part(m.full_name, ' ', 1),
               'language', m.language,
               'package', ms.package_name,
               'package_status', ms.membership_status,
               'package_ends', to_char(ms.ends_on, 'Dy DD Mon YYYY'),
               'sessions_left', ms.sessions_left,
               'upcoming_sign_ups', (
                 select jsonb_agg(concat(so.name, ', ', to_char(so.starts_at at time zone so.location_timezone, 'Dy DD Mon HH24:MI'),
                                         ' (', r.status, ')') order by so.starts_at)
                   from public.session_registrations r join public.session_overview so on so.id = r.session_id
                  where r.member_id = m.id and r.status in ('booked', 'waitlisted') and so.starts_at > now()),
               'upcoming_court_bookings', (
                 select jsonb_agg(concat(b.court_name, ', ', to_char(b.start_at at time zone l.timezone, 'Dy DD Mon HH24:MI')) order by b.start_at)
                   from public.booking_calendar b join public.locations l on l.id = b.location_id
                  where b.member_id = m.id and b.status = 'confirmed' and b.start_at > now())))
        from public.members m
        left join public.member_status ms on ms.member_id = m.id
       where m.id = p_member and m.org_id = p_org)
  );
$$;

grant execute on function public.inquiry_context(uuid, uuid, uuid, int) to authenticated;
revoke execute on function public.inquiry_context(uuid, uuid, uuid, int) from anon, public;
