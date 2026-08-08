import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  CalendarDays,
  ChartNoAxesCombined,
  CheckSquare2,
  ChefHat,
  ContactRound,
  Gauge,
  HandCoins,
  MessageCircleMore,
  PlugZap,
  ReceiptText,
  RadioTower,
  Settings2,
  Sparkles,
  Timer,
  Truck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import {
  hasAnyCapability,
  KITCHEN_CAPABILITIES,
  type OperationalCapability,
} from "@/lib/permissions/capabilities";
import type { AppRole } from "@/types";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  mobile?: boolean;
  roles?: readonly AppRole[];
  anyCapabilities?: readonly OperationalCapability[];
  personas?: readonly "chef"[];
  hiddenPersonas?: readonly "chef"[];
};

export const navigationSections: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Today",
    items: [{ href: "/today", label: "Today", icon: Gauge, mobile: true }],
  },
  {
    label: "Service",
    items: [
      { href: "/schedule", label: "Schedule", icon: CalendarDays, mobile: true },
      { href: "/service", label: "Service Control", icon: RadioTower },
      { href: "/time-clock", label: "Time Clock", icon: Timer, mobile: true },
      { href: "/messages", label: "Messages", icon: MessageCircleMore, mobile: true },
    ],
  },
  {
    label: "Kitchen",
    items: [
      { href: "/kitchen", label: "Kitchen", icon: ChefHat, mobile: true, roles: ["owner", "admin"], anyCapabilities: KITCHEN_CAPABILITIES },
      { href: "/inventory", label: "Inventory", icon: Boxes, roles: ["owner", "admin"], anyCapabilities: KITCHEN_CAPABILITIES },
      { href: "/vendors", label: "Vendors", icon: Truck, roles: ["owner", "admin"], anyCapabilities: ["inventory.vendor.manage", "inventory.price.manage", "inventory.purchase.create", "inventory.receive"] },
    ],
  },
  {
    label: "Team",
    items: [
      { href: "/team", label: "People", icon: UsersRound, roles: ["owner", "admin", "manager"], hiddenPersonas: ["chef"] },
      { href: "/earnings", label: "Earnings", icon: WalletCards, mobile: true, hiddenPersonas: ["chef"] },
    ],
  },
  {
    label: "Guests",
    items: [
      { href: "/guests", label: "Guests", icon: ContactRound, roles: ["owner", "admin"], anyCapabilities: ["guest.manage", "guest.sensitive_notes.view", "guest_recovery.manage"] },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/closeout", label: "Closeout & tips", icon: HandCoins, roles: ["owner", "admin"], anyCapabilities: ["closeout.create", "closeout.approve", "cash.manage", "tip.calculate", "tip.approve"], hiddenPersonas: ["chef"] },
      { href: "/receipts", label: "Invoices", icon: ReceiptText, roles: ["owner", "admin", "manager"], hiddenPersonas: ["chef"] },
    ],
  },
  {
    label: "Operations",
    items: [{ href: "/tasks", label: "Tasks & SOPs", icon: CheckSquare2 }],
  },
  {
    label: "Insights",
    items: [
      { href: "/reports", label: "Reports", icon: ChartNoAxesCombined, roles: ["owner", "admin"], anyCapabilities: ["reports.operational.view", "reports.financial.view"] },
      { href: "/assistant", label: "Ask Le Yard", icon: Sparkles, roles: ["owner", "admin"], anyCapabilities: ["reports.operational.view", "reports.financial.view"] },
      { href: "/integrations", label: "Integrations", icon: PlugZap, roles: ["owner", "admin"], anyCapabilities: ["integrations.manage"] },
    ],
  },
];

export const settingsItem: NavItem = {
  href: "/settings",
  label: "Settings",
  icon: Settings2,
  roles: ["owner", "admin"],
};

export const allNavItems = [
  ...navigationSections.flatMap((section) => section.items),
  settingsItem,
];

export function isNavItemVisible(item: NavItem, workspace: WorkspaceContextValue): boolean {
  if (item.personas && (!workspace.persona || !item.personas.includes(workspace.persona))) return false;
  if (item.hiddenPersonas?.includes(workspace.persona as "chef")) return false;
  if (!item.roles && !item.anyCapabilities) return true;
  return Boolean(
    item.roles?.includes(workspace.role)
    || (item.anyCapabilities && hasAnyCapability(workspace.capabilities, item.anyCapabilities)),
  );
}

export const routeMeta: Record<string, { title: string; detail: string }> = {
  "/today": { title: "Today", detail: "Current service" },
  "/schedule": { title: "Service", detail: "Schedule and availability" },
  "/service": { title: "Service Control", detail: "Availability, pre-shift, and handoff" },
  "/time-clock": { title: "Time Clock", detail: "Punches, breaks, and corrections" },
  "/team": { title: "Team", detail: "People and job roles" },
  "/vendors": { title: "Vendors", detail: "Prices and purchasing" },
  "/kitchen": { title: "Kitchen", detail: "Recipes and production" },
  "/earnings": { title: "Earnings", detail: "Pay periods, tips, and hourly pay" },
  "/messages": { title: "Messages", detail: "Internal channels" },
  "/closeout": { title: "Money", detail: "Closeout, cash, and tips" },
  "/receipts": { title: "Invoices", detail: "Document intake and review" },
  "/inventory": { title: "Inventory", detail: "Stock, counts, and purchasing" },
  "/guests": { title: "Guests", detail: "Hospitality CRM" },
  "/tasks": { title: "Operations", detail: "Tasks, SOPs, maintenance, and incidents" },
  "/reports": { title: "Insights", detail: "Operational reporting" },
  "/assistant": { title: "Ask Le Yard", detail: "Cited operational intelligence" },
  "/integrations": { title: "Integrations", detail: "Imports and sync health" },
  "/settings": { title: "Settings", detail: "Organization, capabilities, and security" },
};
