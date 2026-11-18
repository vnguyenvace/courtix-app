// Which club a request is for, from its host name.
//
//   raccoon.courtix.app      → club "raccoon"
//   courtix.app, www.…       → the main site (sign-up, sign-in, onboarding)
//   anything else            → "other": Vercel preview URLs, a LAN IP for phone testing.
//                              These fall back to the club cookie, like before subdomains.
//
// ROOT_DOMAIN is courtix.app in production and courtix.localhost locally
// (Chrome resolves *.localhost to this computer, so raccoon.courtix.localhost:3000 just works).
// The sign-in cookie is set on ROOT_DOMAIN, so one sign-in works on every club subdomain.
// Which club someone may see is still decided by the database (RLS), never by the host.

export const ROOT_DOMAIN = (process.env.ROOT_DOMAIN || "courtix.localhost").toLowerCase();

export type HostInfo =
  | { kind: "club"; slug: string }
  | { kind: "root" }
  | { kind: "other" };

/**
 * The host the visitor actually used. Prefer x-forwarded-host: Vercel sets it, and Next.js
 * passes it along when it renders the page after a server action's redirect (that internal
 * request goes to the server's own address, so its Host header is not the club's).
 */
export function requestHost(headers: { get(name: string): string | null }): string | null {
  return headers.get("x-forwarded-host")?.split(",")[0].trim() || headers.get("host");
}

function hostname(host: string | null | undefined): string {
  return (host ?? "").toLowerCase().trim().replace(/:\d+$/, "");
}

export function parseHost(host: string | null | undefined): HostInfo {
  const h = hostname(host);
  if (h === ROOT_DOMAIN || h === `www.${ROOT_DOMAIN}`) return { kind: "root" };
  if (h.endsWith(`.${ROOT_DOMAIN}`)) {
    const sub = h.slice(0, -(ROOT_DOMAIN.length + 1));
    // Only one level: a.b.courtix.app isn't a club.
    if (/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])$/.test(sub)) return { kind: "club", slug: sub };
    return { kind: "root" };
  }
  return { kind: "other" };
}

/** Cookie domain for the sign-in session: shared across subdomains on our own domain. */
export function cookieDomain(host: string | null | undefined): string | undefined {
  return parseHost(host).kind === "other" ? undefined : ROOT_DOMAIN;
}

function portOf(host: string | null | undefined): string {
  const m = (host ?? "").match(/:(\d+)$/);
  return m ? `:${m[1]}` : "";
}

/** http locally, https everywhere else (courtix.app is HTTPS-only). */
function protocolFor(host: string | null | undefined, forwardedProto?: string | null): string {
  if (forwardedProto) return forwardedProto.split(",")[0].trim();
  return hostname(host).endsWith("localhost") ? "http" : "https";
}

/** Full address of a page on a club's subdomain, keeping the current port (local dev). */
export function clubUrl(slug: string, path: string, currentHost: string | null, forwardedProto?: string | null): string {
  return `${protocolFor(currentHost, forwardedProto)}://${slug}.${ROOT_DOMAIN}${portOf(currentHost)}${path}`;
}

/** Full address of a page on the main site. */
export function rootUrl(path: string, currentHost: string | null, forwardedProto?: string | null): string {
  return `${protocolFor(currentHost, forwardedProto)}://${ROOT_DOMAIN}${portOf(currentHost)}${path}`;
}
