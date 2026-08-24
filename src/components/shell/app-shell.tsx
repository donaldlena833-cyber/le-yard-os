"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  CheckCheck,
  Command,
  LoaderCircle,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { useFormStatus } from "react-dom";
import { signOutAction } from "@/app/actions/auth";
import { ThemeProvider, useTheme } from "@/components/providers/theme-provider";
import {
  ConnectivityProvider,
  ConnectivityStatusNotice,
  useConnectivity,
} from "@/components/providers/connectivity-provider";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Avatar } from "@/components/ui/avatar";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button, buttonVariants } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Popover } from "@/components/ui/popover";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import { ActionOmnibox } from "@/components/shell/action-omnibox";
import {
  allNavItems,
  getMobileNavItems,
  navigationSections,
  isNavItemVisible,
  routeMeta,
  settingsItem,
} from "@/components/shell/navigation";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { safeInternalRedirect } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database.generated";
import {
  isHostSurface,
  surfaceProductDetail,
  surfaceProductName,
} from "@/lib/app-surface";

const shellRoleLabel: Record<WorkspaceContextValue["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  employee: "Employee",
};

function workspaceHeaderDetail(workspace: WorkspaceContextValue): string {
  const locationName = workspace.activeLocation.name.trim();
  const organizationName = workspace.organization.name.trim();

  if (locationName.localeCompare(organizationName, undefined, { sensitivity: "base" }) === 0) {
    return locationName;
  }

  return `${locationName} · ${organizationName}`;
}

function SignOutButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="focus-ring flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[13px] font-medium text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white/90 disabled:cursor-wait disabled:opacity-60 lg:min-h-10"
    >
      {pending ? (
        <LoaderCircle aria-hidden="true" className="size-[15px] shrink-0 animate-spin" />
      ) : (
        <LogOut aria-hidden="true" className="size-[15px] shrink-0" />
      )}
      <span aria-live="polite">{pending ? "Logging out…" : "Log out"}</span>
    </button>
  );
}

function SignOutControl({ className }: { className?: string }) {
  return (
    <form action={signOutAction} className={className}>
      <SignOutButton />
    </form>
  );
}

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

interface ShellNotification {
  id: string;
  title: string;
  body: string | null;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

function normalizeNotification(row: NotificationRow): ShellNotification {
  const actionUrl = row.action_url
    ? safeInternalRedirect(row.action_url, "") || null
    : null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    actionUrl,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

function notificationAge(value: string): string {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).valueOf()) / 60_000));
  if (elapsedMinutes < 1) return "now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  if (elapsedMinutes < 1_440) return `${Math.floor(elapsedMinutes / 60)}h`;
  return `${Math.floor(elapsedMinutes / 1_440)}d`;
}

