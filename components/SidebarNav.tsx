"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { NAV_LABELS } from "@/lib/nav";
import {
  CalendarDays,
  GraduationCap,
  House,
  LayoutGrid,
  LifeBuoy,
  MessageSquareReply,
  MessagesSquare,
  Settings,
  Sparkles,
  Sunrise,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

const ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/dashboard", label: NAV_LABELS["/dashboard"], icon: House },
  { href: "/morning", label: NAV_LABELS["/morning"], icon: Sunrise },
  { href: "/sessions", label: NAV_LABELS["/sessions"], icon: CalendarDays },
  { href: "/bookings", label: NAV_LABELS["/bookings"], icon: LayoutGrid },
  { href: "/coaches", label: NAV_LABELS["/coaches"], icon: GraduationCap },
  { href: "/members", label: NAV_LABELS["/members"], icon: Users },
  { href: "/payments", label: NAV_LABELS["/payments"], icon: Wallet },
  { href: "/chats", label: NAV_LABELS["/chats"], icon: MessagesSquare },
  { href: "/replies", label: NAV_LABELS["/replies"], icon: MessageSquareReply },
  { href: "/followups", label: NAV_LABELS["/followups"], icon: Sparkles },
  { href: "/settings", label: NAV_LABELS["/settings"], icon: Settings },
  { href: "/staff", label: NAV_LABELS["/staff"], icon: UserCog },
  { href: "/help", label: NAV_LABELS["/help"], icon: LifeBuoy },
];

// The phone menu opens with a checkbox (id "nav-toggle" in app/(app)/layout.tsx; works without JS).
// Close it after each page change.
const NAV_TOGGLE_ID = "nav-toggle";

/** `allowed`: the hrefs this person's role can open; `labels`: translated labels (worked out on the server). */
export default function SidebarNav({ allowed, labels = {} }: { allowed: string[]; labels?: Record<string, string> }) {
  const pathname = usePathname();

  useEffect(() => {
    const toggle = document.getElementById(NAV_TOGGLE_ID) as HTMLInputElement | null;
    if (toggle) toggle.checked = false;
  }, [pathname]);

  return (
    <nav className="nav" aria-label="Main">
      {ITEMS.filter((i) => allowed.includes(i.href)).map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link key={href} href={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
            <Icon size={18} strokeWidth={1.75} aria-hidden />
            <span>{labels[href] ?? label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
