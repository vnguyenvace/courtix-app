import Link from "next/link";
import { CourtixMark } from "@/components/CourtixLogo";

/** Footer on public pages: who runs the booking site, and the legal pages. */
export function PublicFooter() {
  return (
    <p className="muted small public-foot">
      <span className="by-courtix">
        <CourtixMark size={16} /> Booking by Courtix
      </span>{" "}
      · <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link>
    </p>
  );
}
