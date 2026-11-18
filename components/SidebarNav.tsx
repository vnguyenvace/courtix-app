"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  CalendarDays,
  House,
  LayoutGrid,
  MessageSquareReply,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

const ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/dashboard", label: "Dashboard", icon: House },
  { href: "/sessions", label: "Sessions", icon: CalendarDays },
  { href: "/bookings", label: "Courts", icon: LayoutGrid },
  { href: "/members", label: "Members", icon: Users },
  { href: "/replies", label: "Reply helper", icon: MessageSquareReply },
  { href: "/followups", label: "AI follow-ups", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
];

// The phone menu opens with a checkbox (id "nav-toggle" in app/(app)/layout.tsx; works without JS).
// Close it after each page change.
const NAV_TOGGLE_ID = "nav-toggle";

export default function SidebarNav() {
  const pathname = usePathname();

  useEffect(() => {
    const toggle = document.getElementById(NAV_TOGGLE_ID) as HTMLInputElement | null;
    if (toggle) toggle.checked = false;
  }, [pathname]);

  return (
    <nav className="nav" aria-label="Main">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link key={href} href={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
            <Icon size={18} strokeWidth={1.75} aria-hidden />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
