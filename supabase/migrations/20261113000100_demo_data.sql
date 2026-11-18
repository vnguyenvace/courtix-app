-- Fills a club with realistic sample members, check-ins and bookings,
-- so you can demo the dashboard to an owner before importing real data.
create or replace function public.add_demo_data(p_org uuid)
returns int language plpgsql security invoker set search_path = '' as $$
declare
  v_today   date := public.org_today(p_org);
  v_monthly uuid;
  v_quarter uuid;
  v_pack    uuid;
  v_court   uuid;
  v_id      uuid;
  r         record;
  n         int := 0;
begin
  if not public.has_org_role(p_org, '{owner,manager}') then
    raise exception 'Only owners and managers can add demo data';
  end if;

  select id into v_monthly from public.package_types where org_id = p_org and kind = 'time_based' order by duration_days limit 1;
  select id into v_quarter from public.package_types where org_id = p_org and kind = 'time_based' order by duration_days desc limit 1;
  select id into v_pack    from public.package_types where org_id = p_org and kind = 'class_pack' limit 1;
  select id into v_court   from public.courts where org_id = p_org and is_active order by sort_order limit 1;

  -- name, language, package (m/q/p/none), started N days ago, last visit N days ago (null = never), usual time
  for r in select * from (values
    ('Dmitri Volkov',     'ru', 'm', 18,  12, '7am open play'),
    ('Somchai Rattana',   'th', 'q', 84,   2, 'Evenings'),
    ('Anna Becker',       'en', 'p',  5,   1, 'Mornings'),
    ('Mark Thompson',     'en', 'm', 26,   3, 'Weekend mornings'),
    ('Elena Sokolova',    'ru', 'q', 40,  16, '6pm doubles'),
    ('Nong Siriporn',     'th', 'm', 10,   0, 'Lunchtime'),
    ('James O''Connor',   'en', 'm', 29,   9, 'Evenings'),
    ('Li Wei',            'zh', 'p', 20,  11, 'Mornings'),
    ('Pim Chaiyaporn',    'th', 'q', 88,   4, 'Evenings'),
    ('Sergei Ivanov',     'ru', 'm', 12,  null, null),
    ('Sophie Laurent',    'en', 'n',  6,   6, null),
    ('Tom Becker',        'en', 'n',  3,   3, null)
  ) as t(name, lang, pkg, started_ago, visit_ago, usual)
  loop
    insert into public.members (org_id, full_name, language, usual_play_time, marketing_consent, consent_at, created_at)
    values (p_org, r.name, r.lang, r.usual, true, now(), now() - make_interval(days => r.started_ago))
    returning id into v_id;

    if r.pkg = 'm' then perform public.sell_membership(v_id, v_monthly, v_today - r.started_ago);
    elsif r.pkg = 'q' then perform public.sell_membership(v_id, v_quarter, v_today - r.started_ago);
    elsif r.pkg = 'p' then perform public.sell_membership(v_id, v_pack, v_today - r.started_ago);
    end if;

    if r.visit_ago is not null then
      insert into public.check_ins (org_id, member_id, checked_in_at, source)
      values (p_org, v_id, now() - make_interval(days => r.visit_ago), 'import');
    end if;

    -- A couple of members already have something booked tomorrow
    if r.name in ('Somchai Rattana', 'Nong Siriporn') and v_court is not null then
      begin
        perform public.create_booking(
          v_court,
          ((v_today + 1)::timestamp + case when r.name = 'Somchai Rattana' then time '18:00' else time '12:00' end)
            at time zone (select timezone from public.orgs where id = p_org),
          v_id);
      exception when others then null; -- slot taken or outside hours: skip
      end;
    end if;

    n := n + 1;
  end loop;

  return n;
end;
$$;

grant execute on function public.add_demo_data(uuid) to authenticated;
revoke execute on function public.add_demo_data(uuid) from anon, public;
