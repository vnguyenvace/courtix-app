-- Club branding: each club uploads its logo, Courtix picks colours from it, and the owner can
-- change them. Used on the public booking page (<slug>.courtix.app/book).
--
-- The logo lives in Supabase Storage (bucket `club-logos`, public read: it's shown to visitors
-- anyway). Files sit under `<org_id>/...`, and only that club's owners and managers can add,
-- replace or remove them. The app re-encodes every upload as PNG (no SVG: an SVG can carry script).

alter table public.orgs
  -- Path inside the bucket, always in this club's own folder.
  add column logo_path text,
  add constraint orgs_logo_path_own_folder
    check (logo_path is null or (logo_path like id::text || '/%' and logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$')),
  -- Buttons, links and active tabs.
  add column brand_primary text check (brand_primary ~ '^#[0-9a-f]{6}$'),
  -- A second colour: the line under the page header and the session times.
  add column brand_secondary text check (brand_secondary ~ '^#[0-9a-f]{6}$'),
  -- Colours found in the logo, offered as suggestions when the owner adjusts them.
  add column brand_palette text[] not null default '{}'
    check (cardinality(brand_palette) = 0
           or array_to_string(brand_palette, ',') ~ '^#[0-9a-f]{6}(,#[0-9a-f]{6}){0,7}$');

-- ---------------------------------------------------------------------------
-- Storage bucket and its rules
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-logos', 'club-logos', true, 2 * 1024 * 1024, array['image/png'])
on conflict (id) do nothing;

-- The club a logo file belongs to: the first folder of its path, or null if that isn't a uuid.
create or replace function public.logo_org(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end;
$$;

create policy club_logos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'club-logos' and public.has_org_role(public.logo_org(name), '{owner,manager}'));
create policy club_logos_update on storage.objects for update to authenticated
  using (bucket_id = 'club-logos' and public.has_org_role(public.logo_org(name), '{owner,manager}'))
  with check (bucket_id = 'club-logos' and public.has_org_role(public.logo_org(name), '{owner,manager}'));
create policy club_logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'club-logos' and public.has_org_role(public.logo_org(name), '{owner,manager}'));
-- Staff can list their own club's files (the app removes the old logo after a new upload).
-- Visitors fetch logos through the bucket's public URL, which doesn't need a policy.
create policy club_logos_select on storage.objects for select to authenticated
  using (bucket_id = 'club-logos' and public.is_org_staff(public.logo_org(name)));

-- ---------------------------------------------------------------------------
-- The public page gets the logo and colours.
-- ---------------------------------------------------------------------------
create or replace function public.public_club(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'currency', o.currency,
    'public_booking', o.public_booking,
    'online_signups', o.online_signups,
    'logo_path', o.logo_path,
    'brand_primary', o.brand_primary,
    'brand_secondary', o.brand_secondary,
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'name', l.name, 'address', l.address, 'whatsapp', l.whatsapp,
               'timezone', l.timezone, 'opens_at', l.opens_at, 'closes_at', l.closes_at,
               'slot_minutes', l.slot_minutes)
             order by l.sort_order, l.name)
        from public.locations l where l.org_id = o.id and l.is_active), '[]'::jsonb)
  )
  from public.orgs o where o.slug = lower(trim(p_slug));
$$;
