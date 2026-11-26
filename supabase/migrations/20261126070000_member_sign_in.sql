-- Members sign in on the public booking page (Julian, 26 Nov 2026) with a one-time code sent to
-- their LINE, by SMS or by email, then book with their package, see and cancel their bookings.
--
-- Before this, every online sign-up was a guest at the drop-in price: a phone number typed into a
-- web page proves nothing, and trusting it would let anyone spend a member's package.
--
-- How it's kept safe:
--   * The app sends the code (it needs the club's LINE key or an SMS / email provider). Only a
--     hash of the code is stored; codes last 10 minutes and allow 5 tries.
--   * member_verify_code() swaps a correct code for a sign-in token (stored hashed, 90 days),
--     kept in an http-only cookie on the club's subdomain.
--   * Every member action is a security-definer function that takes that token, works out the
--     member from it, and calls the same booking functions as the desk. A member can only see
--     and cancel their own bookings. Visitors never touch tables directly.

create table public.member_login_codes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  member_id   uuid not null,
  code_hash   text not null,
  channel     text not null check (channel in ('line', 'sms', 'email')),
  attempts    int not null default 0,
  expires_at  timestamptz not null default now() + interval '10 minutes',
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, member_id) references public.members(org_id, id) on delete cascade
);
create index member_login_codes_member_idx on public.member_login_codes(member_id, created_at desc);

create table public.member_sessions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  member_id    uuid not null,
  token_hash   text not null unique,
  expires_at   timestamptz not null default now() + interval '90 days',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, member_id) references public.members(org_id, id) on delete cascade
);

-- Nobody reads these directly: only the functions below and the server's code sender.
alter table public.member_login_codes enable row level security;
alter table public.member_sessions enable row level security;
revoke all on public.member_login_codes, public.member_sessions from anon, authenticated;

create or replace function public.sha256_hex(p text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(p, 'sha256'), 'hex');
$$;

-- The member behind a sign-in token at this club, or an error. Keeps the token alive.
create or replace function public.member_from_token(p_slug text, p_token text)
returns public.members language plpgsql security definer set search_path = '' as $$
declare
  v_m public.members;
  v_s public.member_sessions;
begin
  select s.* into v_s
    from public.member_sessions s join public.orgs o on o.id = s.org_id
   where s.token_hash = public.sha256_hex(coalesce(p_token, '')) and o.slug = lower(trim(p_slug))
     and s.expires_at > now();
  if not found then raise exception 'Please sign in again'; end if;
  update public.member_sessions set last_seen_at = now() where id = v_s.id and last_seen_at < now() - interval '1 hour';
  select * into v_m from public.members where id = v_s.member_id;
  return v_m;
end;
$$;

-- A correct code becomes a sign-in token. Same answer for "no such member" and "wrong code".
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
    raise exception 'That code is wrong or has expired. Ask for a new one';
  end if;

  update public.member_login_codes set used_at = now() where id = v_c.id;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.member_sessions (org_id, member_id, token_hash) values (v_c.org_id, v_c.member_id, public.sha256_hex(v_token));
  return v_token;
end;
$$;

create or replace function public.member_sign_out(p_slug text, p_token text)
returns void language sql security definer set search_path = '' as $$
  delete from public.member_sessions s using public.orgs o
   where o.id = s.org_id and o.slug = lower(trim(p_slug)) and s.token_hash = public.sha256_hex(coalesce(p_token, ''));
$$;

-- Everything the member's own page shows: name, package, upcoming places and courts, what's due.
create or replace function public.member_me(p_slug text, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_m public.members;
begin
  v_m := public.member_from_token(p_slug, p_token);
  return jsonb_build_object(
    'name', v_m.full_name,
    'first_name', split_part(v_m.full_name, ' ', 1),
    'package', (select jsonb_strip_nulls(jsonb_build_object(
                  'name', ms.package_name, 'status', ms.membership_status, 'ends_on', ms.ends_on,
                  'sessions_left', ms.sessions_left))
                  from public.member_status ms where ms.member_id = v_m.id and ms.package_name is not null),
    'late_cancel_hours', (select late_cancel_hours from public.orgs where id = v_m.org_id),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'session_id', so.id, 'name', so.name, 'location', so.location_name,
               'starts_at', so.starts_at, 'ends_at', so.ends_at, 'timezone', so.location_timezone,
               'status', r.status, 'price', r.price, 'covered', r.membership_id is not null)
             order by so.starts_at)
        from public.session_registrations r join public.session_overview so on so.id = r.session_id
       where r.member_id = v_m.id and r.status in ('booked', 'waitlisted', 'requested') and so.ends_at > now()), '[]'),
    'courts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'court', b.court_name, 'location', b.location_name,
               'starts_at', b.start_at, 'ends_at', b.end_at, 'timezone', l.timezone, 'price', b.price)
             order by b.start_at)
        from public.booking_calendar b join public.locations l on l.id = b.location_id
       where b.member_id = v_m.id and b.status = 'confirmed' and b.session_id is null and b.end_at > now()), '[]'),
    'to_pay', (select coalesce(sum(total), 0) from public.orders where member_id = v_m.id and status = 'pending'));
