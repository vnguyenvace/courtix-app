// Club roles and what they may do. The database (role_permissions, has_org_permission) is the
// source of truth and enforces it; this file names things for the app and hides what a person
// can't use. Keep ROLE_PERMISSIONS in sync with supabase/migrations/20261127000100_staff_permissions.sql.
import type { StaffRole } from "@/lib/types";

export type Permission =
  | "bookings.manage"
  | "members.view"
  | "members.edit"
  | "payments.record"
  | "payments.refund"
  | "chats.reply"
  | "followups.send"
  | "followups.manage"
  | "reports.view"
  | "club.setup"
  | "settings.manage"
  | "members.export"
  | "staff.manage";

/** In the order shown in the role picker. 'manager' is shown as "Admin". */
export const ROLES: StaffRole[] = ["owner", "manager", "front_desk", "marketing", "back_office"];

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  manager: "Admin",
  front_desk: "Front desk",
  marketing: "Marketing",
  back_office: "Back office",
};

export const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  owner: "Everything, including staff, member data export and closing the club.",
  manager: "Runs the club: setup, prices, settings, payments and refunds. Can't manage staff.",
  front_desk: "Bookings, check-ins, members, selling packages, recording payments and chats. No refunds or settings.",
  marketing: "Sees members, answers chats, writes and approves follow-ups and offers. No bookings or payments.",
  back_office: "Payments, refunds and revenue figures. Sees members, but no bookings or chats.",
};

/** For the role picker's explanation; the database decides. */
export const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  owner: [
    "bookings.manage", "members.view", "members.edit", "payments.record", "payments.refund", "chats.reply",
    "followups.send", "followups.manage", "reports.view", "club.setup", "settings.manage", "members.export", "staff.manage",
  ],
  manager: [
    "bookings.manage", "members.view", "members.edit", "payments.record", "payments.refund", "chats.reply",
    "followups.send", "followups.manage", "reports.view", "club.setup", "settings.manage",
  ],
  front_desk: ["bookings.manage", "members.view", "members.edit", "payments.record", "chats.reply", "followups.send"],
  marketing: ["members.view", "chats.reply", "followups.send", "followups.manage"],
  back_office: ["members.view", "payments.record", "payments.refund", "reports.view"],
};

/** Which permission opens each page in the sidebar (no entry: everyone on the staff; Settings is read-only without settings.manage). */
export const PAGE_PERMISSION: Record<string, Permission> = {
  "/sessions": "members.view",
  "/bookings": "members.view",
  "/members": "members.view",
  "/payments": "payments.record",
  "/chats": "chats.reply",
  "/replies": "chats.reply",
  "/followups": "followups.send",
  "/staff": "staff.manage",
};

/** The invite link is shown once to the owner after adding someone (the database keeps only a hash). */
export const INVITE_LINK_COOKIE = "staff_invite_link";
