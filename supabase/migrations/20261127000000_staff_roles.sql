-- Club roles (Julian, 27 Nov 2026): owner, admin (stored as 'manager'), front desk, marketing,
-- back office. 'staff' becomes 'front_desk' (same people, clearer name). Existing rows, defaults
-- and policies keep working: a renamed enum value is the same value.
-- New values can't be used in the transaction that adds them, so the permissions that use them
-- are in the next migration.
alter type public.staff_role rename value 'staff' to 'front_desk';
alter type public.staff_role add value if not exists 'marketing';
alter type public.staff_role add value if not exists 'back_office';
