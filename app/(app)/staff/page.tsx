import { cookies } from "next/headers";
import { Banner, type SearchParams } from "@/components/Banner";
import { CopyButton } from "@/components/CopyButton";
import { requirePermission } from "@/lib/org";
import { INVITE_LINK_COOKIE, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from "@/lib/permissions";
import type { Location, StaffRole } from "@/lib/types";
import { cancelInvite, inviteStaff, removeStaff, renewInvite, updateStaff } from "./actions";

interface StaffRow {
  user_id: string;
  email: string;
  role: StaffRole;
  location_ids: string[] | null;
  created_at: string;
}

interface InviteRow {
  id: string;
  email: string;
  role: StaffRole;
  location_ids: string[] | null;
  expires_at: string;
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function Locations({ locations, chosen, role }: { locations: Location[]; chosen: string[] | null; role?: StaffRole }) {
  if (role === "owner" || role === "manager") return null;
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="small muted" style={{ marginBottom: 6 }}>
        Works at (leave all unticked for every location; owners and admins always have every location)
      </legend>
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

export default async function StaffPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, userId, locations, multiLocation } = await requirePermission("staff.manage");
  const active = locations.filter((l) => l.is_active);
  const locName = new Map(locations.map((l) => [l.id, l.name]));

  const [{ data: staffData, error }, { data: inviteData }] = await Promise.all([
    supabase.rpc("club_staff", { p_org: org.id }),
    supabase
      .from("staff_invites")
      .select("id, email, role, location_ids, expires_at")
      .eq("org_id", org.id)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);
  if (error) throw new Error(error.message);
  const staff = (staffData ?? []) as StaffRow[];
  const invites = (inviteData ?? []) as InviteRow[];

  let justInvited: { email: string; link: string; emailed: boolean } | null = null;
  try {
    const raw = (await cookies()).get(INVITE_LINK_COOKIE)?.value;
    if (raw) justInvited = JSON.parse(raw);
  } catch {
    justInvited = null;
  }
  const where = (ids: string[] | null) => (ids ? ids.map((id) => locName.get(id) ?? "?").join(", ") : "All locations");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Staff and roles</h1>
          <p className="muted">Who can sign in to {org.name}, and what each person can do.</p>
        </div>
      </div>
      <Banner sp={sp} />

      {justInvited && invites.some((i) => i.email === justInvited!.email) && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2>Invite link for {justInvited.email}</h2>
          <p className="muted small">
            {justInvited.emailed ? "We emailed this link. You can also send it on LINE or WhatsApp. " : "Send this link on LINE, WhatsApp or email. "}
            It works for 7 days, only for {justInvited.email}. It&apos;s shown here only for a few minutes; make a new link any
            time below.
          </p>
          <div className="form" style={{ marginTop: 8 }}>
            <textarea id="invite-link" readOnly rows={2} defaultValue={justInvited.link} />
            <div className="actions">
              <CopyButton targetId="invite-link" />
            </div>
          </div>
        </section>
      )}

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Staff</h2>
        <ul className="list">
          {staff.map((s) => (
            <li key={s.user_id} style={{ display: "grid", gap: 8 }}>
              <div>
                <strong>{s.email}</strong>
                {s.user_id === userId && <span className="muted small"> (you)</span>}
                <div className="muted small">
                  {ROLE_LABELS[s.role]}
                  {multiLocation && ` · ${s.role === "owner" || s.role === "manager" ? "All locations" : where(s.location_ids)}`}
                  {` · since ${dateFmt.format(new Date(s.created_at))}`}
                </div>
              </div>
              <details>
                <summary className="small">Change role</summary>
                <form action={updateStaff} className="form" style={{ marginTop: 8 }}>
                  <input type="hidden" name="user_id" value={s.user_id} />
                  <label>
                    Role
                    <select name="role" defaultValue={s.role}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  </label>
                  {multiLocation && <Locations locations={active} chosen={s.location_ids} />}
                  <div className="actions">
                    <button>Save</button>
                  </div>
                </form>
                <form action={removeStaff} className="form" style={{ marginTop: 8 }}>
                  <input type="hidden" name="user_id" value={s.user_id} />
                  <button className="danger">{s.user_id === userId ? "Leave this club" : "Remove from staff"}</button>
                </form>
              </details>
            </li>
          ))}
        </ul>
      </section>

      {invites.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2>Waiting to join</h2>
          <ul className="list">
            {invites.map((i) => {
              const expired = new Date(i.expires_at).getTime() < Date.now();
              return (
                <li key={i.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong>{i.email}</strong>
                    <div className="muted small">
                      {ROLE_LABELS[i.role]}
                      {multiLocation && ` · ${where(i.location_ids)}`}
                      {" · "}
                      {expired ? "link expired" : `link works until ${dateFmt.format(new Date(i.expires_at))}`}
                    </div>
                  </div>
                  <div className="actions">
                    <form action={renewInvite} className="inline">
                      <input type="hidden" name="invite_id" value={i.id} />
                      <button>New link</button>
                    </form>
                    <form action={cancelInvite} className="inline">
                      <input type="hidden" name="invite_id" value={i.id} />
                      <button className="link">Cancel</button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Add someone</h2>
        <form action={inviteStaff} className="form">
          <label>
            Email
            <input name="email" type="email" required autoComplete="off" placeholder="nong@yourclub.com" />
          </label>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
            <legend className="small muted" style={{ marginBottom: 6 }}>Role</legend>
            {ROLES.map((r) => (
              <label key={r} className="check" style={{ alignItems: "flex-start" }}>
                <input type="radio" name="role" value={r} defaultChecked={r === "front_desk"} />
                <span>
                  <strong>{ROLE_LABELS[r]}</strong>
                  <span className="muted small" style={{ display: "block" }}>{ROLE_DESCRIPTIONS[r]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {multiLocation && <Locations locations={active} chosen={null} />}
          <div className="actions">
            <button className="primary">Add to staff</button>
          </div>
          <p className="muted small">
            They get a link to join. They sign in, or create an account, with this email address. Location limits don&apos;t
            apply to owners and admins.
          </p>
        </form>
      </section>
    </>
  );
}
