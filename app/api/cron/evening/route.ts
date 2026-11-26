import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendPendingNotices } from "@/lib/notices";
import { serviceClient } from "@/lib/supabase/service";

// The evening job: queues tomorrow's booking reminders and package-ending notices for every
// club (queue_evening_notices; each is queued once, so a rerun adds nothing), then sends them.
// Vercel Cron calls it daily at 11:00 UTC = 18:00 in Phuket (vercel.json), with CRON_SECRET.
// Runs as the service identity: every query names the club.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const db = serviceClient();
  const { data: orgs, error } = await db.from("orgs").select("id, slug, auto_notices");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const clubs: Record<string, unknown>[] = [];
  for (const org of (orgs ?? []) as { id: string; slug: string; auto_notices: string[] }[]) {
    if (!org.auto_notices?.length) continue;
    const { data: queued, error: qErr } = await db.rpc("queue_evening_notices", { p_org: org.id });
    const sent = await sendPendingNotices(db, org.id);
    clubs.push({ club: org.slug, queued: qErr ? qErr.message : queued, ...sent });
  }
  return NextResponse.json({ ran_at: new Date().toISOString(), clubs });
}
