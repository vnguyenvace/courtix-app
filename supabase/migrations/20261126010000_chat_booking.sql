-- Step 9 (part 1): chat booking with Claude.
--
-- Members chat with the club (WhatsApp first; a test chat in the app until WhatsApp is connected).
-- Claude answers from the club's real data and, when the club allows it, books places that are
-- FREE or COVERED BY THE MEMBER'S PACKAGE. Anything that would cost money, refunds, complaints,
-- private coaching or anything unclear goes to the club's staff (Julian's defaults, 18 Nov 2026).
--
-- The money rule lives here, not in the prompt: chat_book_session / chat_book_court make the
-- booking with the normal functions (every club rule applies) and then refuse, undoing it, if
-- the place would cost anything. A confused or manipulated model can't book a paid place.
--
-- Who is chatting comes from the conversation (the phone number WhatsApp gives us), never from
-- the model: Claude can only book for the person in that conversation.

-- ---------------------------------------------------------------------------
-- Club setting
-- ---------------------------------------------------------------------------
-- 'book'   = answer questions and book free / package-covered places (the default)
-- 'answer' = answer questions only; staff do every booking
alter table public.orgs add column chat_mode text not null default 'book'
  check (chat_mode in ('answer', 'book'));

-- Places booked by chat are marked on the roster.
alter table public.session_registrations drop constraint session_registrations_source_check;
alter table public.session_registrations add constraint session_registrations_source_check
  check (source in ('desk', 'online', 'chat'));

-- ---------------------------------------------------------------------------
-- Conversations and messages
-- ---------------------------------------------------------------------------
create table public.chat_conversations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  location_id     uuid,                 -- the site whose number they wrote to (null = club-wide)
  channel         text not null check (channel in ('whatsapp', 'line', 'test')),
  contact_phone   text not null,        -- +66812345678 style
  contact_name    text,                 -- name from their chat profile, or what they told us
  member_id       uuid,                 -- matched by phone number
  -- bot: Claude answers. staff: handed off, Claude stays quiet until staff hand it back. closed: done.
  status          text not null default 'bot' check (status in ('bot', 'staff', 'closed')),
  handoff_reason  text,
  handed_off_at   timestamptz,
  last_message_at timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, member_id) references public.members(org_id, id) on delete set null (member_id),
  foreign key (org_id, location_id) references public.locations(org_id, id) on delete set null (location_id)
);
create index chat_conversations_org_idx on public.chat_conversations(org_id, status, last_message_at desc);
-- One open conversation per person per channel.
create unique index chat_conversations_open_uq on public.chat_conversations(org_id, channel, contact_phone)
  where status <> 'closed';

create table public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  conversation_id uuid not null,
  -- contact: the member/visitor. assistant: Claude. staff: a person at the club. tool: Claude's
  -- tool results (not shown as chat bubbles; kept so the conversation replays exactly).
  role            text not null check (role in ('contact', 'assistant', 'staff', 'tool')),
  body            text,                 -- what people see (null for tool-only steps)
  api             jsonb,                -- the exact Claude API message {role, content}, replayed next turn
  event           jsonb,                -- what happened, for the transcript: booked / handed off / refused
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, conversation_id) references public.chat_conversations(org_id, id) on delete cascade
);
create index chat_messages_conv_idx on public.chat_messages(conversation_id, created_at, id);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
create policy chat_conversations_all on public.chat_conversations for all to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));
create policy chat_messages_all on public.chat_messages for all to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));
grant select, insert, update, delete on public.chat_conversations, public.chat_messages to authenticated;
revoke all on public.chat_conversations, public.chat_messages from anon;

-- ---------------------------------------------------------------------------
-- Phone numbers: digits with country code. Thai 08x... becomes 668x...
-- ---------------------------------------------------------------------------
create or replace function public.phone_key(p_phone text)
returns text language sql immutable set search_path = '' as $$
  select case
    when d ~ '^0[0-9]{8,9}$' then '66' || substr(d, 2)
    when d = '' then null
    else d end
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d) x;
$$;

-- Opens (or reuses) the conversation with this phone number and matches it to a member.
-- Security invoker: staff (and later the WhatsApp service identity) only reach their own club.
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
  if not public.is_org_staff(p_org) then raise exception 'You don''t have access to this club'; end if;

  select id into v_id from public.chat_conversations
   where org_id = p_org and channel = p_channel and contact_phone = '+' || v_key and status <> 'closed';
  if found then return v_id; end if;

  -- A number shared by two members is ambiguous: treat them as a visitor.
  select case when count(*) = 1 then min(m.id::text)::uuid end into v_member
    from public.members m
   where m.org_id = p_org and public.phone_key(m.phone) = v_key;

  insert into public.chat_conversations (org_id, location_id, channel, contact_phone, contact_name, member_id)
  values (p_org, p_location, p_channel, '+' || v_key, nullif(trim(p_name), ''), v_member)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bookings Claude may make. Both return what happened as JSON for Claude to tell the member.
