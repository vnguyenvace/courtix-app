-- Online sign-ups that wait for staff approval (orgs.online_signups = 'approve').
-- Its own migration: a new enum value can't be used in the same transaction that adds it.
alter type public.registration_status add value if not exists 'requested';
