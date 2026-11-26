import { logoUrl } from "@/lib/brand";

/** The club's uploaded logo, or nothing. Plain <img>: the file is already a small PNG in Storage. */
export function ClubLogo({ path, name, small }: { path: string | null; name: string; small?: boolean }) {
  const src = logoUrl(path);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={`${name} logo`} className={`club-logo${small ? " small" : ""}`} />;
}
