-- AI follow-ups: Claude drafts personal messages for members the database flags
-- (at risk, renewing soon, drop-in leads) and invites to fill sessions short of players.
-- Staff review every draft before it is sent.

create type public.followup_reason as enum ('at_risk', 'renewal', 'drop_in_lead', 'fill_session');
create type public.message_status as enum ('draft', 'sent', 'dismissed');

-- How the club wants its messages to sound, and what offers the AI may mention.
alter table public.orgs
  add column ai_voice text not null default 'Warm, friendly and short, like a message from the front desk. One emoji at most.',
  add column ai_sign_off text,                 -- e.g. 'Nong at Raccoon Pickleball'
  add column ai_offers text,                   -- offers staff are happy for the AI to mention
  add column followup_cooldown_days int not null default 7 check (followup_cooldown_days between 1 and 60);

create table public.ai_messages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  member_id   uuid not null,
  reason      public.followup_reason not null,
  session_id  uuid,                            -- the session being promoted, for fill_session
  channel     text not null default 'whatsapp' check (channel in ('whatsapp', 'line', 'sms', 'other')),
  language    text not null default 'en',
  body        text not null check (length(trim(body)) > 0),
  context     jsonb not null default '{}',     -- what the AI was told, for checking its work later
  model       text,                            -- null when written from a template
  status      public.message_status not null default 'draft',
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  sent_by     uuid,
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, member_id) references public.members(org_id, id) on delete cascade,
  foreign key (org_id, session_id) references public.sessions(org_id, id) on delete set null (session_id)
);
create index ai_messages_org_status_idx on public.ai_messages(org_id, status, created_at desc);
create index ai_messages_member_idx on public.ai_messages(org_id, member_id, created_at desc);
-- Only one open draft per member, reason and session at a time.
create unique index ai_messages_one_open_draft
  on public.ai_messages(member_id, reason, coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'draft';

alter table public.ai_messages enable row level security;
create policy ai_messages_all on public.ai_messages for all to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));

-- ---------------------------------------------------------------------------
-- Session suggestions for one member: upcoming sessions with spots that fit them.
-- Prefers session types they've played before; otherwise adult open play,
-- match play and clinics (no age limit, so kids clinics aren't offered to adults).
-- ---------------------------------------------------------------------------
create or replace function public.member_session_suggestions(p_member uuid, p_days int default 4, p_limit int default 3)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with m as (
    select id, org_id, skill_level from public.members where id = p_member
  ),
  played as (
    select s.session_type_id, count(*) as n
      from public.session_registrations r
      join public.sessions s on s.id = r.session_id
     where r.member_id = p_member and r.status in ('booked', 'attended')
     group by s.session_type_id
  ),
  picks as (
    select o.id, o.name, o.starts_at, o.price, o.spots_left, o.category, coalesce(p.n, 0) as played_before
      from public.session_overview o
      join m on m.org_id = o.org_id
      left join played p on p.session_type_id = o.session_type_id
     where o.status <> 'cancelled'
       and o.spots_left > 0
       and o.book_by > now()
       and o.starts_at < now() + make_interval(days => p_days)
       and (m.skill_level is null
            or (m.skill_level >= coalesce(o.level_min, 0) and m.skill_level <= coalesce(o.level_max, 9)))
       and (p.n is not null or (o.category in ('open_play', 'match_play', 'clinic') and o.min_age is null))
       and not exists (
         select 1 from public.session_registrations x
          where x.session_id = o.id and x.member_id = p_member and x.status in ('booked', 'waitlisted')
       )
     order by coalesce(p.n, 0) desc, o.starts_at
     limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'session_id', p.id,
           'name', p.name,
           'when', to_char(p.starts_at at time zone o.timezone, 'Dy DD Mon HH24:MI'),
           'price', p.price,
           'spots_left', p.spots_left,
           'played_before', p.played_before > 0
         ) order by p.played_before desc, p.starts_at), '[]'::jsonb)
    from picks p, m join public.orgs o on o.id = m.org_id;
