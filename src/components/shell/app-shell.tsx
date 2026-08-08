"use client";

import { AnimatePresence, motion } from "motion/react";
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
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFormStatus } from "react-dom";
import { signOutAction } from "@/app/actions/auth";
import { ThemeProvider, useTheme } from "@/components/providers/theme-provider";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Avatar } from "@/components/ui/avatar";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import {
  allNavItems,
  mobileNavItems,
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

const shellRoleLabel: Record<WorkspaceContextValue["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  employee: "Employee",
};

function SignOutButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="focus-ring flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[11px] font-medium text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white/90 disabled:cursor-wait disabled:opacity-60"
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

const demoNotifications: ShellNotification[] = [
  { id: "demo-clock", title: "Missed clock-out", body: "Maya’s Friday shift needs review", actionUrl: "/time-clock", readAt: null, createdAt: new Date(Date.now() - 8 * 60_000).toISOString() },
  { id: "demo-stock", title: "Low stock", body: "Japanese whisky is below par", actionUrl: "/inventory", readAt: null, createdAt: new Date(Date.now() - 22 * 60_000).toISOString() },
  { id: "demo-swap", title: "Shift swap", body: "Eli offered Saturday dinner", actionUrl: "/schedule", readAt: null, createdAt: new Date(Date.now() - 60 * 60_000).toISOString() },
];

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
    workspace.mode === "demo" ? demoNotifications : [],
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

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

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
    <>
      <Button
        variant="quiet"
        size="icon"
        aria-label={unreadCount ? `Open notifications, ${unreadCount} unread` : "Open notifications"}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="relative"
      >
        <Bell className="size-4" />
        {unreadCount ? <span className="absolute top-2 right-2 size-1.5 rounded-full bg-[var(--danger)] ring-2 ring-[var(--canvas)]" /> : null}
      </Button>
      <AnimatePresence>
        {open ? (
          <motion.aside
            role="dialog"
            aria-label="Notifications"
            className="fixed top-[58px] right-3 z-50 w-[min(92vw,360px)] rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] p-2 shadow-[var(--shadow-float)] sm:top-[68px] sm:right-6"
            initial={{ y: -8, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -6, opacity: 0, scale: 0.98 }}
          >
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <div>
                <p className="text-sm font-semibold">Notifications</p>
                <p className="mt-0.5 text-[10px] text-[var(--ink-faint)]">{unreadCount ? `${unreadCount} unread` : "You’re caught up"}</p>
              </div>
              <div className="flex items-center gap-1">
                {workspace.mode === "live" && unreadCount ? <button type="button" onClick={() => void markAllRead()} className="focus-ring flex size-8 items-center justify-center rounded-lg text-[var(--ink-faint)] hover:bg-[var(--canvas)]" aria-label="Mark all notifications read"><CheckCheck className="size-3.5" /></button> : null}
                <button type="button" aria-label="Close notifications" onClick={() => setOpen(false)} className="focus-ring flex size-8 items-center justify-center rounded-lg text-[var(--ink-faint)] hover:bg-[var(--canvas)]"><X className="size-3.5" /></button>
              </div>
            </div>
            {state === "loading" ? <p className="px-3 py-8 text-center text-[10px] text-[var(--ink-faint)]">Loading your feed…</p> : null}
            {state === "error" ? <p role="alert" className="mx-3 my-3 rounded-xl bg-[var(--danger-soft)] px-3 py-3 text-[10px] leading-4 text-[var(--danger)]">The notification feed could not be refreshed. Try again shortly.</p> : null}
            {state === "ready" && notifications.length === 0 ? <div className="px-3 py-8 text-center"><p className="text-xs font-semibold">No notifications</p><p className="mt-1 text-[10px] leading-4 text-[var(--ink-faint)]">New tenant-scoped alerts will appear here.</p></div> : null}
            {notifications.map((notification) => (
              <button key={notification.id} type="button" onClick={() => void markRead(notification)} className="focus-ring flex w-full gap-3 rounded-xl px-3 py-3 text-left hover:bg-[var(--canvas)]">
                <span className={cn("mt-1 size-2 shrink-0 rounded-full", notification.readAt ? "bg-[var(--line-strong)]" : "bg-[var(--accent)]")} />
                <span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{notification.title}</span>{notification.body ? <span className="mt-1 block text-[11px] text-[var(--ink-faint)]">{notification.body}</span> : null}</span>
                <time dateTime={notification.createdAt} className="text-[9px] text-[var(--ink-faint)]">{notificationAge(notification.createdAt)}</time>
              </button>
            ))}
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </>
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
        "focus-ring group relative flex min-h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition-colors",
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
            "rounded-full px-1.5 py-0.5 text-[9px] font-bold",
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
            Le Yard OS
          </p>
          <p className="mt-0.5 text-[10px] font-medium tracking-[0.08em] text-white/55 uppercase">
            Operator workspace
          </p>
        </div>
      </div>

      <WorkspaceSwitcher key={workspace.activeLocation.id} className="px-3" />

      <nav aria-label="Primary navigation" className="mt-5 flex-1 overflow-y-auto px-3 pb-4">
        {navigationSections.map((section, index) => {
          const visibleItems = section.items.filter((item) =>
            isNavItemVisible(item, workspace.role),
          );
          if (!visibleItems.length) return null;
          return (
            <div key={section.label} className={cn(index > 0 && "mt-5")}>
              <p className="mb-1.5 px-3 text-[9px] font-semibold tracking-[0.16em] text-white/55 uppercase">
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
        <NavigationLink item={settingsItem} pathname={pathname} />
        <div className="mt-2 flex items-center gap-3 px-3 py-2.5">
          <Avatar name={workspace.identity.displayName} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white/90">
              {workspace.identity.displayName}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-white/55">
              {shellRoleLabel[workspace.role]} · {workspace.mode === "demo" ? "Playground" : workspace.identity.aal === "aal2" ? "MFA on" : workspace.role === "owner" ? "MFA required" : "MFA available"}
            </p>
          </div>
          <ShieldCheck
            aria-label={workspace.mode === "demo" ? "Temporary playground session" : workspace.identity.aal === "aal2" ? "Multi-factor authentication verified" : "Standard assurance session"}
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

function CommandPalette({
  open,
  onClose,
  role,
}: {
  open: boolean;
  onClose: () => void;
  role: WorkspaceContextValue["role"];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(
    () =>
      allNavItems.filter(
        (item) =>
          isNavItemVisible(item, role) &&
          item.label.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [query, role],
  );

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (filtered[0]) {
      router.push(filtered[0].href);
      onClose();
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[70] flex items-start justify-center bg-black/30 px-4 pt-[12svh] backdrop-blur-[5px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command menu"
            className="w-full max-w-xl overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] shadow-[var(--shadow-float)]"
            initial={{ y: -12, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -8, scale: 0.985, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <form onSubmit={submit} className="flex items-center gap-3 border-b border-[var(--line)] px-4">
              <Search className="size-4 text-[var(--ink-faint)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Go to a workspace or search actions…"
                className="h-14 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
              />
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-[var(--line)] px-1.5 py-1 text-[9px] font-semibold text-[var(--ink-faint)]"
              >
                ESC
              </button>
            </form>
            <div className="max-h-[360px] overflow-y-auto p-2">
              <p className="eyebrow px-3 py-2">Workspaces</p>
              {filtered.length ? (
                filtered.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.href}
                      type="button"
                      onClick={() => {
                        router.push(item.href);
                        onClose();
                      }}
                      className={cn(
                        "focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
                        index === 0
                          ? "bg-[var(--canvas-strong)] text-[var(--ink)]"
                          : "text-[var(--ink-soft)] hover:bg-[var(--canvas)]",
                      )}
                    >
                      <Icon className="size-4" />
                      <span className="flex-1">{item.label}</span>
                      {index === 0 ? (
                        <span className="text-[10px] text-[var(--ink-faint)]">↵</span>
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <p className="px-3 py-8 text-center text-sm text-[var(--ink-faint)]">
                  No workspace matches “{query}”.
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
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
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-[3px] lg:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.aside
            className="absolute inset-y-0 right-0 flex w-[min(88vw,360px)] flex-col bg-[var(--graphite)] p-4 text-white shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 350, damping: 34 }}
          >
            <div className="mb-5 flex h-10 items-center gap-3">
              <BrandMark />
              <span className="flex-1 text-sm font-semibold">Le Yard OS</span>
              <button
                aria-label="Close navigation"
                onClick={onClose}
                className="focus-ring flex size-9 items-center justify-center rounded-xl bg-white/[0.06] text-white/70"
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
                  isNavItemVisible(item, workspace.role),
                );
                if (!visibleItems.length) return null;
                return (
                  <div key={section.label} className={cn(index > 0 && "mt-5")}>
                    <p className="mb-1.5 px-3 text-[9px] font-semibold tracking-[0.16em] text-white/55 uppercase">
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
                {isNavItemVisible(settingsItem, workspace.role) ? (
                  <NavigationLink item={settingsItem} pathname={pathname} onNavigate={onClose} />
                ) : null}
              </div>
            </nav>
            <div className="mt-3 border-t border-white/[0.07] pt-4 pb-1">
              <div className="flex items-center gap-3 px-3">
                <Avatar name={workspace.identity.displayName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white/90">{workspace.identity.displayName}</p>
                  <p className="mt-0.5 truncate text-[10px] text-white/55">
                    {shellRoleLabel[workspace.role]} · {workspace.mode === "demo" ? "Playground" : workspace.identity.aal === "aal2" ? "MFA on" : workspace.role === "owner" ? "MFA required" : "MFA available"}
                  </p>
                </div>
              </div>
              <SignOutControl className="mt-2" />
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function ShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const workspace = useWorkspaceContext();
  const [commandOpen, setCommandOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const meta = routeMeta[pathname] || {
    title: "Le Yard OS",
    detail: "Operator workspace",
  };
  const headerDetail =
    workspace.mode === "demo"
      ? meta.detail
      : `${workspace.activeLocation.name} · ${workspace.organization.name}`;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setDrawerOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
                {workspace.mode === "demo" && (pathname === "/today" || pathname === "/time-clock") ? (
                  <span className="hidden items-center gap-1.5 text-[10px] font-semibold text-[var(--positive)] sm:flex">
                    <span className="pulse-dot size-1.5 rounded-full bg-[var(--positive)]" />
                    Live
                  </span>
                ) : workspace.mode === "live" ? (
                  <span className="hidden items-center gap-1.5 text-[10px] font-semibold text-[var(--positive)] sm:flex">
                    <span className="size-1.5 rounded-full bg-[var(--positive)]" />
                    Connected
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-[10px] text-[var(--ink-faint)] sm:text-[11px]">
                {headerDetail}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => setCommandOpen(true)}
              className="focus-ring hidden h-9 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs text-[var(--ink-faint)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--ink)] md:flex"
            >
              <Search className="size-3.5" />
              <span className="pr-6">Search</span>
              <span className="flex items-center gap-0.5 rounded border border-[var(--line)] px-1 py-0.5 font-mono text-[8px]">
                <Command className="size-2.5" />K
              </span>
            </button>
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
            {workspace.mode === "demo" ? (
              <Button variant="primary" size="sm" className="hidden sm:inline-flex">
                <Plus className="size-3.5" />
                Create
              </Button>
            ) : null}
            <button
              aria-label="Open navigation"
              onClick={() => setDrawerOpen(true)}
              className="focus-ring flex size-9 items-center justify-center rounded-xl text-[var(--ink-soft)] hover:bg-[var(--canvas-strong)] lg:hidden"
            >
              <Menu className="size-5" />
            </button>
          </div>
        </header>

        <main key={pathname} className="page-enter min-h-[calc(100svh-64px)] pb-24 lg:min-h-[calc(100svh-74px)] lg:pb-8">
          {children}
        </main>
      </div>

      <nav
        aria-label="Primary mobile navigation"
        className="fixed inset-x-0 bottom-0 z-30 grid h-[72px] grid-cols-5 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--paper-strong)_94%,transparent)] px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "focus-ring flex flex-col items-center justify-center gap-1 rounded-xl text-[9px] font-semibold",
                active ? "text-[var(--accent-strong)]" : "text-[var(--ink-faint)]",
              )}
            >
              <Icon className="size-[18px]" strokeWidth={active ? 2.3 : 1.8} />
              {item.label === "Time clock" ? "Clock" : item.label}
            </Link>
          );
        })}
        <button
          onClick={() => setDrawerOpen(true)}
          className="focus-ring flex flex-col items-center justify-center gap-1 rounded-xl text-[9px] font-semibold text-[var(--ink-faint)]"
        >
          <Menu className="size-[18px]" />
          More
        </button>
      </nav>

      <CommandPalette
        key={commandOpen ? "open" : "closed"}
        open={commandOpen}
        role={workspace.role}
        onClose={() => setCommandOpen(false)}
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
      <ShellContent>{children}</ShellContent>
    </ThemeProvider>
  );
}
