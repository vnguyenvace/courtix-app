import { Banner, type SearchParams } from "@/components/Banner";
import { requirePlatform } from "@/lib/platform";

interface ClubRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  owner_email: string | null;
  members: number;
  staff: number;
  locations: number;
  bookings_30d: number;
  sessions_30d: number;
  support_until: string | null;
}

const fmt = (iso: string, time = false) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    ...(time ? { hour: "2-digit", minute: "2-digit" } : { year: "numeric" }),
  });

export default async function AdminClubsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, role, host, t, locale } = await requirePlatform();
  const { data, error } = await supabase.rpc("platform_clubs");
  if (error) throw new Error(error.message);
  const clubs = (data ?? []) as ClubRow[];
  const canSupport = role === "super_admin" || role === "support";
  const showOwner = role !== "marketing";
  const sum = (k: "members" | "bookings_30d" | "sessions_30d") => clubs.reduce((n, c) => n + Number(c[k]), 0);

  const { data: logData } =
    role === "super_admin"
      ? await supabase.from("support_access_log").select("id, org_id, email, path, viewed_at").order("viewed_at", { ascending: false }).limit(20)
      : { data: [] };
  const log = (logData ?? []) as { id: number; org_id: string; email: string | null; path: string | null; viewed_at: string }[];
  const clubName = new Map(clubs.map((c) => [c.id, c.name]));

  return (
    <>
      <h1>{t("Clubs")}</h1>
      <Banner sp={sp} />
      <div className="stats" style={{ margin: "12px 0 18px" }}>
        <div className="stat"><div className="label">{t("Clubs")}</div><div className="value">{clubs.length}</div></div>
        <div className="stat"><div className="label">{t("Members")}</div><div className="value">{sum("members")}</div></div>
        <div className="stat"><div className="label">{t("Court bookings, 30 days")}</div><div className="value">{sum("bookings_30d")}</div></div>
        <div className="stat"><div className="label">{t("Session sign-ups, 30 days")}</div><div className="value">{sum("sessions_30d")}</div></div>
      </div>

      <section className="card table-wrap" style={{ marginBottom: 18 }}>
        <table>
          <thead>
            <tr>
              <th>{t("Club")}</th>
              <th>{t("Since")}</th>
              {showOwner && <th>{t("Owner")}</th>}
              <th>{t("Members")}</th>
              <th>{t("Staff")}</th>
              <th>{t("Sites")}</th>
              <th>{t("Bookings, 30 days")}</th>
              <th>{t("Sign-ups, 30 days")}</th>
              <th>{t("Support access")}</th>
            </tr>
          </thead>
          <tbody>
            {clubs.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                  <div className="small">
                    <a href={host.clubUrl(c.slug, "/")} target="_blank" rel="noreferrer">{c.slug}</a>
                  </div>
                </td>
                <td>{fmt(c.created_at)}</td>
                {showOwner && <td className="small">{c.owner_email ?? "—"}</td>}
                <td>{c.members}</td>
                <td>{c.staff}</td>
                <td>{c.locations}</td>
                <td>{c.bookings_30d}</td>
                <td>{c.sessions_30d}</td>
                <td className="small">
                  {c.support_until ? (
                    <>
                      {t("Allowed until {fmt}", { fmt: fmt(c.support_until, true) })}
                      {canSupport && (
                        <div>
                          <a href={host.clubUrl(c.slug, "/dashboard")}>{t("Open (read only)")}</a>
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="muted">{t("Not allowed")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {canSupport && (
          <p className="muted small" style={{ marginTop: 8 }}>
            {t("To look inside a club, ask its owner to allow Courtix support in Staff → Courtix support access. You can only view, and the owner sees every page you open. Times are Thailand time.")}
          </p>
        )}
      </section>

      {role === "super_admin" && log.length > 0 && (
        <section className="card">
          <h2>{t("Recent support views")}</h2>
          <ul className="list small">
            {log.map((l) => (
              <li key={l.id}>
                {fmt(l.viewed_at, true)} · {l.email ?? "?"} · {clubName.get(l.org_id) ?? "?"} · {l.path ?? "page"}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
