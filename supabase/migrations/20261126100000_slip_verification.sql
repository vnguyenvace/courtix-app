-- Automatic slip checks (Julian, 26 Nov 2026: "research the slip verification services and build A").
-- When a payer sends a transfer slip on the pay page, Courtix asks EasySlip (lib/slipCheck.ts) to
-- confirm the transfer with the bank network, then marks the order paid by itself only if: the
-- amount is exactly what's due, it went to the club's PromptPay (or a receiver with the club's
-- account name), it was made after the booking and in the last 7 days, and the slip was never
-- used before (slip_refs, across every club). Anything else stays for staff with the reason.

-- Per club: check slips automatically (on by default; needs Courtix's EasySlip key to work).
alter table public.orgs add column slip_autoverify boolean not null default true;

-- The last automatic check of this order's slip: {status: verified | mismatch | error, reasons[], ...}.
alter table public.orders add column slip_check jsonb;

-- Every transfer reference that has paid for something, once. A slip can't pay twice, at any club.
create table public.slip_refs (
  trans_ref  text primary key,
  org_id     uuid not null,
  order_id   uuid not null,
  amount     numeric(10,2) not null,
  created_at timestamptz not null default now(),
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, order_id) references public.orders(org_id, id) on delete cascade
);
create index slip_refs_order_idx on public.slip_refs(order_id);

alter table public.slip_refs enable row level security;
create policy slip_refs_select on public.slip_refs for select to authenticated using (public.is_org_staff(org_id));
grant select on public.slip_refs to authenticated;
revoke all on public.slip_refs from anon;

-- Record a verified slip and mark the order paid, in one step. Raises if the slip was already
-- used (the primary key) or the order is no longer due. Called by the server after the check.
create or replace function public.apply_verified_slip(p_order uuid, p_trans_ref text, p_amount numeric, p_check jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_o public.orders;
begin
  select * into v_o from public.orders where id = p_order for update;
  if not found or v_o.status <> 'pending' then raise exception 'This payment is already done or no longer due'; end if;
  if p_amount <> v_o.total then raise exception 'The amount doesn''t match'; end if;
  insert into public.slip_refs (trans_ref, org_id, order_id, amount) values (p_trans_ref, v_o.org_id, v_o.id, p_amount);
  update public.orders
     set status = 'paid', method = 'promptpay', paid_amount = v_o.total, paid_at = now(), received_by = null,
         slip_check = p_check, note = coalesce(note, 'Slip checked automatically')
   where id = p_order;
exception
  when unique_violation then raise exception 'This slip was already used for another payment';
end;
$$;
-- Only the server (service identity) calls this, after checking the slip with the bank network.
revoke execute on function public.apply_verified_slip(uuid, text, numeric, jsonb) from anon, authenticated, public;