function NotificationsControl({ workspace }: { workspace: WorkspaceContextValue }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<ShellNotification[]>(
    [],
  );
  const [state, setState] = useState<"loading" | "ready" | "error">(
    workspace.mode === "demo" ? "ready" : "loading",
  );
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  useEffect(() => {
    if (workspace.mode !== "live") return;
    const supabase = createClient();
    let cancelled = false;

    async function load() {
      const result = await supabase
        .from("notifications")
        .select("id, organization_id, user_id, notification_type, title, body, action_url, entity_type, entity_id, evidence_key, read_at, created_at")
        .eq("organization_id", workspace.organization.id)
        .eq("user_id", workspace.identity.userId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (cancelled) return;
      if (result.error) {
        setState("error");
        return;
      }
      setNotifications((result.data ?? []).map(normalizeNotification));
      setState("ready");
    }

    void load();
    const channel = supabase
      .channel(`notifications:${workspace.organization.id}:${workspace.identity.userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${workspace.identity.userId}`,
        },
        () => void load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [workspace.identity.userId, workspace.mode, workspace.organization.id]);

  async function markRead(notification: ShellNotification) {
    if (workspace.mode === "live" && !notification.readAt) {
      const readAt = new Date().toISOString();
      const result = await createClient()
        .from("notifications")
        .update({ read_at: readAt })
        .eq("id", notification.id)
        .eq("organization_id", workspace.organization.id)
        .eq("user_id", workspace.identity.userId);
      if (result.error) {
        setState("error");
        return;
      }
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt } : item));
    }
    if (notification.actionUrl) {
      router.push(notification.actionUrl);
      setOpen(false);
    }
  }

  async function markAllRead() {
    if (workspace.mode !== "live" || unreadCount === 0) return;
    const readAt = new Date().toISOString();
    const result = await createClient()
      .from("notifications")
      .update({ read_at: readAt })
      .eq("organization_id", workspace.organization.id)
      .eq("user_id", workspace.identity.userId)
      .is("read_at", null);
    if (result.error) {
      setState("error");
      return;
    }
    setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })));
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Notifications"
      triggerLabel={unreadCount ? `Open notifications, ${unreadCount} unread` : "Open notifications"}
      triggerClassName={cn(
        buttonVariants({ variant: "quiet", size: "icon" }),
        "relative size-11 min-h-11 sm:size-10 sm:min-h-10",
      )}
      trigger={
        <>
          <Bell className="size-4" />
          {unreadCount ? <span className="absolute top-2 right-2 size-1.5 rounded-full bg-[var(--danger)] ring-2 ring-[var(--canvas)]" /> : null}
        </>
      }
    >
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <div>
                <p className="text-sm font-semibold">Notifications</p>
                <p className="mt-0.5 text-xs text-[var(--ink-faint)]">{unreadCount ? `${unreadCount} unread` : "You’re caught up"}</p>
              </div>
              <div className="flex items-center gap-1">
                {workspace.mode === "live" && unreadCount ? <button type="button" onClick={() => void markAllRead()} className="focus-ring flex size-8 items-center justify-center rounded-lg text-[var(--ink-faint)] hover:bg-[var(--canvas)]" aria-label="Mark all notifications read"><CheckCheck className="size-3.5" /></button> : null}
                <button type="button" aria-label="Close notifications" onClick={() => setOpen(false)} className="focus-ring flex size-8 items-center justify-center rounded-lg text-[var(--ink-faint)] hover:bg-[var(--canvas)]"><X className="size-3.5" /></button>
              </div>
            </div>
            {state === "loading" ? <p className="px-3 py-8 text-center text-xs text-[var(--ink-faint)]">Loading your feed…</p> : null}
            {state === "error" ? <p role="alert" className="mx-3 my-3 rounded-xl bg-[var(--danger-soft)] px-3 py-3 text-xs leading-4 text-[var(--danger)]">The notification feed could not be refreshed. Try again shortly.</p> : null}
            {state === "ready" && notifications.length === 0 ? <div className="px-3 py-8 text-center"><p className="text-xs font-semibold">No notifications</p><p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">New tenant-scoped alerts will appear here.</p></div> : null}
            {notifications.map((notification) => (
              <button key={notification.id} type="button" onClick={() => void markRead(notification)} className="focus-ring flex w-full gap-3 rounded-xl px-3 py-3 text-left hover:bg-[var(--canvas)]">
                <span className={cn("mt-1 size-2 shrink-0 rounded-full", notification.readAt ? "bg-[var(--line-strong)]" : "bg-[var(--accent)]")} />
                <span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{notification.title}</span>{notification.body ? <span className="mt-1 block text-[13px] text-[var(--ink-faint)]">{notification.body}</span> : null}</span>
                <time dateTime={notification.createdAt} className="text-xs text-[var(--ink-faint)]">{notificationAge(notification.createdAt)}</time>
              </button>
            ))}
    </Popover>
  );
}

