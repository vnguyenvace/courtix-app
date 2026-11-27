import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { cookieDomain, requestHost } from "@/lib/tenant";

// /book: the public booking page on a club subdomain (no sign-in; data comes from public_* functions).
// "/" is the club's public front page (app/page.tsx); on the main site it redirects to /dashboard,
// which is protected as before.
// /api/cron: scheduled jobs, protected by CRON_SECRET in the route itself (no user session).
// /api/line: LINE webhooks, protected by LINE's signature with the club's channel secret.
// /guides: help pages for club owners (no sign-in, so they can be sent to new clubs).
// /privacy, /terms: legal pages, readable by anyone on any Courtix address.
// /join: staff invite links (the person may not have an account yet).
const PUBLIC_PATHS = ["/login", "/auth", "/book", "/guides", "/privacy", "/terms", "/join", "/api/cron", "/api/line"];

// Keeps the Supabase session fresh and sends signed-out visitors to /login.
export async function updateSession(request: NextRequest) {
  // The page path, for server code (the support view log). Set on every forwarded request.
  const forward = () => {
    const h = new Headers(request.headers);
    h.set("x-pathname", request.nextUrl.pathname);
    h.set("x-request-method", request.method);
    return NextResponse.next({ request: { headers: h } });
  };
  let response = forward();
  // One sign-in for courtix.app and every club subdomain (see lib/tenant.ts).
  const domain = cookieDomain(requestHost(request.headers));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: domain ? { domain } : undefined,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = forward();
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Don't put code between createServerClient and getUser: it refreshes the token.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = path === "/" || PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
