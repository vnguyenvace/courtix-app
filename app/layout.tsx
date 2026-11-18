import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Courtix",
  description: "Memberships and court bookings for racket clubs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
