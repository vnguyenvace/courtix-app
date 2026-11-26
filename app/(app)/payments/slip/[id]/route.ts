import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/org";

// Opens a transfer slip photo: a link valid for 5 minutes, only for staff of that club
// (RLS on orders and on the private payment-slips bucket decide).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireOrg();
  const { data: order } = await supabase.from("orders").select("slip_path").eq("id", id).maybeSingle();
  if (!order?.slip_path) return NextResponse.json({ error: "No slip" }, { status: 404 });
  const { data, error } = await supabase.storage.from("payment-slips").createSignedUrl(order.slip_path, 300);
  if (error || !data) return NextResponse.json({ error: "Couldn't open the slip" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
