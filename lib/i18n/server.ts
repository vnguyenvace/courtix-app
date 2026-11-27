import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isLang, langFromHeader, LOCALES, makeT, translateMessage, type Lang, type T } from "./index";

/** The signed-in user, once per request (requireOrg and the language both need it). */
export const currentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** This person's screen language: their setting, else their browser's language, else English. */
export const getLang = cache(async (): Promise<{ lang: Lang; setting: Lang | "auto" }> => {
  const user = await currentUser();
  const saved = user?.user_metadata?.ui_language;
  if (isLang(saved)) return { lang: saved, setting: saved };
  return { lang: langFromHeader((await headers()).get("accept-language")), setting: "auto" };
});

export interface I18n {
  lang: Lang;
  setting: Lang | "auto";
  locale: string;
  t: T;
  /** Translate a whole message (banner, database error). */
  tm: (message: string) => string;
}

export const getI18n = cache(async (): Promise<I18n> => {
  const { lang, setting } = await getLang();
  return { lang, setting, locale: LOCALES[lang], t: makeT(lang), tm: (m) => translateMessage(lang, m) };
});
