-- PromptPay QR payments (Julian, 26 Nov 2026: "build A first"). The club enters its PromptPay ID;
-- payers see a QR with the exact amount on a pay page (/book/pay/<order id>), scan it in any Thai
-- banking app, and can send their transfer slip. The money goes straight to the club; staff still
-- check the bank and mark it paid (no payment provider tells Courtix the money arrived).
--
-- The pay page is reached by its order id (random, unguessable), like a payment link. It shows only
-- what's being paid for and the amount: no names, phone numbers or other orders.

alter table public.orgs add column promptpay_id text
  check (promptpay_id is null or promptpay_id ~ '^(0[0-9]{9}|[0-9]{13}|[0-9]{15})$');
alter table public.orgs add column promptpay_name text check (length(promptpay_name) <= 80);

-- The payer sent a slip: staff check their bank and mark it paid.
alter table public.orders add column payer_slip_at timestamptz;

-- What the pay page may show for one order.
create or replace function public.public_order(p_slug text, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id,
    'status', o.status,
    'total', o.total,
    'currency', o.currency,
    'items', (select coalesce(jsonb_agg(i.description order by i.created_at), '[]') from public.order_items i
               where i.order_id = o.id and i.cancelled_at is null),
    -- A court request waiting for the club's approval: don't ask for money yet.
    'awaiting_approval', exists (select 1 from public.order_items i join public.bookings b on b.id = i.booking_id
                                  where i.order_id = o.id and b.pending_approval),
    'slip_sent', o.payer_slip_at is not null,
    'promptpay_id', g.promptpay_id,
    'promptpay_name', g.promptpay_name)
  from public.orders o join public.orgs g on g.id = o.org_id
  where o.id = p_order and g.slug = lower(trim(p_slug));
$$;

-- Payer slip photos go in the private payment-slips bucket under <org_id>/<order_id>/payer-*.
-- Allowed only for an unpaid order of that club, at most 3 photos per order.
create or replace function public.order_accepts_slip(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.orders o
     where o.org_id::text = split_part(p_name, '/', 1)
       and o.id::text = split_part(p_name, '/', 2)
       and split_part(p_name, '/', 3) like 'payer-%.jpg'
       and o.status = 'pending')
    and (select count(*) from storage.objects s
          where s.bucket_id = 'payment-slips' and s.name like split_part(p_name, '/', 1) || '/' || split_part(p_name, '/', 2) || '/payer-%') < 3;
$$;
grant execute on function public.order_accepts_slip(text) to anon, authenticated;

create policy payment_slips_payer_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'payment-slips' and public.order_accepts_slip(name));

-- Record the payer's slip on the order (after the upload above).
create or replace function public.public_attach_slip(p_slug text, p_order uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.orders o
     set slip_path = p_path, payer_slip_at = now()
    from public.orgs g
   where o.id = p_order and g.id = o.org_id and g.slug = lower(trim(p_slug)) and o.status = 'pending'
     and p_path like o.org_id::text || '/' || o.id::text || '/payer-%'
     and exists (select 1 from storage.objects s where s.bucket_id = 'payment-slips' and s.name = p_path);
  if not found then raise exception 'This payment is already done or the slip didn''t upload. Please try again'; end if;
end;
$$;

grant execute on function public.public_order(text, uuid), public.public_attach_slip(text, uuid, text) to anon, authenticated;

-- The member page also lists each unpaid item (same as 20261126070000_member_sign_in.sql, plus "unpaid").
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
    'to_pay', (select coalesce(sum(total), 0) from public.orders where member_id = v_m.id and status = 'pending'),
    -- Each unpaid item, with its order id for the pay page (PromptPay QR).
    'unpaid', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_id', o.id, 'total', o.total, 'slip_sent', o.payer_slip_at is not null,
               'description', (select string_agg(i.description, ' · ') from public.order_items i
                                where i.order_id = o.id and i.cancelled_at is null))
             order by o.created_at)
        from public.orders o where o.member_id = v_m.id and o.status = 'pending'), '[]'));
end;
$$;
