-- Demo data for LOCAL development. Runs automatically after `supabase db reset`
-- (not after `supabase migration up`, and `npm run test:db` skips it).
--
-- Sign in at http://raccoon.courtix.localhost:3000 (Chrome) with:  demo@clubos.test / password123
-- A second club, Chalong Padel (http://chalong.courtix.localhost:3000), belongs to
-- other@clubos.test / password123, to check that clubs can't see each other.
-- demo@clubos.test is also a Courtix super admin: http://courtix.localhost:3000/admin
--
-- What you get: Raccoon Pickleball with its real timetable and prices (load_raccoon_demo),
-- 12 sample members with packages and visit history (add_demo_data), WhatsApp numbers,
-- sign-ups on the next few sessions (one comfortably on, one full with a waitlist,
-- one short of players), and a few court bookings. Dates are relative to today, so a
-- reset always gives a fresh-looking club.

-- 1. Demo owner account (email login, already confirmed).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'demo@clubos.test',
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', ''
);

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  '{"sub":"d0000000-0000-4000-8000-000000000001","email":"demo@clubos.test","email_verified":true}',
  'email', now(), now(), now()
);

-- 2. Everything else runs as the demo owner, through the same functions the app uses,
--    so every business rule and RLS policy applies.
set role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', false);

do $$
declare
  v_org   uuid;
  v_tz    text;
  v_today date;
  v_open  uuid;
  v_open2 uuid;
  v_kids  uuid;
  v_adult uuid;
  v_camp  uuid;
  v_c4    uuid;
  v_tennis uuid;
  v_name  text;
