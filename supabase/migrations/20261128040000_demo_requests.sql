-- Demo requests from the Courtix landing page (courtix.app, Julian 28 Nov 2026).
-- Visitors (not signed in) ask for a demo; the Courtix team sees them in Admin → Demo requests
-- and gets an email (SALES_EMAIL). Platform-level: no club owns these rows.

create table public.demo_requests (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 100),
  club_name   text not null check (length(club_name) between 1 and 120),
  contact     text not null check (length(contact) between 3 and 120),   -- phone, LINE ID or email
  email       text check (email is null or length(email) <= 200),
  sports      text[] not null default '{}' check (sports <@ '{pickleball,padel,tennis,other}'::text[]),
  courts      int check (courts is null or courts between 1 and 200),
  message     text check (message is null or length(message) <= 2000),
  language    text not null default 'en' check (language in ('en', 'th')),
  status      text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  note        text check (note is null or length(note) <= 2000),          -- the team's own note
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index demo_requests_created_idx on public.demo_requests(created_at desc);

alter table public.demo_requests enable row level security;
-- The Courtix team (super admins and support) see and update them. Visitors insert only
-- through request_demo(), never directly.
create policy demo_requests_select on public.demo_requests for select to authenticated
  using (public.platform_role() in ('super_admin', 'support'));
create policy demo_requests_update on public.demo_requests for update to authenticated
  using (public.platform_role() in ('super_admin', 'support'))
  with check (public.platform_role() in ('super_admin', 'support'));
grant select, update (status, note, updated_at) on public.demo_requests to authenticated;
revoke all on public.demo_requests from anon;

-- A visitor asks for a demo. Security definer: visitors can't write the table themselves.
-- Simple flood guard: at most 3 a day from the same contact, 30 an hour in total.
create or replace function public.request_demo(
  p_name text, p_club text, p_contact text, p_email text, p_sports text[], p_courts int,
  p_message text, p_language text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_contact text := left(trim(coalesce(p_contact, '')), 120);
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Please enter your name'; end if;
  if coalesce(trim(p_club), '') = '' then raise exception 'Please enter your club''s name'; end if;
  if length(v_contact) < 3 then raise exception 'Please enter a phone number, LINE ID or email so we can reach you'; end if;
  if (select count(*) from public.demo_requests where contact = v_contact and created_at > now() - interval '1 day') >= 3
     or (select count(*) from public.demo_requests where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'We already have your request. We''ll be in touch soon';
  end if;
  insert into public.demo_requests (name, club_name, contact, email, sports, courts, message, language)
  values (left(trim(p_name), 100), left(trim(p_club), 120), v_contact,
          nullif(left(trim(coalesce(p_email, '')), 200), ''),
          coalesce((select array_agg(distinct s) from unnest(p_sports) s where s in ('pickleball', 'padel', 'tennis', 'other')), '{}'),
          case when p_courts between 1 and 200 then p_courts end,
          nullif(left(trim(coalesce(p_message, '')), 2000), ''),
          case when p_language = 'th' then 'th' else 'en' end)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.request_demo(text, text, text, text, text[], int, text, text) to anon, authenticated;
revoke execute on function public.request_demo(text, text, text, text, text[], int, text, text) from public;
