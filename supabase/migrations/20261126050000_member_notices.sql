-- Automatic service messages to members (Julian, 26 Nov 2026): booking reminders, package
-- ending soon, waitlist moved up, session cancelled. Plus a per-club option to send AI
-- marketing follow-ups without the morning approval.
--
-- Notices about a member's own bookings and package are service messages: they don't need
-- marketing consent, but a member can be opted out (members.notices_opt_out), and each club
-- picks which kinds it sends (orgs.auto_notices).
--
-- Flow: something queues a row in member_notices (once: dedupe_key is unique), the app sends it
-- (LINE push for members linked on LINE, in their language) and records the result. Members
-- who can't be reached automatically are listed on the Morning page for a one-tap send.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
alter table public.orgs add column auto_notices text[] not null
  default '{booking_reminder,package_ending,waitlist_moved_up,session_cancelled}'
  check (auto_notices <@ '{booking_reminder,package_ending,waitlist_moved_up,session_cancelled}'::text[]);

-- Marketing follow-ups: 'auto' = the morning job approves and sends them itself.
alter table public.orgs drop constraint orgs_followup_mode_check;
alter table public.orgs add constraint orgs_followup_mode_check check (followup_mode in ('approve', 'desk', 'auto'));

alter table public.members add column notices_opt_out boolean not null default false;

-- ---------------------------------------------------------------------------
-- The outbox
-- ---------------------------------------------------------------------------
create table public.member_notices (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  member_id   uuid not null,
  kind        text not null check (kind in ('booking_reminder', 'package_ending', 'waitlist_moved_up', 'session_cancelled')),
  dedupe_key  text not null,          -- e.g. reminder:reg:<id>: the same notice is never queued twice
  payload     jsonb not null default '{}',
  -- pending: to send. sent: delivered. manual: no automatic channel, listed for staff.
  -- done: staff sent it by hand. failed: the channel refused it. skipped: no longer relevant.
  status      text not null default 'pending' check (status in ('pending', 'sent', 'manual', 'done', 'failed', 'skipped')),
  channel     text,
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  unique (org_id, dedupe_key),
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, member_id) references public.members(org_id, id) on delete cascade
);
create index member_notices_status_idx on public.member_notices(org_id, status, created_at);

alter table public.member_notices enable row level security;
create policy member_notices_all on public.member_notices for all to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));
grant select, insert, update on public.member_notices to authenticated;
revoke all on public.member_notices from anon;

