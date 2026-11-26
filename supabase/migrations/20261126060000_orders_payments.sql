-- Step 3: orders and payments (staff-marked), plus booking confirmations with the amount due.
-- Decided with Julian, 26 Nov 2026: full orders (order + items), confirmation messages include
-- the amount due, and the revenue figures owners already see stay as they are ("received" and
-- "unpaid" are shown next to them).
--
-- Every paid thing becomes an order automatically, whatever created it (desk, chat assistant,
-- public booking page): a court booking (member / drop-in), a session place (booked), a package
-- sale. Free and package-covered places create nothing. Cancelling an unpaid item cancels its
-- order; cancelling a paid one flags the order "refund_due" for an owner or manager to decide.
-- Staff record how it was paid (cash, transfer, PromptPay, card), optionally with a slip photo.
--
-- The checks run at the END of each transaction (deferred triggers that re-read the row):
-- signing up first records the drop-in price and then applies the member's package in the same
-- transaction, and only the final price counts.

-- ---------------------------------------------------------------------------
-- Keys so orders can't point at another club's rows
-- ---------------------------------------------------------------------------
alter table public.bookings add constraint bookings_org_id_key unique (org_id, id);
alter table public.session_registrations add constraint session_registrations_org_id_key unique (org_id, id);

-- Where a court booking came from (chat bookings are already confirmed in the chat).
alter table public.bookings add column source text not null default 'desk' check (source in ('desk', 'online', 'chat'));

-- How members pay, in the club's own words (used in confirmations), e.g.
-- "Pay at the desk, or PromptPay 081-234-5678 (Raccoon Pickleball Co.)".
alter table public.orgs add column payment_note text check (length(payment_note) <= 300);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table public.orders (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  location_id  uuid,                 -- where it's paid (null = club-wide, e.g. a package)
  member_id    uuid,
  guest_name   text,
  guest_phone  text,
  -- pending: to pay. paid. cancelled: nothing to pay any more.
  -- refund_due: paid, then cancelled: an owner/manager decides. refunded.
  status       text not null default 'pending'
               check (status in ('pending', 'paid', 'cancelled', 'refund_due', 'refunded')),
  total        numeric(10,2) not null default 0,
  currency     text not null,
  method       text check (method in ('cash', 'transfer', 'promptpay', 'card', 'other')),
  paid_amount  numeric(10,2),
  paid_at      timestamptz,
  received_by  uuid,
  note         text check (length(note) <= 300),
  slip_path    text,                 -- transfer slip photo in Storage (payment-slips/<org_id>/...)
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id) references public.orgs(id) on delete cascade,
  foreign key (org_id, location_id) references public.locations(org_id, id) on delete set null (location_id),
  foreign key (org_id, member_id) references public.members(org_id, id) on delete set null (member_id),
  check (status <> 'paid' or (paid_at is not null and method is not null)),
  check (slip_path is null or slip_path like org_id::text || '/%')
);
create index orders_org_status_idx on public.orders(org_id, status, created_at desc);
create index orders_paid_idx on public.orders(org_id, paid_at) where paid_at is not null;
create index orders_member_idx on public.orders(org_id, member_id);

create table public.order_items (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  order_id        uuid not null,
  kind            text not null check (kind in ('session', 'court', 'package')),
  registration_id uuid unique,
  booking_id      uuid unique,
  membership_id   uuid unique,
  description     text not null,
  amount          numeric(10,2) not null check (amount >= 0),
  cancelled_at    timestamptz,       -- the place / booking / package was cancelled
  created_at      timestamptz not null default now(),
  foreign key (org_id, order_id) references public.orders(org_id, id) on delete cascade,
  foreign key (org_id, registration_id) references public.session_registrations(org_id, id) on delete set null (registration_id),
  foreign key (org_id, booking_id) references public.bookings(org_id, id) on delete set null (booking_id),
  foreign key (org_id, membership_id) references public.memberships(org_id, id) on delete set null (membership_id),
  check (num_nonnulls(registration_id, booking_id, membership_id) <= 1)
);
create index order_items_order_idx on public.order_items(order_id);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
create policy orders_select on public.orders for select to authenticated using (public.is_org_staff(org_id));
create policy orders_insert on public.orders for insert to authenticated with check (public.is_org_staff(org_id));
create policy orders_update on public.orders for update to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));
create policy order_items_select on public.order_items for select to authenticated using (public.is_org_staff(org_id));
create policy order_items_insert on public.order_items for insert to authenticated with check (public.is_org_staff(org_id));
create policy order_items_update on public.order_items for update to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));
grant select, insert, update on public.orders, public.order_items to authenticated;
revoke all on public.orders, public.order_items from anon;

