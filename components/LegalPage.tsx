import Link from "next/link";
import { CourtixLogo } from "@/components/CourtixLogo";
import { LEGAL_UPDATED } from "@/lib/legal";

/** Layout for the Privacy and Terms pages: one readable column that also prints well. */
export function LegalPage({ title, intro, children }: { title: string; intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="public legal">
      <nav className="legal-nav">
        <Link href="/" aria-label="Courtix"><CourtixLogo height={26} /></Link>
        <span>
          <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link>
        </span>
      </nav>
      <h1>{title}</h1>
      <p className="muted small">Last updated {LEGAL_UPDATED}</p>
      <div className="legal-intro">{intro}</div>
      {children}
      <p className="muted small public-foot">Courtix · courtix.app</p>
    </main>
  );
}
