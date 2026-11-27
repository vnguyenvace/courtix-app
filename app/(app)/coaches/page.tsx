import { Banner, param, type SearchParams } from "@/components/Banner";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { requirePermission } from "@/lib/org";
import { formatMoney, isValidDate, todayIn } from "@/lib/time";
import type { Coach, CoachScheduleRow, Court, LessonRate, Location, MemberStatus } from "@/lib/types";
import { setBookingStatus } from "../actions";
import { addCoach, addRate, bookLesson, deleteRate, updateCoach } from "./actions";

const LENGTHS = [30, 45, 60, 90, 120];
const SIZES = [1, 2, 3, 4, 5, 6];

function LocationChecks({ locations, chosen }: { locations: Location[]; chosen: string[] | null }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="small muted" style={{ marginBottom: 6 }}>Teaches at (leave all unticked for every location)</legend>
      <div className="actions">
        {locations.map((l) => (
          <label key={l.id} className="check">
            <input type="checkbox" name="location_ids" value={l.id} defaultChecked={chosen?.includes(l.id) ?? false} /> {l.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);

export default async function CoachesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, can, location, workLocation, locations, multiLocation, role } = await requirePermission("bookings.manage");
  const setup = can("club.setup");
  const active = locations.filter((l) => l.is_active);
  const loc = location ?? workLocation;
  const dateParam = param(sp, "date");
  const date = isValidDate(dateParam) ? dateParam : todayIn(loc.timezone);

  const [{ data: coachData }, { data: rateData }, { data: schedData }, { data: memberData }, { data: courtData }] = await Promise.all([
    supabase.from("coaches").select("*").eq("org_id", org.id).order("is_active", { ascending: false }).order("name"),
    supabase.from("lesson_rates").select("*").eq("org_id", org.id).order("minutes").order("group_size"),
    supabase
      .from("coach_schedule")
      .select("*")
      .eq("org_id", org.id)
      .gte("end_at", new Date().toISOString())
      .lte("start_at", new Date(Date.now() + 14 * 86400_000).toISOString())
      .order("start_at"),
    supabase.from("member_status").select("member_id, full_name").eq("org_id", org.id).order("full_name"),
    supabase.from("courts").select("*").eq("org_id", org.id).eq("is_active", true).order("sort_order"),
  ]);
  const coaches = (coachData ?? []) as Coach[];
  const activeCoaches = coaches.filter((c) => c.is_active);
  const rates = (rateData ?? []) as LessonRate[];
  const schedule = (schedData ?? []) as CoachScheduleRow[];
  const members = (memberData ?? []) as Pick<MemberStatus, "member_id" | "full_name">[];
  const courts = (courtData ?? []) as Court[];
  const locName = new Map(locations.map((l) => [l.id, l]));
  const coachName = new Map(coaches.map((c) => [c.id, c.name]));
  const when = (iso: string, tz: string) =>
    new Date(iso).toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const time = (iso: string, tz: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Coaches</h1>
          <p className="muted">Private lessons book the coach and a court together. A coach can&apos;t be in two places at once.</p>
        </div>
      </div>
      <Banner sp={sp} />

      {activeCoaches.length === 0 ? (
        <section className="card" style={{ marginBottom: 16 }}>
          <p className="muted">
            {setup ? "Add your coaches below, then set lesson prices, to start booking lessons." : "No coaches yet. Ask the owner or an admin to add them."}
          </p>
        </section>
      ) : (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2>Book a lesson</h2>
          <form action={bookLesson} className="form">
            <div className="form-row">
              <label>
                Coach
                <select name="coach_id" required>
                  {activeCoaches.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label>
                People
                <select name="group_size" defaultValue="1">
                  {SIZES.map((n) => (
                    <option key={n} value={n}>{people(n)}</option>
                  ))}
                </select>
              </label>
              <label>
                Length
                <select name="minutes" defaultValue="60">
                  {LENGTHS.map((m) => (
                    <option key={m} value={m}>{m} minutes</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                Date
                <input type="date" name="date" defaultValue={date} required />
              </label>
              <label>
                Start
                <input type="time" name="time" step={900} defaultValue="09:00" required />
              </label>
              {multiLocation && (
                <label>
                  Location
                  <select name="location_id" defaultValue={loc.id}>
                    {active.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Court
                <select name="court_id" defaultValue="">
                  <option value="">Any free court</option>
                  {courts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {multiLocation ? ` (${locName.get(c.location_id)?.name ?? ""})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                Member who pays
                <select name="member_id" defaultValue="">
                  <option value="">Not a member (enter a name)</option>
                  {members.map((m) => (
                    <option key={m.member_id} value={m.member_id}>{m.full_name}</option>
                  ))}
                </select>
              </label>
              <label>
                Guest name
                <input name="guest_name" placeholder="Tourist Tom" />
              </label>
            </div>
            <label>
              Notes (optional)
              <input name="notes" maxLength={200} placeholder="Working on the third shot drop" />
            </label>
            <div className="actions">
              <button className="primary">Book lesson</button>
            </div>
            <p className="muted small">
              The price comes from the prices below, by length and number of people. It goes to Payments to collect, like a
              court booking.
            </p>
          </form>
        </section>
      )}

      {schedule.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2>Next 14 days</h2>
          <ul className="list">
            {schedule.map((r) => {
              const tz = locName.get(r.location_id)?.timezone ?? loc.timezone;
              return (
                <li key={r.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong>{r.coach_name}</strong> · {when(r.start_at, tz)}–{time(r.end_at, tz)}
                    <div className="muted small">
                      {r.booking_id
                        ? `Lesson: ${r.student ?? "guest"}${r.group_size && r.group_size > 1 ? ` (${people(r.group_size)})` : ""} · ${r.court_name ?? ""} · ${formatMoney(Number(r.price ?? 0), org.currency)}`
                        : `Session: ${r.session_name ?? ""}`}
                      {multiLocation && ` · ${locName.get(r.location_id)?.name ?? ""}`}
                    </div>
                  </div>
                  {r.booking_id && role !== "support" && (
                    <form action={setBookingStatus} className="inline">
                      <input type="hidden" name="booking_id" value={r.booking_id} />
                      <input type="hidden" name="status" value="cancelled" />
                      <input type="hidden" name="return_to" value="/coaches" />
                      <ConfirmSubmit label="Cancel lesson" confirm="Yes, cancel lesson" />
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card" style={{ marginBottom: 16 }} id="prices">
        <h2>Lesson prices</h2>
        {rates.length === 0 ? (
          <p className="muted small">No prices yet. A lesson can only be booked once its price is set.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>For</th>
                  <th>Length</th>
                  <th>People</th>
                  <th>Price</th>
                  {setup && <th />}
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id}>
                    <td>{r.coach_id ? coachName.get(r.coach_id) ?? "?" : "All coaches"}</td>
                    <td>{r.minutes} min</td>
                    <td>{people(r.group_size)}</td>
                    <td>{formatMoney(Number(r.price), org.currency)}</td>
                    {setup && (
                      <td>
                        <form action={deleteRate} className="inline">
                          <input type="hidden" name="rate_id" value={r.id} />
                          <button className="link">Remove</button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {setup && coaches.length > 0 && (
          <form action={addRate} className="form" style={{ marginTop: 12 }}>
            <div className="form-row">
              <label>
                For
                <select name="coach_id" defaultValue="">
                  <option value="">All coaches</option>
                  {coaches.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} only</option>
                  ))}
                </select>
              </label>
              <label>
                Length
                <select name="minutes" defaultValue="60">
                  {LENGTHS.map((m) => (
                    <option key={m} value={m}>{m} minutes</option>
                  ))}
                </select>
              </label>
              <label>
                People
                <select name="group_size" defaultValue="1">
                  {SIZES.map((n) => (
                    <option key={n} value={n}>{people(n)}</option>
                  ))}
                </select>
              </label>
              <label>
                Price ({org.currency})
                <input type="number" name="price" min="0" step="1" required />
              </label>
            </div>
            <div className="actions">
              <button>Save price</button>
            </div>
            <p className="muted small">
              The price is for the whole lesson, not per person. A coach&apos;s own price wins over the &quot;All coaches&quot; price.
              Saving the same length and people again changes the price.
            </p>
          </form>
        )}
      </section>

      <section className="card">
        <h2>Your coaches</h2>
        {coaches.length > 0 && (
          <ul className="list">
            {coaches.map((c) => (
              <li key={c.id} style={{ display: "grid", gap: 6 }}>
                <div>
                  <strong>{c.name}</strong>
                  {!c.is_active && <span className="muted small"> (not taking lessons)</span>}
                  <div className="muted small">
                    {[c.phone, multiLocation ? (c.location_ids ? c.location_ids.map((id) => locName.get(id)?.name).join(", ") : "All locations") : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {c.about && <div className="small">{c.about}</div>}
                </div>
                {setup && (
                  <details>
                    <summary className="small">Edit</summary>
                    <form action={updateCoach} className="form" style={{ marginTop: 8 }}>
                      <input type="hidden" name="coach_id" value={c.id} />
                      <div className="form-row">
                        <label>
                          Name
                          <input name="name" required maxLength={80} defaultValue={c.name} />
                        </label>
                        <label>
                          Phone
                          <input name="phone" maxLength={40} defaultValue={c.phone ?? ""} />
                        </label>
                      </div>
                      <label>
                        About (optional)
                        <input name="about" maxLength={500} defaultValue={c.about ?? ""} />
                      </label>
                      {multiLocation && <LocationChecks locations={active} chosen={c.location_ids} />}
                      <label className="check">
                        <input type="checkbox" name="is_active" defaultChecked={c.is_active} /> Taking lessons
                      </label>
                      <div className="actions">
                        <button>Save</button>
                      </div>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
        {setup && (
          <form action={addCoach} className="form" style={{ marginTop: 12 }}>
            <h3 style={{ margin: 0 }}>Add a coach</h3>
            <div className="form-row">
              <label>
                Name
                <input name="name" required maxLength={80} placeholder="Coach Kimo" />
              </label>
              <label>
                Phone (optional)
                <input name="phone" maxLength={40} />
              </label>
            </div>
            <label>
              About (optional)
              <input name="about" maxLength={500} placeholder="IPTPA certified, beginners to 4.0" />
            </label>
            {multiLocation && <LocationChecks locations={active} chosen={null} />}
            <div className="actions">
              <button className="primary">Add coach</button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
