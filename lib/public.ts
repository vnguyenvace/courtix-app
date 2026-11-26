import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { currentHost } from "@/lib/host";
import { createClient } from "@/lib/supabase/server";
import type { SessionCategory } from "@/lib/types";

// The public booking page (<slug>.courtix.app/book). Visitors aren't signed in, so every
// read and write goes through the public_* database functions, never tables (see
// supabase/migrations/20261118050000_public_booking.sql).

export interface PublicLocation {
  id: string;
  name: string;
  address: string | null;
  whatsapp: string | null;
  timezone: string;
  opens_at: string;
  closes_at: string;
  slot_minutes: number;
}

export interface PublicClub {
  id: string;
  name: string;
  currency: string;
  public_booking: boolean;
  online_signups: "instant" | "approve"; // approve = sign-ups wait for staff
  logo_path: string | null;
  brand_primary: string | null;
  brand_secondary: string | null;
  locations: PublicLocation[];
}

export interface PublicSession {
  id: string;
  location_id: string;
  location_name: string;
  location_timezone: string;
  name: string;
  category: SessionCategory;
  description: string | null;
  starts_at: string;
  ends_at: string;
  price: number;
  max_players: number;
  spots_left: number;
  level_min: number | null;
  level_max: number | null;
  min_age: number | null;
  coach_name: string | null;
  book_by: string;
  signups_open_at: string | null;
}

export interface PublicCourtSlot {
  court_id: string;
  court_name: string;
  slot_start: string;
  slot_end: string;
  is_free: boolean;
}

/** The club behind this subdomain, or a 404. Cached per request (layout, metadata and page share it). */
export const loadPublicClub = cache(async () => {
  const host = await currentHost();
  if (host.kind !== "club") notFound();
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_club", { p_slug: host.slug });
  if (!data) notFound();
  return { supabase, slug: host.slug, club: data as PublicClub };
});

/** Where a session stands for a visitor right now. */
export function sessionState(s: PublicSession, now = Date.now()) {
  if (s.signups_open_at && new Date(s.signups_open_at).getTime() > now) return "not_open" as const;
  if (new Date(s.book_by).getTime() <= now) return "closed" as const;
  if (s.spots_left === 0) return "full" as const;
  return "open" as const;
}
