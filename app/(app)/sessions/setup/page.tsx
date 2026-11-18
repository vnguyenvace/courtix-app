import Link from "next/link";
import { requireOrg, canManage } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { levelText } from "@/components/SessionBits";
import { formatDate, formatMoney } from "@/lib/time";
import { addSchedule, addSessionType, generateSessions, toggleSchedule, toggleSessionType, setSessionTypePublic, updateScheduleEntry, updateSessionType } from "../actions";
import { CATEGORY_LABELS, type Court, type SessionCategory, type SessionSchedule, type SessionType } from "@/lib/types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayText(days: number[]) {
  const sorted = [...days].sort();
  if (sorted.length === 7) return "Every day";
  if (sorted.join() === "1,2,3,4,5") return "Mon–Fri";
  if (sorted.join() === "1,2,3,4,5,6") return "Mon–Sat";
  // Show Monday first
  return [...sorted.filter((d) => d !== 0), ...sorted.filter((d) => d === 0)].map((d) => DAYS[d]).join(", ");
}

export default async function SetupPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, role, locations, workLocation, multiLocation } = await requireOrg();
  const editable = canManage(role);

  const [{ data: tData }, { data: sData }, { data: cData }] = await Promise.all([
    supabase.from("session_types").select("*").eq("org_id", org.id).order("name"),
    supabase.from("session_schedules").select("*").eq("org_id", org.id).order("start_time"),
    supabase.from("courts").select("*").eq("org_id", org.id).order("sort_order"),
  ]);
  const types = (tData ?? []) as SessionType[];
  const schedules = (sData ?? []) as SessionSchedule[];
  const courts = (cData ?? []) as Court[];
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const courtName = new Map(courts.map((c) => [c.id, c.name]));
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const activeLocations = locations.filter((l) => l.is_active);

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/sessions" className="small">← Sessions</Link>
          <h1>Timetable setup</h1>
          <p className="muted">
            {editable ? "Session types and the weekly timetable." : "Only owners and managers can change the timetable."}
          </p>
        </div>
        {editable && (
          <form action={generateSessions}>
            <input type="hidden" name="return_to" value="/sessions/setup" />
            <button className="primary">Fill the next 2 weeks</button>
          </form>
        )}
      </div>
      <Banner sp={sp} />

      <div className="grid grid-2">
        <div className="stack">
          <section className="card">
            <h2>Weekly timetable</h2>
            {schedules.length === 0 ? (
              <p className="muted small">Nothing in the weekly timetable yet.</p>
            ) : (
              <ul className="list">
                {schedules.map((s) => (
                  <li key={s.id}>
                    <span>
                      <strong>{s.start_time.slice(0, 5)}</strong> {typeName.get(s.session_type_id)}
                      <div className="muted small">
                        {multiLocation ? `${locName.get(s.location_id)} · ` : ""}
                        {dayText(s.days_of_week)}
                        {s.court_ids.length > 0 && ` · ${s.court_ids.map((id) => courtName.get(id) ?? "?").join(", ")}`}
                        {s.valid_until && ` · until ${formatDate(s.valid_until)}`}
                      </div>
                      {editable && (
                        <ScheduleEditor
                          s={s}
                          courts={courts.filter((c) => c.is_active && c.location_id === s.location_id)}
                        />
                      )}
                    </span>
                    <span className="actions">
                      {!s.is_active && <span className="badge">off</span>}
                      {editable && (
                        <form action={toggleSchedule} className="inline">
                          <input type="hidden" name="schedule_id" value={s.id} />
                          <input type="hidden" name="is_active" value={String(!s.is_active)} />
                          <button className="link">{s.is_active ? "Turn off" : "Turn on"}</button>
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {editable && types.length > 0 && (
            <section className="card">
              <h2>Add to the timetable</h2>
              <form action={addSchedule} className="form">
                <div className="form-row">
                  <label>
                    Session
                    <select name="session_type_id" required>
                      {types.filter((t) => t.is_active).map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Starts at
                    <input type="time" name="start_time" required />
                  </label>
                </div>
                {multiLocation && (
                  <label>
                    Location
                    <select name="location_id" defaultValue={workLocation.id} required>
                      {activeLocations.map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="actions">
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <label key={d} className="check">
                      <input type="checkbox" name="days" value={d} /> {DAYS[d]}
                    </label>
                  ))}
                </div>
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="small muted" style={{ marginBottom: 6 }}>Courts to hold</legend>
                  <div className="actions">
                    {courts.filter((c) => c.is_active).map((c) => (
                      <label key={c.id} className="check">
                        <input type="checkbox" name="court_ids" value={c.id} /> {c.name}
                        {multiLocation ? ` (${locName.get(c.location_id)})` : ""}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="form-row">
                  <label>
                    Starting from (optional)
                    <input type="date" name="valid_from" />
                  </label>
                  <label>
                    Until (optional, e.g. end of high season)
                    <input type="date" name="valid_until" />
                  </label>
                </div>
                <button>Add to timetable</button>
              </form>
            </section>
          )}
        </div>

        <div className="stack">
          <section className="card">
            <h2>Session types</h2>
            {types.length === 0 ? (
              <p className="muted small">No session types yet.</p>
            ) : (
              <ul className="list">
                {types.map((t) => (
                  <li key={t.id}>
                    <span>
                      {t.name}
                      <div className="muted small">
                        {CATEGORY_LABELS[t.category]} · {formatMoney(t.price, org.currency)} · {t.duration_minutes} min ·{" "}
                        {t.min_players}–{t.max_players} players · {levelText(t.level_min, t.level_max)}
                        {t.min_age ? ` · age ${t.min_age}+` : ""} · book {t.book_by_minutes} min ahead · go / no-go{" "}
                        {t.min_check_hours}h before
                        {t.signup_opens_days !== null ? ` · sign-ups open ${t.signup_opens_days} days before` : ""}
                      </div>
                      {editable && <TypeEditor t={t} />}
                    </span>
                    <span className="actions">
                      {!t.is_active && <span className="badge">hidden</span>}
                      {t.is_active && !t.is_public && <span className="badge">not on booking page</span>}
                      {editable && t.is_active && (
                        <form action={setSessionTypePublic} className="inline">
                          <input type="hidden" name="type_id" value={t.id} />
                          <input type="hidden" name="is_public" value={String(!t.is_public)} />
                          <button className="link">{t.is_public ? "Hide online" : "Show online"}</button>
                        </form>
                      )}
                      {editable && (
                        <form action={toggleSessionType} className="inline">
                          <input type="hidden" name="type_id" value={t.id} />
                          <input type="hidden" name="is_active" value={String(!t.is_active)} />
                          <button className="link">{t.is_active ? "Hide" : "Show"}</button>
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {editable && (
            <section className="card">
              <h2>Add a session type</h2>
              <form action={addSessionType} className="form">
                <div className="form-row">
                  <label>
                    Name
                    <input name="name" required placeholder="Adult clinic" />
                  </label>
                  <label>
                    Kind
                    <select name="category" defaultValue="clinic">
                      {(Object.keys(CATEGORY_LABELS) as SessionCategory[]).map((c) => (
                        <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Price per person
                    <input type="number" name="price" min="0" required placeholder="500" />
                  </label>
                  <label>
                    Length (minutes)
                    <input type="number" name="duration_minutes" min="15" defaultValue={60} />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Minimum players
                    <input type="number" name="min_players" min="1" defaultValue={2} />
                  </label>
                  <label>
                    Maximum players
                    <input type="number" name="max_players" min="1" defaultValue={8} />
                  </label>
                  <label>
                    Minimum age
                    <input type="number" name="min_age" min="3" placeholder="None" />
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
                </div>
                <div className="form-row">
                  <label>
                    Sign-ups close (minutes before)
                    <input type="number" name="book_by_minutes" min="0" defaultValue={60} />
                  </label>
                  <label>
                    Go / no-go decision (hours before)
                    <input type="number" name="min_check_hours" min="0" defaultValue={3} />
                  </label>
                  <label>
                    Sign-ups open (days before)
                    <input type="number" name="signup_opens_days" min="0" max="90" placeholder="Any time" />
                  </label>
                </div>
                <p className="muted small">
                  Packages with priority booking let their members sign up that many days earlier.
                </p>
                <label>
                  Description
                  <textarea name="description" placeholder="A coached hour for beginners and improvers…" />
                </label>
                <button>Add session type</button>
              </form>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Editors

function ScheduleEditor({ s, courts }: { s: SessionSchedule; courts: Court[] }) {
  return (
    <details style={{ marginTop: 6 }}>
      <summary className="small" style={{ cursor: "pointer", color: "var(--accent)" }}>Edit</summary>
      <form action={updateScheduleEntry} className="form" style={{ marginTop: 8 }}>
        <input type="hidden" name="schedule_id" value={s.id} />
        <div className="form-row">
          <label>
            Starts at
            <input type="time" name="start_time" required defaultValue={s.start_time.slice(0, 5)} />
          </label>
          <label>
            Until (optional)
            <input type="date" name="valid_until" defaultValue={s.valid_until ?? ""} />
          </label>
        </div>
        <div className="actions">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <label key={d} className="check">
              <input type="checkbox" name="days" value={d} defaultChecked={s.days_of_week.includes(d)} /> {DAYS[d]}
            </label>
          ))}
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small muted" style={{ marginBottom: 6 }}>Courts to hold</legend>
          <div className="actions">
            {courts.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" name="court_ids" value={c.id} defaultChecked={s.court_ids.includes(c.id)} /> {c.name}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="muted small">
          Upcoming sessions nobody has signed up for are remade with the new times. Sessions with people signed up keep
          their time, and you&apos;ll get a list to move or cancel them one by one.
        </p>
        <button data-pending-label="Saving…">Save timetable entry</button>
      </form>
    </details>
  );
}

function TypeEditor({ t }: { t: SessionType }) {
  return (
    <details style={{ marginTop: 6 }}>
      <summary className="small" style={{ cursor: "pointer", color: "var(--accent)" }}>Edit</summary>
      <form action={updateSessionType} className="form" style={{ marginTop: 8 }}>
        <input type="hidden" name="type_id" value={t.id} />
        <div className="form-row">
          <label>
            Name
            <input name="name" required defaultValue={t.name} />
          </label>
          <label>
            Kind
            <select name="category" defaultValue={t.category}>
              {(Object.keys(CATEGORY_LABELS) as SessionCategory[]).map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            Price per person
            <input type="number" name="price" min="0" required defaultValue={t.price} />
          </label>
          <label>
            Length (minutes)
            <input type="number" name="duration_minutes" min="15" max="1440" required defaultValue={t.duration_minutes} />
          </label>
        </div>
        <div className="form-row">
          <label>
            Minimum players
            <input type="number" name="min_players" min="1" required defaultValue={t.min_players} />
          </label>
          <label>
            Maximum players
            <input type="number" name="max_players" min="1" required defaultValue={t.max_players} />
          </label>
          <label>
            Minimum age
            <input type="number" name="min_age" min="3" max="99" defaultValue={t.min_age ?? ""} placeholder="Any" />
          </label>
        </div>
        <div className="form-row">
          <label>
            Level from
            <input type="number" name="level_min" step="0.5" min="1" max="6" defaultValue={t.level_min ?? ""} placeholder="Any" />
          </label>
          <label>
            Level to
            <input type="number" name="level_max" step="0.5" min="1" max="6" defaultValue={t.level_max ?? ""} placeholder="Any" />
          </label>
        </div>
        <div className="form-row">
          <label>
            Sign-ups close (minutes before)
            <input type="number" name="book_by_minutes" min="0" defaultValue={t.book_by_minutes} />
          </label>
          <label>
            Go / no-go decision (hours before)
            <input type="number" name="min_check_hours" min="0" defaultValue={t.min_check_hours} />
          </label>
          <label>
            Sign-ups open (days before)
            <input type="number" name="signup_opens_days" min="0" max="90" defaultValue={t.signup_opens_days ?? ""} placeholder="Any time" />
          </label>
        </div>
        <label>
          Description
          <textarea name="description" defaultValue={t.description ?? ""} />
        </label>
        <label className="check">
          <input type="checkbox" name="apply_upcoming" defaultChecked /> Also update upcoming sessions of this type
          (price, players, levels, length). Sessions you edited by hand are left alone, and people already booked keep
          their price.
        </label>
        <button data-pending-label="Saving…">Save session type</button>
      </form>
    </details>
  );
}
