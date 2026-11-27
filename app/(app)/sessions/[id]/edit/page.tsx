import Link from "next/link";
import { notFound } from "next/navigation";
import { canManage, requireOrg } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { formatLongDay, localTime } from "@/lib/time";
import { updateSession } from "../../actions";
import type { SessionOverview } from "@/lib/types";

export default async function EditSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, org, role } = await requireOrg();
  const { data } = await supabase.from("session_overview").select("*").eq("id", id).eq("org_id", org.id).maybeSingle();
  if (!data) notFound();
  const s = data as SessionOverview;
  const tz = s.location_timezone;
  const day = new Date(s.starts_at).toLocaleDateString("en-CA", { timeZone: tz });
  const endDay = new Date(s.ends_at).toLocaleDateString("en-CA", { timeZone: tz });
  const finished = new Date(s.ends_at).getTime() <= Date.now();

  const back = <Link href={`/sessions/${s.id}`} className="small">← {s.name}</Link>;
  if (!canManage(role) || s.status === "cancelled" || finished) {
    return (
      <>
        {back}
        <h1>Edit session</h1>
        <p className="muted">
          {!canManage(role)
            ? "Only the owner or an admin can edit sessions."
            : s.status === "cancelled"
              ? "This session has been cancelled, so it can't be edited."
              : "This session has finished, so it can't be edited."}
        </p>
      </>
    );
  }

  // This location's courts and the ones the session holds now.
  const [{ data: courtData }, { data: holdData }] = await Promise.all([
    supabase.from("courts").select("id, name").eq("location_id", s.location_id).eq("is_active", true).order("sort_order"),
    supabase.from("bookings").select("court_id").eq("session_id", s.id).eq("status", "confirmed"),
  ]);
  const locationCourts = (courtData ?? []) as { id: string; name: string }[];
  const heldCourts = new Set(((holdData ?? []) as { court_id: string }[]).map((b) => b.court_id));

  return (
    <>
      <div className="page-head">
        <div>
          {back}
          <h1>Edit session</h1>
          <p className="muted">
            {s.name} · {formatLongDay(day)} · {localTime(s.starts_at, tz)}–{localTime(s.ends_at, tz)}
          </p>
        </div>
      </div>
      <Banner sp={sp} />
      <section className="card" style={{ maxWidth: 760 }}>
        <form action={updateSession} className="form" >
                <input type="hidden" name="session_id" value={s.id} />
                <input type="hidden" name="timezone" value={tz} />
                <input type="hidden" name="original_title" value={s.name} />
                <label>
                  Title
                  <input name="title" defaultValue={s.name} />
                </label>
                <div className="form-row">
                  <label>
                    Date
                    <input type="date" name="date" required defaultValue={day} />
                  </label>
                  <label>
                    Starts
                    <input type="time" name="start_time" required defaultValue={localTime(s.starts_at, tz)} />
                  </label>
                  <label>
                    Ends
                    <input type="time" name="end_time" required defaultValue={localTime(s.ends_at, tz)} />
                  </label>
                </div>
                {endDay !== day && (
                  <label>
                    End date (multi-day event)
                    <input type="date" name="end_date" defaultValue={endDay} />
                  </label>
                )}
                <div className="form-row">
                  <label>
                    Price per person
                    <input type="number" name="price" min="0" required defaultValue={s.price} />
                  </label>
                  <label>
                    Minimum players
                    <input type="number" name="min_players" min="1" required defaultValue={s.min_players} />
                  </label>
                  <label>
                    Maximum players
                    <input type="number" name="max_players" min="1" required defaultValue={s.max_players} />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Level from
                    <input type="number" name="level_min" step="0.5" min="1" max="6" defaultValue={s.level_min ?? ""} placeholder="Any" />
                  </label>
                  <label>
                    Level to
                    <input type="number" name="level_max" step="0.5" min="1" max="6" defaultValue={s.level_max ?? ""} placeholder="Any" />
                  </label>
                  <label>
                    Coach
                    <input name="coach_name" defaultValue={s.coach_name ?? ""} />
                  </label>
                </div>
                {locationCourts.length > 0 && (
                  <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="small muted" style={{ marginBottom: 6 }}>Courts to hold</legend>
                    <div className="actions">
                      {locationCourts.map((c) => (
                        <label key={c.id} className="check">
                          <input type="checkbox" name="court_ids" value={c.id} defaultChecked={heldCourts.has(c.id)} /> {c.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                <label>
                  Description
                  <textarea name="description" defaultValue={s.description ?? ""} />
                </label>
                <label>
                  Notes for staff
                  <textarea name="notes" defaultValue={s.notes ?? ""} />
                </label>
                <p className="muted small">
                  People already booked keep the price they signed up at. If you change the time, let them know.
                  Later timetable changes won&apos;t overwrite this session.
                </p>
                <button className="primary" data-pending-label="Saving…">Save session</button>
              </form>
      </section>
    </>
  );
}
