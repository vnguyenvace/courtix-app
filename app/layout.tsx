import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import PendingButtons from "@/components/PendingButtons";

const ROOT = process.env.ROOT_DOMAIN || "courtix.app";

// Icons: app/icon.png (tab) and app/apple-icon.png (phone home screen) are picked up by Next.
// Club public pages replace these with the club's own logo (components/ClubBrand.tsx).
export const metadata: Metadata = {
  metadataBase: new URL(`${ROOT.includes("localhost") ? "http" : "https"}://${ROOT}`),
  title: "Courtix",
  description: "Memberships and court bookings for racket clubs",
  openGraph: { title: "Courtix", siteName: "Courtix", images: ["/brand/og.png"] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* Spinner + no double submits on every form button. Stamp changes on each server render. */}
        <Suspense fallback={null}>
          <PendingButtons stamp={String(Date.now())} />
        </Suspense>
      </body>
    </html>
  );
}
