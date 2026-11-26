import "server-only";
import { normalizeSlip } from "@/lib/logo";
import { serviceClient } from "@/lib/supabase/service";

// A payer sends their transfer slip from the pay page. Saved by the server (visitors get no access
// to the slip storage, so nobody can list or open other people's slips): this checks the order is
// unpaid at this club and has fewer than 3 slips, shrinks the photo, stores it privately, and
// flags the order for staff ("slip received, check and mark paid").

const MAX_SLIPS = 3;

export async function savePayerSlip(slug: string, orderId: string, file: Buffer): Promise<void> {
  const db = serviceClient();
  const { data: order } = await db
    .from("orders")
    .select("id, org_id, status, orgs!inner(slug)")
    .eq("id", orderId)
    .eq("orgs.slug", slug)
    .maybeSingle();
  if (!order || order.status !== "pending") throw new Error("This payment is already done or no longer due.");

  const folder = `${order.org_id}/${order.id}`;
  const { data: existing } = await db.storage.from("payment-slips").list(folder);
  if ((existing ?? []).filter((f) => f.name.startsWith("payer-")).length >= MAX_SLIPS) {
    throw new Error("We already have your slips. The club will check them soon.");
  }

  let jpg: Buffer;
  try {
    jpg = await normalizeSlip(file);
  } catch {
    throw new Error("That file couldn't be read as a photo. Try a screenshot or JPG.");
  }
  const path = `${folder}/payer-${Date.now()}.jpg`;
  const { error: upErr } = await db.storage.from("payment-slips").upload(path, jpg, { contentType: "image/jpeg" });
  if (upErr) throw new Error("The slip didn't upload. Please try again.");
  const { error } = await db.rpc("public_attach_slip", { p_slug: slug, p_order: orderId, p_path: path });
  if (error) throw new Error(error.message);
}