-- ---------------------------------------------------------------------------
-- Keeping orders in step with what was sold
-- ---------------------------------------------------------------------------
-- Total and status of one order from its items.
create or replace function public.recalc_order(p_order uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_o      public.orders;
  v_active numeric;
  v_live   int;
begin
  select * into v_o from public.orders where id = p_order;
  if not found then return; end if;
  select coalesce(sum(amount), 0), count(*) into v_active, v_live
    from public.order_items where order_id = p_order and cancelled_at is null;

  if v_o.status in ('pending', 'cancelled') then
    update public.orders
       set total = v_active,
           status = case when v_active > 0 then 'pending' else 'cancelled' end
     where id = p_order;
  elsif v_o.status = 'paid' and v_live = 0 then
    -- Paid, then everything in it was cancelled: someone decides about the money.
    update public.orders set status = 'refund_due' where id = p_order;
  elsif v_o.status = 'refund_due' and v_live > 0 then
    update public.orders set status = 'paid' where id = p_order;
  end if;
end;
$$;

-- Create or update the order item for one sold thing.
create or replace function public.sync_order_item(
  p_org uuid, p_kind text, p_ref uuid, p_location uuid, p_member uuid, p_guest_name text, p_guest_phone text,
  p_description text, p_amount numeric, p_active boolean
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_item  public.order_items;
  v_order uuid;
  v_paid  boolean;
begin
  select * into v_item from public.order_items i
   where (p_kind = 'session' and i.registration_id = p_ref)
      or (p_kind = 'court' and i.booking_id = p_ref)
      or (p_kind = 'package' and i.membership_id = p_ref);

  if not found then
    if not p_active or coalesce(p_amount, 0) <= 0 then return; end if;
    insert into public.orders (org_id, location_id, member_id, guest_name, guest_phone, currency)
    values (p_org, p_location, p_member, p_guest_name, p_guest_phone,
            (select currency from public.orgs where id = p_org))
    returning id into v_order;
    insert into public.order_items (org_id, order_id, kind, registration_id, booking_id, membership_id, description, amount)
    values (p_org, v_order, p_kind,
            case when p_kind = 'session' then p_ref end,
            case when p_kind = 'court' then p_ref end,
            case when p_kind = 'package' then p_ref end,
            p_description, p_amount);
  else
    v_order := v_item.order_id;
    select status in ('paid', 'refund_due', 'refunded') into v_paid from public.orders where id = v_order;
    update public.order_items
       set cancelled_at = case when p_active then null else coalesce(cancelled_at, now()) end,
           -- A paid amount never changes afterwards.
           amount = case when v_paid then amount else greatest(coalesce(p_amount, 0), 0) end
     where id = v_item.id;
  end if;
  perform public.recalc_order(v_order);
end;
$$;

-- Deferred triggers: they run when the transaction commits and re-read the row (final state).
create or replace function public.session_registrations_order()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  r public.session_registrations;
  s record;
begin
  select * into r from public.session_registrations where id = new.id;
  if not found then return null; end if;
  select so.name, so.location_id, so.starts_at, so.location_timezone into s from public.session_overview so where so.id = r.session_id;
  perform public.sync_order_item(r.org_id, 'session', r.id, s.location_id, r.member_id, r.guest_name, r.guest_phone,
    s.name || ', ' || to_char(s.starts_at at time zone s.location_timezone, 'Dy DD Mon HH24:MI'),
    r.price, r.status in ('booked', 'attended', 'no_show'));
  return null;
end;
$$;
create constraint trigger session_registrations_order after insert or update on public.session_registrations
  deferrable initially deferred for each row execute function public.session_registrations_order();

create or replace function public.bookings_order()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  b record;
begin
  select bc.*, l.timezone into b
    from public.booking_calendar bc join public.locations l on l.id = bc.location_id where bc.id = new.id;
  if not found or b.kind not in ('member', 'drop_in') then return null; end if;
  perform public.sync_order_item(b.org_id, 'court', b.id, b.location_id, b.member_id, b.guest_name, null,
    b.court_name || ', ' || to_char(b.start_at at time zone b.timezone, 'Dy DD Mon HH24:MI'),
    b.price, b.status = 'confirmed');
  return null;
end;
$$;
create constraint trigger bookings_order after insert or update on public.bookings
  deferrable initially deferred for each row execute function public.bookings_order();

create or replace function public.memberships_order()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  m public.memberships;
  v_name text;
begin
  select * into m from public.memberships where id = new.id;
  if not found then return null; end if;
  select name into v_name from public.package_types where id = m.package_type_id;
  perform public.sync_order_item(m.org_id, 'package', m.id, null, m.member_id, null, null,
    v_name, m.price_paid, m.status <> 'cancelled');
  return null;
end;
$$;
create constraint trigger memberships_order after insert or update on public.memberships
  deferrable initially deferred for each row execute function public.memberships_order();

-- ---------------------------------------------------------------------------
-- Recording payments
-- ---------------------------------------------------------------------------
create or replace function public.mark_order_paid(p_order uuid, p_method text, p_note text default null, p_slip text default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_method not in ('cash', 'transfer', 'promptpay', 'card', 'other') then
    raise exception 'Choose how it was paid';
  end if;
  update public.orders
     set status = 'paid', method = p_method, paid_amount = total, paid_at = now(), received_by = auth.uid(),
         note = coalesce(nullif(trim(p_note), ''), note), slip_path = coalesce(p_slip, slip_path)
   where id = p_order and status = 'pending';
  if not found then raise exception 'This is already paid or no longer due'; end if;
end;
$$;

-- Owners and managers: undo a payment marked by mistake.
create or replace function public.mark_order_unpaid(p_order uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if not public.has_org_role(v_org, '{owner,manager}') then
    raise exception 'Only an owner or manager can undo a payment';
  end if;
  update public.orders
     set status = 'pending', method = null, paid_amount = null, paid_at = null, received_by = null
   where id = p_order and status = 'paid';
  if not found then raise exception 'Only paid orders can be undone'; end if;
  perform public.recalc_order(p_order);
end;
$$;

-- Owners and managers: a paid order whose booking was cancelled. Refunded, or kept (e.g. as credit).
create or replace function public.resolve_refund(p_order uuid, p_refunded boolean, p_note text default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if not public.has_org_role(v_org, '{owner,manager}') then
    raise exception 'Only an owner or manager can decide about refunds';
  end if;
  update public.orders
     set status = case when p_refunded then 'refunded' else 'paid' end,
         note = coalesce(nullif(trim(p_note), ''), note, case when p_refunded then null else 'Kept after cancellation' end)
   where id = p_order and status = 'refund_due';
  if not found then raise exception 'There''s no refund to decide on this order'; end if;
end;
$$;

grant execute on function
  public.mark_order_paid(uuid, text, text, text),
  public.mark_order_unpaid(uuid),
  public.resolve_refund(uuid, boolean, text)
to authenticated;
revoke execute on function
  public.mark_order_paid(uuid, text, text, text),
  public.mark_order_unpaid(uuid),
  public.resolve_refund(uuid, boolean, text),
  public.recalc_order(uuid),
  public.sync_order_item(uuid, text, uuid, uuid, uuid, text, text, text, numeric, boolean)
from anon, public;

-- Transfer slips: private bucket, files under <org_id>/, staff of that club only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-slips', 'payment-slips', false, 3 * 1024 * 1024, array['image/jpeg'])
on conflict (id) do nothing;
create policy payment_slips_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-slips' and public.is_org_staff(public.logo_org(name)));
create policy payment_slips_select on storage.objects for select to authenticated
  using (bucket_id = 'payment-slips' and public.is_org_staff(public.logo_org(name)));

-- ---------------------------------------------------------------------------
-- Booking confirmations (with the amount due), when the desk books for a member.
-- ---------------------------------------------------------------------------
alter table public.member_notices drop constraint member_notices_kind_check;
alter table public.member_notices add constraint member_notices_kind_check
  check (kind in ('booking_confirmed', 'booking_reminder', 'package_ending', 'waitlist_moved_up', 'session_cancelled'));
alter table public.orgs drop constraint orgs_auto_notices_check;
alter table public.orgs add constraint orgs_auto_notices_check
  check (auto_notices <@ '{booking_confirmed,booking_reminder,package_ending,waitlist_moved_up,session_cancelled}'::text[]);
alter table public.orgs alter column auto_notices
  set default '{booking_confirmed,booking_reminder,package_ending,waitlist_moved_up,session_cancelled}';
update public.orgs set auto_notices = array_append(auto_notices, 'booking_confirmed')
 where not 'booking_confirmed' = any (auto_notices);

create or replace function public.session_registrations_confirm()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  r public.session_registrations;
begin
  select * into r from public.session_registrations where id = new.id;
  if not found or r.member_id is null or r.source <> 'desk' or r.status <> 'booked' then return null; end if;
  perform public.queue_member_notice(r.org_id, r.member_id, 'booking_confirmed', 'confirmed:reg:' || r.id,
    public.session_notice_payload(r.session_id) || jsonb_build_object(
      'type', 'session', 'amount', r.price,
      'covered_by', (select p.name from public.memberships ms join public.package_types p on p.id = ms.package_type_id
                      where ms.id = r.membership_id)));
  return null;
end;
$$;
create constraint trigger session_registrations_confirm after insert on public.session_registrations
  deferrable initially deferred for each row execute function public.session_registrations_confirm();

create or replace function public.bookings_confirm()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  b record;
begin
  select bc.*, l.timezone, bk.source into b
    from public.booking_calendar bc
    join public.locations l on l.id = bc.location_id
    join public.bookings bk on bk.id = bc.id
   where bc.id = new.id;
  if not found or b.member_id is null or b.source <> 'desk' or b.status <> 'confirmed'
     or b.kind not in ('member', 'drop_in') then return null; end if;
  perform public.queue_member_notice(b.org_id, b.member_id, 'booking_confirmed', 'confirmed:court:' || b.id,
    jsonb_build_object('type', 'court', 'court', b.court_name, 'location', b.location_name,
      'date', to_char(b.start_at at time zone b.timezone, 'YYYY-MM-DD'),
      'start', to_char(b.start_at at time zone b.timezone, 'HH24:MI'),
      'end', to_char(b.end_at at time zone b.timezone, 'HH24:MI'),
      'amount', b.price,
      'covered_by', case when b.kind = 'member' and b.price = 0 then 'package' end));
  return null;
end;
$$;
create constraint trigger bookings_confirm after insert on public.bookings
  deferrable initially deferred for each row execute function public.bookings_confirm();

-- ---------------------------------------------------------------------------
-- Chat court bookings are marked as such (no confirmation: the assistant already confirmed).
-- Same as 20261126040000_chat_keeps_answering.sql, plus that one line.
-- ---------------------------------------------------------------------------
create or replace function public.chat_book_court(p_conversation uuid, p_court uuid, p_start timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_c   public.chat_conversations;
  v_org public.orgs;
  v_id  uuid;
  v_b   public.bookings;
  v_court public.courts;
  v_loc public.locations;
begin
  select * into v_c from public.chat_conversations where id = p_conversation;
  if not found then raise exception 'Conversation not found'; end if;
  select * into v_org from public.orgs where id = v_c.org_id;
  if v_org.chat_mode <> 'book' then
    raise exception 'The club books courts itself. Tell them a team member will confirm';
  end if;
  -- A chat waiting for staff still gets answers and free bookings; only a closed chat, or one a
  -- person at the club is answering right now, is off limits.
  if v_c.status = 'closed' or v_c.assistant_paused_until > now() then
    raise exception 'Staff are handling this chat';
  end if;
  if v_c.member_id is null then
    raise exception 'Only members can book courts by chat. A team member will help a visitor';
  end if;
  select * into v_court from public.courts where id = p_court and org_id = v_c.org_id;
  if not found then raise exception 'Court not found'; end if;
  select * into v_loc from public.locations where id = v_court.location_id;

  v_id := public.create_booking(p_court, p_start, v_c.member_id, null, null, null, 'Booked by chat');
  -- Marked as a chat booking: the assistant already confirmed it in the chat.
  update public.bookings set source = 'chat' where id = v_id;
  select * into v_b from public.bookings where id = v_id;
  if v_b.price > 0 then
    raise exception 'This court time costs % %, so the club needs to confirm it', v_org.currency, regexp_replace(v_b.price::text, '\.00$', '');
  end if;

  return jsonb_build_object(
    'booking_id', v_b.id,
    'court', v_court.name,
    'location', v_loc.name,
    'when', to_char(lower(v_b.during) at time zone v_loc.timezone, 'Dy DD Mon HH24:MI'),
    'until', to_char(upper(v_b.during) at time zone v_loc.timezone, 'HH24:MI'),
    'price', v_b.price);
end;
$$;
