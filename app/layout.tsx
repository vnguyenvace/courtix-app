import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import PendingButtons from "@/components/PendingButtons";

export const metadata: Metadata = {
  title: "Courtix",
  description: "Memberships and court bookings for racket clubs",
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
