-- Club subdomains: each club lives at <slug>.courtix.app.
--
-- The slug becomes a DNS name, so it must be a valid label (lowercase letters, digits,
-- dashes, not at the ends, 2-40 characters) and not a name the product needs itself.

create or replace function public.reserved_club_slugs()
returns text[] language sql immutable set search_path = '' as $$
  select array[
    'www', 'app', 'api', 'admin', 'administrator', 'root', 'courtix',
    'mail', 'email', 'smtp', 'imap', 'pop', 'webmail', 'mx', 'ns', 'ns1', 'ns2', 'ftp', 'vpn',
    'static', 'assets', 'cdn', 'img', 'images', 'media', 'files', 'uploads',
    'auth', 'login', 'logout', 'signin', 'signup', 'register', 'account', 'accounts', 'oauth', 'sso',
    'billing', 'pay', 'payment', 'payments', 'checkout', 'invoice', 'invoices',
    'dashboard', 'console', 'portal', 'manage', 'settings',
    'help', 'support', 'docs', 'blog', 'news', 'status', 'about', 'pricing', 'contact',
    'terms', 'privacy', 'legal', 'security', 'abuse', 'postmaster', 'hostmaster', 'webmaster',
    'dev', 'test', 'staging', 'beta', 'preview', 'sandbox', 'internal', 'localhost',
    'webhook', 'webhooks', 'whatsapp', 'line', 'bot'
  ];
$$;

-- Existing slugs were made by the onboarding form (lowercase letters, digits, dashes),
-- so these hold for current data. If a hosted database ever fails here, rename that club first.
alter table public.orgs
  add constraint orgs_slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])$'),
  add constraint orgs_slug_not_reserved check (not (slug = any (public.reserved_club_slugs())));

-- Same as before, with front-desk-friendly messages for bad links.
create or replace function public.create_org(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org  uuid;
  v_slug text := lower(trim(p_slug));
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in to create a club';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Enter your club''s name';
  end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])$' then
    raise exception 'Your club link can use letters, numbers and dashes (2 to 40 characters), like rawai-pickleball';
  end if;
  if v_slug = any (public.reserved_club_slugs()) then
    raise exception 'The club link "%" is reserved. Try something like %-pickleball', v_slug, v_slug;
  end if;

  insert into public.orgs (name, slug) values (trim(p_name), v_slug)
  returning id into v_org;

  insert into public.org_staff (org_id, user_id, role) values (v_org, auth.uid(), 'owner');

  -- Sensible starting setup the owner can change later.
  insert into public.courts (org_id, name, sort_order) values
    (v_org, 'Court 1', 1), (v_org, 'Court 2', 2);
  insert into public.rate_rules (org_id, label, start_time, end_time, drop_in_price, member_price, priority) values
    (v_org, 'Off-peak', '07:00', '17:00', 300, 0, 20),
    (v_org, 'Peak',     '17:00', '22:00', 450, 0, 10);
  insert into public.package_types (org_id, name, kind, duration_days, sessions, price) values
    (v_org, 'Monthly unlimited', 'time_based', 30, null, 3500),
    (v_org, '3-month unlimited', 'time_based', 90, null, 9000),
    (v_org, '10-session pack',   'class_pack', null, 10, 2800);

  return v_org;
exception
  when unique_violation then
    raise exception 'The club link "%" is already taken. Try another one', v_slug;
end;
$$;

-- The club behind a subdomain, for its sign-in page and for "not found" pages.
-- Public on purpose (the subdomain itself is public): returns only the club's name.
create or replace function public.club_by_slug(p_slug text)
returns table (id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name from public.orgs o where o.slug = lower(trim(p_slug));
$$;
grant execute on function public.club_by_slug(text) to anon, authenticated;
