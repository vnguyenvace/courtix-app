-- Scheduled jobs (roadmap step 10), so nobody has to press the housekeeping buttons.
--
-- pg_cron runs inside Postgres, locally and on hosted Supabase, as the postgres role.
-- Times are UTC. Every job is safe to run again: it only does what's still needed.
--
-- Not scheduled yet: the go / no-go check (check_session_minimums). Run on its own it
-- would cancel short sessions without telling the players. It gets scheduled together
-- with automatic WhatsApp notices (step 9). Until then, use "Run go / no-go check".

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

-- Hourly: expire finished packages, end pauses that are over, and keep two weeks of
-- sessions generated for every club. Hourly rather than nightly so clubs in any time
-- zone are covered soon after their midnight; re-running changes nothing.
create or replace function public.run_housekeeping()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r       record;
  v_made  int := 0;
  v_fail  int := 0;
begin
  perform public.refresh_membership_statuses();

  for r in select id from public.orgs loop
    begin
      v_made := v_made + coalesce(public.generate_sessions(r.id, 14), 0);
    exception when others then
      -- One club's broken timetable must not stop the others.
      v_fail := v_fail + 1;
      raise warning 'generate_sessions failed for club %: %', r.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('sessions_created', v_made, 'clubs_failed', v_fail);
end;
$$;
-- Only the scheduler (postgres) runs this; staff use the buttons in the app.
revoke execute on function public.run_housekeeping() from public, anon, authenticated;

-- cron.schedule with an existing name updates that job, so re-applying is safe.
select cron.schedule('club-os-housekeeping', '5 * * * *', 'select public.run_housekeeping()');

-- Keep two weeks of job history (it's visible in Supabase Studio → Integrations → Cron).
select cron.schedule('club-os-cron-history-cleanup', '30 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '14 days'$$);
