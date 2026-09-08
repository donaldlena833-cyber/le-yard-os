"use client";

import { motion, useReducedMotion } from "motion/react";
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
import styles from "./shell.module.css";
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
      className={cn("focus-ring", styles.signOut)}
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
      contentClassName={styles.notificationPopover}
      triggerLabel={unreadCount ? `Open notifications, ${unreadCount} unread` : "Open notifications"}
      triggerClassName={cn(
        buttonVariants({ variant: "quiet", size: "icon" }),
        styles.iconButton,
      )}
      trigger={
        <>
          <Bell className="size-4" />
          {unreadCount ? <span className="absolute top-2 right-2 size-1.5 rounded-full bg-[var(--danger)] ring-2 ring-[var(--canvas)]" /> : null}
        </>
      }
    >
            <div className={styles.notificationHeader}>
              <div>
                <p className={styles.notificationTitle}>Notifications</p>
                <p className="mt-0.5 text-xs text-[var(--ink-faint)]">{state === "loading" ? "Refreshing your feed…" : state === "error" ? "Refresh unavailable" : unreadCount ? `${unreadCount} unread` : "You’re caught up"}</p>
              </div>
              <div className="flex items-center gap-1">
                {workspace.mode === "live" && unreadCount ? <button type="button" onClick={() => void markAllRead()} className={cn("focus-ring", styles.iconButton)} aria-label="Mark all notifications read"><CheckCheck className="size-3.5" /></button> : null}
                <button type="button" aria-label="Close notifications" onClick={() => setOpen(false)} className={cn("focus-ring", styles.iconButton)}><X className="size-3.5" /></button>
              </div>
            </div>
            {state === "loading" ? <p className="px-3 py-8 text-center text-xs text-[var(--ink-faint)]">Loading your feed…</p> : null}
            {state === "error" ? <p role="alert" className="mx-3 my-3 rounded-xl bg-[var(--danger-soft)] px-3 py-3 text-xs leading-4 text-[var(--danger)]">The notification feed could not be refreshed. Try again shortly.</p> : null}
            {state === "ready" && notifications.length === 0 ? <div className="px-3 py-8 text-center"><p className="text-xs font-semibold">No notifications</p><p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">New alerts for your workspace will appear here.</p></div> : null}
            {notifications.map((notification) => (
              <button key={notification.id} type="button" onClick={() => void markRead(notification)} className={cn("focus-ring", styles.notificationRow)}>
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
  const reducedMotion = useReducedMotion();

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn("focus-ring", styles.navLink)}
    >
      <span className={styles.navIcon}>
        {active ? (
          <motion.span
            layoutId="active-nav"
            className={styles.activeNav}
            transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 34 }}
          />
        ) : null}
        <Icon className="size-[17px] shrink-0" strokeWidth={active ? 2.1 : 1.7} />
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {showBadges && item.badge ? (
        <span
          className={styles.badge}
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
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <BrandMark className={styles.monogram} />
        <div className="min-w-0">
          <p className={styles.brandTitle}>
            {surfaceProductName}
          </p>
          <p className={styles.brandDetail}>
            {surfaceProductDetail}
          </p>
        </div>
      </div>

      <WorkspaceSwitcher key={workspace.activeLocation.id} className="mx-3 mb-5" />

      <nav aria-label="Primary navigation" className={styles.nav}>
        {navigationSections.map((section) => {
          const visibleItems = section.items.filter((item) =>
            isNavItemVisible(item, workspace),
          );
          if (!visibleItems.length) return null;
          return (
            <div key={section.label} className={styles.navGroup}>
              <p className={styles.groupLabel}>
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

      <div className={styles.sidebarFooter}>
        {isNavItemVisible(settingsItem, workspace) ? (
          <NavigationLink item={settingsItem} pathname={pathname} />
        ) : null}
        <div className={styles.identity}>
          <Avatar name={workspace.identity.displayName} size="sm" />
          <div className="min-w-0 flex-1">
            <p className={cn("truncate", styles.identityName)}>
              {workspace.identity.displayName}
            </p>
            <p className={cn("truncate", styles.identityDetail)}>
              {shellRoleLabel[workspace.role]} · {workspace.mode === "demo" ? "Playground" : "Password secured"}
            </p>
          </div>
          <ShieldCheck
            aria-label={workspace.mode === "demo" ? "Temporary playground session" : "Authenticated password session"}
            className={cn(
              "size-3.5",
              workspace.mode !== "demo" && workspace.identity.aal === "aal2" ? "text-[var(--positive)]" : "text-[var(--muted)]",
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
      surface="paper"
      overlayClassName="lg:hidden"
      className={styles.drawer}
    >
            <div className={styles.drawerHeader}>
              <BrandMark className={styles.monogram} />
              <span id="mobile-navigation-title" className={styles.drawerTitle}>{surfaceProductName}</span>
              <button
                type="button"
                data-drawer-close
                aria-label="Close navigation"
                onClick={onClose}
                className={cn("focus-ring", styles.iconButton)}
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
              {navigationSections.map((section) => {
                const visibleItems = section.items.filter((item) =>
                  isNavItemVisible(item, workspace),
                );
                if (!visibleItems.length) return null;
                return (
                  <div key={section.label} className={styles.navGroup}>
                    <p className={styles.groupLabel}>
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
              <div className={styles.drawerDivider}>
                {isNavItemVisible(settingsItem, workspace) ? (
                  <NavigationLink item={settingsItem} pathname={pathname} onNavigate={onClose} />
                ) : null}
              </div>
            </nav>
            <div className={styles.drawerDivider}>
              <div className="flex items-center gap-3 px-3">
                <Avatar name={workspace.identity.displayName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate", styles.identityName)}>{workspace.identity.displayName}</p>
                  <p className={cn("truncate", styles.identityDetail)}>
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
  const className = cn("focus-ring", styles.dockControl);
  const content = (
    <>
      <span aria-hidden="true" className={styles.dockIcon}>
        <Icon className="size-[18px]" strokeWidth={active ? 2.1 : 1.7} />
      </span>
      <span className="max-w-full truncate">{label}</span>
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
    <div className={styles.shell}>
      <Sidebar pathname={pathname} workspace={workspace} />

      <div className={styles.frame}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <BrandMark className={cn(styles.monogram, styles.headerBrand, "lg:hidden")} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className={styles.title}>
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
              <p className={styles.headerDetail}>
                {headerDetail}
              </p>
            </div>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              onClick={(event) => {
                setCommandTrigger(event.currentTarget);
                setCommandOpen(true);
              }}
              className={cn("focus-ring", styles.searchTrigger)}
            >
              <Search className="size-3.5" />
              <span className="pr-6">Search</span>
              <span className={styles.shortcut}>
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
              className={cn(styles.iconButton, styles.mobileSearch)}
            >
              <Search className="size-4" />
            </Button>
            <Button
              variant="quiet"
              size="icon"
              aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
              onClick={toggleTheme}
              className={styles.iconButton}
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
              className={cn("focus-ring", styles.iconButton, styles.mobileMenu)}
            >
              <Menu className="size-5" />
            </button>
          </div>
        </header>

        <ConnectivityStatusNotice />

        <main key={pathname} className={cn("page-enter", styles.content)}>
          {children}
        </main>
      </div>

      <nav
        aria-label="Primary mobile navigation"
        className={styles.dock}
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
