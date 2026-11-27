-- Courtix team roles (Step 10b, Julian 27 Nov 2026). Julian's own team, kept apart from club staff:
--   super_admin  everything in the Courtix admin area, manages the team
--   support      club list; a club's data only during a support session the club owner allowed
--   sales        club list with owner contact and usage numbers; no member data
--   marketing    club list and usage numbers; no member data, no owner contact
--
-- Support sessions: the club owner allows Courtix support for a set time (Staff page). Support can
-- then VIEW that club (select policies only; nothing can be changed, and the app refuses every
-- action), every page they open is logged, and the owner sees the log. PDPA: the club is the
-- data controller, so access to its members' data needs its OK.
--
-- The first super admin is added by hand in the Supabase SQL editor:
--   insert into public.platform_staff (user_id, role)
--   select id, 'super_admin' from auth.users where email = '<your email>';

create type public.platform_role as enum ('super_admin', 'support', 'sales', 'marketing');

create table public.platform_staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       public.platform_role not null,
  created_at timestamptz not null default now()
);

create or replace function public.platform_role()
returns public.platform_role language sql stable security definer set search_path = '' as $$
  select role from public.platform_staff where user_id = auth.uid();
$$;

alter table public.platform_staff enable row level security;
-- Your own row; super admins see the whole team. Changes go through the functions below.
create policy platform_staff_select on public.platform_staff for select to authenticated
  using (user_id = auth.uid() or public.platform_role() = 'super_admin');
grant select on public.platform_staff to authenticated;
revoke all on public.platform_staff from anon;

-- Always one super admin left.
create or replace function public.platform_staff_keep_super_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'super_admin' and (tg_op = 'DELETE' or new.role <> 'super_admin')
     and not exists (select 1 from public.platform_staff where role = 'super_admin' and user_id <> old.user_id)
     and exists (select 1 from auth.users where id = old.user_id)  -- not when the account itself is deleted
  then
    raise exception 'Courtix needs at least one super admin';
  end if;
  return null;
end;
$$;
create trigger platform_staff_keep_super_admin after update of role or delete on public.platform_staff
  for each row execute function public.platform_staff_keep_super_admin();

-- ---------------------------------------------------------------------------
-- Support sessions
-- ---------------------------------------------------------------------------
create table public.support_grants (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  granted_by  uuid references auth.users(id) on delete set null,
  note        text check (char_length(note) <= 300),
  starts_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  ended_at    timestamptz,
  unique (org_id, id)
);
create index support_grants_org_idx on public.support_grants(org_id, expires_at desc);

create table public.support_access_log (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references public.orgs(id) on delete cascade,
  grant_id   uuid not null,
  user_id    uuid references auth.users(id) on delete set null,
  email      text,
  path       text,
  viewed_at  timestamptz not null default now(),
  foreign key (org_id, grant_id) references public.support_grants(org_id, id) on delete cascade
);
create index support_access_log_org_idx on public.support_access_log(org_id, viewed_at desc);

