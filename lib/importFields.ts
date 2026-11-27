// The member fields a spreadsheet column can fill, and a first guess from the column names.

export const IMPORT_FIELDS = [
  { key: "full_name", label: "Name", hint: "Full name", words: ["name", "full name", "member", "member name", "ชื่อ", "ชื่อ-นามสกุล", "ชื่อ นามสกุล", "имя", "фио", "姓名"] },
  { key: "first_name", label: "First name", hint: "If first and last names are in separate columns", words: ["first", "first name", "firstname", "given name", "ชื่อจริง"] },
  { key: "last_name", label: "Last name", hint: "", words: ["last", "last name", "lastname", "surname", "family name", "นามสกุล", "фамилия"] },
  { key: "phone", label: "Phone", hint: "Thai numbers become +66…; duplicates are skipped", words: ["phone", "mobile", "tel", "telephone", "phone number", "whatsapp", "เบอร์", "เบอร์โทร", "โทร", "โทรศัพท์", "телефон", "电话", "手机"] },
  { key: "email", label: "Email", hint: "", words: ["email", "e-mail", "mail", "อีเมล", "почта"] },
  { key: "language", label: "Language", hint: "English, Thai, Russian… or en, th, ru", words: ["language", "lang", "ภาษา", "язык"] },
  { key: "skill_level", label: "Level", hint: "A number from 1 to 6", words: ["level", "skill", "skill level", "dupr", "rating", "ระดับ"] },
  { key: "package", label: "Package", hint: "Must match a package name in Settings", words: ["package", "membership", "plan", "pass", "แพ็กเกจ", "แพ็คเกจ", "абонемент"] },
  { key: "starts_on", label: "Package start", hint: "15/12/2026 (day first); blank = today", words: ["start", "start date", "from", "valid from", "joined", "วันเริ่ม"] },
  { key: "ends_on", label: "Package end", hint: "Blank = worked out from the package length", words: ["end", "end date", "expiry", "expires", "expiry date", "until", "valid until", "วันหมดอายุ"] },
  { key: "sessions_left", label: "Sessions left", hint: "For session packs", words: ["sessions left", "credits", "remaining", "sessions", "credits left", "คงเหลือ"] },
  { key: "home_location", label: "Home location", hint: "Must match a location name", words: ["location", "site", "home", "branch", "home location", "สาขา"] },
  { key: "marketing_consent", label: "Marketing consent", hint: "yes / no. Blank = no", words: ["consent", "marketing", "marketing consent", "opt in", "opt-in", "newsletter", "ยินยอม"] },
  { key: "notes", label: "Notes", hint: "", words: ["notes", "note", "comment", "comments", "remarks", "หมายเหตุ"] },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];

/** A first guess: exact column names first, then names that contain the word. */
export function guessMapping(headers: string[]): Partial<Record<ImportField, number>> {
  const norm = headers.map((h) => h.toLowerCase().replace(/[_*:]+/g, " ").replace(/\s+/g, " ").trim());
  const used = new Set<number>();
  const map: Partial<Record<ImportField, number>> = {};
  for (const pass of ["exact", "contains"] as const) {
    for (const f of IMPORT_FIELDS) {
      if (map[f.key] !== undefined) continue;
      const i = norm.findIndex(
        (h, idx) => !used.has(idx) && f.words.some((w) => (pass === "exact" ? h === w : w.length > 3 && h.includes(w))),
      );
      if (i >= 0) {
        map[f.key] = i;
        used.add(i);
      }
    }
  }
  // Separate first/last name columns: no need for a full-name column too.
  if (map.first_name !== undefined && map.full_name !== undefined && headers.length && norm[map.full_name] !== "name") delete map.full_name;
  return map;
}
