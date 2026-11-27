-- Join invited clubs without needing the link again (Julian, 27 Nov 2026: invited as admin,
-- created the account, landed on "No access"). With email confirmation on, the confirmation
-- email can bring the person back somewhere other than the invite link, so the join step never
-- ran. A confirmed email proves the person owns the invited address, which is what the link
-- proves, so open invites for that email are accepted when they arrive at the club.
create or replace function public.accept_my_invites()
returns setof uuid language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_i public.staff_invites;
begin
  if auth.uid() is null then return; end if;
  select lower(u.email) into v_email from auth.users u
   where u.id = auth.uid() and u.email_confirmed_at is not null;
  if v_email is null then return; end if;
  for v_i in
    select * from public.staff_invites
     where email = v_email and accepted_at is null and expires_at > now()
     for update
  loop
    insert into public.org_staff (org_id, user_id, role, location_ids)
    values (v_i.org_id, auth.uid(), v_i.role, v_i.location_ids)
    on conflict (org_id, user_id) do nothing;
    update public.staff_invites set accepted_at = now(), accepted_by = auth.uid() where id = v_i.id;
    return next v_i.org_id;
  end loop;
end;
$$;
grant execute on function public.accept_my_invites() to authenticated;
revoke execute on function public.accept_my_invites() from anon, public;
