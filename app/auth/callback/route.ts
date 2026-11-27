import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Email confirmation links land here and get swapped for a session.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const { searchParams } = url;
  // The address the person used (behind a proxy, request.url can be the server's own address,
  // and the sign-in cookie wouldn't reach it).
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const origin = `${proto}://${host}`;
  const code = searchParams.get("code");
  // Where to go afterwards: only a path on this site (e.g. a staff invite, /join/...).
  const nextParam = searchParams.get("next") ?? "";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") && !nextParam.includes("\\") ? nextParam : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("That link didn't work. Try signing in.")}`);
}