end;
$$;

-- Book a session place as this member (package rules, levels, cut-offs: same as the desk).
create or replace function public.member_book_session(p_slug text, p_token text, p_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_m  public.members;
  v_t  public.session_types;
  v_id uuid;
  v_r  public.session_registrations;
begin
  v_m := public.member_from_token(p_slug, p_token);
  if not (select public_booking from public.orgs where id = v_m.org_id) then
    raise exception 'This club takes bookings by WhatsApp or at the desk';
  end if;
  select t.* into v_t from public.sessions s join public.session_types t on t.id = s.session_type_id
   where s.id = p_session and s.org_id = v_m.org_id;
  if not found or not v_t.is_public then raise exception 'Session not found'; end if;

  v_id := public.register_for_session(p_session, v_m.id, null, null, false, false);
  update public.session_registrations set source = 'online' where id = v_id returning * into v_r;
  return jsonb_build_object('registration_id', v_r.id, 'status', v_r.status, 'price', v_r.price,
                            'covered', v_r.membership_id is not null);
end;
$$;

-- Book a court as this member (their package's court price, booking-ahead and active limits apply).
create or replace function public.member_book_court(p_slug text, p_token text, p_court uuid, p_start timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_m  public.members;
  v_id uuid;
  v_b  public.bookings;
begin
  v_m := public.member_from_token(p_slug, p_token);
  if not (select public_booking from public.orgs where id = v_m.org_id) then
    raise exception 'This club takes bookings by WhatsApp or at the desk';
  end if;
  if not exists (select 1 from public.courts where id = p_court and org_id = v_m.org_id and is_active) then
    raise exception 'Court not found';
  end if;
  v_id := public.create_booking(p_court, p_start, v_m.id, null, null, null, 'Booked online by the member');
  update public.bookings set source = 'online' where id = v_id returning * into v_b;
  return jsonb_build_object('booking_id', v_b.id, 'price', v_b.price, 'kind', v_b.kind);
end;
$$;

-- Cancel one of their own places or court bookings. Session credits come back by the club's
-- usual rule (cancel_registration); courts can be cancelled until they start.
create or replace function public.member_cancel(p_slug text, p_token text, p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_m public.members;
  v_b public.bookings;
begin
  v_m := public.member_from_token(p_slug, p_token);
  if p_kind = 'session' then
    if not exists (select 1 from public.session_registrations
                    where id = p_id and member_id = v_m.id and status in ('booked', 'waitlisted', 'requested')) then
      raise exception 'Booking not found';
    end if;
    perform public.cancel_registration(p_id);
  elsif p_kind = 'court' then
    select * into v_b from public.bookings where id = p_id and member_id = v_m.id and status = 'confirmed' and session_id is null;
    if not found then raise exception 'Booking not found'; end if;
    if lower(v_b.during) <= now() then raise exception 'This booking has already started. Please message the club'; end if;
    update public.bookings set status = 'cancelled' where id = p_id;
  else
    raise exception 'Booking not found';
  end if;
end;
$$;

revoke execute on function public.member_from_token(text, text), public.sha256_hex(text) from anon, authenticated, public;
grant execute on function
  public.member_verify_code(text, text, text),
  public.member_sign_out(text, text),
  public.member_me(text, text),
  public.member_book_session(text, text, uuid),
  public.member_book_court(text, text, uuid, timestamptz),
  public.member_cancel(text, text, text, uuid)
to anon, authenticated;