-- Queue one notice if the club sends that kind and the member hasn't opted out. Repeats are ignored.
create or replace function public.queue_member_notice(
  p_org uuid, p_member uuid, p_kind text, p_key text, p_payload jsonb
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_member is null then return; end if;
  if not exists (select 1 from public.orgs where id = p_org and p_kind = any (auto_notices)) then return; end if;
  if exists (select 1 from public.members where id = p_member and notices_opt_out) then return; end if;
  insert into public.member_notices (org_id, member_id, kind, dedupe_key, payload)
  values (p_org, p_member, p_kind, p_key, p_payload)
  on conflict (org_id, dedupe_key) do nothing;
end;
$$;

-- What a session notice says: name, local day and time, location.
create or replace function public.session_notice_payload(p_session uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'session', so.name,
    'date', to_char(so.starts_at at time zone so.location_timezone, 'YYYY-MM-DD'),
    'start', to_char(so.starts_at at time zone so.location_timezone, 'HH24:MI'),
    'end', to_char(so.ends_at at time zone so.location_timezone, 'HH24:MI'),
    'location', so.location_name,
    'reason', so.cancel_reason)
  from public.session_overview so where so.id = p_session;
$$;

-- ---------------------------------------------------------------------------
-- Instant notices, queued by the database whenever it happens (any screen, any channel).
-- ---------------------------------------------------------------------------
create or replace function public.session_registrations_notices()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.member_id is null then return null; end if;

  -- Waitlist → booked (someone cancelled, the limit went up, ...).
  if old.status = 'waitlisted' and new.status = 'booked' then
    perform public.queue_member_notice(new.org_id, new.member_id, 'waitlist_moved_up',
      'waitlist:' || new.id, public.session_notice_payload(new.session_id));
  end if;

  -- Their place is cancelled because the whole session was cancelled.
  if old.status in ('booked', 'waitlisted') and new.status = 'cancelled'
     and exists (select 1 from public.sessions s where s.id = new.session_id and s.status = 'cancelled') then
    perform public.queue_member_notice(new.org_id, new.member_id, 'session_cancelled',
      'cancelled:' || new.id, public.session_notice_payload(new.session_id));
  end if;
  return null;
end;
$$;

create trigger session_registrations_notices after update of status on public.session_registrations
  for each row when (old.status is distinct from new.status)
  execute function public.session_registrations_notices();

-- ---------------------------------------------------------------------------
-- Evening notices: tomorrow's bookings, packages ending in 3 days, last session credit.
-- Run by the evening job (as the service identity) or staff. Returns how many were queued.
-- ---------------------------------------------------------------------------
create or replace function public.queue_evening_notices(p_org uuid)
returns int language plpgsql security invoker set search_path = '' as $$
declare
  v_before int;
  v_after  int;
  r        record;
begin
  select count(*) into v_before from public.member_notices where org_id = p_org;

  -- Session places tomorrow (in each location's own time zone).
  for r in
    select g.id, g.member_id, g.session_id
      from public.session_registrations g
      join public.session_overview so on so.id = g.session_id
     where g.org_id = p_org and g.member_id is not null and g.status = 'booked' and so.status <> 'cancelled'
       and (so.starts_at at time zone so.location_timezone)::date = (now() at time zone so.location_timezone)::date + 1
  loop
    perform public.queue_member_notice(p_org, r.member_id, 'booking_reminder', 'reminder:reg:' || r.id,
      public.session_notice_payload(r.session_id) || '{"type":"session"}');
  end loop;

  -- Court bookings tomorrow (not session holds).
  for r in
    select b.id, b.member_id, b.court_name, b.location_name, b.start_at, b.end_at, l.timezone
      from public.booking_calendar b join public.locations l on l.id = b.location_id
     where b.org_id = p_org and b.member_id is not null and b.status = 'confirmed' and b.session_id is null
       and (b.start_at at time zone l.timezone)::date = (now() at time zone l.timezone)::date + 1
  loop
    perform public.queue_member_notice(p_org, r.member_id, 'booking_reminder', 'reminder:court:' || r.id,
      jsonb_build_object('type', 'court', 'court', r.court_name, 'location', r.location_name,
        'date', to_char(r.start_at at time zone r.timezone, 'YYYY-MM-DD'),
        'start', to_char(r.start_at at time zone r.timezone, 'HH24:MI'),
        'end', to_char(r.end_at at time zone r.timezone, 'HH24:MI')));
  end loop;

  -- Time-based packages ending in 3 days, and session packs down to their last credit.
  for r in
    select m.id, m.member_id, p.name, m.ends_on, m.sessions_left, p.kind
      from public.memberships m
      join public.package_types p on p.id = m.package_type_id
      join public.orgs o on o.id = m.org_id
     where m.org_id = p_org and m.status = 'active'
       and ((p.kind = 'time_based' and m.ends_on = (now() at time zone o.timezone)::date + 3)
            or (p.kind = 'class_pack' and m.sessions_left = 1))
  loop
    perform public.queue_member_notice(p_org, r.member_id, 'package_ending',
      case when r.kind = 'class_pack' then 'pkg_last:' || r.id else 'pkg_end:' || r.id || ':' || r.ends_on end,
      jsonb_build_object('package', r.name, 'ends_on', r.ends_on, 'sessions_left', r.sessions_left,
                         'type', case when r.kind = 'class_pack' then 'last_credit' else 'ending' end));
  end loop;

  select count(*) into v_after from public.member_notices where org_id = p_org;
  return v_after - v_before;
end;
$$;

grant execute on function
  public.queue_member_notice(uuid, uuid, text, text, jsonb),
  public.session_notice_payload(uuid),
  public.queue_evening_notices(uuid)
to authenticated;
revoke execute on function
  public.queue_member_notice(uuid, uuid, text, text, jsonb),
  public.session_notice_payload(uuid),
  public.queue_evening_notices(uuid)
from anon, public;