begin
  v_org := public.create_org('Raccoon Pickleball', 'raccoon');
  perform public.add_demo_data(v_org);   -- members first, on the starter packages (as a club would have them)
  perform public.load_raccoon_demo(v_org);
  select timezone into v_tz from public.orgs where id = v_org;
  v_today := public.org_today(v_org);

  -- WhatsApp numbers, so "Send on WhatsApp" shows on AI follow-ups. Made-up numbers.
  update public.members m
     set whatsapp = n.wa, phone = n.wa
    from (values
      ('Dmitri Volkov',   '+7 912 345 6701'),
      ('Somchai Rattana', '+66 81 234 5602'),
      ('Anna Becker',     '+49 151 2345 6703'),
      ('Mark Thompson',   '+44 7700 900404'),
      ('Elena Sokolova',  '+7 916 555 0105'),
      ('Nong Siriporn',   '+66 89 765 4306'),
      ('James O''Connor', '+61 412 345 607'),
      ('Li Wei',          '+86 138 0013 8008'),
      ('Pim Chaiyaporn',  '+66 62 345 6709'),
      ('Sergei Ivanov',   '+7 925 111 2210'),
      ('Sophie Laurent',  '+33 6 12 34 56 11'),
      ('Tom Becker',      '+49 160 9876 5412')
    ) as n(name, wa)
   where m.org_id = v_org and m.full_name = n.name;

  -- Upcoming sessions to fill (at least 4 hours away, so sign-up cut-offs and the
  -- go / no-go check don't interfere whatever time you reset).
  select s.id into v_open from public.sessions s join public.session_types t on t.id = s.session_type_id
   where s.org_id = v_org and t.name = 'Open play' and s.status = 'scheduled' and s.starts_at > now() + interval '4 hours'
   order by s.starts_at limit 1;
  select s.id into v_open2 from public.sessions s join public.session_types t on t.id = s.session_type_id
   where s.org_id = v_org and t.name = 'Open play' and s.status = 'scheduled' and s.starts_at > now() + interval '4 hours'
   order by s.starts_at offset 1 limit 1;
  select s.id into v_kids from public.sessions s join public.session_types t on t.id = s.session_type_id
   where s.org_id = v_org and t.name = 'Kids clinic' and s.status = 'scheduled' and s.starts_at > now() + interval '4 hours'
   order by s.starts_at limit 1;
  select s.id into v_adult from public.sessions s join public.session_types t on t.id = s.session_type_id
   where s.org_id = v_org and t.name = 'Adult clinic' and s.status = 'scheduled' and s.starts_at > now() + interval '4 hours'
   order by s.starts_at limit 1;
  select s.id into v_camp from public.sessions s
   where s.org_id = v_org and s.schedule_id is null and s.status = 'scheduled' and s.starts_at > now() + interval '4 hours'
   order by s.starts_at limit 1;

  -- Open play: comfortably on (6 of 16, minimum 4). Members who are renewing soon, plus guests.
  if v_open is not null then
    foreach v_name in array array['Pim Chaiyaporn', 'James O''Connor', 'Mark Thompson', 'Nong Siriporn'] loop
      begin
        perform public.register_for_session(p_session => v_open,
          p_member => (select id from public.members where org_id = v_org and full_name = v_name));
      exception when others then raise notice 'seed: skipped % for open play: %', v_name, sqlerrm;
      end;
    end loop;
    perform public.register_for_session(p_session => v_open, p_guest_name => 'Kenji Tanaka', p_guest_phone => '+81 90 1234 5678');
    perform public.register_for_session(p_session => v_open, p_guest_name => 'Alex Morgan');
  end if;

  -- Second open play: two drop-in leads came back.
  if v_open2 is not null then
    foreach v_name in array array['Sophie Laurent', 'Tom Becker'] loop
      begin
        perform public.register_for_session(p_session => v_open2,
          p_member => (select id from public.members where org_id = v_org and full_name = v_name));
      exception when others then raise notice 'seed: skipped % for open play: %', v_name, sqlerrm;
      end;
    end loop;
  end if;

  -- Kids clinic: full (6) with one on the waitlist.
  if v_kids is not null then
    foreach v_name in array array['Mia Thompson', 'Ploy Rattana', 'Lucas Becker', 'Sasha Volkova', 'Noah Chen', 'Ava Laurent', 'Max Ivanov'] loop
      perform public.register_for_session(p_session => v_kids, p_guest_name => v_name);
    end loop;
  end if;

  -- Adult clinic: 1 of the 2 needed, so it shows under "Sessions short of players".
  if v_adult is not null then
    perform public.register_for_session(p_session => v_adult,
      p_member => (select id from public.members where org_id = v_org and full_name = 'Anna Becker'));
  end if;

  -- Next camp or event: a few early sign-ups.
  if v_camp is not null then
    foreach v_name in array array['Rachel Green', 'Ben Carter', 'Yuki Sato'] loop
      begin
        perform public.register_for_session(p_session => v_camp, p_guest_name => v_name, p_ignore_level => true);
      exception when others then raise notice 'seed: skipped % for event: %', v_name, sqlerrm;
      end;
    end loop;
  end if;

  -- Court bookings tomorrow: a drop-in, a private lesson block, and a maintenance closure.
  select id into v_c4 from public.courts where org_id = v_org and name = 'Court 4';
  select id into v_tennis from public.courts where org_id = v_org and name = 'Tennis court';
  begin
    perform public.create_booking(v_c4, ((v_today + 1)::timestamp + time '10:00') at time zone v_tz,
      p_guest_name => 'Tourist Tom', p_kind => 'drop_in');
    perform public.create_booking(v_c4, ((v_today + 1)::timestamp + time '15:00') at time zone v_tz,
      p_guest_name => 'Private lesson', p_kind => 'coaching', p_minutes => 60, p_notes => 'Coach Kimo, 1 pax');
    perform public.create_booking(v_tennis, ((v_today + 2)::timestamp + time '13:00') at time zone v_tz,
      p_kind => 'maintenance', p_minutes => 120, p_notes => 'Net replacement');
  exception when others then raise notice 'seed: skipped a court booking: %', sqlerrm;
  end;
end;
$$;

reset role;

-- 3. A second club with its own owner (bare: starter courts, prices and packages only).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'other@clubos.test',
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', ''
);
insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000002',
  '{"sub":"d0000000-0000-4000-8000-000000000002","email":"other@clubos.test","email_verified":true}',
  'email', now(), now(), now()
);
set role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000002', false);
select public.create_org('Chalong Padel', 'chalong');
reset role;

-- Payments (Step 3): the database made an order for every demo sale above. Make the demo
-- realistic: package sales were paid (cash, transfer, PromptPay), and past court bookings and
-- session places were paid at the desk. Upcoming ones stay unpaid, to collect when they come.
-- The seed runs as one transaction: make the order triggers (deferred) run now, before this.
set constraints all immediate;
update public.orders o
   set status = 'paid',
       method = (array['cash', 'transfer', 'promptpay'])[1 + (abs(hashtext(o.id::text)) % 3)],
       paid_amount = o.total,
       paid_at = o.created_at
 where o.status = 'pending'
   and (exists (select 1 from public.order_items i where i.order_id = o.id and i.kind = 'package')
        or exists (select 1 from public.order_items i
                     join public.booking_calendar b on b.id = i.booking_id
                    where i.order_id = o.id and b.start_at < now())
        or exists (select 1 from public.order_items i
                     join public.session_overview s on s.id = (select r.session_id from public.session_registrations r where r.id = i.registration_id)
                    where i.order_id = o.id and s.starts_at < now()));

-- Courtix team (Step 10b): the demo login is also a Courtix super admin, so the admin area
-- (http://courtix.localhost:3000/admin) can be tried locally.
insert into public.platform_staff (user_id, role) values ('d0000000-0000-4000-8000-000000000001', 'super_admin');
