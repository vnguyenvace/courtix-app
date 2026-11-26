// Club colours: turning a club's brand colours into the CSS variables the public booking page
// uses, readable in both light and dark mode. Pure functions (no server-only), so the settings
// preview and the public pages share them.

export type Rgb = [number, number, number];

const HEX = /^#[0-9a-f]{6}$/;

/** "#D94F1E" / "d94f1e" → "#d94f1e", or null if it isn't a colour. */
export function normalizeHex(v: string | null | undefined): string | null {
  if (!v) return null;
  const h = (v.trim().startsWith("#") ? v.trim() : `#${v.trim()}`).toLowerCase();
  return HEX.test(h) ? h : null;
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

function luminance([r, g, b]: Rgb) {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: Rgb, b: Rgb) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** a mixed towards b by t (0 = a, 1 = b). */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Hue (0–360), saturation and lightness (0–1). */
export function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return [h * 60, s, l];
}

/**
 * The colour, darkened (light mode) or lightened (dark mode) just enough to read as text on
 * `bg`. A yellow logo colour becomes a deep gold for links on white.
 */
function readableOn(c: Rgb, bg: Rgb, min = 4.5): Rgb {
  if (contrast(c, bg) >= min) return c;
  const towards: Rgb = luminance(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  for (let t = 0.05; t <= 1; t += 0.05) {
    const m = mix(c, towards, t);
    if (contrast(m, bg) >= min) return m;
  }
  return towards;
}

/** Black or white text on a filled button of this colour. */
function textOn(c: Rgb): string {
  return contrast(c, [255, 255, 255]) >= contrast(c, [17, 17, 17]) ? "#ffffff" : "#111111";
}

// The surfaces from app/globals.css (light and dark).
const LIGHT_SURFACE: Rgb = [255, 255, 255];
const LIGHT_BG: Rgb = [246, 245, 241];
const DARK_SURFACE: Rgb = [31, 31, 29];

function themeVars(primary: Rgb, secondary: Rgb, surface: Rgb, dark: boolean) {
  // Buttons keep the exact brand colour unless it disappears into the page (a near-black brand
  // in dark mode, or a pale one in light mode); then the readable version is used.
  const fill = contrast(primary, surface) >= 1.25 ? primary : readableOn(primary, surface, 1.6);
  return {
    "--accent": rgbToHex(readableOn(primary, surface)),
    "--accent-soft": rgbToHex(mix(primary, surface, dark ? 0.78 : 0.88)),
    "--accent-fill": rgbToHex(fill),
    "--on-accent": textOn(fill),
    "--brand-2": rgbToHex(readableOn(secondary, dark ? DARK_SURFACE : LIGHT_BG, 3)),
  };
}

/**
 * CSS that applies the club's colours to the page. Both values must be validated hex colours
 * (the database only stores #rrggbb, and normalizeHex checks again), so it's safe inside <style>.
 * Returns "" when the club uses the default Courtix colours.
 */
export function brandCss(primaryHex: string | null, secondaryHex: string | null, scope = ":root"): string {
  const p = normalizeHex(primaryHex);
  const s = normalizeHex(secondaryHex) ?? p;
  if (!p || !s) return "";
  const [primary, secondary] = [hexToRgb(p), hexToRgb(s)];
  const block = (vars: Record<string, string>) =>
    Object.entries(vars).map(([k, v]) => `${k}:${v};`).join("");
  return (
    `${scope}{${block(themeVars(primary, secondary, LIGHT_SURFACE, false))}}` +
    `@media (prefers-color-scheme: dark){${scope}{${block(themeVars(primary, secondary, DARK_SURFACE, true))}}}`
  );
}

/** Public URL of a club's logo in Supabase Storage (bucket club-logos is public). */
export function logoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return base ? `${base.replace(/\/$/, "")}/storage/v1/object/public/club-logos/${path}` : null;
}
