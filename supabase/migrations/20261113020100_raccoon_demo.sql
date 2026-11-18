-- Demo template based on Raccoon Pickleball's published flyers (The Peak Racquet Park, Phuket).
-- Prices and weekly times come from their rates sheet. Camp start times, session capacities
-- and the IPTPA course price weren't on the flyers, so those are placeholders to confirm.
create or replace function public.load_raccoon_demo(p_org uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_tz      text;
  v_c       uuid[] := '{}';
  v_tennis  uuid;
  v_id      uuid;
  v_open    uuid;
  v_adult   uuid;
  v_kids    uuid;
  v_match   uuid;
  v_camp    uuid;
  v_course  uuid;
  v_year    int;
  v_created int;
  i         int;
  r         record;
begin
  if not public.has_org_role(p_org, '{owner,manager}') then
    raise exception 'Only owners and managers can load the demo timetable';
  end if;
  if exists (select 1 from public.session_types where org_id = p_org) then
    raise exception 'This club already has session types. The demo timetable is for a fresh club.';
  end if;

  update public.orgs set opens_at = '08:00', closes_at = '22:00', timezone = 'Asia/Bangkok', currency = 'THB'
   where id = p_org
  returning timezone into v_tz;

  -- Courts: four covered pickleball courts plus a tennis court for match play.
  for i in 1..4 loop
    select id into v_id from public.courts where org_id = p_org and name = 'Court ' || i;
    if v_id is null then
      insert into public.courts (org_id, name, is_covered, sort_order)
      values (p_org, 'Court ' || i, true, i) returning id into v_id;
    else
      update public.courts set is_covered = true, is_active = true where id = v_id;
    end if;
    v_c := v_c || v_id;
    v_id := null;
  end loop;
  insert into public.courts (org_id, name, is_covered, sort_order)
  values (p_org, 'Tennis court', false, 10)
  on conflict (org_id, name) do update set is_active = true
  returning id into v_tennis;

  -- Court rental: 600 per hour for everyone.
  delete from public.rate_rules where org_id = p_org;
  insert into public.rate_rules (org_id, label, start_time, end_time, drop_in_price, member_price, priority)
  values (p_org, 'Court rental', '08:00', '22:00', 600, 600, 10);

  -- Packages from the flyers. The starter packages are hidden, not deleted.
  update public.package_types set is_active = false where org_id = p_org;
  insert into public.package_types (org_id, name, kind, duration_days, sessions, price) values
    (p_org, 'Unlimited evenings (30 days)',          'time_based', 30, null, 3500),
    (p_org, 'Unlimited any session (30 days)',       'time_based', 30, null, 4000),
    (p_org, 'Match play mornings: buy 10 get 1 free', 'class_pack', null, 11, 4500),
    (p_org, 'Match play nights: buy 10 get 1 free',   'class_pack', null, 11, 3800);

  -- Session types
  insert into public.session_types (org_id, name, category, description, price, duration_minutes,
                                    min_players, max_players, min_age, book_by_minutes, min_check_hours)
  values (p_org, 'Open play', 'open_play',
          'Social doubles on covered courts. Come alone or with friends. All levels welcome. Balls provided; bring your own paddle or hire one on site.',
          350, 180, 4, 16, null, 60, 3)
  returning id into v_open;

  insert into public.session_types (org_id, name, category, description, price, duration_minutes,
                                    min_players, max_players, book_by_minutes, min_check_hours)
  values (p_org, 'Adult clinic', 'clinic',
          'A coached hour for beginners and improvers: drills on basic technique and tactics, plus game rules, followed by guided play.',
          500, 60, 2, 8, 60, 3)
  returning id into v_adult;

  insert into public.session_types (org_id, name, category, description, price, duration_minutes,
                                    min_players, max_players, min_age, book_by_minutes, min_check_hours)
  values (p_org, 'Kids clinic', 'clinic',
          'A coached hour for juniors: basic technique, fun games and small groups. Age 8+.',
          600, 60, 2, 6, 8, 60, 3)
  returning id into v_kids;

  insert into public.session_types (org_id, name, category, description, price, duration_minutes,
                                    min_players, max_players, level_min, book_by_minutes, min_check_hours)
  values (p_org, 'Social match play (tennis)', 'match_play',
          'Intermediate to advanced match play. Mornings 450, nights 380 per session.',
          450, 120, 4, 8, 3.5, 120, 6)
  returning id into v_match;

  insert into public.session_types (org_id, name, category, description, price, duration_minutes,
                                    min_players, max_players, book_by_minutes, min_check_hours)
  values (p_org, 'Camp', 'camp', 'Two-hour coaching camp with a visiting coach.', 3300, 120, 4, 12, 0, 24)
  returning id into v_camp;

  insert into public.session_types (org_id, name, category, description, price, duration_minutes,
                                    min_players, max_players, book_by_minutes, min_check_hours)
  values (p_org, 'Coaching course', 'course', 'Certification course.', 0, 480, 6, 30, 0, 48)
  returning id into v_course;

  -- Weekly timetable. Court plan: open play on courts 1–2, clinics on court 3.
  insert into public.session_schedules (org_id, session_type_id, days_of_week, start_time, court_ids) values
    (p_org, v_open,  '{0,1,2,3,4,5,6}', '08:30', array[v_c[1], v_c[2]]),
    (p_org, v_open,  '{0,1,2,3,4,5,6}', '18:00', array[v_c[1], v_c[2]]),
    (p_org, v_adult, '{1,2,3,4,5}',     '09:00', array[v_c[3]]),
    (p_org, v_adult, '{1,2,3,4,5,6}',   '17:00', array[v_c[3]]),
    (p_org, v_kids,  '{1,2,3,4,5,6}',   '16:00', array[v_c[3]]),
    (p_org, v_kids,  '{6}',             '09:00', array[v_c[3]]),
    (p_org, v_match, '{2,4}',           '09:00', array[v_tennis]);

  -- Thursday-night match play is cheaper, so it gets its own schedule entry and price.
  insert into public.session_types (org_id, name, category, description, price, duration_minutes,
                                    min_players, max_players, level_min, book_by_minutes, min_check_hours)
  values (p_org, 'Social match play night (tennis)', 'match_play',
          'Intermediate to advanced match play under lights.', 380, 120, 4, 8, 3.5, 120, 6)
  returning id into v_id;
  insert into public.session_schedules (org_id, session_type_id, days_of_week, start_time, court_ids)
  values (p_org, v_id, '{4}', '19:00', array[v_tennis]);

  v_created := public.generate_sessions(p_org, 14);

  -- One-off events from the flyers (only those still in the future).
  v_year := extract(year from public.org_today(p_org))::int;
  for r in select * from (values
      (make_date(v_year, 11, 21), time '12:00', time '14:00', 'Coach Kimo camp: kids',           null::numeric, null::numeric),
      (make_date(v_year, 11, 21), time '14:00', time '16:00', 'Coach Kimo camp: 3.0–3.5',         3.0, 3.5),
      (make_date(v_year, 11, 21), time '18:00', time '20:00', 'Coach Kimo camp: 3.5–4.0',         3.5, 4.0),
      (make_date(v_year, 11, 23), time '13:00', time '15:00', 'Coach Kimo Championship Edge camp: 4.0–4.5', 4.0, 4.5)
    ) as t(d, s, e, title, lmin, lmax)
  loop
    if (r.d + r.s) at time zone v_tz > now() then
      perform public.create_event(
        v_camp, (r.d + r.s) at time zone v_tz, (r.d + r.e) at time zone v_tz, r.title,
        2500, 4, 12, r.lmin, r.lmax, array[v_c[4]],
        'Coach Kimo, IPTPA Master Teaching Professional. Early bird 2,500 until 15 Nov, then 3,300. Start time is a placeholder.',
        'Coach Kimo');
    end if;
  end loop;

  if (make_date(v_year, 11, 28) + time '09:00') at time zone v_tz > now() then
    perform public.create_event(
      v_course,
      (make_date(v_year, 11, 28) + time '09:00') at time zone v_tz,
      (make_date(v_year, 11, 29) + time '17:00') at time zone v_tz,
      'IPTPA certified coach workshop', 0, 6, 30, null, null, '{}',
      'Become an IPTPA certified pickleball coach. Register online at iptpa.com and finish the online course first, then attend this 2-day on-court workshop. Limited to 30 spots. Price to confirm.',
      null);
  end if;

  return format('Loaded the timetable: %s sessions over the next 14 days, plus upcoming camps and events.', v_created);
end;
$$;

grant execute on function public.load_raccoon_demo(uuid) to authenticated;
revoke execute on function public.load_raccoon_demo(uuid) from public, anon;
