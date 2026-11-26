import QRCode from "qrcode";
import { promptPayKind, promptPayPayload } from "@/lib/promptpay";
import { loadPublicClub } from "@/lib/public";

// The pay page's QR as a PNG, so someone paying on the same phone can save it and pick it in
// their banking app's scan screen.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, slug } = await loadPublicClub();
  const { data } = await supabase.rpc("public_order", { p_slug: slug, p_order: id });
  const o = data as { status: string; total: number; awaiting_approval: boolean; promptpay_id: string | null } | null;
  if (!o || o.status !== "pending" || o.awaiting_approval || !promptPayKind(o.promptpay_id)) {
    return new Response("Nothing to pay", { status: 404 });
  }
  const png = await QRCode.toBuffer(promptPayPayload(o.promptpay_id!, Number(o.total)), { type: "png", margin: 4, width: 720 });
  return new Response(new Uint8Array(png), {
    headers: { "content-type": "image/png", "cache-control": "private, no-store" },
  });
}
