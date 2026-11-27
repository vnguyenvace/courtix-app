import type { Location, Member } from "@/lib/types";
import type { T } from "@/lib/i18n";

const same: T = (s) => s;

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "th", label: "Thai" },
  { code: "ru", label: "Russian" },
  { code: "zh", label: "Chinese" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
];

/** Shared fields for adding and editing a member. */
export function MemberFields({
  m,
  defaultLanguage = "en",
  locations = [],
  defaultLocationId,
  t = same,
}: {
  t?: T;
  m?: Member;
  defaultLanguage?: string;
  locations?: Location[];
  defaultLocationId?: string;
}) {
  const active = locations.filter((l) => l.is_active || l.id === m?.home_location_id);
  return (
    <>
      <label>
        {t("Full name")}
        <input name="full_name" required defaultValue={m?.full_name} placeholder="Dmitri Volkov" />
      </label>
      <div className="form-row">
        <label>
          {t("Phone")}
          <input name="phone" type="tel" defaultValue={m?.phone ?? ""} placeholder="+66 81 234 5678" />
        </label>
        <label>
          WhatsApp
          <input name="whatsapp" type="tel" defaultValue={m?.whatsapp ?? ""} placeholder="+7 912 345 6789" />
        </label>
        <label>
          {t("Email")}
          <input name="email" type="email" defaultValue={m?.email ?? ""} placeholder="name@example.com" />
        </label>
      </div>
      <div className="form-row">
        <label>
          {t("Language for messages")}
          <select name="language" defaultValue={m?.language ?? defaultLanguage}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{t(l.label)}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Send messages on")}
          <select name="preferred_channel" defaultValue={m?.preferred_channel ?? ""}>
            <option value="">{t("Automatic (LINE for Thai speakers, otherwise WhatsApp)")}</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="line">LINE</option>
          </select>
        </label>
        <label>
          {t("Skill level (1–6)")}
          <input name="skill_level" type="number" step="0.5" min="1" max="6" defaultValue={m?.skill_level ?? ""} placeholder="3.5" />
        </label>
        {active.length > 1 && (
          <label>
            {t("Home location")}
            <select name="home_location_id" defaultValue={m ? m.home_location_id ?? "" : defaultLocationId ?? ""}>
              <option value="">{t("No preference")}</option>
              {active.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          {t("Usual play time")}
          <input name="usual_play_time" defaultValue={m?.usual_play_time ?? ""} placeholder="7am open play" />
        </label>
      </div>
      <label>
        {t("Notes")}
        <textarea name="notes" defaultValue={m?.notes ?? ""} placeholder="Here until April. Prefers doubles." />
      </label>
      <label className="check">
        <input type="checkbox" name="marketing_consent" defaultChecked={m?.marketing_consent ?? false} />
        {t("Agreed to receive messages from the club (needed before any AI follow-ups)")}
      </label>
      <label className="check">
        <input type="checkbox" name="notices_opt_out" defaultChecked={m?.notices_opt_out ?? false} />
        {t("No automatic reminders or notices (bookings, package ending, waitlist, cancellations)")}
      </label>
    </>
  );
}
