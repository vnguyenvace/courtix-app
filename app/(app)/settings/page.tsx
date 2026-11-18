import { requireOrg, canManage } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { LANGUAGES } from "@/components/MemberFields";
import { formatMoney } from "@/lib/time";
import {
  addCourt,
  addLocation,
  addPackage,
  addRateRule,
  deleteRateRule,
  toggleCourt,
  toggleLocation,
  togglePackage,
  updateClub,
  updateLocation,
} from "../actions";
import type { Court, Location, PackageType, RateRule } from "@/lib/types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIMEZONES = ["Asia/Bangkok", "Asia/Ho_Chi_Minh", "Asia/Makassar", "Asia/Jakarta", "Asia/Singapore", "Asia/Kuala_Lumpur", "Asia/Manila", "Asia/Tokyo", "Australia/Sydney", "Europe/London", "UTC"];

function LocationFields({ l }: { l?: Location }) {
  return (
    <>
      <div className="form-row">
        <label>
          Name
          <input name="name" required defaultValue={l?.name} placeholder="Chalong" />
        </label>
        <label>
          WhatsApp for bookings
          <input name="whatsapp" type="tel" defaultValue={l?.whatsapp ?? ""} placeholder="+66 65 650 5195" />
        </label>
      </div>
      <label>
        Address
        <input name="address" defaultValue={l?.address ?? ""} placeholder="Chao Fa West Rd, Chalong, Phuket" />
      </label>
      <div className="form-row">
        <label>
          Opens
          <input type="time" name="opens_at" defaultValue={l?.opens_at.slice(0, 5) ?? "07:00"} required />
        </label>
        <label>
          Closes
          <input type="time" name="closes_at" defaultValue={l?.closes_at.slice(0, 5) ?? "22:00"} required />
        </label>
        <label>
          Slot length
          <select name="slot_minutes" defaultValue={String(l?.slot_minutes ?? 60)}>
            {[30, 60, 90].map((m) => (
              <option key={m} value={m}>{m} minutes</option>
            ))}
          </select>
        </label>
        <label>
          Time zone
          <select name="timezone" defaultValue={l?.timezone ?? "Asia/Bangkok"}>
            {[...new Set([...(l ? [l.timezone] : []), ...TIMEZONES])].map((z) => (
              <option key={z} value={z}>{z.replaceAll("_", " ")}</option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, role, locations, workLocation } = await requireOrg();
  const editable = canManage(role);
  const multi = locations.filter((l) => l.is_active).length > 1;
  const locName = new Map(locations.map((l) => [l.id, l.name]));

  const [{ data: courtData }, { data: pkgData }, { data: ruleData }] = await Promise.all([
    supabase.from("courts").select("*").eq("org_id", org.id).order("sort_order"),
    supabase.from("package_types").select("*").eq("org_id", org.id).order("price"),
    supabase.from("rate_rules").select("*").eq("org_id", org.id).order("priority"),
  ]);
  const courts = (courtData ?? []) as Court[];
  const packages = (pkgData ?? []) as PackageType[];
  const rules = (ruleData ?? []) as RateRule[];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">
            {editable ? "Changes apply straight away." : "Only owners and managers can change settings."}
          </p>
        </div>
      </div>
      <Banner sp={sp} />

      <div className="grid grid-2">
        <div className="stack">
          <section className="card">
            <h2>Club and booking rules</h2>
            <p className="muted small">These apply at every location.</p>
            <form action={updateClub} className="form">
              <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
                <label>
                  Club name
                  <input name="name" defaultValue={org.name} required />
                </label>
                <div className="form-row">
                  <label>
                    Members can book ahead (days)
                    <input type="number" name="booking_advance_days" min="0" max="90" defaultValue={org.booking_advance_days} />
                  </label>
                  <label>
                    Upcoming bookings per member
                    <input type="number" name="max_active_bookings" min="1" max="50" defaultValue={org.max_active_bookings} />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    At risk after (days without a visit)
                    <input type="number" name="at_risk_days" min="1" max="90" defaultValue={org.at_risk_days} />
                  </label>
                  <label>
                    Renewal reminder window (days)
                    <input type="number" name="renewal_window_days" min="1" max="60" defaultValue={org.renewal_window_days} />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Currency
                    <input name="currency" defaultValue={org.currency} maxLength={3} />
                  </label>
                  <label>
                    Default language
                    <select name="default_language" defaultValue={org.default_language}>
                      {LANGUAGES.map((l) => (
                        <option key={l.code} value={l.code}>{l.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button className="primary">Save club settings</button>
              </fieldset>
            </form>
          </section>

          <section className="card">
            <h2>Locations</h2>
            <p className="muted small">
              Each location has its own courts, hours and timetable. Members and packages are shared across the club.
            </p>
            <div className="stack" style={{ marginTop: 10 }}>
              {locations.map((l) => (
                <details key={l.id} className="card" style={{ padding: "10px 14px" }}>
                  <summary style={{ cursor: "pointer" }}>
                    <strong>{l.name}</strong>
                    <span className="muted small">
                      {" "}
                      · {l.opens_at.slice(0, 5)}–{l.closes_at.slice(0, 5)} ·{" "}
                      {courts.filter((c) => c.location_id === l.id && c.is_active).length} courts
                      {l.timezone !== "Asia/Bangkok" ? ` · ${l.timezone}` : ""}
                    </span>
                    {!l.is_active && <span className="badge" style={{ marginLeft: 6 }}>closed</span>}
                  </summary>
                  <form action={updateLocation} className="form" style={{ marginTop: 10 }}>
                    <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
                      <input type="hidden" name="location_id" value={l.id} />
                      <LocationFields l={l} />
                      <button>Save {l.name}</button>
                    </fieldset>
                  </form>
                  {editable && (
                    <form action={toggleLocation} style={{ marginTop: 8 }}>
                      <input type="hidden" name="location_id" value={l.id} />
                      <input type="hidden" name="is_active" value={String(!l.is_active)} />
                      <button className={`link ${l.is_active ? "danger" : ""}`}>
                        {l.is_active ? "Close this location" : "Reopen this location"}
                      </button>
                    </form>
                  )}
                </details>
              ))}
            </div>
            {editable && (
              <details style={{ marginTop: 12 }}>
                <summary className="small" style={{ cursor: "pointer" }}>Add a location</summary>
                <form action={addLocation} className="form" style={{ marginTop: 10 }}>
                  <LocationFields />
                  <button className="primary">Add location</button>
                </form>
              </details>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <h2>Courts</h2>
            {locations.filter((l) => l.is_active).map((l) => {
              const here = courts.filter((c) => c.location_id === l.id);
              return (
                <div key={l.id} style={{ marginBottom: 12 }}>
                  {multi && <h3 style={{ marginTop: 6 }}>{l.name}</h3>}
                  <ul className="list">
                    {here.length === 0 && <li className="muted small">No courts yet.</li>}
                    {here.map((c) => (
                      <li key={c.id}>
                        <span>
                          {c.name}
                          {c.is_covered && <span className="muted small"> · covered</span>}
                          {!c.is_active && <span className="badge" style={{ marginLeft: 6 }}>closed</span>}
                        </span>
                        {editable && (
                          <form action={toggleCourt} className="inline">
                            <input type="hidden" name="court_id" value={c.id} />
                            <input type="hidden" name="is_active" value={String(!c.is_active)} />
                            <button className="link">{c.is_active ? "Close for booking" : "Reopen"}</button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {editable && (
              <form action={addCourt} className="actions" style={{ marginTop: 10 }}>
                <input name="name" placeholder="Court 3" required style={{ maxWidth: 160 }} />
                {multi && (
                  <select name="location_id" defaultValue={workLocation.id} style={{ maxWidth: 170 }} aria-label="Location">
                    {locations.filter((l) => l.is_active).map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                )}
                <label className="check">
                  <input type="checkbox" name="is_covered" /> Covered
                </label>
                <button>Add court</button>
              </form>
            )}
          </section>

          <section className="card">
            <h2>Packages</h2>
            <ul className="list">
              {packages.map((p) => (
                <li key={p.id}>
                  <span>
                    {p.name}
                    <div className="muted small">
                      {p.kind === "time_based" ? `${p.duration_days} days unlimited` : `${p.sessions} sessions`} ·{" "}
                      {formatMoney(p.price, org.currency)}
                      {p.max_active_bookings && ` · ${p.max_active_bookings} bookings at a time`}
                      {multi && ` · ${p.location_ids ? p.location_ids.map((id) => locName.get(id)).join(", ") + " only" : "all locations"}`}
                    </div>
                  </span>
                  <span className="actions">
                    {!p.is_active && <span className="badge">hidden</span>}
                    {editable && (
                      <form action={togglePackage} className="inline">
                        <input type="hidden" name="package_id" value={p.id} />
                        <input type="hidden" name="is_active" value={String(!p.is_active)} />
                        <button className="link">{p.is_active ? "Stop selling" : "Sell again"}</button>
                      </form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {editable && (
              <details style={{ marginTop: 10 }}>
                <summary className="small" style={{ cursor: "pointer" }}>Add a package</summary>
                <form action={addPackage} className="form" style={{ marginTop: 10 }}>
                  <label>
                    Name
                    <input name="name" required placeholder="Low season 2-month" />
                  </label>
                  <div className="form-row">
                    <label>
                      Type
                      <select name="kind" defaultValue="time_based">
                        <option value="time_based">Unlimited for a period</option>
                        <option value="class_pack">Set number of sessions</option>
                      </select>
                    </label>
                    <label>
                      Days (period packages)
                      <input type="number" name="duration_days" min="1" placeholder="60" />
                    </label>
                    <label>
                      Sessions (session packs)
                      <input type="number" name="sessions" min="1" placeholder="10" />
                    </label>
                  </div>
                  <div className="form-row">
                    <label>
                      Price
                      <input type="number" name="price" min="0" required placeholder="6000" />
                    </label>
                    <label>
                      Upcoming bookings allowed (optional)
                      <input type="number" name="max_active_bookings" min="1" placeholder={String(org.max_active_bookings)} />
                    </label>
                  </div>
                  {multi && (
                    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                      <legend className="small muted" style={{ marginBottom: 6 }}>
                        Valid at (leave all unticked for every location)
                      </legend>
                      <div className="actions">
                        {locations.filter((l) => l.is_active).map((l) => (
                          <label key={l.id} className="check">
                            <input type="checkbox" name="location_ids" value={l.id} /> {l.name} only
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  <button>Add package</button>
                </form>
              </details>
            )}
          </section>

          <section className="card">
            <h2>Court prices</h2>
            <p className="muted small">
              {multi ? "A location's own rules come before club-wide ones. " : ""}Lowest priority number wins when rules overlap.
            </p>
            <ul className="list">
              {rules.map((r) => (
                <li key={r.id}>
                  <span>
                    {r.label}
                    <div className="muted small">
                      {multi && `${r.location_id ? locName.get(r.location_id) : "All locations"} · `}
                      {r.days_of_week.length === 7 ? "Every day" : r.days_of_week.map((d) => DAYS[d]).join(", ")} ·{" "}
                      {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)} · drop-in{" "}
                      {formatMoney(r.drop_in_price, org.currency)}, members {formatMoney(r.member_price, org.currency)} ·
                      priority {r.priority}
                    </div>
                  </span>
                  {editable && (
                    <form action={deleteRateRule} className="inline">
                      <input type="hidden" name="rule_id" value={r.id} />
                      <button className="link danger">Remove</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            {editable && (
              <details style={{ marginTop: 10 }}>
                <summary className="small" style={{ cursor: "pointer" }}>Add a price rule</summary>
                <form action={addRateRule} className="form" style={{ marginTop: 10 }}>
                  <div className="form-row">
                    <label>
                      Label
                      <input name="label" required placeholder="Weekend mornings" />
                    </label>
                    {multi && (
                      <label>
                        Location
                        <select name="location_id" defaultValue="">
                          <option value="">All locations</option>
                          {locations.filter((l) => l.is_active).map((l) => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <div className="actions">
                    {DAYS.map((d, i) => (
                      <label key={d} className="check">
                        <input type="checkbox" name="days" value={i} /> {d}
                      </label>
                    ))}
                  </div>
                  <div className="form-row">
                    <label>
                      From
                      <input type="time" name="start_time" required />
                    </label>
                    <label>
                      To
                      <input type="time" name="end_time" required />
                    </label>
                    <label>
                      Priority
                      <input type="number" name="priority" defaultValue={5} />
                    </label>
                  </div>
                  <div className="form-row">
                    <label>
                      Drop-in price
                      <input type="number" name="drop_in_price" min="0" required />
                    </label>
                    <label>
                      Member price
                      <input type="number" name="member_price" min="0" defaultValue={0} />
                    </label>
                  </div>
                  <button>Add price rule</button>
                </form>
              </details>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
