-- The drop-in price of one court slot, for the public booking form ("THB 600, paid at the club").
-- Only the price for that court and time: rate rules stay private.
create or replace function public.public_court_price(p_slug text, p_court uuid, p_start timestamptz)
returns numeric language sql stable security definer set search_path = '' as $$
  select public.slot_price(o.id, p_start, false, c.location_id)
    from public.orgs o join public.courts c on c.org_id = o.id
   where o.slug = lower(trim(p_slug)) and o.public_booking and c.id = p_court and c.is_active;
$$;
revoke execute on function public.public_court_price(text, uuid, timestamptz) from public;
grant execute on function public.public_court_price(text, uuid, timestamptz) to anon, authenticated;
