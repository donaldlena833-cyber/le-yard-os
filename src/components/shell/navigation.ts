import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  CalendarDays,
  ChartNoAxesCombined,
  CheckSquare2,
  Clock3,
  ContactRound,
  Gauge,
  HandCoins,
  MessageCircleMore,
  PlugZap,
  ReceiptText,
  Settings2,
  Sparkles,
  UsersRound,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  mobile?: boolean;
};

export const navigationSections: Array<{
  label: string;
  items: NavItem[];
}> = [
  {
    label: "Service",
    items: [
      { href: "/today", label: "Today", icon: Gauge, mobile: true },
      {
        href: "/schedule",
        label: "Schedule",
        icon: CalendarDays,
        mobile: true,
      },
      { href: "/team", label: "Team", icon: UsersRound },
      { href: "/time-clock", label: "Time clock", icon: Clock3, mobile: true },
      {
        href: "/messages",
        label: "Messages",
        icon: MessageCircleMore,
        badge: "4",
        mobile: true,
      },
    ],
  },
  {
    label: "Back office",
    items: [
      { href: "/closeout", label: "Closeout & tips", icon: HandCoins },
      { href: "/receipts", label: "Receipts", icon: ReceiptText, badge: "3" },
      { href: "/inventory", label: "Inventory", icon: Boxes },
      { href: "/guests", label: "Guests", icon: ContactRound },
      { href: "/tasks", label: "Tasks & SOPs", icon: CheckSquare2 },
    ],
  },
  {
    label: "Intelligence",
    items: [
      {
        href: "/reports",
        label: "Reports",
        icon: ChartNoAxesCombined,
      },
      { href: "/assistant", label: "Ask Le Yard", icon: Sparkles },
      { href: "/integrations", label: "Integrations", icon: PlugZap },
    ],
  },
];

export const settingsItem: NavItem = {
  href: "/settings",
  label: "Settings",
  icon: Settings2,
};

export const allNavItems = [
  ...navigationSections.flatMap((section) => section.items),
  settingsItem,
];

export const mobileNavItems = navigationSections[0].items.filter(
  (item) => item.mobile,
);

export const routeMeta: Record<string, { title: string; detail: string }> = {
  "/today": {
    title: "Today",
    detail: "Saturday service · August 1",
  },
  "/schedule": {
    title: "Schedule",
    detail: "Aug 3–9 · Current location",
  },
  "/team": {
    title: "Team",
    detail: "18 active people · 2 locations",
  },
  "/time-clock": {
    title: "Time clock",
    detail: "Live attendance · Current location",
  },
  "/messages": {
    title: "Messages",
    detail: "4 unread across 3 channels",
  },
  "/closeout": {
    title: "Closeout & tips",
    detail: "Saturday dinner · Draft",
  },
  "/receipts": {
    title: "Receipts",
    detail: "3 documents need review",
  },
  "/inventory": {
    title: "Inventory",
    detail: "Current location · Live count",
  },
  "/guests": {
    title: "Guests",
    detail: "1,248 unified profiles",
  },
  "/tasks": {
    title: "Tasks & SOPs",
    detail: "7 due before service",
  },
  "/reports": {
    title: "Reports",
    detail: "Jul 26–Aug 1 · All locations",
  },
  "/assistant": {
    title: "Ask Le Yard",
    detail: "Permission-aware operations intelligence",
  },
  "/integrations": {
    title: "Integrations",
    detail: "Imports, credentials, and sync health",
  },
  "/settings": {
    title: "Settings",
    detail: "Organization, security, and policies",
  },
};
