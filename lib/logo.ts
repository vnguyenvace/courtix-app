import "server-only";
import sharp from "sharp";
import { contrast, mix, rgbToHex, rgbToHsl, type Rgb } from "@/lib/brand";

// Club logos: re-encode the upload and pick brand colours from it.

export const LOGO_MAX_BYTES = 4 * 1024 * 1024; // Vercel refuses request bodies over 4.5 MB
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];

/**
 * Any image the owner uploads becomes a PNG of at most 512×512. That keeps files small for
 * phones, strips photo metadata (GPS), and turns SVGs into plain pixels (an SVG can carry script).
 */
export async function normalizeLogo(input: Buffer): Promise<Buffer> {
  return sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

interface Bucket {
  n: number;
  r: number;
  g: number;
  b: number;
}

/**
 * The logo's main colours, most important first (up to 6), plus a suggested primary and
 * secondary. Background white, transparent pixels and anti-aliasing greys are ignored; bright,
 * frequent colours rank first. A black-and-white logo gives its dark colour as primary.
 */
export async function detectColors(png: Buffer): Promise<{ palette: string[]; primary: string | null; secondary: string | null }> {
  const { data, info } = await sharp(png)
    .resize(128, 128, { fit: "inside", kernel: "nearest" }) // nearest: no blur or overshoot, real pixel colours
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Count pixels in coarse colour boxes (4 bits per channel), keeping each box's average colour.
  const boxes = new Map<number, Bucket>();
  for (let i = 0; i < info.width * info.height; i++) {
    const [r, g, b, a] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
    if (a < 160) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const box = boxes.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    box.n++;
    box.r += r;
    box.g += g;
    box.b += b;
    boxes.set(key, box);
  }
  const total = [...boxes.values()].reduce((sum, b) => sum + b.n, 0) || 1;

  // Merge near-identical boxes so one colour with soft edges counts once. The biggest box keeps
  // its colour: averaging would pull thin lettering towards the background (navy → grey-blue).
  const colours: { rgb: Rgb; n: number }[] = [];
  for (const box of [...boxes.values()].sort((x, y) => y.n - x.n)) {
    const rgb: Rgb = [box.r / box.n, box.g / box.n, box.b / box.n];
    const near = colours.find((c) => distance(c.rgb, rgb) < 56);
    if (near) near.n += box.n;
    else colours.push({ rgb, n: box.n });
  }
  // Edge pixels between a colour and the background aren't colours of their own: drop any colour
  // that sits on the line between a bigger colour and white/black/another bigger colour.
  const anchors: Rgb[] = [[255, 255, 255], [0, 0, 0]];
  const kept: typeof colours = [];
  for (const c of colours) {
    const blend = kept.some((k) => [...anchors, ...kept.map((x) => x.rgb)].some((a) => a !== k.rgb && onSegment(c.rgb, k.rgb, a)));
    if (!blend || c.n / total > 0.08) kept.push(c);
  }
  colours.splice(0, colours.length, ...kept);
  // Shares are measured against the logo's "ink", not a white background around it, so thin
  // lettering still counts.
  // White and near-white (white lettering, a faintly tinted background). Uses chroma, not HSL
  // saturation, which shoots up near white (#fffaf5 counts as "fully saturated").
  const isPaper = ([r, g, b]: Rgb) => Math.min(r, g, b) > 215 && Math.max(r, g, b) - Math.min(r, g, b) < 40;
  const ink = colours.filter((c) => !isPaper(c.rgb)).reduce((sum, c) => sum + c.n, 0) || total;

  const scored = colours
    .filter((c) => !isPaper(c.rgb) && c.n / ink >= 0.03)
    .map((c) => {
      const [h, s, l] = rgbToHsl(c.rgb);
      const neutral = s < 0.18 || l < 0.08 || l > 0.94;
      // Colourful and frequent first; a clearly visible colour beats a bigger pale one.
      const score = (c.n / ink) * (neutral ? 0.25 : 0.6 + s) * (l > 0.85 ? 0.3 : 1);
      return { ...c, h, s, l, neutral, score, hex: rgbToHex(c.rgb) };
    })
    .sort((x, y) => y.score - x.score);

  const palette = scored
    .slice(0, 6)
    .map((c) => c.hex);

  const colourful = scored.filter((c) => !c.neutral);
  const darks = scored.filter((c) => c.neutral && c.l < 0.35);
  const first = colourful[0] ?? darks[0] ?? null;
  if (!first) return { palette, primary: null, secondary: null };
  // Second colour: a different hue if the logo has one, otherwise its dark text colour.
  const second =
    colourful.find((c) => c !== first && hueGap(c.h, first.h) > 35 && contrast(c.rgb, first.rgb) > 1.3) ??
    darks.find((c) => c !== first) ??
    null;
  return { palette: [...new Set(palette)], primary: first.hex, secondary: second?.hex ?? null };
}

/** Is p (roughly) a blend of a and b? */
function onSegment(p: Rgb, a: Rgb, b: Rgb) {
  const ab: Rgb = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  if (len2 === 0) return false;
  const t = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / len2;
  if (t <= 0.08 || t >= 0.92) return false;
  return distance(p, mix(a, b, t)) < 18;
}

function distance(a: Rgb, b: Rgb) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function hueGap(a: number, b: number) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
