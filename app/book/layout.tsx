import type { Metadata } from "next";
import { ClubBrandStyle, clubIcons } from "@/components/ClubBrand";
import { loadPublicClub } from "@/lib/public";

// Every public booking page wears the club's colours and its logo as the tab icon.

export async function generateMetadata(): Promise<Metadata> {
  const { club } = await loadPublicClub();
  return { icons: clubIcons(club) };
}

export default async function BookLayout({ children }: { children: React.ReactNode }) {
  const { club } = await loadPublicClub();
  return (
    <>
      <ClubBrandStyle club={club} />
      {children}
    </>
  );
}
