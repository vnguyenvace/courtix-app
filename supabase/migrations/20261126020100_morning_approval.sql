-- Step 9b: morning approval list.
--
-- Every morning a job writes follow-up drafts for each club (app/api/cron/morning). The club's
-- owner or a manager approves, edits or skips them on the Morning page (/morning). Approved
-- messages are then sent by anyone at the club (one-tap WhatsApp/LINE links for now; the
-- WhatsApp Cloud API later sends them by itself).
--
-- "Nothing goes out without approval" is enforced here, not only in the app: in clubs using
-- morning approval, desk staff can't mark an unapproved draft as sent or change an approved one.

-- ---------------------------------------------------------------------------
-- Club settings
-- ---------------------------------------------------------------------------
-- approve: owner/manager approves each morning, then it's sent (default, decided 18 Nov 2026)
-- desk:    drafts only; anyone at the desk may send them (how it worked before)
alter table public.orgs add column followup_mode text not null default 'approve'
  check (followup_mode in ('approve', 'desk'));
-- Write drafts automatically every morning.
alter table public.orgs add column morning_drafts boolean not null default true;
-- The club's local date the morning job last ran, so it runs once a day per club.
alter table public.orgs add column morning_run_on date;

alter table public.ai_messages add column approved_at timestamptz;
alter table public.ai_messages add column approved_by uuid;

-- One open message per member, reason and session: approved-but-not-sent counts as open too.
drop index public.ai_messages_one_open_draft;
create unique index ai_messages_one_open_draft
  on public.ai_messages(member_id, reason, coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('draft', 'approved');

-- ---------------------------------------------------------------------------
-- The approval rule
-- ---------------------------------------------------------------------------
create or replace function public.ai_messages_approval_rule()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_mode    text;
  v_manager boolean;
begin
  select followup_mode into v_mode from public.orgs where id = new.org_id;
  -- auth.uid() is null for the database owner and the service identity (morning job).
  v_manager := auth.uid() is null or public.has_org_role(new.org_id, '{owner,manager}');

  if new.status = 'approved' and old.status is distinct from 'approved' then
    if not v_manager then
      raise exception 'Only an owner or manager can approve messages';
    end if;
    new.approved_at := now();
    new.approved_by := auth.uid();
  end if;

  if v_mode = 'approve' and not v_manager then
    if new.status = 'sent' and old.status = 'draft' then
      raise exception 'An owner or manager needs to approve this message before it goes out';
    end if;
    if old.status = 'approved' and new.body is distinct from old.body then
      raise exception 'This message was approved as it is. Ask an owner or manager to change it';
    end if;
  end if;
  return new;
end;
$$;

create trigger ai_messages_approval_rule before update on public.ai_messages
  for each row execute function public.ai_messages_approval_rule();

-- Approve every waiting draft in one go. Returns how many.
create or replace function public.approve_all_drafts(p_org uuid)
returns int language plpgsql security invoker set search_path = '' as $$
declare v_count int;
begin
  if not public.has_org_role(p_org, '{owner,manager}') then
    raise exception 'Only an owner or manager can approve messages';
  end if;
  update public.ai_messages set status = 'approved'
   where org_id = p_org and status = 'draft';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.approve_all_drafts(uuid) to authenticated;
revoke execute on function public.approve_all_drafts(uuid) from anon, public;

-- ---------------------------------------------------------------------------
-- Candidates: a member with an approved message waiting doesn't get another draft.
-- (Same as 20261115000000_locations.sql, with 'approved' counted as open.)
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
      'home_location', (select l.name from public.locations l where l.id = m.home_location_id),
      'club_locations', (select jsonb_agg(l.name order by l.sort_order) from public.locations l
                          where l.org_id = p_org and l.is_active),
      'suggested_sessions', public.member_session_suggestions(f.member_id),
      'packages_for_sale', (
        select jsonb_agg(jsonb_build_object(
                 'name', p.name, 'price', p.price,
                 'valid_at', case when p.location_ids is null then 'all locations'
                                  else (select string_agg(l.name, ', ') from public.locations l
                                         where l.id = any (p.location_ids)) end)
               order by p.price)
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
         and (a.status in ('draft', 'approved')
              or (a.status = 'sent' and a.sent_at > now() - make_interval(days => o.followup_cooldown_days)))
    )
  order by f.priority, f.days_to_expiry nulls last, f.days_since_visit desc nulls last
  limit p_limit;
$$;

-- Waiting-to-send count for the dashboard (appended column).
create or replace view public.ai_followup_stats with (security_invoker = true) as
select
  o.id as org_id,
  (select count(*) from public.ai_messages a where a.org_id = o.id and a.status = 'draft') as drafts_waiting,
  count(x.id) filter (where x.sent_at > now() - interval '30 days') as sent_30d,
  count(x.id) filter (where x.sent_at > now() - interval '30 days'
                        and (x.came_in or x.signed_up or x.package_revenue > 0)) as responded_30d,
  coalesce(sum(x.package_revenue) filter (where x.sent_at > now() - interval '30 days'), 0) as package_revenue_30d,
  (select count(*) from public.ai_messages a where a.org_id = o.id and a.status = 'approved') as approved_waiting
from public.orgs o
left join public.ai_message_outcomes x on x.org_id = o.id
group by o.id;
