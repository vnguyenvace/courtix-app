-- Step 9b: follow-ups the club's owner or a manager has approved, ready to go out.
-- On its own: a new enum value can't be used in the migration that adds it.
alter type public.message_status add value if not exists 'approved' after 'draft';
