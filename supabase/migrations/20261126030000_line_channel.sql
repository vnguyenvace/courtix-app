-- Step 9: each club connects its own LINE Official Account (Messaging API).
--
-- A club pastes its LINE channel secret and channel access token in Settings → Messaging.
-- They are stored ENCRYPTED by the app (AES-256-GCM, key CHANNEL_SECRETS_KEY, server-only), so
-- these columns hold ciphertext; a copy of the database alone can't use them.
-- LINE calls https://courtix.app/api/line/<webhook_key>; the route checks LINE's signature with
-- that club's channel secret before doing anything.
--
-- The table is generic (provider) so a club's own WhatsApp Cloud API number can use it later.

create table public.messaging_channels (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  location_id    uuid,                -- null = the whole club
  provider       text not null check (provider in ('line', 'whatsapp')),
  -- Unguessable part of the webhook address. Not a secret on its own (LINE signs every request).
  webhook_key    text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  secret_enc     text not null,       -- LINE channel secret, encrypted by the app
  token_enc      text not null,       -- LINE channel access token, encrypted by the app
  account_name   text,                -- e.g. "Raccoon Pickleball", from LINE
  account_id     text,                -- LINE basic id, e.g. "@raccoon"
  is_enabled     boolean not null default true,
  last_event_at  timestamptz,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, location_id) references public.locations(org_id, id) on delete cascade
);
-- One channel per provider per club (per location later, when a club asks for it).
create unique index messaging_channels_one_per_club on public.messaging_channels(org_id, provider)
  where location_id is null;

alter table public.messaging_channels enable row level security;
-- Staff can see that a channel is connected (the app reads the ciphertext to send their replies).
create policy messaging_channels_select on public.messaging_channels for select to authenticated
  using (public.is_org_staff(org_id));
-- Only owners and managers connect, change or remove it.
create policy messaging_channels_write on public.messaging_channels for all to authenticated
  using (public.has_org_role(org_id, '{owner,manager}'))
  with check (public.has_org_role(org_id, '{owner,manager}'));
grant select, insert, update, delete on public.messaging_channels to authenticated;
revoke all on public.messaging_channels from anon;

-- ---------------------------------------------------------------------------
-- Conversations from LINE: identified by LINE user id, not a phone number.
-- ---------------------------------------------------------------------------
alter table public.chat_conversations alter column contact_phone drop not null;
alter table public.chat_conversations add column line_user_id text;
alter table public.chat_conversations add constraint chat_conversations_contact_check check (
  case when channel = 'line' then line_user_id is not null else contact_phone is not null end);
drop index public.chat_conversations_open_uq;
create unique index chat_conversations_open_uq
  on public.chat_conversations(org_id, channel, coalesce(line_user_id, contact_phone))
  where status <> 'closed';

-- Delivery of what the assistant or staff wrote, for LINE/WhatsApp conversations.
alter table public.chat_messages add column delivered_at timestamptz;
alter table public.chat_messages add column delivery_error text;

-- ---------------------------------------------------------------------------
-- The service identity (LINE webhook, morning job) may open conversations too.
-- Inside a security-invoker function current_user is the caller's database role.
-- ---------------------------------------------------------------------------
create or replace function public.chat_open_conversation(
  p_org uuid, p_channel text, p_phone text, p_name text default null, p_location uuid default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_key    text := public.phone_key(p_phone);
  v_id     uuid;
  v_member uuid;
begin
  if v_key is null or length(v_key) < 8 or length(v_key) > 15 then
    raise exception 'Enter a phone number with country code, like +66 81 234 5678';
  end if;
  if current_user <> 'service_role' and not public.is_org_staff(p_org) then
    raise exception 'You don''t have access to this club';
  end if;

  select id into v_id from public.chat_conversations
   where org_id = p_org and channel = p_channel and contact_phone = '+' || v_key and status <> 'closed';
  if found then return v_id; end if;

  select case when count(*) = 1 then min(m.id::text)::uuid end into v_member
    from public.members m
   where m.org_id = p_org and public.phone_key(m.phone) = v_key;

  insert into public.chat_conversations (org_id, location_id, channel, contact_phone, contact_name, member_id)
  values (p_org, p_location, p_channel, '+' || v_key, nullif(trim(p_name), ''), v_member)
  returning id into v_id;
  return v_id;
end;
$$;

-- A LINE user writes to the club: reuse their open conversation or start one. A member who was
-- linked before (members.line_user_id) is recognised straight away.
create or replace function public.chat_open_line_conversation(
  p_org uuid, p_line_user text, p_name text default null, p_location uuid default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id     uuid;
  v_member uuid;
begin
  if coalesce(trim(p_line_user), '') = '' then raise exception 'LINE user missing'; end if;
  if current_user <> 'service_role' and not public.is_org_staff(p_org) then
    raise exception 'You don''t have access to this club';
  end if;

  select id into v_id from public.chat_conversations
   where org_id = p_org and channel = 'line' and line_user_id = p_line_user and status <> 'closed';
  if found then
    -- Keep their LINE display name fresh.
    update public.chat_conversations set contact_name = coalesce(nullif(trim(p_name), ''), contact_name)
     where id = v_id;
    return v_id;
  end if;

  select m.id into v_member from public.members m where m.org_id = p_org and m.line_user_id = p_line_user;

  insert into public.chat_conversations (org_id, location_id, channel, line_user_id, contact_name, member_id)
  values (p_org, p_location, 'line', p_line_user, nullif(trim(p_name), ''), v_member)
  returning id into v_id;
  return v_id;
end;
$$;

-- Staff say who a LINE chat is ("this is Dmitri"). Saves the link on the member, so their next
-- chats are recognised. LINE gives no phone number, so a person at the club decides this.
create or replace function public.chat_link_member(p_conversation uuid, p_member uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_c public.chat_conversations;
begin
  select * into v_c from public.chat_conversations where id = p_conversation;
  if not found then raise exception 'Conversation not found'; end if;
  if v_c.channel <> 'line' then raise exception 'Only LINE chats are linked by hand'; end if;
  if not exists (select 1 from public.members where id = p_member and org_id = v_c.org_id) then
    raise exception 'Member not found';
  end if;
  if exists (select 1 from public.members where org_id = v_c.org_id and line_user_id = v_c.line_user_id and id <> p_member) then
    raise exception 'This LINE account is already linked to another member';
  end if;
  update public.members set line_user_id = v_c.line_user_id where id = p_member;
  update public.chat_conversations set member_id = p_member where id = p_conversation;
end;
$$;

grant execute on function
  public.chat_open_line_conversation(uuid, text, text, uuid),
  public.chat_link_member(uuid, uuid)
to authenticated;
revoke execute on function
  public.chat_open_line_conversation(uuid, text, text, uuid),
  public.chat_link_member(uuid, uuid)
from anon, public;
