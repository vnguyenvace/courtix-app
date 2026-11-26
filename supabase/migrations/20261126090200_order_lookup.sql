-- The pay link for a booking someone just made online. The order is created when the booking is
-- saved (end of the transaction), so the page looks it up afterwards from the registration or
-- booking id it got back. Only the person who booked has that id.
create or replace function public.public_order_for(p_slug text, p_registration uuid default null, p_booking uuid default null)
returns uuid language sql stable security definer set search_path = '' as $$
  select o.id
    from public.order_items i
    join public.orders o on o.id = i.order_id
    join public.orgs g on g.id = o.org_id
   where g.slug = lower(trim(p_slug)) and o.status = 'pending'
     and ((p_registration is not null and i.registration_id = p_registration)
          or (p_booking is not null and i.booking_id = p_booking))
   limit 1;
$$;
revoke execute on function public.public_order_for(text, uuid, uuid) from public;
grant execute on function public.public_order_for(text, uuid, uuid) to anon, authenticated;
