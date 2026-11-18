import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { cookieDomain, requestHost } from "@/lib/tenant";

// Supabase client for Server Components, Server Actions and Route Handlers.
// It acts as the signed-in user, so row-level security applies to every query.
export async function createClient() {
  const cookieStore = await cookies();
  // One sign-in for courtix.app and every club subdomain (see lib/tenant.ts).
  const domain = cookieDomain(requestHost(await headers()));

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: domain ? { domain } : undefined,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component: middleware refreshes the session instead.
          }
        },
      },
    },
  );
}
