-- Payer slips are saved by the server, not uploaded by visitors straight into storage. A direct
-- upload would also need visitors to be able to read the bucket, and club ids are public (they're
-- in logo addresses), so anyone could have listed and opened other people's bank slips.
-- The pay page's server action checks the order (unpaid, fewer than 3 slips) and stores the photo.
drop policy payment_slips_payer_insert on storage.objects;
revoke execute on function public.order_accepts_slip(text) from anon, authenticated, public;
