-- member_verify_code: a wrong code returns null instead of raising an error. Raising undid the
-- function's work, including the attempt count, so the 5-tries limit never applied. The app shows
-- "wrong or expired" for null. Same signature and grants.

create or replace function public.member_verify_code(p_slug text, p_contact text, p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_org   uuid;
  v_key   text := public.phone_key(p_contact);
  v_email text := lower(trim(p_contact));
  v_c     public.member_login_codes;
  v_token text;
begin
  select id into v_org from public.orgs where slug = lower(trim(p_slug));
  select c.* into v_c
    from public.member_login_codes c join public.members m on m.id = c.member_id
   where c.org_id = v_org and c.used_at is null and c.expires_at > now() and c.attempts < 5
     and ((v_key is not null and (public.phone_key(m.phone) = v_key or public.phone_key(m.whatsapp) = v_key))
          or (position('@' in v_email) > 0 and lower(m.email) = v_email))
   order by c.created_at desc limit 1
   for update of c;
  if not found then raise exception 'That code is wrong or has expired. Ask for a new one'; end if;

  update public.member_login_codes set attempts = attempts + 1 where id = v_c.id;
  if v_c.code_hash <> public.sha256_hex(v_c.id::text || ':' || regexp_replace(coalesce(p_code, ''), '\D', '', 'g')) then
    -- Return instead of raising: an error would undo the attempt count above.
    return null;
  end if;

  update public.member_login_codes set used_at = now() where id = v_c.id;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.member_sessions (org_id, member_id, token_hash) values (v_c.org_id, v_c.member_id, public.sha256_hex(v_token));
  return v_token;
end;
$$;
