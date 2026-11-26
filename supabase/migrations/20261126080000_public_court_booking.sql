-- Visitors book courts online as guests (Julian, 26 Nov 2026). Before: tapping a free court time
-- opened WhatsApp. Now the court is booked at the drop-in price (paid at the club: it becomes an
-- order under Payments), with the same spam limits and consent as session sign-ups.
-- Clubs in "Request, staff approve" mode: the booking holds the court (others see it taken) but
-- waits for staff to Approve or Decline on the dashboard. Declining frees the court and cancels
-- the amount due.

alter table public.bookings add column guest_phone text;
alter table public.bookings add column guest_marketing_consent boolean not null default false;
-- Online request waiting for staff (the court is held meanwhile).
alter table public.bookings add column pending_approval boolean not null default false;
create index bookings_online_idx on public.bookings(org_id, created_at desc) where source = 'online';

create or replace function public.public_book_court(
  p_slug       text,
  p_court      uuid,
  p_start      timestamptz,
  p_name       text,
  p_phone      text,
  p_contact_ok boolean,
  p_marketing  boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org    public.orgs;
  v_court  public.courts;
  v_loc    public.locations;
  v_name   text := nullif(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_phone  text;
  v_id     uuid;
  v_b      public.bookings;
  v_local  date;
begin
  select * into v_org from public.orgs where slug = lower(trim(p_slug));
  if not found then raise exception 'Club not found'; end if;
  if not v_org.public_booking then raise exception 'This club takes bookings by WhatsApp or at the desk'; end if;
  select * into v_court from public.courts where id = p_court and org_id = v_org.id and is_active;
  if not found then raise exception 'Court not found'; end if;
  select * into v_loc from public.locations where id = v_court.location_id and is_active;
  if not found then raise exception 'Court not found'; end if;

  -- Same window as the court times page: today to two weeks ahead.
  v_local := (p_start at time zone v_loc.timezone)::date;
  if v_local > (now() at time zone v_loc.timezone)::date + 14 then
    raise exception 'Courts can be booked up to two weeks ahead online. Please message the club';
  end if;

  if v_name is null or length(v_name) > 80 then raise exception 'Please enter your name'; end if;
  if length(v_digits) < 8 or length(v_digits) > 15 then
    raise exception 'Please enter a WhatsApp number, with country code if you are not on a Thai number';
  end if;
  if not coalesce(p_contact_ok, false) then
    raise exception 'Please tick the box so the club can contact you about this booking';
  end if;
  v_phone := case when v_digits ~ '^0[0-9]{8,9}$' then '+66' || substr(v_digits, 2) else '+' || v_digits end;

  -- Spam limits (as for session sign-ups).
  if (select count(*) from public.bookings b
       where b.org_id = v_org.id and b.source = 'online' and b.guest_phone = v_phone
         and b.created_at > now() - interval '1 day') >= 3 then
    raise exception 'That''s the most online court bookings for one number today. Please message the club';
  end if;
  if (select count(*) from public.bookings b
       where b.org_id = v_org.id and b.source = 'online' and b.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Online bookings are busy right now. Please try again in a few minutes or message the club';
  end if;

  -- Same rules as the desk (opening hours, no double booking, drop-in price).
  v_id := public.create_booking(p_court, p_start, null, v_name, 'drop_in', null,
            case when v_org.online_signups = 'approve' then 'Online request: waiting for approval' else 'Booked online' end);
  update public.bookings
     set source = 'online', guest_phone = v_phone, guest_marketing_consent = coalesce(p_marketing, false),
         pending_approval = (v_org.online_signups = 'approve')
   where id = v_id
  returning * into v_b;

  return jsonb_build_object('booking_id', v_b.id, 'price', v_b.price, 'pending_approval', v_b.pending_approval);
end;
$$;

-- Staff decide on an online court request.
create or replace function public.decide_online_court(p_booking uuid, p_approve boolean)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_approve then
    update public.bookings set pending_approval = false, notes = 'Booked online'
     where id = p_booking and pending_approval and status = 'confirmed';
  else
    update public.bookings set pending_approval = false, status = 'cancelled', notes = 'Online request declined'
     where id = p_booking and pending_approval and status = 'confirmed';
  end if;
  if not found then raise exception 'This request was already decided or cancelled'; end if;
end;
$$;

-- Orders for guest courts carry the guest's phone (same as before, plus guest_phone).
create or replace function public.bookings_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  b record;
begin
  select bc.*, l.timezone, bk.guest_phone into b
    from public.booking_calendar bc
    join public.locations l on l.id = bc.location_id
    join public.bookings bk on bk.id = bc.id
   where bc.id = new.id;
  if not found or b.kind not in ('member', 'drop_in') then return null; end if;
  perform public.sync_order_item(b.org_id, 'court', b.id, b.location_id, b.member_id, b.guest_name, b.guest_phone,
    b.court_name || ', ' || to_char(b.start_at at time zone b.timezone, 'Dy DD Mon HH24:MI'),
    b.price, b.status = 'confirmed');
  return null;
end;
$$;

revoke execute on function public.public_book_court(text, uuid, timestamptz, text, text, boolean, boolean) from public;
grant execute on function public.public_book_court(text, uuid, timestamptz, text, text, boolean, boolean) to anon, authenticated;
grant execute on function public.decide_online_court(uuid, boolean) to authenticated;
revoke execute on function public.decide_online_court(uuid, boolean) from anon, public;
