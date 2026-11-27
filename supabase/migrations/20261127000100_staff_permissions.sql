-- Club roles as permissions (Julian, 27 Nov 2026, "ok" to the role table).
-- Rules ask "may this person do X?" (has_org_permission) instead of "is this person owner or
-- manager?". Which role may do what is one table, role_permissions, so a new role is new rows,
-- not new policies. Location limits (org_staff.location_ids, can_use_location) still apply on top.
--
--   permission        owner admin front_desk marketing back_office
--   bookings.manage     x     x       x                              book courts/sessions, check in
--   members.view        x     x       x          x          x
--   members.edit        x     x       x                              add/edit members, sell packages
--   payments.record     x     x       x                     x        see and record payments
--   payments.refund     x     x                             x        refunds, undo a payment
--   chats.reply         x     x       x          x                   chats and the reply helper
--   followups.send      x     x       x          x                   draft and send follow-ups
--   followups.manage    x     x                  x                   approve follow-ups, edit offers
--   reports.view        x     x                             x        revenue figures
--   club.setup          x     x                                      prices, packages, courts, timetable
--   settings.manage     x     x                                      club settings, LINE, PromptPay, logo
--   members.export      x                                            export member data
--   staff.manage        x                                            add/remove staff, change roles
--
-- Setup functions that already check has_org_role(.., '{owner,manager}') (generate_sessions,
-- update_session, ...) are unchanged: that is exactly club.setup.

-- ---------------------------------------------------------------------------
-- Which role may do what (the same for every club)
-- ---------------------------------------------------------------------------
create table public.role_permissions (
  role       public.staff_role not null,
  permission text not null,
  primary key (role, permission)
);
alter table public.role_permissions enable row level security;
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);
grant select on public.role_permissions to authenticated;
revoke all on public.role_permissions from anon;

insert into public.role_permissions (role, permission)
select 'owner'::public.staff_role, p from unnest(array[
  'bookings.manage','members.view','members.edit','payments.record','payments.refund','chats.reply',
  'followups.send','followups.manage','reports.view','club.setup','settings.manage','members.export','staff.manage']) p
union all
select 'manager', p from unnest(array[
  'bookings.manage','members.view','members.edit','payments.record','payments.refund','chats.reply',
  'followups.send','followups.manage','reports.view','club.setup','settings.manage']) p
union all
select 'front_desk', p from unnest(array[
  'bookings.manage','members.view','members.edit','payments.record','chats.reply','followups.send']) p
union all
select 'marketing', p from unnest(array[
  'members.view','chats.reply','followups.send','followups.manage']) p
union all
select 'back_office', p from unnest(array[
  'members.view','payments.record','payments.refund','reports.view']) p;

create or replace function public.has_org_permission(p_org uuid, p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_staff s
      join public.role_permissions r on r.role = s.role
     where s.org_id = p_org and s.user_id = auth.uid() and r.permission = p_permission
  );
$$;
grant execute on function public.has_org_permission(uuid, text) to authenticated;
revoke execute on function public.has_org_permission(uuid, text) from anon, public;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- Club settings and the staff list
drop policy orgs_update on public.orgs;
create policy orgs_update on public.orgs for update to authenticated
  using (public.has_org_permission(id, 'settings.manage'))
  with check (public.has_org_permission(id, 'settings.manage'));

drop policy org_staff_write on public.org_staff;
create policy org_staff_write on public.org_staff for all to authenticated
  using (public.has_org_permission(org_id, 'staff.manage'))
  with check (public.has_org_permission(org_id, 'staff.manage'));

drop policy messaging_channels_write on public.messaging_channels;
create policy messaging_channels_write on public.messaging_channels for all to authenticated
  using (public.has_org_permission(org_id, 'settings.manage'))
  with check (public.has_org_permission(org_id, 'settings.manage'));

-- Club setup: everyone reads, club.setup writes
drop policy courts_write on public.courts;
create policy courts_write on public.courts for all to authenticated
  using (public.has_org_permission(org_id, 'club.setup')) with check (public.has_org_permission(org_id, 'club.setup'));
drop policy rate_rules_write on public.rate_rules;
create policy rate_rules_write on public.rate_rules for all to authenticated
  using (public.has_org_permission(org_id, 'club.setup')) with check (public.has_org_permission(org_id, 'club.setup'));
drop policy package_types_write on public.package_types;
create policy package_types_write on public.package_types for all to authenticated
  using (public.has_org_permission(org_id, 'club.setup')) with check (public.has_org_permission(org_id, 'club.setup'));
