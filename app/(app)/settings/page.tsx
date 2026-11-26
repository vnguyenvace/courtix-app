import QRCode from "qrcode";
import { requireOrg, canManage } from "@/lib/org";
import { currentHost } from "@/lib/host";
import { Banner, type SearchParams } from "@/components/Banner";
import { LANGUAGES } from "@/components/MemberFields";
import { formatMoney } from "@/lib/time";
import { brandCss } from "@/lib/brand";
import { secretsConfigured } from "@/lib/secrets";
import { ClubLogo } from "@/components/ClubLogo";
import {
  addCourt,
  addCoverage,
  addLocation,
  addPackage,
  addRateRule,
  deleteRateRule,
  removeCoverage,
  removeLogo,
  saveBrandColors,
  uploadLogo,
  setChatMode,
  connectLine,
  disconnectLine,
  setLineEnabled,
  setOnlineSignupMode,
  setPublicBooking,
  setPriorityDays,
  toggleCourt,
  toggleLocation,
  togglePackage,
  updateClub,
  updateLocation,
} from "../actions";
import { CATEGORY_LABELS, type Court, type Location, type PackageCoverage, type PackageType, type RateRule, type SessionCategory, type SessionType } from "@/lib/types";
import { ASSISTANT_NAME } from "@/lib/assistant";

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

  const [{ data: courtData }, { data: pkgData }, { data: ruleData }, { data: covData }, { data: typeData }] = await Promise.all([
    supabase.from("courts").select("*").eq("org_id", org.id).order("sort_order"),
    supabase.from("package_types").select("*").eq("org_id", org.id).order("price"),
    supabase.from("rate_rules").select("*").eq("org_id", org.id).order("priority"),
    supabase.from("package_coverage").select("*").eq("org_id", org.id).order("created_at"),
    supabase.from("session_types").select("id, name, category").eq("org_id", org.id).eq("is_active", true).order("name"),
  ]);
  const courts = (courtData ?? []) as Court[];
  const packages = (pkgData ?? []) as PackageType[];
  const rules = (ruleData ?? []) as RateRule[];
  const coverage = (covData ?? []) as PackageCoverage[];
  const sessionTypes = (typeData ?? []) as Pick<SessionType, "id" | "name" | "category">[];
  const typeName = new Map(sessionTypes.map((t) => [t.id, t.name]));
  const host = await currentHost();
  const bookingUrl = host.clubUrl(org.slug, "/book");
  // The club's LINE connection (never the encrypted keys: this page doesn't need them).
  const { data: lineData } = await supabase
    .from("messaging_channels")
    .select("id, account_name, account_id, is_enabled, webhook_key, last_event_at")
    .eq("org_id", org.id)
    .eq("provider", "line")
    .maybeSingle();
  const lineChannel = lineData as { account_name: string | null; account_id: string | null; is_enabled: boolean; webhook_key: string; last_event_at: string | null } | null;
  const lineWebhook = lineChannel ? host.rootUrl(`/api/line/${lineChannel.webhook_key}`) : null;
  const canStoreKeys = secretsConfigured();
  const bookingQr = await QRCode.toString(bookingUrl, { type: "svg", margin: 1, width: 180 });

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
                <label>
                  Late cancel cut-off (hours before a session)
                  <input type="number" name="late_cancel_hours" min="0" max="168" defaultValue={org.late_cancel_hours} />
                  <span className="small muted">
                    Cancel earlier and a package credit comes back. Later, or a no-show, and the credit is used.
                  </span>
                </label>
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
            <h2>Booking page</h2>
            <p className="muted small">
              Visitors see your sessions and free court times, and sign up for sessions without an account. They pay at
              the club. Put the link or QR code on flyers, Instagram and WhatsApp.
            </p>
            <div className="actions" style={{ alignItems: "flex-start", marginTop: 8 }}>
              {/* Generated by the qrcode library from our own URL. */}
              <div
                className="qr"
                aria-label={`QR code for ${bookingUrl}`}
                role="img"
                dangerouslySetInnerHTML={{ __html: bookingQr }}
              />
              <div className="stack" style={{ gap: 8, flex: "1 1 200px" }}>
                <a href={bookingUrl} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all" }}>{bookingUrl}</a>
                <span className={`badge ${org.public_booking ? "ok" : ""}`} style={{ justifySelf: "start" }}>
                  {org.public_booking ? "Online sign-ups on" : "Off: page says to book by WhatsApp"}
                </span>
                {editable && (
                  <form action={setPublicBooking}>
                    <input type="hidden" name="on" value={String(!org.public_booking)} />
                    <button>{org.public_booking ? "Turn online booking off" : "Turn online booking on"}</button>
                  </form>
                )}
                <span className="muted small">Hide a session type from the page in Sessions → Set up.</span>
              </div>
            </div>
            <form action={setOnlineSignupMode} className="form" style={{ marginTop: 14 }}>
              <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
                <legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>When someone signs up online</legend>
                <label className="check" style={{ alignItems: "flex-start" }}>
                  <input type="radio" name="mode" value="instant" defaultChecked={org.online_signups !== "approve"} />
                  <span>
                    <strong>They get the spot straight away</strong>
                    <span className="muted small" style={{ display: "block" }}>
                      Booked at once, paid at the club. You can still cancel any that look wrong.
                    </span>
                  </span>
                </label>
                <label className="check" style={{ alignItems: "flex-start" }}>
                  <input type="radio" name="mode" value="approve" defaultChecked={org.online_signups === "approve"} />
                  <span>
                    <strong>Request, staff approve</strong>
                    <span className="muted small" style={{ display: "block" }}>
                      It waits as a request and doesn&apos;t take a spot until someone at the club approves it on the
                      dashboard or the session.
                    </span>
                  </span>
                </label>
                {editable && <button style={{ justifySelf: "start" }}>Save</button>}
              </fieldset>
            </form>
          </section>

          <section className="card" id="messaging">
            <h2>Messaging: LINE</h2>
            <p className="muted small">
              Connect your club&apos;s own LINE Official Account. Messages to it appear in Chats, {ASSISTANT_NAME} answers
              them (see Chat below), and your replies go out on LINE.
            </p>
            {lineChannel ? (
              <div className="stack" style={{ gap: 10, marginTop: 8 }}>
                <div className="actions">
                  <span className={`badge ${lineChannel.is_enabled ? "ok" : ""}`}>
                    {lineChannel.is_enabled ? "Connected" : "Off"}
                  </span>
                  <strong>{lineChannel.account_name ?? "LINE account"}</strong>
                  {lineChannel.account_id && <span className="muted small">{lineChannel.account_id}</span>}
                </div>
                <label className="small">
                  Webhook URL (paste into LINE Developers → Messaging API → Webhook URL, then Verify and turn on Use webhook)
                  <input readOnly value={lineWebhook ?? ""} />
                </label>
                <span className="muted small">
                  {lineChannel.last_event_at
                    ? `Last message from LINE: ${new Date(lineChannel.last_event_at).toLocaleString("en-GB", { timeZone: org.timezone, dateStyle: "medium", timeStyle: "short" })}`
                    : "No messages from LINE yet. After pasting the webhook URL, send your LINE account a message to test."}
                </span>
                {editable && (
                  <div className="actions">
                    <form action={setLineEnabled}>
                      <input type="hidden" name="on" value={String(!lineChannel.is_enabled)} />
                      <button>{lineChannel.is_enabled ? "Turn LINE chats off" : "Turn LINE chats on"}</button>
                    </form>
                    <form action={disconnectLine}>
                      <button className="link danger">Disconnect and delete keys</button>
                    </form>
                  </div>
                )}
              </div>
            ) : (
              <ol className="small steps">
                <li>
                  Create a LINE Official Account for the club (or use yours) and turn on <strong>Messaging API</strong> in
                  LINE Official Account Manager → Settings.
                </li>
                <li>
                  In <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer">LINE Developers</a>, open
                  the channel: copy the <strong>Channel secret</strong> (Basic settings) and issue a{" "}
                  <strong>Channel access token</strong> (Messaging API tab). Paste both below.
                </li>
                <li>Courtix then shows a webhook URL to paste back into the Messaging API tab.</li>
                <li>
                  In LINE Official Account Manager → Response settings, turn off <strong>Auto-response messages</strong>, so
                  members get one answer, not two.
                </li>
              </ol>
            )}
            {editable && (
              <form action={connectLine} className="form" style={{ marginTop: 12 }}>
                {!canStoreKeys && (
                  <div className="banner warn">Courtix can&apos;t store LINE keys yet (CHANNEL_SECRETS_KEY isn&apos;t set).</div>
                )}
                <fieldset disabled={!canStoreKeys} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 10 }}>
                  <label>
                    Channel secret
                    <input name="channel_secret" type="password" autoComplete="off" required placeholder="32 letters and numbers" />
                  </label>
                  <label>
                    Channel access token
                    <input name="access_token" type="password" autoComplete="off" required placeholder="The long token from Messaging API → Issue" />
                  </label>
                  <span className="muted small">Stored encrypted. Nobody can read them back here, not even you.</span>
                  <button className="primary" style={{ justifySelf: "start" }}>
                    {lineChannel ? "Replace keys" : "Connect LINE"}
                  </button>
                </fieldset>
              </form>
            )}
          </section>

          <section className="card" id="chat">
            <h2>Chat</h2>
            <p className="muted small">
              What {ASSISTANT_NAME} may do when members and visitors message the club. Refunds, complaints, private coaching and
              anything unclear always come to you (Chats).
            </p>
            <form action={setChatMode} className="form" style={{ marginTop: 8 }}>
              <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
                <label className="check" style={{ alignItems: "flex-start" }}>
                  <input type="radio" name="mode" value="book" defaultChecked={org.chat_mode !== "answer"} />
                  <span>
                    <strong>Answer and book free places</strong>
                    <span className="muted small" style={{ display: "block" }}>
                      Books sessions and courts that are free or covered by the member&apos;s package. Paid places come
                      to you to confirm.
                    </span>
                  </span>
                </label>
                <label className="check" style={{ alignItems: "flex-start" }}>
                  <input type="radio" name="mode" value="answer" defaultChecked={org.chat_mode === "answer"} />
                  <span>
                    <strong>Answer only</strong>
                    <span className="muted small" style={{ display: "block" }}>
                      Answers questions and suggests options. Every booking comes to you.
                    </span>
                  </span>
                </label>
                {editable && <button style={{ justifySelf: "start" }}>Save</button>}
              </fieldset>
            </form>
          </section>

          <section className="card" id="branding">
            <h2>Logo and colours</h2>
            <p className="muted small">
              Your booking page shows your logo and uses your colours. Upload a logo and Courtix picks the colours from
              it; change them below if they don&apos;t look right.
            </p>
            <div className="actions" style={{ alignItems: "center", margin: "10px 0" }}>
              {org.logo_path ? (
                <ClubLogo path={org.logo_path} name={org.name} />
              ) : (
                <span className="muted small">No logo yet.</span>
              )}
              {editable && org.logo_path && (
                <form action={removeLogo}>
                  <button className="danger">Remove logo</button>
                </form>
              )}
            </div>
            {editable && (
              <form action={uploadLogo} className="form">
                <label>
                  {org.logo_path ? "New logo" : "Logo"}
                  <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" required />
                  <span className="muted small">PNG with a transparent background works best. Up to 4 MB.</span>
                </label>
                <label className="check">
                  <input type="checkbox" name="pick_colors" defaultChecked />
                  Pick colours from the logo
                </label>
                <button className="primary" style={{ justifySelf: "start" }}>Upload logo</button>
              </form>
            )}

            <form action={saveBrandColors} className="form" style={{ marginTop: 16 }}>
              <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 10 }}>
                <legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Colours</legend>
                {org.brand_palette.length > 0 && (
                  <div className="stack" style={{ gap: 4 }}>
                    <span className="muted small">Found in your logo:</span>
                    <div className="swatches">
                      {org.brand_palette.map((c) => (
                        <span key={c} className="swatch" style={{ background: c }} title={c} />
                      ))}
                    </div>
                  </div>
                )}
                <datalist id="brand-swatches">
                  {org.brand_palette.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <div className="actions">
                  <label>
                    Main colour
                    <input type="color" name="brand_primary" list="brand-swatches" defaultValue={org.brand_primary ?? "#0f6e56"} />
                    <span className="muted small">Buttons and links</span>
                  </label>
                  <label>
                    Second colour
                    <input
                      type="color"
                      name="brand_secondary"
                      list="brand-swatches"
                      defaultValue={org.brand_secondary ?? org.brand_primary ?? "#0f6e56"}
                    />
                    <span className="muted small">Top stripe and session times</span>
                  </label>
                </div>
                <div className="brand-preview" aria-label="Preview of your booking page">
                  {/* Only validated #rrggbb values reach brandCss. */}
                  <style dangerouslySetInnerHTML={{ __html: brandCss(org.brand_primary, org.brand_secondary, ".brand-preview") }} />
                  <div className="row">
                    <ClubLogo path={org.logo_path} name={org.name} small />
                    <strong>{org.name}</strong>
                  </div>
                  <div className="row">
                    <span className="public-time">18:00</span>
                    <span className="tabs" style={{ margin: 0 }}><span className="active">Sessions</span><span>Court times</span></span>
                  </div>
                  <div className="row">
                    <span className="button primary">Sign up</span>
                    <a href={bookingUrl} target="_blank" rel="noreferrer">See your booking page</a>
                  </div>
                </div>
                {editable && (
                  <div className="actions">
                    <button className="primary">Save colours</button>
                    {org.brand_primary && (
                      <button name="reset" value="true">Use standard Courtix colours</button>
                    )}
                  </div>
                )}
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
                      {p.priority_days > 0 && ` · signs up ${p.priority_days} ${p.priority_days === 1 ? "day" : "days"} early`}
                    </div>
                    <div className="small">
                      {coverageSummary(coverage.filter((c) => c.package_type_id === p.id), typeName)}
                    </div>
                    {editable && (
                      <CoverageEditor
                        pkg={p}
                        rules={coverage.filter((c) => c.package_type_id === p.id)}
                        typeName={typeName}
                        sessionTypes={sessionTypes}
                      />
                    )}
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
                    <label>
                      Priority booking (days early)
                      <input type="number" name="priority_days" min="0" max="30" defaultValue={0} />
                    </label>
                  </div>
                  <p className="muted small">After adding it, open the package to choose which sessions it covers.</p>
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

// ---------------------------------------------------------------- Package coverage

function hhmm(t: string | null) {
  return t ? t.slice(0, 5) : "";
}

function ruleText(c: PackageCoverage, typeName: Map<string, string>) {
  const what = c.session_type_id
    ? typeName.get(c.session_type_id) ?? "A session type"
    : c.category
      ? CATEGORY_LABELS[c.category]
      : "Every session";
  const days = c.days_of_week ? ` on ${c.days_of_week.map((d) => DAYS[d]).join(", ")}` : "";
  const time = c.start_time ? ` starting ${hhmm(c.start_time)}–${hhmm(c.end_time)}` : "";
  return what + days + time;
}

function coverageSummary(rules: PackageCoverage[], typeName: Map<string, string>) {
  if (rules.length === 0) return <span className="muted">Covers court booking only, no sessions.</span>;
  return <span>Covers: {rules.map((c) => ruleText(c, typeName)).join("; ")}</span>;
}

function CoverageEditor({
  pkg,
  rules,
  typeName,
  sessionTypes,
}: {
  pkg: PackageType;
  rules: PackageCoverage[];
  typeName: Map<string, string>;
  sessionTypes: Pick<SessionType, "id" | "name" | "category">[];
}) {
  const categories = Object.keys(CATEGORY_LABELS) as SessionCategory[];
  return (
    <details style={{ marginTop: 6 }}>
      <summary className="small" style={{ cursor: "pointer", color: "var(--accent)" }}>Sessions it covers</summary>
      <div className="stack" style={{ marginTop: 8, gap: 10 }}>
        <p className="muted small">
          {pkg.kind === "class_pack"
            ? "Signing up for a covered session uses 1 credit. Other sessions cost the drop-in price."
            : "Covered sessions are free for members with this package. Other sessions cost the drop-in price."}
        </p>
        {rules.length > 0 && (
          <ul className="list">
            {rules.map((c) => (
              <li key={c.id}>
                <span>{ruleText(c, typeName)}</span>
                <form action={removeCoverage} className="inline">
                  <input type="hidden" name="coverage_id" value={c.id} />
                  <button className="link danger">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addCoverage} className="form">
          <input type="hidden" name="package_id" value={pkg.id} />
          <label>
            Covers
            <select name="what" defaultValue="cat:open_play">
              <option value="all">Every session</option>
              <optgroup label="All sessions of a kind">
                {categories.map((c) => (
                  <option key={c} value={`cat:${c}`}>{CATEGORY_LABELS[c]}</option>
                ))}
              </optgroup>
              {sessionTypes.length > 0 && (
                <optgroup label="One session type">
                  {sessionTypes.map((t) => (
                    <option key={t.id} value={`type:${t.id}`}>{t.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <div className="actions">
            {DAYS.map((d, i) => (
              <label key={d} className="check">
                <input type="checkbox" name="days" value={i} /> {d}
              </label>
            ))}
          </div>
          <div className="form-row">
            <label>
              Starting from (optional)
              <input type="time" name="start_time" />
            </label>
            <label>
              Until
              <input type="time" name="end_time" />
            </label>
          </div>
          <p className="muted small">Leave days unticked for every day, and times empty for any time.</p>
          <button>Add rule</button>
        </form>
        <form action={setPriorityDays} className="actions">
          <input type="hidden" name="package_id" value={pkg.id} />
          <label style={{ flex: "1 1 200px" }}>
            Priority booking (days early)
            <input type="number" name="priority_days" min="0" max="30" defaultValue={pkg.priority_days} />
          </label>
          <button style={{ alignSelf: "flex-end" }}>Save</button>
        </form>
      </div>
    </details>
  );
}
