import type { Metadata } from "next";
import { brandCss, logoUrl } from "@/lib/brand";
import { loadPublicClub } from "@/lib/public";

// Every public booking page wears the club's colours (Settings → Branding) and its logo as the tab icon.

export async function generateMetadata(): Promise<Metadata> {
  const { club } = await loadPublicClub();
  const logo = logoUrl(club.logo_path);
  return logo ? { icons: { icon: logo, apple: logo } } : {};
}

export default async function BookLayout({ children }: { children: React.ReactNode }) {
  const { club } = await loadPublicClub();
  // Only #rrggbb values reach this (database check + normalizeHex), so it's safe in a <style>.
  const css = brandCss(club.brand_primary, club.brand_secondary);
  return (
    <>
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      <div className="brand-band" aria-hidden />
      {children}
    </>
  );
}