-- The open support session of a club, if any.
create or replace function public.active_support_grant(p_org uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.support_grants
   where org_id = p_org and ended_at is null and now() between starts_at and expires_at
   order by expires_at desc limit 1;
$$;

-- May the signed-in person look at this club as Courtix support right now?
create or replace function public.support_can_view(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.platform_role() in ('super_admin', 'support'), false) and public.active_support_grant(p_org) is not null;
$$;

alter table public.support_grants enable row level security;
create policy support_grants_select on public.support_grants for select to authenticated
  using (public.is_org_staff(org_id) or public.platform_role() is not null);
grant select on public.support_grants to authenticated;
revoke all on public.support_grants from anon;

alter table public.support_access_log enable row level security;
create policy support_access_log_select on public.support_access_log for select to authenticated
  using (public.has_org_permission(org_id, 'staff.manage') or public.platform_role() = 'super_admin');
grant select on public.support_access_log to authenticated;
revoke all on public.support_access_log from anon;

-- Club owner: allow Courtix support for some hours (replaces an open session). Returns its id.
create or replace function public.allow_support_access(p_org uuid, p_hours int default 24, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.has_org_permission(p_org, 'staff.manage') then
    raise exception 'Only the club owner can let Courtix support in';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 168 then
    raise exception 'Choose between 1 hour and 7 days';
  end if;
  update public.support_grants set ended_at = now() where org_id = p_org and ended_at is null and expires_at > now();
  insert into public.support_grants (org_id, granted_by, note, expires_at)
  values (p_org, auth.uid(), nullif(trim(coalesce(p_note, '')), ''), now() + make_interval(hours => p_hours))
  returning id into v_id;
  return v_id;
end;
$$;

-- Club owner: end support access now.
create or replace function public.end_support_access(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_org_permission(p_org, 'staff.manage') then
    raise exception 'Only the club owner can change Courtix support access';
  end if;
  update public.support_grants set ended_at = now() where org_id = p_org and ended_at is null and expires_at > now();
end;
$$;

-- Support: record a page view (the app calls this on every page while in support view).
-- The same page within a minute counts once.
create or replace function public.log_support_view(p_org uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_grant uuid := public.active_support_grant(p_org);
begin
  if v_grant is null or not coalesce(public.platform_role() in ('super_admin', 'support'), false) then
    raise exception 'No support access to this club right now';
  end if;
  -- The layout and the page log at the same moment: one at a time per person and page.
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || coalesce(p_path, '')));
  if exists (select 1 from public.support_access_log
              where org_id = p_org and user_id = auth.uid() and path is not distinct from p_path
                and viewed_at > now() - interval '1 minute') then
    return;
  end if;
  insert into public.support_access_log (org_id, grant_id, user_id, email, path)
  select p_org, v_grant, auth.uid(), u.email, left(p_path, 300) from auth.users u where u.id = auth.uid();
end;
$$;

-- Read-only access for support during a session: an extra select policy on club tables.
-- (Policies add up: staff keep their own rules; there are no write policies for support.)
do $$
declare t text;
begin
  foreach t in array array[
    'locations', 'courts', 'rate_rules', 'package_types', 'package_coverage', 'members', 'memberships',
    'check_ins', 'bookings', 'sessions', 'session_types', 'session_schedules', 'session_registrations',
    'orders', 'order_items', 'slip_refs', 'chat_conversations', 'chat_messages', 'ai_messages',
    'member_notices', 'inquiry_replies', 'org_staff'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.support_can_view(org_id))',
      t || '_support_view', t);
  end loop;
end $$;
create policy orgs_support_view on public.orgs for select to authenticated using (public.support_can_view(id));

-- ---------------------------------------------------------------------------
-- The Courtix admin area
-- ---------------------------------------------------------------------------
-- Every club with usage numbers. No member data. Owner contact for super admin, support, sales.
create or replace function public.platform_clubs()
returns table (
  id uuid, name text, slug text, created_at timestamptz, owner_email text,
  members bigint, staff bigint, locations bigint, bookings_30d bigint, sessions_30d bigint,
  support_until timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.platform_role := public.platform_role();
begin
  if v_role is null then raise exception 'Only the Courtix team can see this'; end if;
  return query
    select o.id, o.name, o.slug, o.created_at,
           case when v_role <> 'marketing' then (
             select u.email::text from public.org_staff s join auth.users u on u.id = s.user_id
              where s.org_id = o.id and s.role = 'owner' order by s.created_at limit 1)
           end,
           (select count(*) from public.members m where m.org_id = o.id),
           (select count(*) from public.org_staff s where s.org_id = o.id),
           (select count(*) from public.locations l where l.org_id = o.id and l.is_active),
           (select count(*) from public.bookings b where b.org_id = o.id and b.created_at > now() - interval '30 days'),
           (select count(*) from public.session_registrations r where r.org_id = o.id and r.created_at > now() - interval '30 days'),
           (select g.expires_at from public.support_grants g
             where g.id = public.active_support_grant(o.id))
      from public.orgs o
     order by o.created_at desc;
end;
$$;

-- Super admin: the team with emails.
create or replace function public.platform_team()
returns table (user_id uuid, email text, role public.platform_role, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.platform_role() is distinct from 'super_admin' then raise exception 'Only a super admin can see the team'; end if;
  return query
    select p.user_id, u.email::text, p.role, p.created_at
      from public.platform_staff p join auth.users u on u.id = p.user_id
     order by p.created_at;
end;
$$;

-- Super admin: add someone (they need a Courtix account first) or change their role.
create or replace function public.platform_set_staff(p_email text, p_role public.platform_role)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if public.platform_role() is distinct from 'super_admin' then raise exception 'Only a super admin can change the team'; end if;
  select id into v_user from auth.users where lower(email) = lower(trim(coalesce(p_email, '')));
  if v_user is null then
    raise exception 'No Courtix account uses that email. Ask them to create one at courtix.app first';
  end if;
  insert into public.platform_staff (user_id, role) values (v_user, p_role)
  on conflict (user_id) do update set role = excluded.role;
end;
$$;

create or replace function public.platform_remove_staff(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.platform_role() is distinct from 'super_admin' then raise exception 'Only a super admin can change the team'; end if;
  delete from public.platform_staff where user_id = p_user;
end;
$$;

grant execute on function
  public.platform_role(), public.active_support_grant(uuid), public.support_can_view(uuid),
  public.allow_support_access(uuid, int, text), public.end_support_access(uuid), public.log_support_view(uuid, text),
  public.platform_clubs(), public.platform_team(), public.platform_set_staff(text, public.platform_role),
  public.platform_remove_staff(uuid)
to authenticated;
revoke execute on function
  public.platform_role(), public.active_support_grant(uuid), public.support_can_view(uuid),
  public.allow_support_access(uuid, int, text), public.end_support_access(uuid), public.log_support_view(uuid, text),
  public.platform_clubs(), public.platform_team(), public.platform_set_staff(text, public.platform_role),
  public.platform_remove_staff(uuid)
from anon, public;
