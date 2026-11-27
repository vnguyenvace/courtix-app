import Link from "next/link";
import { requireOrg } from "@/lib/org";
import { Banner, param, type SearchParams } from "@/components/Banner";
import { MemberBadges, lastVisitText } from "@/components/MemberBadges";
import { formatDate } from "@/lib/time";
import { checkIn } from "../actions";
import type { MemberStatus } from "@/lib/types";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "at_risk", label: "At risk" },
  { key: "renewing", label: "Renewing soon" },
  { key: "paused", label: "Paused" },
  { key: "leads", label: "Drop-in leads" },
];

export default async function MembersPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = param(sp, "q")?.trim() ?? "";
  const filter = param(sp, "filter") ?? "all";
  const { supabase, org, can } = await requireOrg();

  let query = supabase.from("member_status").select("*").eq("org_id", org.id).order("full_name");
  if (q) query = query.ilike("full_name", `%${q.replace(/[%_]/g, "")}%`);
  if (filter === "active") query = query.eq("membership_status", "active");
  if (filter === "at_risk") query = query.eq("is_at_risk", true);
  if (filter === "renewing") query = query.eq("is_renewing_soon", true);
  if (filter === "paused") query = query.eq("membership_status", "paused");
  if (filter === "leads") query = query.eq("is_drop_in_lead", true);

  const { data, error } = await query;
  const rows = (data ?? []) as MemberStatus[];
  const returnTo = `/members?filter=${filter}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Members</h1>
          <p className="muted">{rows.length} shown</p>
        </div>
        <div className="actions">
          {can("club.setup") && <Link className="button" href="/members/import">Import from a spreadsheet</Link>}
          <Link className="button primary" href="/members/new">Add member</Link>
        </div>
      </div>
      <Banner sp={sp} />
      {error && <div className="banner error">{error.message}</div>}

      <form className="actions" style={{ marginBottom: 14 }}>
        <input name="q" defaultValue={q} placeholder="Search by name" style={{ maxWidth: 260 }} />
        <input type="hidden" name="filter" value={filter} />
        <button>Search</button>
      </form>
      <div className="actions" style={{ marginBottom: 14 }}>
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/members?filter=${f.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`badge ${f.key === filter ? "ok" : ""}`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="card table-wrap">
        {rows.length === 0 ? (
          <p className="muted">No members match.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Package</th>
                <th>Ends</th>
                <th>Last visit</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.member_id}>
                  <td>
                    <Link href={`/members/${s.member_id}`}>{s.full_name}</Link>
                    <div className="muted small">{s.language.toUpperCase()}{s.phone ? ` · ${s.phone}` : ""}</div>
                  </td>
                  <td>{s.package_name ?? <span className="muted">—</span>}</td>
                  <td>
                    {s.sessions_left !== null ? `${s.sessions_left} sessions left` : formatDate(s.ends_on)}
                  </td>
                  <td className="muted">{lastVisitText(s.days_since_visit)}</td>
                  <td><MemberBadges s={s} /></td>
                  <td>
                    <form action={checkIn} className="inline">
                      <input type="hidden" name="member_id" value={s.member_id} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <button>Check in</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
