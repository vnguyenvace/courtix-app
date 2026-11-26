-- The order and confirmation triggers run at the end of the transaction. For an online sign-up
-- that is after public_register() returned, as the anonymous visitor, who can't read the tables:
-- the sign-up failed. They only do bookkeeping on the row that changed (trigger functions can't be
-- called directly), so they run with the owner's rights.
alter function public.session_registrations_order() security definer;
alter function public.bookings_order() security definer;
alter function public.memberships_order() security definer;
alter function public.session_registrations_confirm() security definer;
alter function public.bookings_confirm() security definer;