drop policy package_coverage_write on public.package_coverage;
create policy package_coverage_write on public.package_coverage for all to authenticated
  using (public.has_org_permission(org_id, 'club.setup')) with check (public.has_org_permission(org_id, 'club.setup'));
drop policy locations_write on public.locations;
create policy locations_write on public.locations for all to authenticated
  using (public.has_org_permission(org_id, 'club.setup')) with check (public.has_org_permission(org_id, 'club.setup'));
drop policy session_types_write on public.session_types;
create policy session_types_write on public.session_types for all to authenticated
  using (public.has_org_permission(org_id, 'club.setup')) with check (public.has_org_permission(org_id, 'club.setup'));
drop policy session_schedules_write on public.session_schedules;
create policy session_schedules_write on public.session_schedules for all to authenticated
  using (public.has_org_permission(org_id, 'club.setup')) with check (public.has_org_permission(org_id, 'club.setup'));
drop policy sessions_insert on public.sessions;
create policy sessions_insert on public.sessions for insert to authenticated
  with check (public.has_org_permission(org_id, 'club.setup'));
drop policy sessions_delete on public.sessions;
create policy sessions_delete on public.sessions for delete to authenticated
  using (public.has_org_permission(org_id, 'club.setup'));
-- Changing a session (cancel, notes) is front-desk work at that site.
drop policy sessions_update on public.sessions;
create policy sessions_update on public.sessions for update to authenticated
  using (public.has_org_permission(org_id, 'bookings.manage') and public.can_use_location(org_id, location_id))
  with check (public.has_org_permission(org_id, 'bookings.manage') and public.can_use_location(org_id, location_id));

-- Members and their packages: everyone reads, members.edit writes
drop policy members_all on public.members;
create policy members_select on public.members for select to authenticated
  using (public.has_org_permission(org_id, 'members.view'));
create policy members_insert on public.members for insert to authenticated
  with check (public.has_org_permission(org_id, 'members.edit'));
create policy members_update on public.members for update to authenticated
  using (public.has_org_permission(org_id, 'members.edit')) with check (public.has_org_permission(org_id, 'members.edit'));
create policy members_delete on public.members for delete to authenticated
  using (public.has_org_permission(org_id, 'members.edit'));

drop policy memberships_all on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
  using (public.has_org_permission(org_id, 'members.view'));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (public.has_org_permission(org_id, 'members.edit'));
create policy memberships_update on public.memberships for update to authenticated
  using (public.has_org_permission(org_id, 'members.edit')) with check (public.has_org_permission(org_id, 'members.edit'));
create policy memberships_delete on public.memberships for delete to authenticated
  using (public.has_org_permission(org_id, 'members.edit'));

-- Check-ins, court bookings and session sign-ups: everyone reads, bookings.manage at their sites writes
drop policy check_ins_all on public.check_ins;
create policy check_ins_select on public.check_ins for select to authenticated
  using (public.has_org_permission(org_id, 'members.view'));
create policy check_ins_write on public.check_ins for all to authenticated
  using (public.has_org_permission(org_id, 'bookings.manage')) with check (public.has_org_permission(org_id, 'bookings.manage'));

drop policy bookings_write on public.bookings;
drop policy bookings_update on public.bookings;
drop policy bookings_delete on public.bookings;
create policy bookings_write on public.bookings for insert to authenticated
  with check (public.has_org_permission(org_id, 'bookings.manage') and public.can_use_location(org_id, location_id));
create policy bookings_update on public.bookings for update to authenticated
  using (public.has_org_permission(org_id, 'bookings.manage') and public.can_use_location(org_id, location_id))
  with check (public.has_org_permission(org_id, 'bookings.manage') and public.can_use_location(org_id, location_id));
create policy bookings_delete on public.bookings for delete to authenticated
  using (public.has_org_permission(org_id, 'bookings.manage') and public.can_use_location(org_id, location_id));

drop policy session_regs_write on public.session_registrations;
drop policy session_regs_update on public.session_registrations;
drop policy session_regs_delete on public.session_registrations;
create policy session_regs_write on public.session_registrations for insert to authenticated
  with check (public.has_org_permission(org_id, 'bookings.manage')
    and public.can_use_location(org_id, (select s.location_id from public.sessions s where s.id = session_id)));
