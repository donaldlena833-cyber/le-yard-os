import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  CalendarDays,
  ChartNoAxesCombined,
  CheckSquare2,
  ChefHat,
  CircleDollarSign,
  ContactRound,
  Gauge,
  HandCoins,
  LayoutDashboard,
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
import { getStableMobileDestinationActions } from "@/lib/actions/action-registry";
import {
  hasAnyCapability,
  KITCHEN_CAPABILITIES,
  type OperationalCapability,
} from "@/lib/permissions/capabilities";
import type { AppRole } from "@/types";
import {
  type AppSurface,
  appSurface,
  isDestinationAllowedForAppSurface,
} from "@/lib/app-surface";

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
  surfaces?: readonly AppSurface[];
};

export const navigationSections: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Today",
    items: [{ href: "/today", label: "Today", icon: Gauge, mobile: true }],
  },
  {
    label: "Service",
    items: [
      { href: "/reservations", label: "Reservations", icon: LayoutDashboard, mobile: true, roles: ["owner", "admin"], anyCapabilities: ["reservations.view", "reservations.operate", "reservations.override", "reservations.configure"], surfaces: ["operations", "host"] },
      { href: "/reservations/setup", label: "Reservation controls", icon: Settings2, roles: ["owner", "admin"], anyCapabilities: ["reservations.configure", "reservations.override"], surfaces: ["operations", "host"] },
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
      { href: "/guests", label: "Guests", icon: ContactRound, roles: ["owner", "admin"], anyCapabilities: ["guest.manage", "guest.sensitive_notes.view", "guest_recovery.manage"], surfaces: ["operations", "host"] },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/income", label: "Income", icon: CircleDollarSign, roles: ["owner", "admin"], anyCapabilities: ["reports.financial.view"], hiddenPersonas: ["chef"] },
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
  if (!(item.surfaces ?? ["operations"]).includes(appSurface)) return false;
  if (item.personas && (!workspace.persona || !item.personas.includes(workspace.persona))) return false;
  if (item.hiddenPersonas?.includes(workspace.persona as "chef")) return false;
  if (!item.roles && !item.anyCapabilities) return true;
  return Boolean(
    item.roles?.includes(workspace.role)
    || (item.anyCapabilities && hasAnyCapability(workspace.capabilities, item.anyCapabilities)),
  );
}

export function getMobileNavItems(workspace: WorkspaceContextValue): NavItem[] {
  const preferredRoutes = getStableMobileDestinationActions(workspace, workspace.activeJob).map(
    (action) => action.destination,
  );
  const visibleByHref = new Map(
    allNavItems
      .filter((item) => isNavItemVisible(item, workspace))
      .map((item) => [item.href, item]),
  );
  return preferredRoutes
    .map((href) => visibleByHref.get(href))
    .filter((item): item is NavItem => Boolean(item));
}

export function isWorkspaceRouteAccessible(
  pathname: string,
  workspace: WorkspaceContextValue,
): boolean {
  if (!isDestinationAllowedForAppSurface(pathname)) return false;
  const item = allNavItems.find((candidate) => candidate.href === pathname);
  return item ? isNavItemVisible(item, workspace) : true;
}

export const routeMeta: Record<string, { title: string; detail: string }> = {
  "/today": { title: "Today", detail: "Current service" },
  "/reservations": { title: "Reservations", detail: "Book, seat, pace, and know every guest" },
  "/reservations/setup": { title: "Reservation controls", detail: "Floor, service rules, exceptions, and public booking approval" },
  "/schedule": { title: "Service", detail: "Schedule and availability" },
  "/service": { title: "Service Control", detail: "Availability, pre-shift, and handoff" },
  "/time-clock": { title: "Time Clock", detail: "Toast POS attendance mirror" },
  "/team": { title: "Team", detail: "People and job roles" },
  "/vendors": { title: "Vendors", detail: "Prices and purchasing" },
  "/kitchen": { title: "Kitchen", detail: "Recipes and production" },
  "/earnings": { title: "Earnings", detail: "Pay periods, tips, and hourly pay" },
  "/messages": { title: "Messages", detail: "Internal channels" },
  "/closeout": { title: "Money", detail: "Closeout, cash, and tips" },
  "/income": { title: "Income", detail: "Live revenue, costs, labor, and hourly demand" },
  "/receipts": { title: "Invoices", detail: "Document intake and review" },
  "/inventory": { title: "Inventory", detail: "Stock, counts, and purchasing" },
  "/guests": { title: "Guests", detail: "Hospitality CRM" },
  "/tasks": { title: "Operations", detail: "Tasks, SOPs, maintenance, and incidents" },
  "/reports": { title: "Insights", detail: "Operational reporting" },
  "/assistant": { title: "Ask Le Yard", detail: "Cited operational intelligence" },
  "/integrations": { title: "Integrations", detail: "Imports and sync health" },
  "/settings": { title: "Settings", detail: "Organization, capabilities, and security" },
};
