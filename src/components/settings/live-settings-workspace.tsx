"use client";

import {
  Archive,
  BellRing,
  Building2,
  Check,
  CircleAlert,
  DatabaseBackup,
  FileClock,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  LoaderCircle,
  Mail,
  MapPin,
  MonitorCheck,
  Plus,
  ShieldCheck,
  Smartphone,
  Tags,
  UsersRound,
} from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOutAction } from "@/app/actions/auth";
import {
  removePushSubscriptionAction,
  savePushSubscriptionAction,
  setNotificationPreferenceAction,
} from "@/app/actions/workflows/notifications";
import {
  saveExpenseCategoryAction,
  setExpenseCategoryActiveAction,
} from "@/app/actions/workflows/configuration";
import { MfaEnrollment } from "@/components/settings/mfa-enrollment";
import { RetentionPolicyConfiguration } from "@/components/settings/retention-policy-configuration";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type { LiveSettingsModel } from "@/data/read-models/settings";
import type { LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { publicEnv } from "@/lib/env";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/types";

type Tab = "organization" | "locations" | "expenses" | "security" | "notifications" | "data";
type StatusTone = "neutral" | "positive" | "warning" | "danger" | "accent";

const tabs: Array<{ id: Tab; label: string; icon: typeof Building2 }> = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "locations", label: "Locations", icon: MapPin },
  { id: "expenses", label: "Expense categories", icon: Tags },
  { id: "security", label: "Security", icon: Fingerprint },
  { id: "notifications", label: "Notifications", icon: BellRing },
  { id: "data", label: "Data & audit", icon: DatabaseBackup },
];

const roleScope: Record<AppRole, string> = {
  owner: "All settings, financial approvals, and owner assignment",
  admin: "Users, locations, integrations, exports, and operations",
  manager: "Assigned-location schedules, time, closeouts, and operations",
  employee: "Own profile, shifts, clock, chat, tasks, and own tips",
};

function tone(status: string): StatusTone {
  if (["active", "succeeded", "completed"].includes(status)) return "positive";
  if (["failed", "suspended", "fatal"].includes(status)) return "danger";
  if (["queued", "running", "invited", "partially_succeeded"].includes(status)) return "warning";
  return "neutral";
}

function dateTime(value: string | null): string {
  return value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not recorded";
}

function SettingsError({ message }: { message: string }) {
  return <PageFrame><section className="mx-auto mt-[8svh] max-w-xl rounded-[28px] border border-[var(--line)] bg-[var(--paper-strong)] p-8 text-center"><CircleAlert className="mx-auto size-6 text-[var(--danger)]" /><h2 className="mt-4 text-xl font-medium tracking-[-0.04em]">Settings unavailable</h2><p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">{message}</p></section></PageFrame>;
}

