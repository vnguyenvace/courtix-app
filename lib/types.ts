// Hand-written row types for the starter. Once Supabase is running you can
// generate exact types with `npm run db:types` and switch to those.

export type StaffRole = "owner" | "manager" | "staff";
export type PackageKind = "time_based" | "class_pack";
export type MembershipStatus = "active" | "paused" | "expired" | "cancelled";
export type BookingKind = "member" | "drop_in" | "open_play" | "coaching" | "maintenance";
export type BookingStatus = "confirmed" | "cancelled" | "no_show" | "completed";

export interface Org {
  id: string;
  name: string;
  slug: string;
  sport: string;
  timezone: string;
  currency: string;
  default_language: string;
  opens_at: string; // "07:00:00"
  closes_at: string;
  slot_minutes: number;
  booking_advance_days: number;
  max_active_bookings: number;
  at_risk_days: number;
  renewal_window_days: number;
  ai_voice: string;
  ai_sign_off: string | null;
  ai_offers: string | null;
  followup_cooldown_days: number;
  late_cancel_hours: number; // cancel at least this long before a session to get a credit back
  public_booking: boolean; // the public booking page (<slug>.courtix.app/book) is on
  online_signups: "instant" | "approve"; // online sign-ups take the spot, or wait for staff approval
  logo_path: string | null; // in Storage bucket club-logos, "<org_id>/logo-....png"
  brand_primary: string | null; // "#rrggbb"; null = standard Courtix colours
  brand_secondary: string | null;
  brand_palette: string[]; // colours found in the logo, offered as suggestions
}

