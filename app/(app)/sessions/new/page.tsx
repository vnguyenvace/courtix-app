import Link from "next/link";
import { requireOrg } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { formatMoney, todayIn } from "@/lib/time";
import { createEvent } from "../actions";
import { CATEGORY_LABELS, type Court, type SessionType } from "@/lib/types";

export default async function NewEventPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, myLocations, workLocation, multiLocation } = await requireOrg();
  const [{ data: tData }, { data: cData }] = await Promise.all([
    supabase.from("session_types").select("*").eq("org_id", org.id).eq("is_active", true).order("name"),
    supabase.from("courts").select("*").eq("org_id", org.id).eq("is_active", true).order("sort_order"),
  ]);
  const types = (tData ?? []) as SessionType[];
  const courts = (cData ?? []) as Court[];
  const locName = new Map(myLocations.map((l) => [l.id, l.name]));

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/sessions" className="small">← Sessions</Link>
          <h1>New event</h1>
          <p className="muted">A one-off camp, tournament, course or special session.</p>
        </div>
      </div>
      <Banner sp={sp} />

      {types.length === 0 ? (
        <div className="card">
          <p>Add a session type first (for example “Camp” or “Tournament”) in <Link href="/sessions/setup">Timetable setup</Link>.</p>
        </div>
      ) : (
        <form action={createEvent} className="card form" style={{ maxWidth: 760 }}>
          <label>
            Type (its price, player limits and level fill in when you leave fields blank)
            <select name="session_type_id" required>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {CATEGORY_LABELS[t.category]} · {formatMoney(t.price, org.currency)}
                </option>
              ))}
            </select>
          </label>
          {multiLocation && (
            <label>
              Location (times are in its local time)
              <select name="location_id" defaultValue={workLocation.id} required>
                {myLocations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Event name
            <input name="title" required placeholder="Coach Kimo camp: 3.5–4.0" />
          </label>
          <div className="form-row">
            <label>
              Date
              <input type="date" name="date" required defaultValue={todayIn(workLocation.timezone)} />
            </label>
            <label>
              Starts
              <input type="time" name="start_time" required />
            </label>
            <label>
              Ends
              <input type="time" name="end_time" required />
            </label>
            <label>
              End date (multi-day events)
              <input type="date" name="end_date" />
            </label>
          </div>
          <div className="form-row">
            <label>
              Price per person
              <input type="number" name="price" min="0" placeholder="From type" />
            </label>
            <label>
              Minimum players
              <input type="number" name="min_players" min="1" placeholder="From type" />
            </label>
            <label>
              Maximum players
              <input type="number" name="max_players" min="1" placeholder="From type" />
            </label>
          </div>
          <div className="form-row">
            <label>
              Level from
              <input type="number" name="level_min" step="0.5" min="1" max="6" placeholder="Any" />
            </label>
            <label>
              Level to
              <input type="number" name="level_max" step="0.5" min="1" max="6" placeholder="Any" />
            </label>
            <label>
              Coach
              <input name="coach_name" placeholder="Coach Kimo" />
            </label>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small muted" style={{ marginBottom: 6 }}>Hold these courts{multiLocation ? " (only courts at the chosen location are held)" : ""}</legend>
            <div className="actions">
              {courts
                .filter((c) => locName.has(c.location_id))
                .map((c) => (
                  <label key={c.id} className="check">
                    <input type="checkbox" name="court_ids" value={c.id} /> {c.name}
                    {multiLocation ? ` (${locName.get(c.location_id)})` : ""}
                  </label>
                ))}
            </div>
          </fieldset>
          <label>
            Description
            <textarea name="description" placeholder="What players get, what to bring, early bird deadline…" />
          </label>
          <div className="actions">
            <button className="primary">Create event</button>
            <Link href="/sessions" className="button">Cancel</Link>
          </div>
        </form>
      )}
    </>
  );
}
