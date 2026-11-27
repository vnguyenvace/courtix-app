// Staff screen languages (Julian, 28 Nov 2026). English is the source text and the fallback: a
// dictionary maps the exact English text to the translation. "{name}" / "{0}" are filled in.
// Messages from the database and server actions arrive as English text; translateMessage() also
// matches them against dictionary entries with placeholders ("{0} is already booked at that time").
import th from "./th";
import ru from "./ru";
import zh from "./zh";

export type Lang = "en" | "th" | "ru" | "zh";
export const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "th", label: "ไทย" },
  { code: "ru", label: "Русский" },
  { code: "zh", label: "中文（简体）" },
];
/** For dates and numbers (th-TH shows Buddhist years, as Thai staff expect). */
export const LOCALES: Record<Lang, string> = { en: "en-GB", th: "th-TH", ru: "ru-RU", zh: "zh-CN" };

const DICTS: Record<Exclude<Lang, "en">, Record<string, string>> = { th, ru, zh };

export type T = (text: string, vars?: Record<string, string | number>) => string;

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;

export function makeT(lang: Lang): T {
  const dict = lang === "en" ? null : DICTS[lang];
  return (text, vars) => fill(dict?.[text] ?? text, vars);
}

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "th" || v === "ru" || v === "zh";
}

/** The browser's first supported language from an Accept-Language header, else English. */
export function langFromHeader(accept: string | null): Lang {
  for (const part of (accept ?? "").split(",")) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isLang(code)) return code;
  }
  return "en";
}

// Dictionary entries with {0}, {1}…: patterns for messages whose details change.
const patternCache = new Map<Lang, { re: RegExp; to: string }[]>();
function patterns(lang: Exclude<Lang, "en">) {
  let list = patternCache.get(lang);
  if (!list) {
    list = Object.entries(DICTS[lang])
      .filter(([k]) => /\{\d\}/.test(k))
      .map(([k, to]) => ({
        re: new RegExp("^" + k.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\?\{(\d)\\?\}/g, "(?<p$1>(?:(?!\\.\\s).)+?)") + "$"),
        to,
      }));
    patternCache.set(lang, list);
  }
  return list;
}

/** One message: exact match, else a pattern with {0}…; null if not in the dictionary. */
function translateOne(lang: Exclude<Lang, "en">, text: string): string | null {
  const dict = DICTS[lang];
  if (dict[text]) return dict[text];
  for (const { re, to } of patterns(lang)) {
    const m = text.match(re);
    if (m?.groups) {
      // The pieces that change (names, roles) may themselves be translatable ("Front desk").
      return to.replace(/\{(\d)\}/g, (_, n) => {
        const piece = m.groups![`p${n}`] ?? "";
        return dict[piece] ?? piece;
      });
    }
  }
  return null;
}

/** A whole message (banner text, database error): exact match, else a pattern, else as it came. */
export function translateMessage(lang: Lang, message: string): string {
  if (lang === "en" || !message) return message;
  const trimmed = message.trim();
  const one = translateOne(lang, trimmed);
  if (one !== null) return one;
  // Several sentences ("Session saved. People already… 2 moved up from the waitlist."): translate
  // the longest known run of sentences first, then the rest.
  const sentences = trimmed.split(/(?<=\.)\s+/);
  if (sentences.length > 1) {
    for (let n = sentences.length - 1; n >= 1; n--) {
      const done = translateOne(lang, sentences.slice(0, n).join(" "));
      if (done !== null) return `${done} ${translateMessage(lang, sentences.slice(n).join(" "))}`;
    }
    return `${sentences[0]} ${translateMessage(lang, sentences.slice(1).join(" "))}`;
  }
  return message;
}
