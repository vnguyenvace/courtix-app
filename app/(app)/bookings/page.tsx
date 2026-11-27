import Link from "next/link";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { requireOrg } from "@/lib/org";
import { Banner, param, type SearchParams } from "@/components/Banner";
import { addDays, formatLongDay, isValidDate, localTime, slotTimes, todayIn, zonedToUtc } from "@/lib/time";
import { setBookingStatus } from "../actions";
import type { BookingRow, Court } from "@/lib/types";

export default async function BookingsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { supabase, org, locations, workLocation, myLocations, multiLocation } = await requireOrg();
  const at = param(sp, "at");
  const loc = locations.find((l) => l.id === at && l.is_active) ?? workLocation;
  const today = todayIn(loc.timezone);
  const requested = param(sp, "date");
  const date = isValidDate(requested) ? requested : today;

  const dayStart = zonedToUtc(date, "00:00", loc.timezone);
  const dayEnd = zonedToUtc(addDays(date, 1), "00:00", loc.timezone);

  const [{ data: courtData }, { data: bookingData }] = await Promise.all([
    supabase.from("courts").select("*").eq("location_id", loc.id).eq("is_active", true).order("sort_order"),
    supabase
      .from("booking_calendar")
      .select("*")
      .eq("location_id", loc.id)
      .in("status", ["confirmed", "completed", "no_show"])
      .lt("start_at", dayEnd.toISOString())
      .gt("end_at", dayStart.toISOString())
      .order("start_at"),
  ]);

  const courts = (courtData ?? []) as Court[];
  const bookings = (bookingData ?? []) as BookingRow[];
  const slots = slotTimes(loc.opens_at, loc.closes_at, loc.slot_minutes);
  const now = Date.now();
  const returnTo = `/bookings?at=${loc.id}&date=${date}`;

  // A slot is taken if any booking overlaps any part of it, so a session starting at 08:30
  // shows in the 08:00 row instead of leaving a "Book" link that would be refused.
  function bookingAt(courtId: string, slot: string) {
    const t = zonedToUtc(date, slot, loc.timezone).getTime();
    const tEnd = t + loc.slot_minutes * 60000;
    return bookings.find(
      (b) => b.court_id === courtId && new Date(b.start_at).getTime() < tEnd && new Date(b.end_at).getTime() > t,
    );
  }
  const firstSlotStart = slots.length ? zonedToUtc(date, slots[0], loc.timezone).getTime() : 0;

  const confirmedCount = bookings.filter((b) => b.status === "confirmed").length;
  const totalSlots = slots.length * courts.length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Courts{multiLocation ? ` · ${loc.name}` : ""}</h1>
          <p className="muted">
            {formatLongDay(date)} · {confirmedCount} booked of {totalSlots} slots
          </p>
        </div>
        <form className="actions">
          <Link className="button" href={`/bookings?at=${loc.id}&date=${addDays(date, -1)}`} aria-label="Previous day">←</Link>
          <input type="hidden" name="at" value={loc.id} />
          <input type="date" name="date" defaultValue={date} style={{ width: 160 }} />
          <button>Go</button>
          <Link className="button" href={`/bookings?at=${loc.id}&date=${addDays(date, 1)}`} aria-label="Next day">→</Link>
          {date !== today && <Link className="button" href={`/bookings?at=${loc.id}`}>Today</Link>}
        </form>
      </div>
      <Banner sp={sp} />

      {multiLocation && (
        <div className="actions" style={{ marginBottom: 14 }}>
          {locations
            .filter((l) => l.is_active)
            .map((l) => (
              <Link
                key={l.id}
                href={`/bookings?at=${l.id}&date=${date}`}
                className={`badge ${l.id === loc.id ? "ok" : ""}`}
              >
                {l.name}
                {!myLocations.some((m) => m.id === l.id) ? " (view only)" : ""}
              </Link>
            ))}
        </div>
      )}

      {courts.length === 0 ? (
        <div className="card">
          <p>No active courts at {loc.name} yet. <Link href="/settings">Add courts in Settings.</Link></p>
        </div>
      ) : (
        <div className="table-wrap">
          <div
            className="cal"
            style={{ gridTemplateColumns: `64px repeat(${courts.length}, minmax(140px, 1fr))`, minWidth: 64 + courts.length * 140 }}
          >
            <div className="cal-cell cal-head"></div>
            {courts.map((c) => (
              <div key={c.id} className="cal-cell cal-head">
                {c.name}
                {c.is_covered && <span className="muted small"> · covered</span>}
              </div>
            ))}

            {slots.map((slot) => {
              const slotStart = zonedToUtc(date, slot, loc.timezone).getTime();
              const isPast = slotStart + loc.slot_minutes * 60000 <= now;
              return (
                <Row key={slot}>
                  <div className="cal-cell cal-time">{slot}</div>
                  {courts.map((c) => {
                    const b = bookingAt(c.id, slot);
                    if (b) {
                      const bStart = new Date(b.start_at).getTime();
                      // Label the booking in the slot it starts in (or the first slot, if it started earlier).
                      const startsHere =
                        (bStart >= slotStart && bStart < slotStart + loc.slot_minutes * 60000) ||
                        (bStart < slotStart && slotStart === firstSlotStart);
                      const offGrid = localTime(b.start_at, loc.timezone) !== slot;
                      return (
                        <div key={c.id} className="cal-cell">
                          <div className={`booking ${b.kind}`}>
                            {startsHere ? (
                              <>
                                <div className="who">
                                  {b.session_id ? (
                                    <Link href={`/sessions/${b.session_id}`} style={{ color: "inherit" }}>
                                      {b.notes ?? "Session"}
                                    </Link>
                                  ) : b.member_id ? (
                                    <Link href={`/members/${b.member_id}`} style={{ color: "inherit" }}>
                                      {b.member_name}
                                    </Link>
                                  ) : (
                                    b.guest_name ?? b.kind.replace("_", " ")
                                  )}
                                </div>
                                <div className="small">
                                  {offGrid && `${localTime(b.start_at, loc.timezone)}–${localTime(b.end_at, loc.timezone)} · `}
                                  {b.session_id ? "session" : b.kind.replace("_", " ")}
                                  {b.price > 0 && ` · ${Math.round(b.price)} ${org.currency}`}
                                  {b.status !== "confirmed" && ` · ${b.status.replace("_", "-")}`}
                                </div>
                                {b.status === "confirmed" && !b.session_id && (
                                  <div className="actions small" style={{ marginTop: 4, gap: 10 }}>
                                    {new Date(b.start_at).getTime() <= now && b.member_id && (
                                      <StatusButton id={b.id} memberId={b.member_id} status="completed" label="Played" returnTo={returnTo} />
                                    )}
                                    {new Date(b.start_at).getTime() <= now && (
                                      <StatusButton id={b.id} memberId={b.member_id} status="no_show" label="No-show" returnTo={returnTo} />
                                    )}
                                    {new Date(b.end_at).getTime() > now && (
                                      <StatusButton id={b.id} memberId={b.member_id} status="cancelled" label="Cancel" returnTo={returnTo} />
                                    )}
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="small">continued</div>
                            )}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={c.id} className="cal-cell">
                        {isPast ? (
                          <div className="slot-past" />
                        ) : (
                          <Link className="slot-free" href={`/bookings/new?court=${c.id}&date=${date}&time=${slot}`}>
                            Book
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </Row>
              );
            })}
          </div>
        </div>
      )}

      <p className="muted small" style={{ marginTop: 12 }}>
        <span className="badge ok">member</span> <span className="badge info">drop-in</span>{" "}
        <span className="badge warn">coaching or open play</span> · Members can book up to{" "}
        {org.booking_advance_days} days ahead, {org.max_active_bookings} upcoming bookings at a time.
      </p>
    </>
  );
}

// CSS grid rows are just their cells; this keeps the JSX readable.
function Row({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function StatusButton({
  id,
  memberId,
  status,
  label,
  returnTo,
}: {
  id: string;
  memberId: string | null;
  status: string;
  label: string;
  returnTo: string;
}) {
  return (
    <form action={setBookingStatus} className="inline">
      <input type="hidden" name="booking_id" value={id} />
      <input type="hidden" name="member_id" value={memberId ?? ""} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="return_to" value={returnTo} />
      {status === "cancelled" ? (
        <ConfirmSubmit label={label} confirm="Yes, cancel booking" />
      ) : (
        <button className="link" style={{ color: "inherit", textDecoration: "underline" }}>{label}</button>
      )}
    </form>
  );
}
