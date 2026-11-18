import "server-only";
import { headers } from "next/headers";
import { clubUrl, parseHost, requestHost, rootUrl, type HostInfo } from "./tenant";

/** The current request's host, what it points at, and URL builders that keep its protocol and port. */
export async function currentHost(): Promise<
  HostInfo & { host: string | null; clubUrl: (slug: string, path: string) => string; rootUrl: (path: string) => string }
> {
  const h = await headers();
  const host = requestHost(h);
  const proto = h.get("x-forwarded-proto");
  return {
    ...parseHost(host),
    host,
    clubUrl: (slug, path) => clubUrl(slug, path, host, proto),
    rootUrl: (path) => rootUrl(path, host, proto),
  };
}
