import type { Metadata } from "next";
import { brandCss, logoUrl } from "@/lib/brand";
import type { PublicClub } from "@/lib/public";

// The club's colours (Settings → Logo and colours) for its public pages: landing, booking, sign-in.

/** Only #rrggbb values reach brandCss (database check + normalizeHex), so it's safe in a <style>. */
export function ClubBrandStyle({ club }: { club: Pick<PublicClub, "brand_primary" | "brand_secondary"> }) {
  const css = brandCss(club.brand_primary, club.brand_secondary);
  return (
    <>
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      <div className="brand-band" aria-hidden />
    </>
  );
}

/** The club's logo as the browser tab icon. */
export function clubIcons(club: Pick<PublicClub, "logo_path">): Metadata["icons"] {
  const logo = logoUrl(club.logo_path);
  return logo ? { icon: logo, apple: logo } : undefined;
}

/** Link previews (LINE, WhatsApp) of a club's pages: the club's name and logo, never Courtix's. */
export function clubOpenGraph(club: Pick<PublicClub, "name" | "logo_path">): Metadata["openGraph"] {
  const logo = logoUrl(club.logo_path);
  return { title: club.name, siteName: club.name, images: logo ? [logo] : undefined };
}
