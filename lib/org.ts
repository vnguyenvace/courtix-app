import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentHost } from "@/lib/host";
import type { Location, Org, StaffRole } from "@/lib/types";

export const ORG_COOKIE = "club_id";
export const LOCATION_COOKIE = "location_id";

export interface OrgContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string | null;
  org: Org;
  role: StaffRole;
  clubs: { id: string; name: string; slug: string }[];
  /** Every location in the club, active first. */
  locations: Location[];
  /** Locations this person can make changes at (owners and managers: all). */
  myLocations: Location[];
  /** The location picked in the sidebar, or null for "All locations". */
  location: Location | null;
  /** A concrete location for pages that need one (court calendar): the picked one, or the first of mine. */
  workLocation: Location;
  multiLocation: boolean;
}

/**
 * Loads the signed-in user, the club they're working in, and its locations.
 *
 * Which club: on a club subdomain (raccoon.courtix.app) it's that club, if this person is
 * on its staff; otherwise "no access" (or "not found" for an unknown subdomain). On the main
 * site (courtix.app) we send them to their club's subdomain. On other hosts (preview URLs,
 * a LAN IP) the club cookie decides, as before subdomains. The location is a cookie.
 * Sends people with no club to onboarding.
 */
export async function requireOrg(): Promise<OrgContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rows, error } = await supabase
    .from("org_staff")
    .select("role, location_ids, orgs(*)")
    .eq("user_id", user.id)
    .order("created_at");

  if (error) throw new Error(error.message);

  const memberships = (rows ?? []) as unknown as { role: StaffRole; location_ids: string[] | null; orgs: Org }[];
  const host = await currentHost();
  const jar = await cookies();
  const chosen = jar.get(ORG_COOKIE)?.value;

  let current: (typeof memberships)[number] | undefined;
  if (host.kind === "club") {
    current = memberships.find((m) => m.orgs.slug === host.slug);
    if (!current) {
      const { data: club } = await supabase.rpc("club_by_slug", { p_slug: host.slug });
      if (!club || club.length === 0) notFound();
      redirect("/no-access");
    }
  } else {
    if (memberships.length === 0) redirect("/onboarding");
    current = memberships.find((m) => m.orgs.id === chosen) ?? memberships[0];
    // The main site isn't a club: go to this person's club subdomain.
    if (host.kind === "root") redirect(host.clubUrl(current.orgs.slug, "/dashboard"));
  }

  const { data: locData, error: locError } = await supabase
    .from("locations")
    .select("*")
    .eq("org_id", current.orgs.id)
    .order("is_active", { ascending: false })
    .order("sort_order")
    .order("name");
  if (locError) throw new Error(locError.message);

  const locations = (locData ?? []) as Location[];
  const active = locations.filter((l) => l.is_active);
  const limited = !canManage(current.role) && current.location_ids !== null;
  const myLocations = limited ? active.filter((l) => current.location_ids!.includes(l.id)) : active;

  // "all" or a location id. Staff limited to one site always work there.
  const picked = jar.get(LOCATION_COOKIE)?.value;
  let location: Location | null = locations.find((l) => l.id === picked) ?? null;
  if (!location && active.length === 1) location = active[0];
  if (!location && limited && myLocations.length === 1) location = myLocations[0];

  const workLocation = location ?? myLocations[0] ?? active[0] ?? locations[0];

  return {
    supabase,
    userId: user.id,
    email: user.email ?? null,
    org: current.orgs,
    role: current.role,
    clubs: memberships.map((m) => ({ id: m.orgs.id, name: m.orgs.name, slug: m.orgs.slug })),
    locations,
    myLocations,
    location,
    workLocation,
    multiLocation: active.length > 1,
  };
}

export function canManage(role: StaffRole) {
  return role === "owner" || role === "manager";
}
