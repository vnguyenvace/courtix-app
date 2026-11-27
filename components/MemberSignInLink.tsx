"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/** "Member sign in" that brings the member back to the page they were on (with what they had picked). */
export function MemberSignInLink() {
  const pathname = usePathname();
  const params = useSearchParams();
  if (pathname.startsWith("/book/me")) return <Link href="/book/me">Member sign in</Link>;
  const q = new URLSearchParams(params.toString());
  q.delete("error");
  q.delete("notice");
  const here = pathname + (q.size ? `?${q.toString()}` : "");
  return <Link href={`/book/me?next=${encodeURIComponent(here)}`}>Member sign in</Link>;
}
