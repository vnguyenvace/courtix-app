-- Help requests (Julian, 27 Nov 2026): "Get help from Courtix" inside the club app.
-- Any club staff can ask for help. Someone with staff.manage (the owner) can let Courtix support
-- look at the club in the same step (a normal support session, see 20261127020000_platform_team).
-- The Courtix team (super admin, support) sees open requests in courtix.app/admin/help, is emailed
-- when one comes in, and replies there; the reply shows on the club's Help page and is emailed back.
-- Sales and marketing don't see requests: they can contain member details.

create table public.support_requests (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  created_by       uuid references auth.users(id) on delete set null,
  created_by_email text,
  message          text not null check (char_length(btrim(message)) between 1 and 2000),
  contact          text check (char_length(contact) <= 200),
  grant_id         uuid,
  status           text not null default 'open' check (status in ('open', 'closed')),
  reply            text check (char_length(reply) <= 2000),
  replied_by       uuid references auth.users(id) on delete set null,
  replied_at       timestamptz,
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  foreign key (org_id, grant_id) references public.support_grants(org_id, id) on delete set null (grant_id)
);
create index support_requests_org_idx on public.support_requests(org_id, created_at desc);
create index support_requests_open_idx on public.support_requests(created_at desc) where status = 'open';

alter table public.support_requests enable row level security;
-- The club's staff and the Courtix support team. Changes go through the functions below.
create policy support_requests_select on public.support_requests for select to authenticated
  using (public.is_org_staff(org_id) or coalesce(public.platform_role() in ('super_admin', 'support'), false));
grant select on public.support_requests to authenticated;
revoke all on public.support_requests from anon;

-- Club staff: ask Courtix for help. p_allow_hours: also let support look (owner only; ignored
-- for others). An open support session is kept as it is.
create or replace function public.request_support(
  p_org uuid, p_message text, p_contact text default null, p_allow_hours int default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_grant uuid;
begin
  if not public.is_org_staff(p_org) then
    raise exception 'Only the club''s staff can ask for help here';
  end if;
  if char_length(btrim(coalesce(p_message, ''))) = 0 then
    raise exception 'Tell us what''s wrong';
  end if;
  if char_length(btrim(p_message)) > 2000 then
    raise exception 'Please keep it under 2000 characters';
  end if;
  if (select count(*) from public.support_requests
       where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'You''ve sent 5 requests in the last hour. We''ll get back to you soon';
  end if;

  if p_allow_hours is not null and public.has_org_permission(p_org, 'staff.manage') then
    v_grant := public.active_support_grant(p_org);
    if v_grant is null then
      v_grant := public.allow_support_access(p_org, p_allow_hours, left(btrim(p_message), 300));
    end if;
  end if;

  insert into public.support_requests (org_id, created_by, created_by_email, message, contact, grant_id)
  select p_org, auth.uid(), u.email, btrim(p_message), nullif(btrim(coalesce(p_contact, '')), ''), v_grant
    from auth.users u where u.id = auth.uid()
  returning id into v_id;
  return v_id;
end;
$$;

-- Who to email about a new request: the Courtix super admins and support. Only for the person who
-- just sent it (within 5 minutes), so club staff can't list the team otherwise.
create or replace function public.support_request_notify_list(p_request uuid)
returns table (email text) language sql stable security definer set search_path = '' as $$
  select u.email::text
    from public.platform_staff p join auth.users u on u.id = p.user_id
   where p.role in ('super_admin', 'support')
     and exists (select 1 from public.support_requests r
                  where r.id = p_request and r.created_by = auth.uid()
                    and r.created_at > now() - interval '5 minutes');
$$;

-- Club staff: mark their club's request as solved.
create or replace function public.close_support_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.support_requests set status = 'closed', closed_at = now()
   where id = p_request and status = 'open' and public.is_org_staff(org_id);
  if not found then
    if exists (select 1 from public.support_requests where id = p_request and public.is_org_staff(org_id)) then
      raise exception 'That request is already closed';
    end if;
    raise exception 'Help request not found';
  end if;
end;
$$;

-- Courtix team: requests with the club's name.
create or replace function public.platform_support_requests(p_status text default 'open')
returns table (
  id uuid, org_id uuid, club_name text, club_slug text, created_by_email text, message text,
  contact text, status text, reply text, replied_at timestamptz, closed_at timestamptz,
  created_at timestamptz, support_until timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.platform_role() in ('super_admin', 'support'), false) then
    raise exception 'Only Courtix support can see help requests';
  end if;
  return query
    select r.id, r.org_id, o.name, o.slug, r.created_by_email, r.message, r.contact, r.status, r.reply,
           r.replied_at, r.closed_at, r.created_at,
           (select g.expires_at from public.support_grants g where g.id = public.active_support_grant(r.org_id))
      from public.support_requests r join public.orgs o on o.id = r.org_id
     where p_status is null or r.status = p_status
     order by r.created_at desc
     limit 200;
end;
$$;

-- Courtix team: reply (shown to the club) and/or close. Returns who to email the reply to.
create or replace function public.platform_reply_support_request(p_request uuid, p_reply text, p_close boolean default false)
returns table (email text, club_name text, club_slug text)
language plpgsql security definer set search_path = '' as $$
declare v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
begin
  if not coalesce(public.platform_role() in ('super_admin', 'support'), false) then
    raise exception 'Only Courtix support can answer help requests';
  end if;
  if v_reply is null and not p_close then raise exception 'Write a reply'; end if;
  if char_length(v_reply) > 2000 then raise exception 'Please keep the reply under 2000 characters'; end if;
  update public.support_requests set
    reply      = coalesce(v_reply, reply),
    replied_by = case when v_reply is not null then auth.uid() else replied_by end,
    replied_at = case when v_reply is not null then now() else replied_at end,
    status     = case when p_close then 'closed' else status end,
    closed_at  = case when p_close and status = 'open' then now() else closed_at end
  where id = p_request;
  if not found then raise exception 'Help request not found'; end if;
  return query
    select r.created_by_email, o.name, o.slug
      from public.support_requests r join public.orgs o on o.id = r.org_id
     where r.id = p_request and v_reply is not null;
end;
$$;

grant execute on function
  public.request_support(uuid, text, text, int), public.support_request_notify_list(uuid),
  public.close_support_request(uuid), public.platform_support_requests(text),
  public.platform_reply_support_request(uuid, text, boolean)
to authenticated;
revoke execute on function
  public.request_support(uuid, text, text, int), public.support_request_notify_list(uuid),
  public.close_support_request(uuid), public.platform_support_requests(text),
  public.platform_reply_support_request(uuid, text, boolean)
from anon, public;
