-- Lesson requests made in a chat remember the chat, so the club's decision can be sent back
-- there (LINE visitors have no phone number to message). Approving a visitor's request or
-- declining any chat request posts a message in that chat (sent on LINE for LINE chats).
alter table public.bookings add column chat_conversation_id uuid
  references public.chat_conversations(id) on delete set null;

-- Same as 20261127050000, plus chat_conversation_id.
create or replace function public.chat_request_lesson(
  p_conversation uuid, p_coach uuid, p_start timestamptz, p_minutes int, p_group_size int
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_c     public.chat_conversations;
  v_org   public.orgs;
  v_coach public.coaches;
  v_loc   public.locations;
  v_id    uuid;
  v_b     public.bookings;
  v_court text;
begin
  select * into v_c from public.chat_conversations where id = p_conversation;
  if not found then raise exception 'Conversation not found'; end if;
  select * into v_org from public.orgs where id = v_c.org_id;
  if v_org.chat_mode <> 'book' then
    raise exception 'The club arranges lessons itself. Tell them a team member will help';
  end if;
  if v_c.status = 'closed' or v_c.assistant_paused_until > now() then
    raise exception 'Staff are handling this chat';
  end if;
  select * into v_coach from public.coaches where id = p_coach and org_id = v_c.org_id and is_active;
  if not found then raise exception 'Coach not found'; end if;
  if v_c.member_id is null and nullif(btrim(coalesce(v_c.contact_name, '')), '') is null then
    raise exception 'Ask for their name first';
  end if;
  if (select count(*) from public.bookings b
       where b.org_id = v_c.org_id and b.source = 'chat' and b.pending_approval
         and (b.member_id = v_c.member_id or b.guest_phone = v_c.contact_phone)) >= 3 then
    raise exception 'They already have 3 lesson requests waiting. A team member will confirm those first';
  end if;
  -- The chat's location, else the coach's first one, else the club's first.
  select * into v_loc from public.locations l
   where l.org_id = v_c.org_id and l.is_active
     and (v_coach.location_ids is null or l.id = any (v_coach.location_ids))
   order by (l.id is distinct from v_c.location_id), l.sort_order, l.name limit 1;
  if not found then raise exception '% doesn''t teach at an open location', v_coach.name; end if;

  v_id := public.create_lesson(p_coach, p_start, p_minutes, p_group_size, null, v_loc.id, v_c.member_id,
    case when v_c.member_id is null then v_c.contact_name end, 'Lesson request by chat: waiting for approval');
  update public.bookings set source = 'chat', pending_approval = true, guest_phone = v_c.contact_phone,
         chat_conversation_id = v_c.id
   where id = v_id returning * into v_b;
  select name into v_court from public.courts where id = v_b.court_id;
  return jsonb_build_object(
    'status', 'requested', 'booking_id', v_b.id, 'coach', v_coach.name, 'court', v_court, 'location', v_loc.name,
    'day', to_char(p_start at time zone v_loc.timezone, 'Dy DD Mon'),
    'start', to_char(p_start at time zone v_loc.timezone, 'HH24:MI'),
    'end', to_char(upper(v_b.during) at time zone v_loc.timezone, 'HH24:MI'),
    'price', v_b.price, 'currency', v_org.currency,
    'note', 'Held for them. A team member confirms it; pay at the club.');
end;
$$;
