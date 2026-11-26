import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The service identity: full database access, no user, no RLS. ONLY for scheduled jobs
// (app/api/cron/*), which check CRON_SECRET first. Never import this in pages or server
// actions: those must act as the signed-in user so RLS applies.

export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY isn't set, so scheduled jobs can't run.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
