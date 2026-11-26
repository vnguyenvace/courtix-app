import type { Metadata } from "next";
import { ClubBrandStyle, clubIcons } from "@/components/ClubBrand";
import Link from "next/link";
import { loadMember, loadPublicClub } from "@/lib/public";

// Every public booking page wears the club's colours and its logo as the tab icon.

export async function generateMetadata(): Promise<Metadata> {
  const { club } = await loadPublicClub();
  return { icons: clubIcons(club) };
}

export default async function BookLayout({ children }: { children: React.ReactNode }) {
  const { club } = await loadPublicClub();
  const me = club.public_booking ? await loadMember() : null;
  return (
    <>
      <ClubBrandStyle club={club} />
      {club.public_booking && (
        <div className="member-bar">
          {me ? <Link href="/book/me">Hi {me.first_name} · My bookings</Link> : <Link href="/book/me">Member sign in</Link>}
        </div>
      )}
      {children}
    </>
  );
}