function OrganizationPanel({ data }: { data: LiveSettingsModel }) {
  const roles: AppRole[] = ["owner", "admin", "manager", "employee"];
  return <div className="space-y-9">
    <section>
      <SectionHeading title="Organization profile" detail="Authenticated tenant values. Changes remain locked until the owners confirm production identity and branding." />
      <dl className="grid gap-px overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
        {[
          ["Operating name", data.organization.name],
          ["Workspace slug", data.organization.slug],
          ["Default timezone", data.organization.timeZone],
          ["Currency", data.organization.currencyCode],
          ["Week starts", ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][data.organization.weekStartsOn]],
          ["Tenant state", data.organization.status],
        ].map(([label, value]) => <div key={label} className="bg-[var(--paper)] px-4 py-4"><dt className="text-[9px] font-semibold tracking-[.1em] text-[var(--ink-faint)] uppercase">{label}</dt><dd className="mt-2 text-xs font-semibold">{value}</dd></div>)}
      </dl>
      <div className={cn("mt-4 flex items-start gap-3 rounded-[16px] p-4 text-[10px] leading-4", data.organization.configuredAt ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--warning-soft)] text-[var(--warning)]")}><CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{data.organization.configuredAt ? `Tenant setup was marked configured ${dateTime(data.organization.configuredAt)}. Owner approval is still required before production deployment.` : "Owner emails, exact restaurant and location details, brand assets, and operating rules are still required before production bootstrap."}</span></div>
    </section>
    <section>
      <SectionHeading title="Owner accounts" detail="Owners have full tenant access and must use MFA. Auth email and password custody stay with Supabase Auth." />
      <div className="border-y border-[var(--line)]">{data.owners.map((owner, index) => <div key={owner.userId} className="flex items-center gap-3 border-t border-[var(--line)] py-4 first:border-0"><Avatar name={owner.displayName} index={index} /><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{owner.displayName}</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">Owner operator · password not retrievable</p></div><StatusPill tone={tone(owner.status)}><ShieldCheck className="size-3" /> {owner.status}</StatusPill></div>)}{!data.owners.length ? <p className="py-5 text-center text-[10px] text-[var(--ink-faint)]">No owner account is visible in this tenant scope.</p> : null}</div>
    </section>
    <section>
      <SectionHeading title="Role boundaries" detail="Counts come from current tenant memberships; permissions remain constrained by RLS and assigned locations." />
      <div className="overflow-x-auto border-y border-[var(--line)]"><div className="grid min-w-[620px] grid-cols-[110px_1fr_70px] gap-4 bg-[var(--canvas-strong)] px-4 py-2.5 text-[9px] font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase"><span>Role</span><span>Maximum scope</span><span>People</span></div>{roles.map((role) => <div key={role} className="grid min-w-[620px] grid-cols-[110px_1fr_70px] items-center gap-4 border-t border-[var(--line)] px-4 py-3.5"><span className="text-xs font-semibold capitalize">{role}</span><span className="text-[10px] text-[var(--ink-faint)]">{roleScope[role]}</span><span className="numeric text-xs">{data.roleCounts[role]}</span></div>)}</div>
    </section>
  </div>;
}

function LocationsPanel({ data }: { data: LiveSettingsModel }) {
  return <div><SectionHeading title="Restaurant locations" detail="Only locations available through the current user’s tenant scope are shown." action={<Button variant="secondary" size="sm" disabled>Add location</Button>} /><div className="grid gap-4 sm:grid-cols-2">{data.locations.map((location, index) => <article key={location.id} className="rounded-[20px] border border-[var(--line)] bg-[var(--paper)] p-5"><div className="flex items-start justify-between gap-3"><span className={cn("flex size-10 items-center justify-center rounded-[13px]", index % 2 === 0 ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "bg-[var(--positive-soft)] text-[var(--positive)]")}><MapPin className="size-4" /></span><StatusPill tone={location.active ? "positive" : "neutral"} dot>{location.active ? "Active" : "Inactive"}</StatusPill></div><h3 className="mt-5 text-base font-semibold tracking-[-0.03em]">{location.name}</h3><p className="mt-1 text-[9px] font-semibold tracking-[.1em] text-[var(--ink-faint)] uppercase">{location.code}</p><p className="mt-3 min-h-8 text-[10px] leading-4 text-[var(--ink-faint)]">{location.address.length ? location.address.map((line) => <span key={line} className="block">{line}</span>) : "Address not configured"}</p><div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-4"><span className="truncate text-[9px] text-[var(--ink-faint)]">{location.timeZone}</span><span className="text-[9px] text-[var(--ink-faint)]">{location.phone ?? "No phone"}</span></div></article>)}</div>{data.canManage ? <p className="mt-5 flex items-start gap-2 rounded-[16px] bg-[var(--warning-soft)] p-4 text-[10px] leading-4 text-[var(--warning)]"><LockKeyhole className="mt-0.5 size-4 shrink-0" />Location edits are intentionally locked until the owners supply and approve exact operating details.</p> : null}</div>;
}

function SecurityPanel({ workspace }: { workspace: WorkspaceContextValue }) {
  return <div className="space-y-9">
    <section><SectionHeading title="Multi-factor authentication" detail="Owners are gated from connected operations unless the current session reaches AAL2." /><MfaEnrollment /><div className="mt-3 grid gap-3 sm:grid-cols-3"><div className="rounded-[16px] bg-[var(--canvas)] p-4"><p className="text-[9px] text-[var(--ink-faint)]">Current role</p><p className="mt-2 text-xs font-semibold capitalize">{workspace.role}</p></div><div className="rounded-[16px] bg-[var(--canvas)] p-4"><p className="text-[9px] text-[var(--ink-faint)]">Session assurance</p><p className="mt-2 text-xs font-semibold uppercase">{workspace.identity.aal}</p></div><div className="rounded-[16px] bg-[var(--canvas)] p-4"><p className="text-[9px] text-[var(--ink-faint)]">Owner requirement</p><p className="mt-2 text-xs font-semibold">AAL2</p></div></div></section>
    <section><SectionHeading title="Account controls" detail="User creation and role assignment are restricted to Owner and Admin accounts." /><div className="border-y border-[var(--line)]">{[[UsersRound, "User creation", "One-time invitation · Owner or Admin"], [LockKeyhole, "Password custody", "User-controlled · not recoverable by admins"], [KeyRound, "Service credentials", "Server only · private encrypted schema"], [FileClock, "Session history", "Authentication events remain in provider logs"]].map(([Icon, title, detail]) => { const RowIcon = Icon as typeof UsersRound; return <div key={String(title)} className="flex items-center gap-3 border-t border-[var(--line)] py-4 first:border-0"><span className="flex size-8 items-center justify-center rounded-xl bg-[var(--canvas-strong)]"><RowIcon className="size-3.5 text-[var(--ink-soft)]" /></span><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold">{String(title)}</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">{String(detail)}</p></div><Check className="size-3.5 text-[var(--positive)]" /></div>; })}</div></section>
    <form action={signOutAction} className="border-t border-[var(--line)] pt-5"><Button type="submit" variant="secondary">Sign out of this device</Button></form>
  </div>;
}

const notificationCatalog = [
  ["schedule_published", "Published schedules", "A new schedule version is published."],
  ["shift_assigned", "Shift assignments", "A published shift is assigned to you."],
  ["shift_swap_decided", "Shift swap decisions", "A requested shift swap is approved or declined."],
  ["time_correction_decided", "Time correction decisions", "A time-entry correction is approved or declined."],
  ["time_off_decided", "Time-off decisions", "A time-off request is approved or declined."],
  ["task_assigned", "Task assignments", "A new operations task is assigned to you."],
] as const;

function vapidKeyBytes(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const binary = atob((value + padding).replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

async function endpointHash(endpoint: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function NotificationsPanel({ data, workspace }: { data: LiveSettingsModel; workspace: WorkspaceContextValue }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  const [localInApp, setLocalInApp] = useState<Record<string, boolean>>(() => Object.fromEntries(
    notificationCatalog.map(([type]) => [
      type,
      data.notificationPreferences.find((preference) => preference.notificationType === type)?.inApp ?? true,
    ]),
  ));
  const vapidPublicKey = publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  function saveInApp(notificationType: typeof notificationCatalog[number][0], inApp: boolean) {
    setMessage(null);
    startTransition(async () => {
      const payload = {
        organizationId: workspace.organization.id,
        notificationType,
        inApp,
        email: false,
        push: false,
        quietHours: {},
      };
      const result = await setNotificationPreferenceAction({
        requestId: requestIdFor(`notification.preference:${notificationType}`, payload),
        ...payload,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setLocalInApp((current) => ({ ...current, [notificationType]: inApp }));
      rotateRequestId(`notification.preference:${notificationType}`);
      setMessage("In-app preference saved. Future derived alerts will follow this setting.");
      router.refresh();
    });
  }

  function registerBrowser() {
    setMessage(null);
    startTransition(async () => {
      if (!vapidPublicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setMessage("Browser subscription storage is unavailable in this deployment or browser.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("Browser notification permission was not granted.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyBytes(vapidPublicKey),
      });
      const serialized = subscription.toJSON();
      if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth) {
        setMessage("The browser returned an incomplete push subscription.");
        return;
      }
      const result = await savePushSubscriptionAction({
        requestId: requestIdFor("notification.push.save", {
          organizationId: workspace.organization.id,
          endpoint: serialized.endpoint,
          expirationTime: serialized.expirationTime ?? null,
          keys: serialized.keys,
          deviceLabel: "This browser",
        }),
        organizationId: workspace.organization.id,
        subscription: {
          endpoint: serialized.endpoint,
          expirationTime: serialized.expirationTime ?? null,
          keys: serialized.keys,
        },
        deviceLabel: "This browser",
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      rotateRequestId("notification.push.save");
      setMessage("This browser subscription is encrypted and stored. Push delivery is not active until an approved delivery process is deployed.");
      router.refresh();
    });
  }

  function removeBrowser(hash: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await removePushSubscriptionAction({
        requestId: requestIdFor(`notification.push.remove:${hash}`, {
          organizationId: workspace.organization.id,
          endpointHash: hash,
        }),
        organizationId: workspace.organization.id,
        endpointHash: hash,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      if ("serviceWorker" in navigator) {
        const current = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
        if (current && await endpointHash(current.endpoint) === hash) await current.unsubscribe();
      }
      setMessage("The encrypted browser subscription was removed.");
      rotateRequestId(`notification.push.remove:${hash}`);
      router.refresh();
    });
  }

  return <div className="space-y-9"><section><SectionHeading title="In-app alerts" detail="Choose which server-derived events appear in your notification center." /><div className="border-y border-[var(--line)]">{notificationCatalog.map(([type, label, detail]) => <div key={type} className="grid gap-3 border-t border-[var(--line)] py-4 first:border-0 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center"><div><p className="text-[10px] font-semibold">{label}</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">{detail}</p></div><button type="button" role="switch" aria-checked={localInApp[type]} disabled={pending} onClick={() => saveInApp(type, !localInApp[type])} className={cn("focus-ring flex h-8 items-center gap-2 rounded-full px-2.5 text-[9px] font-semibold", localInApp[type] ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--canvas-strong)] text-[var(--ink-faint)]")}><span className={cn("size-2 rounded-full", localInApp[type] ? "bg-[var(--positive)]" : "bg-[var(--ink-faint)]")} />{localInApp[type] ? "In app on" : "In app off"}</button><StatusPill tone="neutral"><Mail className="size-3" />Email inactive</StatusPill><StatusPill tone="neutral"><Smartphone className="size-3" />Push inactive</StatusPill></div>)}</div><p className="mt-3 text-[9px] leading-4 text-[var(--ink-faint)]">Email and push delivery controls remain inactive because no approved SMTP or push-delivery process is running. This screen does not claim those messages are sent.</p></section><section><SectionHeading title="Browser subscription storage" detail="Encrypted endpoint custody for a future approved push-delivery process." action={<Button variant="secondary" size="sm" disabled={pending || !vapidPublicKey} onClick={registerBrowser}>{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Smartphone className="size-3.5" />}Register this browser</Button>} /><div className="border-y border-[var(--line)]">{data.pushSubscriptions.map((subscription) => <div key={subscription.id} className="flex items-center gap-3 border-t border-[var(--line)] py-4 first:border-0"><span className="flex size-8 items-center justify-center rounded-xl bg-[var(--canvas-strong)]"><Smartphone className="size-3.5 text-[var(--ink-soft)]" /></span><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold">{subscription.deviceLabel ?? "Stored browser"}</p><p className="mt-1 font-mono text-[9px] text-[var(--ink-faint)]">Endpoint {subscription.endpointHash.slice(0, 12)}… · stored {dateTime(subscription.createdAt)}</p></div><Button variant="quiet" size="sm" disabled={pending} onClick={() => removeBrowser(subscription.endpointHash)}>Remove</Button></div>)}{!data.pushSubscriptions.length ? <p className="py-5 text-center text-[10px] text-[var(--ink-faint)]">No encrypted browser subscription is stored for your account.</p> : null}</div><div className="mt-4 flex items-start gap-3 rounded-[16px] bg-[var(--warning-soft)] p-4 text-[10px] leading-4 text-[var(--warning)]"><BellRing className="mt-0.5 size-4 shrink-0" /><span>Registering a browser stores encrypted subscription evidence only. It does not activate push delivery. VAPID signing keys and an approved delivery worker are still required.</span></div></section>{message ? <p role="status" aria-live="polite" className="rounded-xl bg-[var(--canvas)] px-4 py-3 text-[10px]">{message}</p> : null}</div>;
}

function ExpenseCategoriesPanel({ data, workspace }: { data: LiveSettingsModel; workspace: WorkspaceContextValue }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [accountingCode, setAccountingCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  const saveScope = editingId ? `expense-category.save:${editingId}` : "expense-category.create";

  function closeEditor() {
    rotateRequestId(saveScope);
    setEditingId(null);
    setName("");
    setAccountingCode("");
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      organizationId: workspace.organization.id,
      categoryId: editingId,
      name: name.trim(),
      accountingCode: accountingCode.trim() || null,
    };
    setMessage(null);
    startTransition(async () => {
      const result = await saveExpenseCategoryAction({
        requestId: requestIdFor(saveScope, payload),
        ...payload,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      rotateRequestId(saveScope);
      setMessage(editingId ? "Expense category updated." : "Expense category created.");
      setEditingId(null);
      setName("");
      setAccountingCode("");
      router.refresh();
    });
  }

  function setActive(categoryId: string, active: boolean) {
    const scope = `expense-category.active:${categoryId}`;
    setMessage(null);
    startTransition(async () => {
      const result = await setExpenseCategoryActiveAction({
        requestId: requestIdFor(scope, { categoryId, active }),
        categoryId,
        active,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      rotateRequestId(scope);
      setMessage(active ? "Expense category restored." : "Expense category deactivated.");
      router.refresh();
    });
  }

  if (!data.canManage) {
    return <section className="rounded-[22px] border border-[var(--line)] bg-[var(--paper)] p-7 text-center"><LockKeyhole className="mx-auto size-5 text-[var(--ink-faint)]" /><h3 className="mt-4 text-base font-semibold">Owner or Admin access required</h3><p className="mx-auto mt-2 max-w-sm text-[10px] leading-4 text-[var(--ink-faint)]">Expense categories control receipt coding and accounting exports across the tenant.</p></section>;
  }

  return <div className="space-y-7"><section><SectionHeading title="Expense categories" detail="Shared receipt-coding options. Deactivation preserves historical references." /><form onSubmit={submit} className="grid gap-3 border-y border-[var(--line)] py-5 sm:grid-cols-[minmax(0,1fr)_180px_auto]"><label><span className="mb-1.5 block text-[9px] font-semibold text-[var(--ink-faint)]">Category name</span><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Smallwares" className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-[11px]" /></label><label><span className="mb-1.5 block text-[9px] font-semibold text-[var(--ink-faint)]">Accounting code</span><input maxLength={64} value={accountingCode} onChange={(event) => setAccountingCode(event.target.value)} placeholder="6100" className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-[11px]" /></label><div className="flex items-end gap-2"><Button type="submit" variant="accent" size="sm" disabled={pending || !name.trim()}>{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : editingId ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}{editingId ? "Save" : "Add"}</Button>{editingId ? <Button type="button" variant="quiet" size="sm" disabled={pending} onClick={closeEditor}>Cancel</Button> : null}</div></form></section><section className="border-y border-[var(--line)]">{data.expenseCategories.map((category) => <div key={category.id} className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] py-4 first:border-0"><span className={cn("flex size-8 items-center justify-center rounded-xl", category.active ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "bg-[var(--canvas-strong)] text-[var(--ink-faint)]")}><Tags className="size-3.5" /></span><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold">{category.name}</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">{category.accountingCode ? `Code ${category.accountingCode}` : "No accounting code"}</p></div><StatusPill tone={category.active ? "positive" : "neutral"}>{category.active ? "Active" : "Inactive"}</StatusPill><Button variant="quiet" size="sm" disabled={pending} onClick={() => { rotateRequestId(saveScope); setEditingId(category.id); setName(category.name); setAccountingCode(category.accountingCode ?? ""); setMessage(null); }}>Edit</Button><Button variant="quiet" size="sm" disabled={pending} onClick={() => setActive(category.id, !category.active)}>{category.active ? "Deactivate" : "Restore"}</Button></div>)}{!data.expenseCategories.length ? <p className="py-8 text-center text-[10px] text-[var(--ink-faint)]">No expense categories exist yet. Add the first coding option above.</p> : null}</section>{message ? <p role="status" aria-live="polite" className="rounded-xl bg-[var(--canvas)] px-4 py-3 text-[10px]">{message}</p> : null}</div>;
}

function DataPanel({ data, workspace }: { data: LiveSettingsModel; workspace: WorkspaceContextValue }) {
  if (!data.canManage) return <section className="rounded-[22px] border border-[var(--line)] bg-[var(--paper)] p-7 text-center"><LockKeyhole className="mx-auto size-5 text-[var(--ink-faint)]" /><h3 className="mt-4 text-base font-semibold">Owner or Admin access required</h3><p className="mx-auto mt-2 max-w-sm text-[10px] leading-4 text-[var(--ink-faint)]">Retention, backup evidence, tenant exports, error status, and immutable audit records are not exposed to this role.</p></section>;
  return <div className="space-y-9">
    <section><SectionHeading title="Retention & recovery" detail="Configuration evidence, backup status, and unresolved operational errors." /><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-[18px] border border-[var(--line)] p-4"><Archive className="size-4 text-[var(--warning)]" /><p className="mt-4 text-xs font-semibold">Retention classes</p><p className="numeric mt-1 text-lg font-semibold">{data.retentionPolicies.length}</p><StatusPill className="mt-3" tone={data.retentionPolicies.length ? "positive" : "warning"}>{data.retentionPolicies.length ? "Recorded" : "Owner decision"}</StatusPill></div><div className="rounded-[18px] border border-[var(--line)] p-4"><DatabaseBackup className="size-4 text-[var(--ink-soft)]" /><p className="mt-4 text-xs font-semibold">Latest backup evidence</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">{data.latestBackup ? `${data.latestBackup.provider} · ${dateTime(data.latestBackup.completedAt)}` : "No run recorded"}</p><StatusPill className="mt-3" tone={data.latestBackup ? tone(data.latestBackup.status) : "warning"}>{data.latestBackup?.status ?? "Not active"}</StatusPill></div><div className="rounded-[18px] border border-[var(--line)] p-4"><MonitorCheck className="size-4 text-[var(--ink-soft)]" /><p className="mt-4 text-xs font-semibold">Unresolved errors</p><p className="numeric mt-1 text-lg font-semibold">{data.unresolvedErrorCount}</p><StatusPill className="mt-3" tone={data.unresolvedErrorCount ? "warning" : "positive"}>{data.unresolvedErrorCount ? "Review" : "Clear"}</StatusPill></div></div></section>
    <RetentionPolicyConfiguration workspace={workspace} policies={data.retentionPolicies} canManage={data.canManage} />
    <section><SectionHeading title="Tenant exports" detail="Requests are permission-checked and recorded. A full tenant export remains locked until an approved storage destination and retention rule exist." /><div className="border-y border-[var(--line)]">{data.exportRequests.map((request) => <div key={request.id} className="flex items-center gap-3 border-t border-[var(--line)] py-3.5 first:border-0"><span className="flex size-8 items-center justify-center rounded-xl bg-[var(--canvas-strong)]"><DatabaseBackup className="size-3.5 text-[var(--ink-soft)]" /></span><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold capitalize">{request.subjectType} export</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">Requested {dateTime(request.requestedAt)}</p></div><StatusPill tone={tone(request.status)}>{request.status}</StatusPill></div>)}{!data.exportRequests.length ? <p className="py-5 text-center text-[10px] text-[var(--ink-faint)]">No tenant export request is recorded.</p> : null}</div></section>
    <section><SectionHeading title="Immutable audit trail" detail="Latest security-sensitive tenant events visible to this session." /><div className="overflow-x-auto border-y border-[var(--line)]"><div className="grid min-w-[700px] grid-cols-[1fr_1fr_.8fr_.8fr] gap-4 bg-[var(--canvas-strong)] px-4 py-2.5 text-[9px] font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase"><span>Event</span><span>Record</span><span>Actor</span><span>Occurred</span></div>{data.auditEvents.map((event) => <div key={event.id} className="grid min-w-[700px] grid-cols-[1fr_1fr_.8fr_.8fr] items-center gap-4 border-t border-[var(--line)] px-4 py-3.5"><span className="text-[10px] font-semibold">{event.action.replaceAll("_", " ")}</span><span className="truncate font-mono text-[9px] text-[var(--ink-faint)]">{event.tableName} · {event.recordId ?? "—"}</span><span className="truncate text-[9px] text-[var(--ink-faint)]">{event.actorName}</span><span className="numeric text-[9px] text-[var(--ink-faint)]">{dateTime(event.occurredAt)}</span></div>)}{!data.auditEvents.length ? <p className="py-5 text-center text-[10px] text-[var(--ink-faint)]">No audit event is visible in this scope.</p> : null}</div></section>
  </div>;
}

export function LiveSettingsWorkspace({ workspace, result }: { workspace: WorkspaceContextValue; result: LiveReadResult<LiveSettingsModel> }) {
  const [tab, setTab] = useState<Tab>("organization");
  if (!result.ok) return <SettingsError message={result.message} />;
  const data = result.data;
  return <PageFrame width="standard"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Tenant administration</p><h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Settings</h2><p className="mt-1 text-[11px] text-[var(--ink-faint)]">Organization, locations, expense coding, security, notifications, retention, and audit</p></div><StatusPill tone={data.organization.configuredAt ? "positive" : "warning"}><CircleAlert className="size-3" /> {data.organization.configuredAt ? "Tenant configured" : "Production setup incomplete"}</StatusPill></div><section className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0"><Metric label="Owners" value={String(data.roleCounts.owner)} detail={`${data.membershipCounts.active} active members`} /><Metric label="Locations" value={String(data.locations.length)} detail="Current access scope" /><Metric label="Session" value={workspace.identity.aal.toUpperCase()} detail={`${workspace.role} access`} /><Metric label="Retention" value={data.retentionPolicies.length ? "Recorded" : "Unset"} detail={data.retentionPolicies.length ? `${data.retentionPolicies.length} classes` : "Owner policy required"} /></section><div className="mt-8 grid gap-8 lg:grid-cols-[210px_1fr]"><nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto lg:block lg:space-y-1">{tabs.map((item) => { const Icon = item.icon; const active = tab === item.id; return <button key={item.id} onClick={() => setTab(item.id)} aria-current={active ? "page" : undefined} className={cn("focus-ring flex min-h-10 shrink-0 items-center gap-2.5 rounded-xl px-3 text-left text-[11px] font-semibold transition-colors lg:w-full", active ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--ink-faint)] hover:bg-[var(--canvas-strong)] hover:text-[var(--ink)]")}><Icon className="size-3.5" />{item.label}</button>; })}</nav><div className="min-w-0">{tab === "organization" ? <OrganizationPanel data={data} /> : tab === "locations" ? <LocationsPanel data={data} /> : tab === "expenses" ? <ExpenseCategoriesPanel data={data} workspace={workspace} /> : tab === "security" ? <SecurityPanel workspace={workspace} /> : tab === "notifications" ? <NotificationsPanel data={data} workspace={workspace} /> : <DataPanel data={data} workspace={workspace} />}</div></div></PageFrame>;
}
