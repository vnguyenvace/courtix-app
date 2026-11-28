/* eslint-disable @next/next/no-img-element */
// The Courtix logo (files in public/brand, made from img/). Plain <img> so it works without JS.

/** Full wordmark. Green on light screens, white on dark ones (follows the phone's theme). */
export function CourtixLogo({ height = 32, className }: { height?: number; className?: string }) {
  return (
    <picture className={className}>
      <source srcSet="/brand/logo-on-dark.png" media="(prefers-color-scheme: dark)" />
      <img src="/brand/logo.png" alt="Courtix" height={height} style={{ height, width: "auto", display: "block" }} />
    </picture>
  );
}

/** The square mark only (court + ball), for tight spots like the sidebar. */
export function CourtixMark({ size = 34, className }: { size?: number; className?: string }) {
  return <img src="/brand/mark.png" alt="" aria-hidden width={size} height={size} className={className} style={{ display: "block", flex: "none" }} />;
}
