-- LINE invite (Julian, 28 Nov 2026). LINE never shares a phone number, so until now a member
-- was linked only when staff picked them in a LINE chat. Now staff can show a member a QR code
-- (or send a link) from the member's page. It opens the club's LINE account with "LINK <code>"
-- typed in. When the member sends it, the webhook links their LINE to that member, and booking
-- confirmations and reminders reach them on LINE from then on.

alter table public.members add column line_link_code text;
create unique index members_line_link_code_idx on public.members(org_id, line_link_code)
  where line_link_code is not null;

-- The member's invite code (made the first time). Anyone who can see members can invite them:
-- the front desk is usually who does it. Security definer because changing members needs
-- members.edit; the check below stands in for it.
create or replace function public.member_line_invite(p_member uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_m public.members;
  v_code text;
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no 0/O, 1/I/L
begin
  select * into v_m from public.members where id = p_member;
  if not found or not public.has_org_permission(v_m.org_id, 'members.view') then
    raise exception 'Member not found';
  end if;
  if v_m.line_link_code is not null then return v_m.line_link_code; end if;
  loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
      into v_code from generate_series(1, 6);
    exit when not exists (select 1 from public.members where org_id = v_m.org_id and line_link_code = v_code);
  end loop;
  update public.members set line_link_code = v_code where id = p_member;
  return v_code;
end;
$$;

-- Called by the LINE webhook for each text message. If it carries a member's invite code
-- ("LINK ABC234"), links this LINE account to that member and returns {name, language};
-- otherwise null, and the message is handled as a normal chat. The code works once.
-- If the code's member was linked to another LINE account (a new phone), the new one replaces it.
create or replace function public.line_link_by_code(p_conversation uuid, p_text text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_c public.chat_conversations;
  v_code text;
  v_m public.members;
begin
  if current_user <> 'service_role' then raise exception 'Not allowed'; end if;
  v_code := substring(upper(coalesce(p_text, '')) from 'LINK[^A-Z0-9]{0,3}([A-Z0-9]{6})');
  if v_code is null then return null; end if;
  select * into v_c from public.chat_conversations where id = p_conversation and channel = 'line';
  if not found or v_c.line_user_id is null then return null; end if;
  select * into v_m from public.members where org_id = v_c.org_id and line_link_code = v_code;
  if not found then return null; end if;
  -- This LINE account belongs to another member already: leave both as they are.
  if exists (select 1 from public.members where org_id = v_c.org_id and line_user_id = v_c.line_user_id and id <> v_m.id) then
    return jsonb_build_object('error', 'other_member', 'language', v_m.language);
  end if;
  update public.members set line_user_id = v_c.line_user_id, line_link_code = null where id = v_m.id;
  update public.chat_conversations set member_id = v_m.id where id = p_conversation;
  return jsonb_build_object('name', v_m.full_name, 'language', v_m.language);
end;
$$;

grant execute on function public.member_line_invite(uuid) to authenticated;
revoke execute on function public.member_line_invite(uuid) from anon, public;
grant execute on function public.line_link_by_code(uuid, text) to service_role;
revoke execute on function public.line_link_by_code(uuid, text) from anon, authenticated, public;