create policy session_regs_update on public.session_registrations for update to authenticated
  using (public.has_org_permission(org_id, 'bookings.manage')
    and public.can_use_location(org_id, (select s.location_id from public.sessions s where s.id = session_id)))
  with check (public.has_org_permission(org_id, 'bookings.manage')
    and public.can_use_location(org_id, (select s.location_id from public.sessions s where s.id = session_id)));
create policy session_regs_delete on public.session_registrations for delete to authenticated
  using (public.has_org_permission(org_id, 'bookings.manage')
    and public.can_use_location(org_id, (select s.location_id from public.sessions s where s.id = session_id)));

-- Payments: payments.record sees and records them (orders made by bookings come from
-- security definer triggers, so booking doesn't need this)
drop policy orders_select on public.orders;
drop policy orders_insert on public.orders;
drop policy orders_update on public.orders;
create policy orders_select on public.orders for select to authenticated
  using (public.has_org_permission(org_id, 'payments.record'));
create policy orders_insert on public.orders for insert to authenticated
  with check (public.has_org_permission(org_id, 'payments.record'));
create policy orders_update on public.orders for update to authenticated
  using (public.has_org_permission(org_id, 'payments.record')) with check (public.has_org_permission(org_id, 'payments.record'));
drop policy order_items_select on public.order_items;
drop policy order_items_insert on public.order_items;
drop policy order_items_update on public.order_items;
create policy order_items_select on public.order_items for select to authenticated
  using (public.has_org_permission(org_id, 'payments.record'));
create policy order_items_insert on public.order_items for insert to authenticated
  with check (public.has_org_permission(org_id, 'payments.record'));
create policy order_items_update on public.order_items for update to authenticated
  using (public.has_org_permission(org_id, 'payments.record')) with check (public.has_org_permission(org_id, 'payments.record'));
drop policy slip_refs_select on public.slip_refs;
create policy slip_refs_select on public.slip_refs for select to authenticated
  using (public.has_org_permission(org_id, 'payments.record'));

-- Chats and the reply helper
drop policy chat_conversations_all on public.chat_conversations;
create policy chat_conversations_all on public.chat_conversations for all to authenticated
  using (public.has_org_permission(org_id, 'chats.reply')) with check (public.has_org_permission(org_id, 'chats.reply'));
drop policy chat_messages_all on public.chat_messages;
create policy chat_messages_all on public.chat_messages for all to authenticated
  using (public.has_org_permission(org_id, 'chats.reply')) with check (public.has_org_permission(org_id, 'chats.reply'));
drop policy inquiry_replies_all on public.inquiry_replies;
create policy inquiry_replies_all on public.inquiry_replies for all to authenticated
  using (public.has_org_permission(org_id, 'chats.reply')) with check (public.has_org_permission(org_id, 'chats.reply'));

-- Follow-ups: followups.send works with them; approving is followups.manage (the rule below)
drop policy ai_messages_all on public.ai_messages;
create policy ai_messages_all on public.ai_messages for all to authenticated
  using (public.has_org_permission(org_id, 'followups.send')) with check (public.has_org_permission(org_id, 'followups.send'));

-- Storage: logo is a setting; transfer slips are payments
drop policy club_logos_insert on storage.objects;
drop policy club_logos_update on storage.objects;
drop policy club_logos_delete on storage.objects;
create policy club_logos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'club-logos' and public.has_org_permission(public.logo_org(name), 'settings.manage'));
create policy club_logos_update on storage.objects for update to authenticated
  using (bucket_id = 'club-logos' and public.has_org_permission(public.logo_org(name), 'settings.manage'))
  with check (bucket_id = 'club-logos' and public.has_org_permission(public.logo_org(name), 'settings.manage'));
create policy club_logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'club-logos' and public.has_org_permission(public.logo_org(name), 'settings.manage'));
drop policy payment_slips_insert on storage.objects;
drop policy payment_slips_select on storage.objects;
create policy payment_slips_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-slips' and public.has_org_permission(public.logo_org(name), 'payments.record'));
create policy payment_slips_select on storage.objects for select to authenticated
  using (bucket_id = 'payment-slips' and public.has_org_permission(public.logo_org(name), 'payments.record'));

-- ---------------------------------------------------------------------------
-- Functions that checked owner/manager for things other roles now do
-- ---------------------------------------------------------------------------
create or replace function public.ai_messages_approval_rule()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_mode    text;
  v_manager boolean;
