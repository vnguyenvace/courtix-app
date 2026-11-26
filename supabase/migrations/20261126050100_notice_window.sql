-- Package-ending notices: catch packages ending in the next 1-3 days instead of exactly 3, so a
-- missed evening run doesn't skip anyone. Still sent once per package and end date (dedupe key).

create or replace function public.queue_evening_notices(p_org uuid)
returns int language plpgsql security invoker set search_path = '' as $$
declare
  v_before int;
  v_after  int;
  r        record;
begin
  select count(*) into v_before from public.member_notices where org_id = p_org;

  -- Session places tomorrow (in each location's own time zone).
  for r in
    select g.id, g.member_id, g.session_id
      from public.session_registrations g
      join public.session_overview so on so.id = g.session_id
     where g.org_id = p_org and g.member_id is not null and g.status = 'booked' and so.status <> 'cancelled'
       and (so.starts_at at time zone so.location_timezone)::date = (now() at time zone so.location_timezone)::date + 1
  loop
    perform public.queue_member_notice(p_org, r.member_id, 'booking_reminder', 'reminder:reg:' || r.id,
      public.session_notice_payload(r.session_id) || '{"type":"session"}');
  end loop;

  -- Court bookings tomorrow (not session holds).
  for r in
    select b.id, b.member_id, b.court_name, b.location_name, b.start_at, b.end_at, l.timezone
      from public.booking_calendar b join public.locations l on l.id = b.location_id
     where b.org_id = p_org and b.member_id is not null and b.status = 'confirmed' and b.session_id is null
       and (b.start_at at time zone l.timezone)::date = (now() at time zone l.timezone)::date + 1
  loop
    perform public.queue_member_notice(p_org, r.member_id, 'booking_reminder', 'reminder:court:' || r.id,
      jsonb_build_object('type', 'court', 'court', r.court_name, 'location', r.location_name,
        'date', to_char(r.start_at at time zone r.timezone, 'YYYY-MM-DD'),
        'start', to_char(r.start_at at time zone r.timezone, 'HH24:MI'),
        'end', to_char(r.end_at at time zone r.timezone, 'HH24:MI')));
  end loop;

  -- Time-based packages ending in the next 1-3 days (once per package and end date), and session packs down to their last credit.
  for r in
    select m.id, m.member_id, p.name, m.ends_on, m.sessions_left, p.kind
      from public.memberships m
      join public.package_types p on p.id = m.package_type_id
      join public.orgs o on o.id = m.org_id
     where m.org_id = p_org and m.status = 'active'
       and ((p.kind = 'time_based' and m.ends_on between (now() at time zone o.timezone)::date + 1
                                                       and (now() at time zone o.timezone)::date + 3)
            or (p.kind = 'class_pack' and m.sessions_left = 1))
  loop
    perform public.queue_member_notice(p_org, r.member_id, 'package_ending',
      case when r.kind = 'class_pack' then 'pkg_last:' || r.id else 'pkg_end:' || r.id || ':' || r.ends_on end,
      jsonb_build_object('package', r.name, 'ends_on', r.ends_on, 'sessions_left', r.sessions_left,
                         'type', case when r.kind = 'class_pack' then 'last_credit' else 'ending' end));
  end loop;

  select count(*) into v_after from public.member_notices where org_id = p_org;
  return v_after - v_before;
end;
$$;