$$;

-- ---------------------------------------------------------------------------
-- Who to follow up today, with everything the AI needs to write a good message.
-- Skips members without marketing consent, members with an open draft, and anyone
-- messaged for the same reason within the club's cooldown.
-- ---------------------------------------------------------------------------
create or replace function public.followup_candidates(p_org uuid, p_limit int default 20)
returns table (member_id uuid, reason public.followup_reason, language text, phone text, context jsonb)
language sql stable security invoker set search_path = '' as $$
  with o as (
    select * from public.orgs where id = p_org
  ),
  flagged as (
    select s.*, 'renewal'::public.followup_reason as reason, 1 as priority
      from public.member_status s where s.org_id = p_org and s.is_renewing_soon
    union all
    select s.*, 'at_risk'::public.followup_reason, 2
      from public.member_status s where s.org_id = p_org and s.is_at_risk and not s.is_renewing_soon
    union all
    select s.*, 'drop_in_lead'::public.followup_reason, 3
      from public.member_status s where s.org_id = p_org and s.is_drop_in_lead
  )
  select
    f.member_id,
    f.reason,
    f.language,
    coalesce(m.whatsapp, m.phone),
    jsonb_strip_nulls(jsonb_build_object(
      'reason', f.reason,
      'first_name', split_part(f.full_name, ' ', 1),
      'language', f.language,
      'package', f.package_name,
      'package_ends', to_char(f.ends_on, 'Dy DD Mon'),
      'days_until_package_ends', f.days_to_expiry,
      'sessions_left', f.sessions_left,
      'days_since_last_visit', f.days_since_visit,
      'never_visited', f.last_check_in is null,
      'usual_play_time', m.usual_play_time,
      'skill_level', m.skill_level,
      'member_notes', m.notes,
      'member_since', to_char(m.created_at at time zone o.timezone, 'Mon YYYY'),
      'suggested_sessions', public.member_session_suggestions(f.member_id),
      'packages_for_sale', (
        select jsonb_agg(jsonb_build_object('name', p.name, 'price', p.price) order by p.price)
          from public.package_types p where p.org_id = p_org and p.is_active
      )
    ))
  from flagged f
  join public.members m on m.id = f.member_id
  cross join o
  where m.marketing_consent
    and not exists (
      select 1 from public.ai_messages a
       where a.member_id = f.member_id
         and a.reason = f.reason
         and (a.status = 'draft'
              or (a.status = 'sent' and a.sent_at > now() - make_interval(days => o.followup_cooldown_days)))
    )
  order by f.priority, f.days_to_expiry nulls last, f.days_since_visit desc nulls last
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- Sessions that need players soon, and the best members to invite to one.
-- ---------------------------------------------------------------------------
create or replace view public.sessions_needing_players with (security_invoker = true) as
select o.*
from public.session_overview o
where o.status = 'scheduled'
  and not o.min_reached
  and o.book_by > now()
  and o.starts_at < now() + interval '3 days';

