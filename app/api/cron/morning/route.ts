import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { draftAndSave, type Candidate } from "@/lib/followups";
import { serviceClient } from "@/lib/supabase/service";
import { todayIn } from "@/lib/time";
import type { Org } from "@/lib/types";

// The morning job (Step 9b): writes each club's follow-up drafts for the owner to approve on
// /morning. Vercel Cron calls it once a day (vercel.json), sending CRON_SECRET as a bearer token.
// It runs as the service identity (no user is signed in at 6 am), so every query below names
// the club explicitly. Each club is claimed for its local date first, so a second run the same
// day (a retry, or someone calling it twice) writes nothing new.

export const dynamic = "force-dynamic";
export const maxDuration = 300; // seconds; drafting for many clubs takes a while

const PER_CLUB = 20;

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
  const { data: orgs, error } = await db.from("orgs").select("*").eq("morning_drafts", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: { club: string; drafts?: number; skipped?: string; errors?: string[] }[] = [];
  for (const org of (orgs ?? []) as Org[]) {
    const today = todayIn(org.timezone);
    // Claim today for this club (only one run per club per local day).
    const { data: claimed } = await db
      .from("orgs")
      .update({ morning_run_on: today })
      .eq("id", org.id)
      .or(`morning_run_on.is.null,morning_run_on.lt.${today}`)
      .select("id");
    if (!claimed?.length) {
      results.push({ club: org.slug, skipped: "already ran today" });
      continue;
    }
    try {
      const { data, error: candErr } = await db.rpc("followup_candidates", { p_org: org.id, p_limit: PER_CLUB });
      if (candErr) throw new Error(candErr.message);
      const { saved, errors } = await draftAndSave(db, org, (data ?? []) as Candidate[]);
      results.push({ club: org.slug, drafts: saved, ...(errors.length ? { errors } : {}) });
    } catch (e) {
      // Let a later run retry this club today.
      await db.from("orgs").update({ morning_run_on: null }).eq("id", org.id);
      results.push({ club: org.slug, errors: [e instanceof Error ? e.message : String(e)] });
    }
  }
  return NextResponse.json({ ran_at: new Date().toISOString(), clubs: results });
}
