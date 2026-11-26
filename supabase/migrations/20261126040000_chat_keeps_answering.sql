-- Chats keep their AI answers while waiting for staff (Julian, 26 Nov 2026: "I want LINE to
-- respond automatically using AI").
--
-- Before: once a chat was handed to staff (status 'staff'), the assistant went silent in it until
-- someone handed it back, so a member who asked one paid thing got no answers to anything else.
-- Now: 'staff' only means "a person needs to look at something here". The assistant keeps
-- answering and may still book free / package-covered places. It pauses only while a person is
-- actually answering: assistant_paused_until is set when staff reply (30 minutes) or take over
-- (until handed back).

alter table public.chat_conversations add column assistant_paused_until timestamptz;

-- Same functions as in 20261126010000_chat_booking.sql, with the new rule above.
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
  -- A chat waiting for staff still gets answers and free bookings; only a closed chat, or one a
  -- person at the club is answering right now, is off limits.
  if v_c.status = 'closed' or v_c.assistant_paused_until > now() then
    raise exception 'Staff are handling this chat';
  end if;

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
  -- A chat waiting for staff still gets answers and free bookings; only a closed chat, or one a
  -- person at the club is answering right now, is off limits.
  if v_c.status = 'closed' or v_c.assistant_paused_until > now() then
    raise exception 'Staff are handling this chat';
  end if;
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