-- ---------------------------------------------------------------------------
create or replace function public.chat_book_session(p_conversation uuid, p_session uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_c    public.chat_conversations;
  v_org  public.orgs;
  v_id   uuid;
  v_r    public.session_registrations;
  v_s    record;
begin
  select * into v_c from public.chat_conversations where id = p_conversation;
  if not found then raise exception 'Conversation not found'; end if;
  select * into v_org from public.orgs where id = v_c.org_id;
  if v_org.chat_mode <> 'book' then
    raise exception 'The club books places itself. Tell them a team member will confirm';
  end if;
  if v_c.status <> 'bot' then raise exception 'Staff are handling this chat'; end if;

  select so.* into v_s from public.session_overview so where so.id = p_session and so.org_id = v_c.org_id;
  if not found then raise exception 'Session not found'; end if;

  -- Same rules as the desk (capacity, waitlist, cut-off, sign-up window, levels), no overrides.
  v_id := public.register_for_session(
    p_session, v_c.member_id,
    case when v_c.member_id is null then coalesce(v_c.contact_name, 'Chat guest') end,
    case when v_c.member_id is null then v_c.contact_phone end,
    false, false);
  update public.session_registrations set source = 'chat' where id = v_id returning * into v_r;

  if v_r.price > 0 then
    -- Raising undoes the sign-up above: chat never books a paid place.
    raise exception 'This place costs % %, so the club needs to confirm it', v_org.currency, regexp_replace(v_r.price::text, '\.00$', '');
  end if;

  return jsonb_build_object(
    'registration_id', v_r.id,
    'status', v_r.status,              -- booked or waitlisted
    'price', v_r.price,
    'covered_by', (select p.name from public.memberships ms join public.package_types p on p.id = ms.package_type_id
                    where ms.id = v_r.membership_id),
    'credit_used', v_r.credit_used,
    'session', v_s.name,
    'when', to_char(v_s.starts_at at time zone v_s.location_timezone, 'Dy DD Mon HH24:MI'),
    'location', v_s.location_name);
end;
$$;

create or replace function public.chat_book_court(p_conversation uuid, p_court uuid, p_start timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_c   public.chat_conversations;
  v_org public.orgs;
  v_id  uuid;
  v_b   public.bookings;
  v_court public.courts;
  v_loc public.locations;
begin
  select * into v_c from public.chat_conversations where id = p_conversation;
  if not found then raise exception 'Conversation not found'; end if;
  select * into v_org from public.orgs where id = v_c.org_id;
  if v_org.chat_mode <> 'book' then
    raise exception 'The club books courts itself. Tell them a team member will confirm';
  end if;
  if v_c.status <> 'bot' then raise exception 'Staff are handling this chat'; end if;
  if v_c.member_id is null then
    raise exception 'Only members can book courts by chat. A team member will help a visitor';
  end if;
  select * into v_court from public.courts where id = p_court and org_id = v_c.org_id;
  if not found then raise exception 'Court not found'; end if;
  select * into v_loc from public.locations where id = v_court.location_id;

  v_id := public.create_booking(p_court, p_start, v_c.member_id, null, null, null, 'Booked by chat');
  select * into v_b from public.bookings where id = v_id;
  if v_b.price > 0 then
    raise exception 'This court time costs % %, so the club needs to confirm it', v_org.currency, regexp_replace(v_b.price::text, '\.00$', '');
  end if;

  return jsonb_build_object(
    'booking_id', v_b.id,
    'court', v_court.name,
    'location', v_loc.name,
    'when', to_char(lower(v_b.during) at time zone v_loc.timezone, 'Dy DD Mon HH24:MI'),
    'until', to_char(upper(v_b.during) at time zone v_loc.timezone, 'HH24:MI'),
    'price', v_b.price);
end;
$$;

-- Claude (or staff) passes the chat to a person. Claude stays quiet until staff hand it back.
create or replace function public.chat_hand_off(p_conversation uuid, p_reason text)
returns void language sql security invoker set search_path = '' as $$
  update public.chat_conversations
     set status = 'staff', handoff_reason = left(coalesce(nullif(trim(p_reason), ''), 'Needs a person'), 300),
         handed_off_at = now()
   where id = p_conversation and status <> 'closed';
$$;

grant execute on function
  public.phone_key(text),
  public.chat_open_conversation(uuid, text, text, text, uuid),
  public.chat_book_session(uuid, uuid),
  public.chat_book_court(uuid, uuid, timestamptz),
  public.chat_hand_off(uuid, text)
to authenticated;
revoke execute on function
  public.chat_open_conversation(uuid, text, text, text, uuid),
  public.chat_book_session(uuid, uuid),
  public.chat_book_court(uuid, uuid, timestamptz),
  public.chat_hand_off(uuid, text)
from anon, public;