function NavigationLink({
  item,
  pathname,
  onNavigate,
  showBadges = true,
}: {
  item: (typeof allNavItems)[number];
  pathname: string;
  onNavigate?: () => void;
  showBadges?: boolean;
}) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "focus-ring group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition-colors lg:min-h-10",
        active
          ? "bg-white/[0.09] text-white"
          : "text-white/55 hover:bg-white/[0.05] hover:text-white/90",
      )}
    >
      {active ? (
        <motion.span
          layoutId="active-nav"
          className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-[#dfa14a]"
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
        />
      ) : null}
      <Icon className="size-[17px] shrink-0" strokeWidth={active ? 2.1 : 1.7} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {showBadges && item.badge ? (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-xs font-bold",
            active
              ? "bg-[#dfa14a] text-[#1a1d19]"
              : "bg-white/10 text-white/65",
          )}
        >
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

function Sidebar({
  pathname,
  workspace,
}: {
  pathname: string;
  workspace: WorkspaceContextValue;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--sidebar-width)] flex-col bg-[var(--graphite)] text-white lg:flex">
      <div className="flex h-[74px] items-center gap-3 px-5">
        <BrandMark />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-[-0.02em]">
            {surfaceProductName}
          </p>
          <p className="mt-0.5 text-xs font-medium tracking-[0.08em] text-white/55 uppercase">
            {surfaceProductDetail}
          </p>
        </div>
      </div>

      <WorkspaceSwitcher key={workspace.activeLocation.id} className="px-3" />

      <nav aria-label="Primary navigation" className="mt-5 flex-1 overflow-y-auto px-3 pb-4">
        {navigationSections.map((section, index) => {
          const visibleItems = section.items.filter((item) =>
            isNavItemVisible(item, workspace),
          );
          if (!visibleItems.length) return null;
          return (
            <div key={section.label} className={cn(index > 0 && "mt-5")}>
              <p className="mb-1.5 px-3 text-xs font-semibold tracking-[0.16em] text-white/55 uppercase">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {visibleItems.map((item) => (
                  <NavigationLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    showBadges={workspace.mode === "demo"}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/[0.07] p-3">
        {isNavItemVisible(settingsItem, workspace) ? (
          <NavigationLink item={settingsItem} pathname={pathname} />
        ) : null}
        <div className="mt-2 flex items-center gap-3 px-3 py-2.5">
          <Avatar name={workspace.identity.displayName} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white/90">
              {workspace.identity.displayName}
            </p>
            <p className="mt-0.5 truncate text-xs text-white/55">
              {shellRoleLabel[workspace.role]} · {workspace.mode === "demo" ? "Playground" : "Password secured"}
            </p>
          </div>
          <ShieldCheck
            aria-label={workspace.mode === "demo" ? "Temporary playground session" : "Authenticated password session"}
            className={cn(
              "size-3.5",
              workspace.mode !== "demo" && workspace.identity.aal === "aal2" ? "text-[#dfa14a]" : "text-white/55",
            )}
          />
        </div>
        <SignOutControl className="mt-0.5" />
      </div>
    </aside>
  );
}

function MobileDrawer({
  open,
  pathname,
  onClose,
  workspace,
}: {
  open: boolean;
  pathname: string;
  onClose: () => void;
  workspace: WorkspaceContextValue;
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      labelledBy="mobile-navigation-title"
      initialFocusSelector="[data-drawer-close]"
      width="sm"
      layer="navigation"
      surface="graphite"
      overlayClassName="lg:hidden"
      className="px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl"
    >
            <div className="mb-5 flex h-10 items-center gap-3">
              <BrandMark />
              <span id="mobile-navigation-title" className="flex-1 text-sm font-semibold">{surfaceProductName}</span>
              <button
                type="button"
                data-drawer-close
                aria-label="Close navigation"
                onClick={onClose}
                className="focus-ring flex size-11 items-center justify-center rounded-xl bg-white/[0.06] text-white/70 transition-[background-color,color,transform] duration-200 hover:-translate-y-px hover:bg-white/[0.12] hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>
            <WorkspaceSwitcher
              key={workspace.activeLocation.id}
              className="mb-5"
              onSelected={onClose}
            />
            <nav className="flex-1 overflow-y-auto" aria-label="Mobile navigation">
              {navigationSections.map((section, index) => {
                const visibleItems = section.items.filter((item) =>
                  isNavItemVisible(item, workspace),
                );
                if (!visibleItems.length) return null;
                return (
                  <div key={section.label} className={cn(index > 0 && "mt-5")}>
                    <p className="mb-1.5 px-3 text-xs font-semibold tracking-[0.16em] text-white/55 uppercase">
                      {section.label}
                    </p>
                    {visibleItems.map((item) => (
                      <NavigationLink
                        key={item.href}
                        item={item}
                        pathname={pathname}
                        onNavigate={onClose}
                        showBadges={workspace.mode === "demo"}
                      />
                    ))}
                  </div>
                );
              })}
              <div className="mt-5 border-t border-white/[0.07] pt-3">
                {isNavItemVisible(settingsItem, workspace) ? (
                  <NavigationLink item={settingsItem} pathname={pathname} onNavigate={onClose} />
                ) : null}
              </div>
            </nav>
            <div className="mt-3 border-t border-white/[0.07] pt-4 pb-1">
              <div className="flex items-center gap-3 px-3">
                <Avatar name={workspace.identity.displayName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white/90">{workspace.identity.displayName}</p>
                  <p className="mt-0.5 truncate text-xs text-white/55">
                    {shellRoleLabel[workspace.role]} · {workspace.mode === "demo" ? "Playground" : "Password secured"}
                  </p>
                </div>
              </div>
              <SignOutControl className="mt-2" />
            </div>
    </Drawer>
  );
}

function MobileNavigationControl({
  label,
  icon: Icon,
  active = false,
  href,
  onClick,
}: {
  label: string;
  icon: (typeof allNavItems)[number]["icon"];
  active?: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const className = cn(
    "focus-ring group relative flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[13px] font-semibold transition-[background-color,color,transform] duration-200",
    active
      ? "bg-[var(--accent-soft)]/45 text-[var(--accent-strong)]"
      : "text-[var(--ink-faint)] hover:bg-[var(--canvas)] hover:text-[var(--ink-soft)]",
  );
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "flex size-6 items-center justify-center rounded-lg transition-colors",
          active && "bg-[var(--paper-strong)]/70 shadow-[0_2px_8px_rgba(25,28,24,.06)]",
        )}
      >
        <Icon className="size-[20px]" strokeWidth={active ? 2.3 : 1.8} />
      </span>
      <span className="max-w-full truncate leading-none">{label}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} aria-current={active ? "page" : undefined} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      aria-haspopup="dialog"
      className={className}
    >
      {content}
    </button>
  );
}

function ShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const workspace = useWorkspaceContext();
  const visibleMobileNavItems = getMobileNavItems(workspace);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandTrigger, setCommandTrigger] = useState<HTMLElement | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const connectivity = useConnectivity();
  const meta = routeMeta[pathname] || {
    title: surfaceProductName,
    detail: surfaceProductDetail,
  };
  const headerDetail =
    workspace.mode === "demo"
      ? meta.detail
      : workspaceHeaderDetail(workspace);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!commandOpen)
          setCommandTrigger(
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null,
          );
        setCommandOpen(!commandOpen);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setDrawerOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandOpen]);

  return (
    <div className="min-h-svh bg-[var(--canvas)]">
      <Sidebar pathname={pathname} workspace={workspace} />

      <div className="min-h-svh lg:pl-[var(--sidebar-width)]">
        <header className="sticky top-0 z-20 flex h-[64px] items-center border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--canvas)_88%,transparent)] px-4 backdrop-blur-xl sm:px-6 lg:h-[74px] lg:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <BrandMark className="lg:hidden" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-[var(--ink)] lg:text-base">
                  {meta.title}
                </h1>
                {workspace.mode === "demo" && pathname === "/today" ? (
                  <span className="hidden items-center gap-1.5 text-xs font-semibold text-[var(--positive)] sm:flex">
                    <span className="pulse-dot size-1.5 rounded-full bg-[var(--positive)]" />
                    Live
                  </span>
                ) : workspace.mode === "live" ? (
                  <span className={cn("hidden items-center gap-1.5 text-xs font-semibold sm:flex", connectivity.state === "online" ? "text-[var(--positive)]" : "text-[var(--warning)]")}>
                    <span className={cn("size-1.5 rounded-full", connectivity.state === "online" ? "bg-[var(--positive)]" : "bg-[var(--warning)]")} />
                    {connectivity.state === "online" ? "Connected" : connectivity.state === "offline" ? "Offline" : "Reconnecting"}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--ink-faint)] sm:text-[13px]">
                {headerDetail}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={(event) => {
                setCommandTrigger(event.currentTarget);
                setCommandOpen(true);
              }}
              className="focus-ring hidden h-9 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs text-[var(--ink-faint)] transition-[background-color,border-color,color,transform] duration-200 hover:-translate-y-px hover:border-[var(--line-strong)] hover:text-[var(--ink)] md:flex"
            >
              <Search className="size-3.5" />
              <span className="pr-6">Search</span>
              <span className="flex items-center gap-0.5 rounded border border-[var(--line)] px-1 py-0.5 font-mono text-xs">
                <Command className="size-2.5" />K
              </span>
            </button>
            <Button
              variant="quiet"
              size="icon"
              aria-label="Open actions"
              aria-expanded={commandOpen}
              onClick={(event) => {
                setCommandTrigger(event.currentTarget);
                setCommandOpen(true);
              }}
              className="md:hidden"
            >
              <Search className="size-4" />
            </Button>
            <Button
              variant="quiet"
              size="icon"
              aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
              onClick={toggleTheme}
              className="hidden sm:inline-flex"
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <NotificationsControl workspace={workspace} />
            {workspace.mode === "demo" && !isHostSurface ? (
              <Button
                variant="primary"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={(event) => {
                  setCommandTrigger(event.currentTarget);
                  setCommandOpen(true);
                }}
              >
                <Plus className="size-3.5" />
                Create
              </Button>
            ) : null}
            <button
              type="button"
              aria-label="Open navigation"
              onClick={() => setDrawerOpen(true)}
              className="focus-ring flex size-11 items-center justify-center rounded-xl text-[var(--ink-soft)] transition-[background-color,color,transform] duration-200 hover:-translate-y-px hover:bg-[var(--canvas-strong)] lg:hidden"
            >
              <Menu className="size-5" />
            </button>
          </div>
        </header>

        <ConnectivityStatusNotice />

        <main key={pathname} className="page-enter min-h-[calc(100svh-64px)] pb-[calc(7rem+env(safe-area-inset-bottom))] lg:min-h-[calc(100svh-74px)] lg:pb-8">
          {children}
        </main>
      </div>

      <nav
        aria-label="Primary mobile navigation"
        className="fixed inset-x-0 bottom-0 z-30 grid min-h-[72px] grid-flow-col auto-cols-fr border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--paper-strong)_96%,transparent)] px-2 pt-1.5 pb-[calc(.375rem+env(safe-area-inset-bottom))] shadow-[0_-10px_30px_rgba(20,23,19,.06)] backdrop-blur-xl lg:hidden"
      >
        {visibleMobileNavItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <MobileNavigationControl
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={active}
            />
          );
        })}
        <MobileNavigationControl
          label="More"
          icon={Menu}
          active={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        />
      </nav>

      <ActionOmnibox
        open={commandOpen}
        workspace={workspace}
        pathname={pathname}
        onClose={() => setCommandOpen(false)}
        returnFocusTarget={commandTrigger}
      />
      <MobileDrawer
        open={drawerOpen}
        pathname={pathname}
        workspace={workspace}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ConnectivityProvider>
        <ShellContent>{children}</ShellContent>
      </ConnectivityProvider>
    </ThemeProvider>
  );
}
