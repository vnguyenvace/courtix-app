import Link from "next/link";
import { requireOrg } from "@/lib/org";
import { Banner, param, type SearchParams } from "@/components/Banner";
import { formatLongDay, formatMoney, isValidDate, todayIn, zonedToUtc } from "@/lib/time";
import { createBooking } from "../../actions";
import type { Court, MemberStatus } from "@/lib/types";

export default async function NewBookingPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, locations, workLocation, t, locale } = await requireOrg();

  const courtId = param(sp, "court") ?? "";
  // The court decides the location (its hours, time zone and prices).
  const { data: picked } = courtId
    ? await supabase.from("courts").select("location_id").eq("id", courtId).maybeSingle()
    : { data: null };
  const loc = locations.find((l) => l.id === picked?.location_id) ?? workLocation;

  const dateParam = param(sp, "date");
  const date = isValidDate(dateParam) ? dateParam : todayIn(loc.timezone);
  const time = /^\d{2}:\d{2}$/.test(param(sp, "time") ?? "") ? param(sp, "time")! : loc.opens_at.slice(0, 5);
  const start = zonedToUtc(date, time, loc.timezone).toISOString();

  const [{ data: courtData }, { data: memberData }, { data: memberPrice }, { data: dropInPrice }] = await Promise.all([
    supabase.from("courts").select("*").eq("location_id", loc.id).eq("is_active", true).order("sort_order"),
    supabase
      .from("member_status")
      .select("member_id, full_name, membership_status, package_name")
      .eq("org_id", org.id)
      .order("full_name"),
    supabase.rpc("slot_price", { p_org: org.id, p_start: start, p_is_member: true, p_location: loc.id }),
    supabase.rpc("slot_price", { p_org: org.id, p_start: start, p_is_member: false, p_location: loc.id }),
  ]);

  const courts = (courtData ?? []) as Court[];
  const members = (memberData ?? []) as Pick<MemberStatus, "member_id" | "full_name" | "membership_status" | "package_name">[];
  const withPackage = members.filter((m) => m.membership_status === "active");
  const others = members.filter((m) => m.membership_status !== "active");

  return (
    <>
      <div className="page-head">
        <div>
          <Link href={`/bookings?at=${loc.id}&date=${date}`} className="small">← {t("Courts")}</Link>
          <h1>{t("Book a court")}</h1>
          <p className="muted">{loc.name} · {formatLongDay(date, locale)} · {time}</p>
        </div>
      </div>
      <Banner sp={sp} />

      <form action={createBooking} className="card form" style={{ maxWidth: 640 }}>
        <input type="hidden" name="date" value={date} />
        <input type="hidden" name="time" value={time} />
        <div className="form-row">
          <label>
            {t("Court")}
            <select name="court_id" defaultValue={courtId} required>
              {courts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            {t("Length")}
            <select name="minutes" defaultValue={String(loc.slot_minutes)}>
              {[30, 60, 90, 120].map((mins) => (
                <option key={mins} value={mins}>{t("{n} minutes", { n: mins })}</option>
              ))}
            </select>
          </label>
        </div>

        <label>
          {t("Member")}
          <select name="member_id" defaultValue="">
            <option value="">{t("Not a member (enter guest name below)")}</option>
            {withPackage.length > 0 && (
              <optgroup label={t("Members with a package")}>
                {withPackage.map((m) => (
                  <option key={m.member_id} value={m.member_id}>
                    {m.full_name} · {m.package_name}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label={t("No active package (pays drop-in)")}>
                {others.map((m) => (
                  <option key={m.member_id} value={m.member_id}>{m.full_name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <label>
          {t("Guest name")}
          <input name="guest_name" placeholder="Tourist Tom" />
        </label>

        <label>
          {t("Booking type")}
          <select name="kind" defaultValue="">
            <option value="">{t("Automatic (member if they have a package, otherwise drop-in)")}</option>
            <option value="drop_in">{t("Drop-in")}</option>
            <option value="coaching">{t("Coaching block")}</option>
            <option value="open_play">{t("Open play session")}</option>
            <option value="maintenance">{t("Maintenance (court closed)")}</option>
          </select>
        </label>
        <label>
          {t("Notes")}
          <input name="notes" placeholder="Coach Ploy, beginners clinic" />
        </label>

        <p className="muted small">
          {t("Price for this slot: members {member}, drop-in {dropin}. Coaching, open play and maintenance blocks are free.", {
            member: formatMoney(Number(memberPrice ?? 0), org.currency),
            dropin: formatMoney(Number(dropInPrice ?? 0), org.currency),
          })}
        </p>
        <div className="actions">
          <button className="primary">{t("Book court")}</button>
          <Link href={`/bookings?at=${loc.id}&date=${date}`} className="button">{t("Cancel")}</Link>
        </div>
      </form>
    </>
  );
}
