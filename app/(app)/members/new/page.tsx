import Link from "next/link";
import { requireOrg } from "@/lib/org";
import { Banner, type SearchParams } from "@/components/Banner";
import { MemberFields } from "@/components/MemberFields";
import { formatMoney } from "@/lib/time";
import { createMember } from "../../actions";
import type { PackageType } from "@/lib/types";

export default async function NewMemberPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, locations, location, t } = await requireOrg();
  const { data } = await supabase
    .from("package_types")
    .select("*")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("price");
  const packages = (data ?? []) as PackageType[];

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/members" className="small">← {t("Members")}</Link>
          <h1>{t("Add member")}</h1>
        </div>
      </div>
      <Banner sp={sp} />
      <form action={createMember} className="card form" style={{ maxWidth: 760 }}>
        <MemberFields defaultLanguage={org.default_language} locations={locations} defaultLocationId={location?.id} t={t} />
        <label>
          {t("Sell a package now (optional)")}
          <select name="package_id" defaultValue="">
            <option value="">{t("No package yet (drop-in)")}</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {formatMoney(p.price, org.currency)}
              </option>
            ))}
          </select>
        </label>
        <div className="actions">
          <button className="primary">{t("Add member")}</button>
          <Link href="/members" className="button">{t("Cancel")}</Link>
        </div>
      </form>
    </>
  );
}