export interface Court {
  id: string;
  org_id: string;
  location_id: string;
  name: string;
  is_covered: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface PackageType {
  id: string;
  org_id: string;
  name: string;
  kind: PackageKind;
  duration_days: number | null;
  sessions: number | null;
  price: number;
  max_active_bookings: number | null;
  is_active: boolean;
  location_ids: string[] | null;
  priority_days: number; // members with this package can sign up this many days earlier
}

/** Which sessions a package covers (one rule per row; any match covers). */
export interface PackageCoverage {
  id: string;
  org_id: string;
  package_type_id: string;
  session_type_id: string | null; // or
  category: SessionCategory | null; // both null = every session
  days_of_week: number[] | null; // 0 = Sunday; null = every day
  start_time: string | null; // session must start in [start_time, end_time)
  end_time: string | null;
}

export interface RateRule {
  id: string;
  org_id: string;
  label: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  drop_in_price: number;
  member_price: number;
  priority: number;
  location_id: string | null;
}

export interface Member {
  id: string;
  org_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  line_user_id: string | null;
  whatsapp: string | null;
  language: string;
  skill_level: number | null;
  usual_play_time: string | null;
  notes: string | null;
  marketing_consent: boolean;
  created_at: string;
  home_location_id: string | null;
  /** null = automatic; see member_channel() in the database */
  preferred_channel: MessageChannel | null;
}

export type MessageChannel = "whatsapp" | "line";

export interface Membership {
  id: string;
  member_id: string;
  package_type_id: string;
  status: MembershipStatus;
  starts_on: string;
  ends_on: string | null;
  sessions_left: number | null;
  price_paid: number;
  paused_from: string | null;
  paused_until: string | null;
  created_at: string;
  package_types?: { name: string } | null;
}

export interface MemberStatus {
  member_id: string;
  org_id: string;
  full_name: string;
  language: string;
  phone: string | null;
  line_user_id: string | null;
  marketing_consent: boolean;
  membership_id: string | null;
  package_name: string | null;
  membership_status: MembershipStatus | null;
  ends_on: string | null;
  sessions_left: number | null;
  days_to_expiry: number | null;
  last_check_in: string | null;
  days_since_visit: number | null;
  upcoming_bookings: number;
  is_at_risk: boolean;
  is_renewing_soon: boolean;
  is_drop_in_lead: boolean;
}

export interface BookingRow {
  id: string;
  org_id: string;
  court_id: string;
  court_name: string;
  member_id: string | null;
  member_name: string | null;
  guest_name: string | null;
  kind: BookingKind;
  status: BookingStatus;
  start_at: string;
  end_at: string;
  price: number;
  notes: string | null;
  session_id: string | null;
  location_id: string;
  location_name: string;
}

export interface Dashboard {
  org_id: string;
  active_members: number;
  paused_members: number;
  at_risk: number;
  renewing_soon: number;
  drop_in_leads: number;
  bookings_today: number;
  sessions_today: number;
  package_sales_this_month: number;
}

// ---------------------------------------------------------------- Sessions

export type SessionCategory = "open_play" | "clinic" | "match_play" | "camp" | "tournament" | "course" | "other";
export type SessionStatus = "scheduled" | "confirmed" | "cancelled";
export type RegistrationStatus = "booked" | "waitlisted" | "cancelled" | "attended" | "no_show" | "requested"; // requested = online, waiting for staff

export const CATEGORY_LABELS: Record<SessionCategory, string> = {
  open_play: "Open play",
  clinic: "Clinic",
  match_play: "Match play",
  camp: "Camp",
  tournament: "Tournament",
  course: "Course",
  other: "Other",
};

export interface SessionType {
  id: string;
  org_id: string;
  name: string;
  category: SessionCategory;
  description: string | null;
  price: number;
  duration_minutes: number;
  min_players: number;
  max_players: number;
  min_age: number | null;
  level_min: number | null;
  level_max: number | null;
  book_by_minutes: number;
  min_check_hours: number;
  is_active: boolean;
  signup_opens_days: number | null; // null = sign-ups open any time
  is_public: boolean; // listed on the public booking page
}

export interface SessionSchedule {
  id: string;
  org_id: string;
  session_type_id: string;
  days_of_week: number[];
  start_time: string;
  court_ids: string[];
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
  location_id: string;
}

export interface SessionOverview {
  id: string;
  org_id: string;
  session_type_id: string;
  schedule_id: string | null;
  name: string;
  type_name: string;
  category: SessionCategory;
  description: string | null;
  starts_at: string;
  ends_at: string;
  price: number;
  min_players: number;
  max_players: number;
  level_min: number | null;
  level_max: number | null;
  min_age: number | null;
  coach_name: string | null;
  status: SessionStatus;
  cancel_reason: string | null;
  notes: string | null;
  booked: number;
  waitlisted: number;
  spots_left: number;
  min_reached: boolean;
  book_by: string;
  courts: string | null;
  location_id: string;
  location_name: string;
  location_timezone: string;
}

export interface RosterRow {
  id: string;
  session_id: string;
  member_id: string | null;
  name: string;
  is_guest: boolean;
  phone: string | null;
  language: string | null;
  skill_level: number | null;
  status: RegistrationStatus;
  price: number;
  notes: string | null;
  created_at: string;
  membership_id: string | null; // the package that covered this place
  credit_used: boolean; // a class-pack credit was taken
  covered_by: string | null; // package name
  covered_kind: PackageKind | null;
  sessions_left: number | null; // credits left on that pack
  source: "desk" | "online"; // online = signed up on the public booking page
}

// ---------------------------------------------------------------- AI follow-ups

export type FollowupReason = "at_risk" | "renewal" | "drop_in_lead" | "fill_session";
export type MessageStatus = "draft" | "sent" | "dismissed";

export const REASON_LABELS: Record<FollowupReason, string> = {
  renewal: "Renewal",
  at_risk: "Missing you",
  drop_in_lead: "Drop-in lead",
  fill_session: "Session invite",
};

export interface AiMessage {
  id: string;
  org_id: string;
  member_id: string;
  reason: FollowupReason;
  session_id: string | null;
  channel: string;
  language: string;
  body: string;
  context: Record<string, any>;
  model: string | null;
  status: MessageStatus;
  created_at: string;
  sent_at: string | null;
  members?: {
    full_name: string;
    phone: string | null;
    whatsapp: string | null;
    /** computed by the database function member_channel() */
    member_channel: MessageChannel;
  } | null;
}

export interface AiFollowupStats {
  org_id: string;
  drafts_waiting: number;
  sent_30d: number;
  responded_30d: number;
  package_revenue_30d: number;
}

// ---------------------------------------------------------------- Locations

export interface Location {
  id: string;
  org_id: string;
  name: string;
  address: string | null;
  timezone: string;
  opens_at: string;
  closes_at: string;
  slot_minutes: number;
  whatsapp: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface LocationDashboard {
  location_id: string;
  org_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  courts: number;
  home_members: number;
  sessions_today: number;
  bookings_today: number;
  players_30d: number;
  visits_30d: number;
  session_fill_pct_30d: number | null;
  session_revenue_30d: number;
  court_revenue_30d: number;
}

/** A reply drafted by the reply helper for a message a member or visitor sent. */
export interface InquiryReply {
  id: string;
  org_id: string;
  location_id: string | null;
  member_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  incoming: string;
  reply: string;
  context: Record<string, any>;
  model: string | null;
  status: MessageStatus;
  channel: "whatsapp" | "line" | "other" | null;
  created_at: string;
  sent_at: string | null;
  members?: {
    full_name: string;
    phone: string | null;
    whatsapp: string | null;
    member_channel: MessageChannel;
  } | null;
}
