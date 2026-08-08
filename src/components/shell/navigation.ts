import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  ChefHat,
  CalendarDays,
  ChartNoAxesCombined,
  CheckSquare2,
  ContactRound,
  Gauge,
  HandCoins,
  MessageCircleMore,
  PlugZap,
  ReceiptText,
  Settings2,
  Sparkles,
  UsersRound,
  Truck,
  WalletCards,
} from "lucide-react";
import type { AppRole } from "@/types";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  mobile?: boolean;
  roles?: readonly AppRole[];
  personas?: readonly ("chef")[];
  hiddenPersonas?: readonly ("chef")[];
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
      {
        href: "/kitchen",
        label: "Kitchen",
        icon: ChefHat,
        mobile: true,
        roles: ["owner", "admin", "manager"],
      },
      { href: "/team", label: "Team", icon: UsersRound, roles: ["owner", "admin", "manager"], hiddenPersonas: ["chef"] },
      { href: "/vendors", label: "Vendors", icon: Truck, mobile: true, roles: ["owner", "admin", "manager", "employee"] },
      { href: "/earnings", label: "Earnings", icon: WalletCards, hiddenPersonas: ["chef"] },
      {
        href: "/messages",
        label: "Messages",
        icon: MessageCircleMore,
        mobile: true,
      },
    ],
  },
  {
    label: "Back office",
    items: [
      { href: "/closeout", label: "Closeout & tips", icon: HandCoins, roles: ["owner", "admin", "manager"], hiddenPersonas: ["chef"] },
      { href: "/receipts", label: "Receipts", icon: ReceiptText, roles: ["owner", "admin", "manager"], hiddenPersonas: ["chef"] },
      { href: "/inventory", label: "Inventory", icon: Boxes, roles: ["owner", "admin", "manager"], hiddenPersonas: ["chef"] },
      { href: "/guests", label: "Guests", icon: ContactRound, roles: ["owner", "admin", "manager"], hiddenPersonas: ["chef"] },
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
        roles: ["owner", "admin", "manager"], hiddenPersonas: ["chef"],
      },
      { href: "/assistant", label: "Ask Le Yard", icon: Sparkles, roles: ["owner", "admin", "manager"], hiddenPersonas: ["chef"] },
      { href: "/integrations", label: "Integrations", icon: PlugZap, roles: ["owner", "admin", "manager"], hiddenPersonas: ["chef"] },
    ],
  },
];

export const settingsItem: NavItem = {
  href: "/settings",
  label: "Settings",
  icon: Settings2,
  roles: ["owner", "admin", "manager"], hiddenPersonas: ["chef"],
};

export const allNavItems = [
  ...navigationSections.flatMap((section) => section.items),
  settingsItem,
];

export function isNavItemVisible(item: NavItem, role: AppRole, persona?: "chef"): boolean {
  if (item.personas && (!persona || !item.personas.includes(persona))) return false;
  if (item.hiddenPersonas?.some((hidden) => hidden === persona)) return false;
  return !item.roles || item.roles.includes(role);
}

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
    detail: "Le Yard team",
  },
  "/vendors": {
    title: "Vendors",
    detail: "Prices · Purchasing · Current room",
  },
  "/kitchen": {
    title: "Kitchen",
    detail: "BOH schedule · Recipes · Portion cost",
  },
  "/earnings": {
    title: "Earnings",
    detail: "Paystubs · Tips and hourly pay",
  },
  "/messages": {
    title: "Messages",
    detail: "Internal channels",
  },
  "/closeout": {
    title: "Closeout & tips",
    detail: "Saturday dinner · Draft",
  },
  "/receipts": {
    title: "Receipts",
    detail: "Invoice intake",
  },
  "/inventory": {
    title: "Inventory",
    detail: "Current location · Live count",
  },
  "/guests": {
    title: "Guests",
    detail: "Live guest CRM",
  },
  "/tasks": {
    title: "Tasks & SOPs",
    detail: "SOPs, maintenance, and incidents",
  },
  "/reports": {
    title: "Reports",
    detail: "Jul 26–Aug 1 · Le Yard",
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
