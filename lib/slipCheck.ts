import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decideSlip, type CheckedSlip } from "@/lib/slipRules";

// Automatic transfer-slip checks with EasySlip (https://document.easyslip.com, API v2).
// EasySlip reads the slip's QR and confirms the transfer with the Thai bank network; the rules
// in lib/slipRules.ts decide whether it pays the order. Courtix holds one EasySlip account
// (EASYSLIP_API_KEY, server-only). EASYSLIP_API_BASE can point at a test stub.

const BASE = (process.env.EASYSLIP_API_BASE || "https://api.easyslip.com/v2").replace(/\/$/, "");

export function slipCheckConfigured() {
  return Boolean(process.env.EASYSLIP_API_KEY);
}

export interface SlipCheckResult {
  status: "verified" | "mismatch" | "error";
  reasons: string[];
  checked_at: string;
  trans_ref?: string;
  amount?: number;
  paid_at?: string;
  receiver?: string;
  duplicate_at_easyslip?: boolean;
}

/** EasySlip error codes in words staff understand. */
function errorText(code: string, message: string): string {
  switch (code) {
    case "SLIP_NOT_FOUND":
      return "couldn't find a bank transfer for this slip (QR unreadable, or not a Thai bank slip)";
    case "SLIP_PENDING":
      return "Bangkok Bank slips can only be checked a few minutes after the transfer: check again later";
    case "IMAGE_SIZE_TOO_LARGE":
    case "INVALID_IMAGE_FORMAT":
      return "the slip photo couldn't be read";
    case "QUOTA_EXCEEDED":
    case "RATE_LIMIT_EXCEEDED":
    case "INVALID_API_KEY":
    case "MISSING_API_KEY":
    case "IP_NOT_ALLOWED":
      return "automatic slip checks are unavailable right now (Courtix's slip-check account)";
    default:
      return `automatic check failed (${code || "error"}: ${message})`.slice(0, 200);
  }
}

/** Ask EasySlip about one slip image. */
async function askEasySlip(jpg: Buffer, amount: number): Promise<{ slip?: CheckedSlip; duplicate?: boolean; error?: string }> {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(jpg)], { type: "image/jpeg" }), "slip.jpg");
  form.append("matchAmount", String(amount));
  form.append("checkDuplicate", "true");
  let res: Response;
  try {
    res = await fetch(`${BASE}/verify/bank`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.EASYSLIP_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { error: "the slip-check service didn't answer: check again later" };
  }
  const body = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: { isDuplicate?: boolean; rawSlip?: Record<string, unknown> }; error?: { code?: string; message?: string } }
    | null;
  if (!res.ok || !body?.success || !body.data?.rawSlip) {
    const code = body?.error?.code ?? `HTTP_${res.status}`;
    if (!["SLIP_NOT_FOUND", "SLIP_PENDING", "IMAGE_SIZE_TOO_LARGE", "INVALID_IMAGE_FORMAT"].includes(code)) {
      console.error("Slip check: EasySlip error", code, body?.error?.message);
    }
    return { error: errorText(code, body?.error?.message ?? "") };
  }
  const raw = body.data.rawSlip as {
    transRef?: string;
    date?: string;
    amount?: { amount?: number };
    receiver?: {
      account?: {
        name?: { th?: string; en?: string };
        bank?: { account?: string } | null;
        proxy?: { type?: string; account?: string } | null;
      };
    };
  };
  const acc = raw.receiver?.account ?? {};
  return {
    duplicate: Boolean(body.data.isDuplicate),
    slip: {
      transRef: raw.transRef ?? "",
      date: raw.date ?? "",
      amount: Number(raw.amount?.amount ?? NaN),
      receiver: {
        name: acc.name ?? {},
        bankAccount: acc.bank?.account ?? null,
        proxy: acc.proxy?.type && acc.proxy?.account ? { type: acc.proxy.type, account: acc.proxy.account } : null,
      },
    },
  };
}

/**
 * Check a payer's slip for one order and, if it clearly pays it, mark the order paid.
 * Needs the service identity (apply_verified_slip is server-only). Never throws: the result is
 * saved on the order (orders.slip_check) for staff to see.
 */
export async function checkSlipForOrder(db: SupabaseClient, orderId: string, jpg: Buffer): Promise<SlipCheckResult> {
  const checked_at = new Date().toISOString();
  const { data: o } = await db
    .from("orders")
    .select("id, total, status, created_at, orgs!inner(promptpay_id, promptpay_name, slip_autoverify)")
    .eq("id", orderId)
    .single();
  const org = (o?.orgs ?? null) as unknown as { promptpay_id: string | null; promptpay_name: string | null; slip_autoverify: boolean } | null;
  let result: SlipCheckResult;

  if (!o || o.status !== "pending" || !org) {
    return { status: "error", reasons: ["this payment is already done or no longer due"], checked_at };
  }
  if (!org.slip_autoverify || !slipCheckConfigured()) {
    return { status: "error", reasons: ["automatic slip checks are off"], checked_at };
  }

  const asked = await askEasySlip(jpg, Number(o.total));
  if (asked.error || !asked.slip) {
    result = { status: "error", reasons: [asked.error ?? "automatic check failed"], checked_at };
  } else {
    const s = asked.slip;
    const decision = decideSlip(s, {
      total: Number(o.total),
      promptpayId: org.promptpay_id,
      promptpayName: org.promptpay_name,
      orderCreatedAt: o.created_at,
    });
    result = {
      status: decision.ok ? "verified" : "mismatch",
      reasons: decision.reasons,
      checked_at,
      trans_ref: s.transRef,
      amount: s.amount,
      paid_at: s.date,
      receiver: [s.receiver.name.th || s.receiver.name.en, s.receiver.proxy?.account ?? s.receiver.bankAccount].filter(Boolean).join(" · "),
      duplicate_at_easyslip: asked.duplicate,
    };
    if (decision.ok) {
      const { error } = await db.rpc("apply_verified_slip", {
        p_order: orderId,
        p_trans_ref: s.transRef,
        p_amount: s.amount,
        p_check: result,
      });
      if (!error) return result;
      // Already used for another payment, or the order changed meanwhile: leave it to staff.
      result = { ...result, status: "mismatch", reasons: [error.message.replace(/^.*?: /, "")] };
    }
  }
  await db.from("orders").update({ slip_check: result }).eq("id", orderId);
  return result;
}
