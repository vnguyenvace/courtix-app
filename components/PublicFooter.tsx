import Link from "next/link";

/** Footer on public pages: who runs the booking site, and the legal pages. */
export function PublicFooter() {
  return (
    <p className="muted small public-foot">
      Booking by Courtix · <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link>
    </p>
  );
}