create or replace function public.fill_session_candidates(p_session uuid, p_limit int default 6)
returns table (member_id uuid, language text, phone text, context jsonb)
language sql stable security invoker set search_path = '' as $$
  with s as (
    select v.*, org.timezone, org.followup_cooldown_days
      from public.session_overview v join public.orgs org on org.id = v.org_id
     where v.id = p_session
  ),
  history as (
    select r.member_id, count(*) as same_type_played
      from public.session_registrations r
      join public.sessions x on x.id = r.session_id
      join s on s.session_type_id = x.session_type_id
     where r.status in ('booked', 'attended')
     group by r.member_id
  )
  select
    m.id,
    m.language,
    coalesce(m.whatsapp, m.phone),
    jsonb_strip_nulls(jsonb_build_object(
      'reason', 'fill_session',
      'first_name', split_part(m.full_name, ' ', 1),
      'language', m.language,
      'usual_play_time', m.usual_play_time,
      'skill_level', m.skill_level,
      'played_this_session_type_before', coalesce(h.same_type_played, 0) > 0,
      'package', ms.package_name,
      'session', jsonb_build_object(
        'session_id', s.id,
        'name', s.name,
        'when', to_char(s.starts_at at time zone s.timezone, 'Dy DD Mon HH24:MI'),
        'price', s.price,
        'spots_left', s.spots_left,
        'players_still_needed', greatest(s.min_players - s.booked, 0),
        'coach', s.coach_name,
        'description', s.description
      )
    ))
  from s
  join public.members m on m.org_id = s.org_id
  left join history h on h.member_id = m.id
  left join public.member_status ms on ms.member_id = m.id
  where m.marketing_consent
    and (m.skill_level is null
         or (m.skill_level >= coalesce(s.level_min, 0) and m.skill_level <= coalesce(s.level_max, 9)))
    -- Age-limited sessions (kids clinics) only go to people who've booked that type before, e.g. parents.
    and (s.min_age is null or h.same_type_played is not null)
    and not exists (
      select 1 from public.session_registrations r
       where r.session_id = s.id and r.member_id = m.id and r.status in ('booked', 'waitlisted', 'attended')
    )
    and not exists (
      select 1 from public.ai_messages a
       where a.member_id = m.id
         and (a.session_id = s.id
              or (a.status = 'sent' and a.sent_at > now() - interval '2 days'))
    )
  order by coalesce(h.same_type_played, 0) desc,
           ms.days_since_visit asc nulls last,
           m.full_name
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- Did it work? A sent message counts as a win if, within 14 days, the member
-- came in, signed up for a session, or bought a package.
-- ---------------------------------------------------------------------------
create or replace view public.ai_message_outcomes with (security_invoker = true) as
select
  a.id, a.org_id, a.member_id, a.reason, a.session_id, a.sent_at,
  exists (select 1 from public.check_ins c
           where c.member_id = a.member_id and c.checked_in_at between a.sent_at and a.sent_at + interval '14 days')
    as came_in,
  exists (select 1 from public.session_registrations r
           where r.member_id = a.member_id and r.status in ('booked', 'attended')
             and r.created_at between a.sent_at and a.sent_at + interval '14 days')
    as signed_up,
  (select coalesce(sum(m.price_paid), 0) from public.memberships m
    where m.member_id = a.member_id and m.created_at between a.sent_at and a.sent_at + interval '14 days')
    as package_revenue
from public.ai_messages a
where a.status = 'sent';

create or replace view public.ai_followup_stats with (security_invoker = true) as
select
  o.id as org_id,
  (select count(*) from public.ai_messages a where a.org_id = o.id and a.status = 'draft') as drafts_waiting,
  count(x.id) filter (where x.sent_at > now() - interval '30 days') as sent_30d,
  count(x.id) filter (where x.sent_at > now() - interval '30 days'
                        and (x.came_in or x.signed_up or x.package_revenue > 0)) as responded_30d,
  coalesce(sum(x.package_revenue) filter (where x.sent_at > now() - interval '30 days'), 0) as package_revenue_30d
from public.orgs o
left join public.ai_message_outcomes x on x.org_id = o.id
group by o.id;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.ai_messages to authenticated;
grant select on public.sessions_needing_players, public.ai_message_outcomes, public.ai_followup_stats to authenticated;
grant execute on function
  public.member_session_suggestions(uuid, int, int),
  public.followup_candidates(uuid, int),
  public.fill_session_candidates(uuid, int)
to authenticated;
revoke all on public.ai_messages, public.sessions_needing_players, public.ai_message_outcomes,
  public.ai_followup_stats from anon;
revoke execute on function
  public.member_session_suggestions(uuid, int, int),
  public.followup_candidates(uuid, int),
  public.fill_session_candidates(uuid, int)
from anon, public;
