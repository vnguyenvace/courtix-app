import type { T } from "@/lib/i18n";
import Link from "next/link";
import { requireOrg, canManage } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { levelText } from "@/components/SessionBits";
import { formatDate, formatMoney } from "@/lib/time";
import { addSchedule, addSessionType, generateSessions, toggleSchedule, toggleSessionType, setSessionTypePublic, updateScheduleEntry, updateSessionType } from "../actions";
import { CATEGORY_LABELS, type Court, type SessionCategory, type SessionSchedule, type SessionType } from "@/lib/types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayText(days: number[], t: T) {
  const sorted = [...days].sort();
  if (sorted.length === 7) return t("Every day");
  if (sorted.join() === "1,2,3,4,5") return t("Mon–Fri");
  if (sorted.join() === "1,2,3,4,5,6") return t("Mon–Sat");
  // Show Monday first
  return [...sorted.filter((d) => d !== 0), ...sorted.filter((d) => d === 0)].map((d) => t(DAYS[d])).join(", ");
}

export default async function SetupPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, role, locations, workLocation, multiLocation, t, locale } = await requireOrg();
  const editable = canManage(role);

  const [{ data: tData }, { data: sData }, { data: cData }] = await Promise.all([
    supabase.from("session_types").select("*").eq("org_id", org.id).order("name"),
    supabase.from("session_schedules").select("*").eq("org_id", org.id).order("start_time"),
    supabase.from("courts").select("*").eq("org_id", org.id).order("sort_order"),
  ]);
  const types = (tData ?? []) as SessionType[];
  const schedules = (sData ?? []) as SessionSchedule[];
  const courts = (cData ?? []) as Court[];
  const typeName = new Map(types.map((ty) => [ty.id, ty.name]));
  const courtName = new Map(courts.map((c) => [c.id, c.name]));
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const activeLocations = locations.filter((l) => l.is_active);

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/sessions" className="small">{t("← Sessions")}</Link>
          <h1>{t("Timetable setup")}</h1>
          <p className="muted">
            {editable ? t("Session types and the weekly timetable.") : t("Only the owner or an admin can change the timetable.")}
          </p>
        </div>
        {editable && (
          <form action={generateSessions}>
            <input type="hidden" name="return_to" value="/sessions/setup" />
            <button className="primary">{t("Fill the next 2 weeks")}</button>
          </form>
        )}
      </div>
      <Banner sp={sp} />

      <div className="grid grid-2">
        <div className="stack">
          <section className="card">
            <h2>{t("Weekly timetable")}</h2>
            {schedules.length === 0 ? (
              <p className="muted small">{t("Nothing in the weekly timetable yet.")}</p>
            ) : (
              <ul className="list">
                {schedules.map((s) => (
                  <li key={s.id}>
                    <span>
                      <strong>{s.start_time.slice(0, 5)}</strong> {typeName.get(s.session_type_id)}
                      <div className="muted small">
                        {multiLocation ? `${locName.get(s.location_id)} · ` : ""}
                        {dayText(s.days_of_week, t)}
                        {s.court_ids.length > 0 && ` · ${s.court_ids.map((id) => courtName.get(id) ?? "?").join(", ")}`}
                        {s.valid_until && ` · until ${formatDate(s.valid_until)}`}
                      </div>
                      {editable && (
                        <ScheduleEditor
                          s={s}
                          courts={courts.filter((c) => c.is_active && c.location_id === s.location_id)}
                          t={t}
                        />
                      )}
                    </span>
                    <span className="actions">
                      {!s.is_active && <span className="badge">off</span>}
                      {editable && (
                        <form action={toggleSchedule} className="inline">
                          <input type="hidden" name="schedule_id" value={s.id} />
                          <input type="hidden" name="is_active" value={String(!s.is_active)} />
                          <button className="link">{s.is_active ? t("Turn off") : t("Turn on")}</button>
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
              <h2>{t("Add to the timetable")}</h2>
              <form action={addSchedule} className="form">
                <div className="form-row">
                  <label>
                    {t("Session")}
                    <select name="session_type_id" required>
                      {types.filter((ty) => ty.is_active).map((ty) => (
                        <option key={ty.id} value={ty.id}>{ty.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("Starts at")}
                    <input type="time" name="start_time" required />
                  </label>
                </div>
                {multiLocation && (
                  <label>
                    {t("Location")}
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
                      <input type="checkbox" name="days" value={d} /> {t(DAYS[d])}
                    </label>
                  ))}
                </div>
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="small muted" style={{ marginBottom: 6 }}>{t("Courts to hold")}</legend>
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
                    {t("Starting from (optional)")}
                    <input type="date" name="valid_from" />
                  </label>
                  <label>
                    {t("Until (optional, e.g. end of high season)")}
                    <input type="date" name="valid_until" />
                  </label>
                </div>
                <button>{t("Add to timetable")}</button>
              </form>
            </section>
          )}
        </div>

        <div className="stack">
          <section className="card">
            <h2>{t("Session types")}</h2>
            {types.length === 0 ? (
              <p className="muted small">{t("No session types yet.")}</p>
            ) : (
              <ul className="list">
                {types.map((ty) => (
                  <li key={ty.id}>
                    <span>
                      {ty.name}
                      <div className="muted small">
                        {[
                          t(CATEGORY_LABELS[ty.category]),
                          formatMoney(ty.price, org.currency),
                          t("{n} min", { n: ty.duration_minutes }),
                          t("{min}–{max} players", { min: ty.min_players, max: ty.max_players }),
                          levelText(ty.level_min, ty.level_max, t),
                          ty.min_age ? t("age {n}+", { n: ty.min_age }) : "",
                          t("book {n} min ahead", { n: ty.book_by_minutes }),
                          t("go / no-go {n}h before", { n: ty.min_check_hours }),
                        ].filter(Boolean).join(" · ")}
                        {ty.signup_opens_days !== null ? ` · ${t("sign-ups open {n} days before", { n: ty.signup_opens_days })}` : ""}
                      </div>
                      {editable && <TypeEditor ty={ty} t={t} />}
                    </span>
                    <span className="actions">
                      {!ty.is_active && <span className="badge">hidden</span>}
                      {ty.is_active && !ty.is_public && <span className="badge">{t("not on booking page")}</span>}
                      {editable && ty.is_active && (
                        <form action={setSessionTypePublic} className="inline">
                          <input type="hidden" name="type_id" value={ty.id} />
                          <input type="hidden" name="is_public" value={String(!ty.is_public)} />
                          <button className="link">{ty.is_public ? t("Hide online") : t("Show online")}</button>
                        </form>
                      )}
                      {editable && (
                        <form action={toggleSessionType} className="inline">
                          <input type="hidden" name="type_id" value={ty.id} />
                          <input type="hidden" name="is_active" value={String(!ty.is_active)} />
                          <button className="link">{ty.is_active ? t("Hide") : t("Show")}</button>
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
              <h2>{t("Add a session type")}</h2>
              <form action={addSessionType} className="form">
                <div className="form-row">
                  <label>
                    {t("Name")}
                    <input name="name" required placeholder={t("Adult clinic")} />
                  </label>
                  <label>
                    {t("Kind")}
                    <select name="category" defaultValue="clinic">
                      {(Object.keys(CATEGORY_LABELS) as SessionCategory[]).map((c) => (
                        <option key={c} value={c}>{t(CATEGORY_LABELS[c])}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    {t("Price per person")}
                    <input type="number" name="price" min="0" required placeholder="500" />
                  </label>
                  <label>
                    {t("Length (minutes)")}
                    <input type="number" name="duration_minutes" min="15" defaultValue={60} />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    {t("Minimum players")}
                    <input type="number" name="min_players" min="1" defaultValue={2} />
                  </label>
                  <label>
                    {t("Maximum players")}
                    <input type="number" name="max_players" min="1" defaultValue={8} />
                  </label>
                  <label>
                    {t("Minimum age")}
                    <input type="number" name="min_age" min="3" placeholder={t("None")} />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    {t("Level from")}
                    <input type="number" name="level_min" step="0.5" min="1" max="6" placeholder={t("Any")} />
                  </label>
                  <label>
                    {t("Level to")}
                    <input type="number" name="level_max" step="0.5" min="1" max="6" placeholder={t("Any")} />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    {t("Sign-ups close (minutes before)")}
                    <input type="number" name="book_by_minutes" min="0" defaultValue={60} />
                  </label>
                  <label>
                    {t("Go / no-go decision (hours before)")}
                    <input type="number" name="min_check_hours" min="0" defaultValue={3} />
                  </label>
                  <label>
                    {t("Sign-ups open (days before)")}
                    <input type="number" name="signup_opens_days" min="0" max="90" placeholder={t("Any time")} />
                  </label>
                </div>
                <p className="muted small">
                  {t("Packages with priority booking let their members sign up that many days earlier.")}
                </p>
                <label>
                  {t("Description")}
                  <textarea name="description" placeholder={t("A coached hour for beginners and improvers…")} />
                </label>
                <button>{t("Add session type")}</button>
              </form>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Editors

function ScheduleEditor({ s, courts, t }: { s: SessionSchedule; courts: Court[]; t: T }) {
  return (
    <details style={{ marginTop: 6 }}>
      <summary className="small" style={{ cursor: "pointer", color: "var(--accent)" }}>{t("Edit")}</summary>
      <form action={updateScheduleEntry} className="form" style={{ marginTop: 8 }}>
        <input type="hidden" name="schedule_id" value={s.id} />
        <div className="form-row">
          <label>
            {t("Starts at")}
            <input type="time" name="start_time" required defaultValue={s.start_time.slice(0, 5)} />
          </label>
          <label>
            {t("Until (optional)")}
            <input type="date" name="valid_until" defaultValue={s.valid_until ?? ""} />
          </label>
        </div>
        <div className="actions">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <label key={d} className="check">
              <input type="checkbox" name="days" value={d} defaultChecked={s.days_of_week.includes(d)} /> {t(DAYS[d])}
            </label>
          ))}
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small muted" style={{ marginBottom: 6 }}>{t("Courts to hold")}</legend>
          <div className="actions">
            {courts.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" name="court_ids" value={c.id} defaultChecked={s.court_ids.includes(c.id)} /> {c.name}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="muted small">
          {t("Upcoming sessions nobody has signed up for are remade with the new times. Sessions with people signed up keep their time, and you'll get a list to move or cancel them one by one.")}
        </p>
        <button data-pending-label={t("Saving…")}>{t("Save timetable entry")}</button>
      </form>
    </details>
  );
}

function TypeEditor({ ty, t }: { ty: SessionType; t: T }) {
  return (
    <details style={{ marginTop: 6 }}>
      <summary className="small" style={{ cursor: "pointer", color: "var(--accent)" }}>{t("Edit")}</summary>
      <form action={updateSessionType} className="form" style={{ marginTop: 8 }}>
        <input type="hidden" name="type_id" value={ty.id} />
        <div className="form-row">
          <label>
            {t("Name")}
            <input name="name" required defaultValue={ty.name} />
          </label>
          <label>
            {t("Kind")}
            <select name="category" defaultValue={ty.category}>
              {(Object.keys(CATEGORY_LABELS) as SessionCategory[]).map((c) => (
                <option key={c} value={c}>{t(CATEGORY_LABELS[c])}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            {t("Price per person")}
            <input type="number" name="price" min="0" required defaultValue={ty.price} />
          </label>
          <label>
            {t("Length (minutes)")}
            <input type="number" name="duration_minutes" min="15" max="1440" required defaultValue={ty.duration_minutes} />
          </label>
        </div>
        <div className="form-row">
          <label>
            {t("Minimum players")}
            <input type="number" name="min_players" min="1" required defaultValue={ty.min_players} />
          </label>
          <label>
            {t("Maximum players")}
            <input type="number" name="max_players" min="1" required defaultValue={ty.max_players} />
          </label>
          <label>
            {t("Minimum age")}
            <input type="number" name="min_age" min="3" max="99" defaultValue={ty.min_age ?? ""} placeholder={t("Any")} />
          </label>
        </div>
        <div className="form-row">
          <label>
            {t("Level from")}
            <input type="number" name="level_min" step="0.5" min="1" max="6" defaultValue={ty.level_min ?? ""} placeholder={t("Any")} />
          </label>
          <label>
            {t("Level to")}
            <input type="number" name="level_max" step="0.5" min="1" max="6" defaultValue={ty.level_max ?? ""} placeholder={t("Any")} />
          </label>
        </div>
        <div className="form-row">
          <label>
            {t("Sign-ups close (minutes before)")}
            <input type="number" name="book_by_minutes" min="0" defaultValue={ty.book_by_minutes} />
          </label>
          <label>
            {t("Go / no-go decision (hours before)")}
            <input type="number" name="min_check_hours" min="0" defaultValue={ty.min_check_hours} />
          </label>
          <label>
            {t("Sign-ups open (days before)")}
            <input type="number" name="signup_opens_days" min="0" max="90" defaultValue={ty.signup_opens_days ?? ""} placeholder={t("Any time")} />
          </label>
        </div>
        <label>
          {t("Description")}
          <textarea name="description" defaultValue={ty.description ?? ""} />
        </label>
        <label className="check">
          <input type="checkbox" name="apply_upcoming" defaultChecked />{" "}{t("Also update upcoming sessions of this type (price, players, levels, length). Sessions you edited by hand are left alone, and people already booked keep their price.")}
        </label>
        <button data-pending-label={t("Saving…")}>{t("Save session type")}</button>
      </form>
    </details>
  );
}