begin
  select followup_mode into v_mode from public.orgs where id = new.org_id;
  -- auth.uid() is null for the database owner and the service identity (morning job).
  v_manager := auth.uid() is null or public.has_org_permission(new.org_id, 'followups.manage');

  if new.status = 'approved' and old.status is distinct from 'approved' then
    if not v_manager then
      raise exception 'Only an owner, admin or marketing can approve messages';
    end if;
    new.approved_at := now();
    new.approved_by := auth.uid();
  end if;

  if v_mode = 'approve' and not v_manager then
    if new.status = 'sent' and old.status = 'draft' then
      raise exception 'This message needs approval before it goes out';
    end if;
    if old.status = 'approved' and new.body is distinct from old.body then
      raise exception 'This message was approved as it is. Ask whoever approves messages to change it';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.approve_all_drafts(p_org uuid)
returns int language plpgsql security invoker set search_path = '' as $$
declare v_count int;
begin
  if not public.has_org_permission(p_org, 'followups.manage') then
    raise exception 'Only an owner, admin or marketing can approve messages';
  end if;
  update public.ai_messages set status = 'approved'
   where org_id = p_org and status = 'draft';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.mark_order_unpaid(p_order uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if not public.has_org_permission(v_org, 'payments.refund') then
    raise exception 'Only an owner, admin or back office can undo a payment';
  end if;
  update public.orders
     set status = 'pending', method = null, paid_amount = null, paid_at = null, received_by = null
   where id = p_order and status = 'paid';
  if not found then raise exception 'Only paid orders can be undone'; end if;
  perform public.recalc_order(p_order);
end;
$$;

create or replace function public.resolve_refund(p_order uuid, p_refunded boolean, p_note text default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if not public.has_org_permission(v_org, 'payments.refund') then
    raise exception 'Only an owner, admin or back office can decide about refunds';
  end if;
  update public.orders
     set status = case when p_refunded then 'refunded' else 'paid' end,
         note = coalesce(nullif(trim(p_note), ''), note, case when p_refunded then null else 'Kept after cancellation' end)
   where id = p_order and status = 'refund_due';
  if not found then raise exception 'There''s no refund to decide on this order'; end if;
end;
$$;

-- Marketing edits how follow-ups sound and which offers they may mention, not the rest of the
-- club's settings (orgs updates are settings.manage).
create or replace function public.update_message_voice(p_org uuid, p_voice text, p_sign_off text, p_offers text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_org_permission(p_org, 'followups.manage') then
    raise exception 'You can''t change how messages sound';
  end if;
  update public.orgs
     set ai_voice = coalesce(nullif(trim(p_voice), ''), ai_voice),
         ai_sign_off = nullif(trim(p_sign_off), ''),
         ai_offers = nullif(trim(p_offers), '')
   where id = p_org;
end;
$$;
grant execute on function public.update_message_voice(uuid, text, text, text) to authenticated;
revoke execute on function public.update_message_voice(uuid, text, text, text) from anon, public;

-- ---------------------------------------------------------------------------
-- A club always keeps at least one owner
-- ---------------------------------------------------------------------------
create or replace function public.org_staff_keep_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner')
     and exists (select 1 from public.orgs where id = old.org_id)  -- not when the whole club is deleted
     and not exists (select 1 from public.org_staff where org_id = old.org_id and role = 'owner' and user_id <> old.user_id)
  then
    raise exception 'A club needs at least one owner. Make someone else owner first';
  end if;
  return null;
end;
$$;
create trigger org_staff_keep_owner after update of role or delete on public.org_staff
  for each row execute function public.org_staff_keep_owner();

-- ---------------------------------------------------------------------------
-- Staff invites: the owner adds an email and a role; the person opens the invite link
-- (<slug>.courtix.app/join/<token>), signs in or creates an account with that email, and joins.
-- The link's token is stored only as a hash. Both the token and the email must match.
-- ---------------------------------------------------------------------------
create table public.staff_invites (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  email        text not null check (email = lower(email)),
  role         public.staff_role not null,
  location_ids uuid[],
  token_hash   text not null unique,
  invited_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null,
  unique (org_id, id)
);
create unique index staff_invites_open_idx on public.staff_invites(org_id, email) where accepted_at is null;
create trigger staff_invites_check_locations before insert or update of location_ids on public.staff_invites
  for each row execute function public.check_location_ids();

alter table public.staff_invites enable row level security;
create policy staff_invites_all on public.staff_invites for all to authenticated
  using (public.has_org_permission(org_id, 'staff.manage')) with check (public.has_org_permission(org_id, 'staff.manage'));
grant select, delete on public.staff_invites to authenticated;
revoke all on public.staff_invites from anon;

-- Owner: invite someone. Returns the token for the link (shown or emailed once).
create or replace function public.invite_staff(p_org uuid, p_email text, p_role public.staff_role, p_location_ids uuid[] default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text;
begin
  if not public.has_org_permission(p_org, 'staff.manage') then
    raise exception 'Only the club owner can add staff';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address';
  end if;
  if exists (select 1 from public.org_staff s join auth.users u on u.id = s.user_id
              where s.org_id = p_org and lower(u.email) = v_email) then
    raise exception '% is already on the staff', v_email;
  end if;
  delete from public.staff_invites where org_id = p_org and email = v_email and accepted_at is null;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.staff_invites (org_id, email, role, location_ids, token_hash, invited_by)
  values (p_org, v_email, p_role, p_location_ids, public.sha256_hex(v_token), auth.uid());
  return v_token;
end;
$$;

-- Owner: a new link for an open invite (the old link stops working), valid 7 more days.
create or replace function public.renew_staff_invite(p_invite uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  select org_id into v_org from public.staff_invites where id = p_invite and accepted_at is null;
  if not found or not public.has_org_permission(v_org, 'staff.manage') then
    raise exception 'This invite is no longer open';
  end if;
  update public.staff_invites
     set token_hash = public.sha256_hex(v_token), expires_at = now() + interval '7 days'
   where id = p_invite;
  return v_token;
end;
$$;

-- Anyone with the link: what the invite is for (to show on the join page).
create or replace function public.staff_invite_info(p_token text)
returns table (club_name text, club_slug text, email text, role public.staff_role, expired boolean, accepted boolean)
language sql stable security definer set search_path = '' as $$
  select o.name, o.slug, i.email, i.role, i.expires_at < now(), i.accepted_at is not null
    from public.staff_invites i join public.orgs o on o.id = i.org_id
   where i.token_hash = public.sha256_hex(coalesce(p_token, ''));
$$;

-- The invited person, signed in with the invited email: join the club. Returns the club id.
create or replace function public.accept_staff_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_i public.staff_invites;
  v_email text;
  v_confirmed timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into v_i from public.staff_invites where token_hash = public.sha256_hex(coalesce(p_token, '')) for update;
  if not found then
    raise exception 'This invite link isn''t valid. Ask the club owner for a new one';
  end if;
  if v_i.accepted_at is not null then
    if v_i.accepted_by = auth.uid() then return v_i.org_id; end if;
    raise exception 'This invite was already used. Ask the club owner for a new one';
  end if;
  if v_i.expires_at < now() then
    raise exception 'This invite has expired. Ask the club owner for a new one';
  end if;
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = auth.uid();
  if v_email is distinct from v_i.email then
    raise exception 'This invite is for %. Sign in with that email', v_i.email;
  end if;
  if v_confirmed is null then
    raise exception 'Confirm your email address first, then open the invite link again';
  end if;
  insert into public.org_staff (org_id, user_id, role, location_ids)
  values (v_i.org_id, auth.uid(), v_i.role, v_i.location_ids)
  on conflict (org_id, user_id) do nothing;
  update public.staff_invites set accepted_at = now(), accepted_by = auth.uid() where id = v_i.id;
  return v_i.org_id;
end;
$$;

-- Owner: the staff list with emails (auth.users isn't readable from the app).
create or replace function public.club_staff(p_org uuid)
returns table (user_id uuid, email text, role public.staff_role, location_ids uuid[], created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_org_permission(p_org, 'staff.manage') then
    raise exception 'Only the club owner can see the staff list';
  end if;
  return query
    select s.user_id, u.email::text, s.role, s.location_ids, s.created_at
      from public.org_staff s join auth.users u on u.id = s.user_id
     where s.org_id = p_org
     order by s.created_at;
end;
$$;

grant execute on function
  public.invite_staff(uuid, text, public.staff_role, uuid[]),
  public.renew_staff_invite(uuid),
  public.accept_staff_invite(text),
  public.club_staff(uuid)
to authenticated;
grant execute on function public.staff_invite_info(text) to anon, authenticated;
revoke execute on function
  public.invite_staff(uuid, text, public.staff_role, uuid[]),
  public.renew_staff_invite(uuid),
  public.accept_staff_invite(text),
  public.club_staff(uuid)
from anon, public;
revoke execute on function public.staff_invite_info(text) from public;
