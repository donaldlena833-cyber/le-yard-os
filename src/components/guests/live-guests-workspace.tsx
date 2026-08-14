"use client";

import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileBarChart,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Merge,
  MessageSquareText,
  Pencil,
  Phone,
  Search,
  ShieldCheck,
  Star,
  Tag,
  UserRoundPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useId,
  useMemo,
  useState,
} from "react";
import {
  addGuestNoteAction,
  mergeGuestAction,
  recordGuestConsentAction,
  saveGuestAction,
} from "@/app/actions/workflows/guests";
import { ObjectActionBar } from "@/components/actions/object-action-bar";
import { RealtimeSyncStatus } from "@/components/realtime/realtime-sync-status";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConversationLog } from "@/components/ui/conversation-log";
import { Drawer } from "@/components/ui/drawer";
import { Modal } from "@/components/ui/modal";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  LiveGuest,
  LiveGuestDuplicateCandidate,
  LiveGuestDuplicateProfile,
  LiveGuestsModel,
} from "@/data/read-models/guests";
import type { LiveReadResult } from "@/data/read-models/shared";
import {
  resolveWorkMode,
  type ActionResolutionContext,
} from "@/lib/actions/action-registry";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import {
  useRealtimeInvalidation,
  type RealtimeInvalidationBinding,
} from "@/lib/realtime/use-realtime-invalidation";
import { cn, formatMoney } from "@/lib/utils";

type Filter = "all" | "vip" | "allergies" | "recent";

const guestRealtimeBindings = [
  { table: "guests", scope: "organization" },
  { table: "reservations", scope: "location" },
] satisfies readonly RealtimeInvalidationBinding[];

interface PendingGuestMerge {
  source: LiveGuestDuplicateProfile;
  target: LiveGuestDuplicateProfile;
  reason: string;
}

function splitText(value: string | null): string[] {
  return value
    ? value
        .split(/[,;\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];
}

function dateLabel(
  value: string | null,
  includeTime = false,
  timeZone?: string,
): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

function latestConsent(guest: LiveGuest, channel: string) {
  return guest.consents.find((consent) => consent.channel === channel) ?? null;
}

function consentTone(status: string) {
  if (status === "granted") return "positive" as const;
  if (status === "revoked") return "danger" as const;
  return "neutral" as const;
}

function DuplicateProfileCard({
  profile,
  role,
  currencyCode,
}: {
  profile: LiveGuestDuplicateProfile;
  role: "Archive" | "Keep";
  currencyCode: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[16px] border p-4",
        role === "Keep"
          ? "border-[var(--accent)] bg-[var(--accent-soft)]/35"
          : "border-[var(--line)] bg-[var(--canvas)]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">
            {profile.displayName}
          </p>
          <p className="mt-1 truncate text-xs text-[var(--ink-faint)]">
            {profile.email || profile.phone || "No additional contact"}
          </p>
        </div>
        <StatusPill tone={role === "Keep" ? "positive" : "neutral"}>
          {role}
        </StatusPill>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-3 text-xs">
        <div>
          <span className="block text-[var(--ink-faint)]">Visits</span>
          <strong className="numeric mt-1 block text-[var(--ink)]">
            {profile.visitCount.toLocaleString()}
          </strong>
        </div>
        <div>
          <span className="block text-[var(--ink-faint)]">Lifetime</span>
          <strong className="numeric mt-1 block text-[var(--ink)]">
            {formatMoney(profile.lifetimeSpendCents, currencyCode)}
          </strong>
        </div>
        <div>
          <span className="block text-[var(--ink-faint)]">Last visit</span>
          <strong className="mt-1 block font-medium text-[var(--ink)]">
            {dateLabel(profile.lastVisitAt)}
          </strong>
        </div>
        <div>
          <span className="block text-[var(--ink-faint)]">Source</span>
          <strong className="mt-1 block truncate font-medium capitalize text-[var(--ink)]">
            {profile.source.replaceAll("_", " ")}
          </strong>
        </div>
      </div>
      {profile.vip ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-strong)]">
          <Star className="size-3 fill-current" />
          VIP flag recorded
        </p>
      ) : null}
    </div>
  );
}

function OverlayDialog({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Modal
      open
      onClose={onClose}
      labelledBy={titleId}
      initialFocusSelector="[autofocus]"
      position="responsive-sheet"
      className="max-h-[92svh] max-w-xl overflow-y-auto rounded-t-[24px] p-5 sm:rounded-[24px] sm:p-7"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3
            id={titleId}
            className="mt-2 text-xl font-medium tracking-[-0.04em]"
          >
            {title}
          </h3>
        </div>
        <Button
          variant="quiet"
          size="icon"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X className="size-4" />
        </Button>
      </div>
      {children}
    </Modal>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="mb-1.5 block text-xs font-semibold">{label}</span>
      {children}
    </label>
  );
}

const fieldClass =
  "h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs outline-none focus:border-[var(--accent)]";
const areaClass =
  "w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-xs leading-5 outline-none focus:border-[var(--accent)]";

export function LiveGuestsWorkspace({
  workspace,
  result,
  initialSearch,
}: {
  workspace: WorkspaceContextValue;
  result: LiveReadResult<LiveGuestsModel>;
  initialSearch: string;
}) {
  const router = useRouter();
  const model = result.ok ? result.data : null;
  const canReadGuestContact = model?.contactContextAuthorized !== false;
  const canReadSensitiveGuestContext =
    model?.sensitiveContextAuthorized !== false;
  const [query, setQuery] = useState(initialSearch);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTrigger, setSelectedTrigger] = useState<HTMLElement | null>(
    null,
  );
  const [editingId, setEditingId] = useState<"new" | string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [mergeReview, setMergeReview] = useState<PendingGuestMerge | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const guestProfileTitleId = useId();
  const [recentCutoff] = useState(() => Date.now() - 90 * 24 * 60 * 60 * 1_000);
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  const selected =
    model?.guests.find((guest) => guest.id === selectedId) ?? null;
  const editing =
    editingId === "new"
      ? null
      : (model?.guests.find((guest) => guest.id === editingId) ?? null);

  const filtered = useMemo(() => {
    if (!model) return [];
    return model.guests.filter((guest) => {
      if (filter === "vip") return guest.vip;
      if (filter === "allergies")
        return canReadSensitiveGuestContext && Boolean(guest.allergies?.trim());
      if (filter === "recent")
        return guest.lastVisitAt
          ? new Date(guest.lastVisitAt).valueOf() >= recentCutoff
          : false;
      return true;
    });
  }, [canReadSensitiveGuestContext, filter, model, recentCutoff]);

  const realtime = useRealtimeInvalidation({
    enabled: Boolean(model),
    channelName: `guest-crm-${workspace.organization.id}-${workspace.activeLocation.id}`,
    bindings: guestRealtimeBindings,
    organizationId: workspace.organization.id,
    locationId: workspace.activeLocation.id,
  });

  if (!result.ok || !model) {
    return (
      <PageFrame>
        <section className="mx-auto mt-[10svh] max-w-xl rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-8 text-center">
          <CircleAlert className="mx-auto size-6 text-[var(--warning)]" />
          <h2 className="mt-4 text-xl font-medium">Guestbook unavailable</h2>
          <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">
            {result.ok ? "Guest data could not be loaded." : result.message}
          </p>
        </section>
      </PageFrame>
    );
  }

  async function perform(
    action: Promise<{ ok: boolean; message?: string }>,
    success: string,
  ) {
    setBusy(true);
    setMessage("");
    try {
      const response = await action;
      setBusy(false);
      if (!response.ok) {
        setMessage(
          response.message ?? "The guest action could not be completed.",
        );
        return false;
      }
      setMessage(success);
      router.refresh();
      return true;
    } catch {
      setBusy(false);
      setMessage(
        "The guest action could not be completed. Check the connection and try again.",
      );
      return false;
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.trim().slice(0, 120);
    router.push(
      normalized ? `/guests?q=${encodeURIComponent(normalized)}` : "/guests",
    );
  }

  async function submitGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scope = `guest.save:${editing?.id ?? "new"}`;
    const payload = {
      organizationId: workspace.organization.id,
      locationId: workspace.activeLocation.id,
      guestId: editing?.id ?? null,
      firstName: String(form.get("firstName") || "") || null,
      lastName: String(form.get("lastName") || "") || null,
      displayName: String(form.get("displayName") || ""),
      email: String(form.get("email") || "") || null,
      phone: String(form.get("phone") || "") || null,
      birthday: String(form.get("birthday") || "") || null,
      vip: form.get("vip") === "on",
      preferences: String(form.get("preferences") || "") || null,
      allergies: String(form.get("allergies") || "") || null,
      notes: String(form.get("notes") || "") || null,
    };
    const response = await perform(
      saveGuestAction({
        requestId: requestIdFor(scope, payload),
        ...payload,
      }),
      editing ? "Guest profile updated." : "Guest profile created.",
    );
    if (response) {
      rotateRequestId(scope);
      setEditingId(null);
    }
  }

  async function toggleVip(guest: LiveGuest) {
    const scope = `guest.vip:${guest.id}`;
    const payload = {
      organizationId: workspace.organization.id,
      locationId: workspace.activeLocation.id,
      guestId: guest.id,
      firstName: guest.firstName,
      lastName: guest.lastName,
      displayName: guest.displayName,
      email: guest.email,
      phone: guest.phone,
      birthday: guest.birthday,
      vip: !guest.vip,
      preferences: guest.preferences,
      allergies: guest.allergies,
      notes: guest.notes,
    };
    const response = await perform(
      saveGuestAction({
        requestId: requestIdFor(scope, payload),
        ...payload,
      }),
      guest.vip ? "VIP flag removed." : "Guest marked VIP.",
    );
    if (response) rotateRequestId(scope);
  }

  async function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const scope = `guest.note:${selected.id}`;
    const payload = {
      organizationId: workspace.organization.id,
      locationId: workspace.activeLocation.id,
      guestId: selected.id,
      note: String(form.get("note") || ""),
      sensitive: form.get("sensitive") === "on",
    };
    const response = await perform(
      addGuestNoteAction({
        requestId: requestIdFor(scope, payload),
        ...payload,
      }),
      "Hospitality note added.",
    );
    if (response) {
      rotateRequestId(scope);
      setNoteOpen(false);
    }
  }

  async function submitConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const scope = `guest.consent:${selected.id}`;
    const payload = {
      organizationId: workspace.organization.id,
      locationId: workspace.activeLocation.id,
      guestId: selected.id,
      channel: String(form.get("channel")),
      status: String(form.get("status")),
      evidenceNote: String(form.get("evidenceNote") || "") || null,
    };
    const response = await perform(
      recordGuestConsentAction({
        requestId: requestIdFor(scope, payload),
        ...payload,
      }),
      "Consent event recorded with a server timestamp.",
    );
    if (response) {
      rotateRequestId(scope);
      setConsentOpen(false);
    }
  }

  function beginMergeReview(
    candidate: LiveGuestDuplicateCandidate,
    target: "left" | "right",
  ) {
    setMessage("");
    setDuplicatesOpen(false);
    setMergeReview({
      source: target === "left" ? candidate.right : candidate.left,
      target: target === "left" ? candidate.left : candidate.right,
      reason: candidate.reason,
    });
  }

  async function submitMerge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mergeReview) return;
    const scope = `guest.merge:${mergeReview.source.id}:${mergeReview.target.id}`;
    const payload = {
      organizationId: workspace.organization.id,
      locationId: workspace.activeLocation.id,
      sourceGuestId: mergeReview.source.id,
      targetGuestId: mergeReview.target.id,
      matchScore: 1,
      reasons: [
        mergeReview.reason,
        "Authorized operator selected the surviving profile after side-by-side review.",
      ],
    };
    const response = await perform(
      mergeGuestAction({
        requestId: requestIdFor(scope, payload),
        ...payload,
      }),
      `${mergeReview.source.displayName} was merged into ${mergeReview.target.displayName}.`,
    );
    if (response) {
      rotateRequestId(scope);
      setSelectedId(null);
      setMergeReview(null);
    }
  }

  const guestActionContext: ActionResolutionContext = {
    role: workspace.role,
    persona: workspace.persona,
    workMode: resolveWorkMode(workspace, workspace.activeJob),
    capabilities: workspace.capabilities,
    servicePhase: "off_hours",
    satisfiedPrerequisites: ["active_workspace", "selected_guest"],
  };

  return (
    <PageFrame>
      <header className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <div className="flex items-center gap-2">
            <StatusPill tone="neutral">Server-backed</StatusPill>
            <span className="text-xs text-[var(--ink-faint)]">
              Tenant-wide CRM · human-controlled changes
            </span>
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">
            Guestbook
          </h2>
          <p className="mt-1 text-[13px] text-[var(--ink-faint)]">
            Profiles, hospitality context, visits, reservations, and consent
            across {workspace.organization.name}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => router.push("/reports?type=guest_activity")}
          >
            <FileBarChart className="size-4" />
            Guest report
          </Button>
          {canReadGuestContact ? (
            <Button
              variant="accent"
              onClick={() => {
                setEditingId("new");
                setMessage("");
              }}
            >
              <UserRoundPlus className="size-4" />
              Add guest
            </Button>
          ) : null}
        </div>
      </header>
      <RealtimeSyncStatus {...realtime} />

      <section className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric
          label="Active profiles"
          value={model.metrics.activeProfiles.toLocaleString()}
          detail="Organization-wide"
        />
        <Metric
          label="VIP guests"
          value={model.metrics.vipProfiles.toLocaleString()}
          detail="Human flagged"
        />
        <Metric
          label="Allergy notes"
          value={
            canReadSensitiveGuestContext
              ? model.metrics.profilesWithAllergies.toLocaleString()
              : "Restricted"
          }
          detail={
            canReadSensitiveGuestContext
              ? "Profiles with recorded text"
              : "Sensitive guest permission required"
          }
        />
        <Metric
          label="Upcoming"
          value={model.metrics.upcomingReservations.toLocaleString()}
          detail={`${workspace.activeLocation.name} · booked or confirmed`}
        />
      </section>

      {canReadGuestContact &&
      canReadSensitiveGuestContext &&
      model.duplicateCandidates.length ? (
        <div className="mt-5 flex flex-col gap-3 rounded-[16px] bg-[var(--warning-soft)] px-4 py-3 text-xs text-[var(--warning)] sm:flex-row sm:items-center">
          <Merge className="size-4 shrink-0" />
          <span className="flex-1">
            <strong>
              {model.duplicateCandidates.length} exact contact match
              {model.duplicateCandidates.length === 1 ? "" : "es"}
            </strong>{" "}
            need human review. No profile is auto-merged.
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDuplicatesOpen(true)}
          >
            Review matches
          </Button>
        </div>
      ) : null}

      {message ? (
        <p
          role="status"
          className={cn(
            "fixed top-4 right-4 z-[80] max-w-sm rounded-xl px-4 py-3 text-xs shadow-[var(--shadow-float)]",
            message.toLowerCase().includes("could not") ||
              message.toLowerCase().includes("already") ||
              message.toLowerCase().includes("conflict")
              ? "bg-[var(--danger-soft)] text-[var(--danger)]"
              : "bg-[var(--positive-soft)] text-[var(--positive)]",
          )}
        >
          {message}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <form onSubmit={submitSearch} className="flex w-full gap-2 lg:max-w-xl">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search guests</span>
            <Search className="absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                canReadGuestContact && canReadSensitiveGuestContext
                  ? "Search name, contact, allergy, preference, or note"
                  : canReadSensitiveGuestContext
                    ? "Search name, allergy, preference, or note"
                    : canReadGuestContact
                      ? "Search name or contact"
                      : "Search guest name"
              }
              className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] pr-4 pl-10 text-xs outline-none focus:border-[var(--accent)]"
            />
          </label>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <div className="flex items-center gap-1 overflow-x-auto">
          {(
            [
              "all",
              "vip",
              ...(canReadSensitiveGuestContext ? ["allergies" as const] : []),
              "recent",
            ] as Filter[]
          ).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
              className={cn(
                "focus-ring rounded-lg px-3 py-2 text-xs font-semibold capitalize",
                filter === item
                  ? "bg-[var(--ink)] text-[var(--paper)]"
                  : "text-[var(--ink-faint)] hover:bg-[var(--canvas-strong)]",
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <section className="mt-5 sm:hidden" aria-label="Guest profiles">
        <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {filtered.map((guest, index) => (
            <button
              key={guest.id}
              onClick={(event) => {
                setSelectedTrigger(event.currentTarget);
                setSelectedId(guest.id);
                setMessage("");
              }}
              className="focus-ring flex w-full items-center gap-3 px-1 py-4 text-left"
            >
              <Avatar name={guest.displayName} index={index} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-semibold">
                    {guest.displayName}
                  </span>
                  {guest.vip ? (
                    <Star className="size-3 fill-[var(--accent)] text-[var(--accent)]" />
                  ) : null}
                </span>
                <span className="mt-1 block truncate text-xs text-[var(--ink-faint)]">
                  {guest.visitCount} visits ·{" "}
                  {canReadGuestContact
                    ? guest.email || guest.phone || "No contact"
                    : "Contact restricted"}
                </span>
              </span>
              {guest.allergies ? (
                <StatusPill tone="danger">Allergy</StatusPill>
              ) : (
                <ChevronRight className="size-4 text-[var(--ink-faint)]" />
              )}
            </button>
          ))}
        </div>
      </section>

      <section
        className="mt-5 hidden overflow-x-auto border-y border-[var(--line)] sm:block"
        aria-label="Guest profiles"
        tabIndex={0}
      >
        <div className="grid min-w-[790px] grid-cols-[1.3fr_.75fr_.7fr_.75fr_.55fr] gap-4 bg-[var(--canvas-strong)] px-4 py-2.5 text-xs font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase">
          <span>Guest</span>
          <span>Last visit</span>
          <span>Lifetime</span>
          <span>{workspace.activeLocation.name}</span>
          <span>Consent</span>
        </div>
        {filtered.map((guest, index) => {
          const consent = canReadGuestContact
            ? latestConsent(guest, "email")
            : undefined;
          return (
            <button
              key={guest.id}
              onClick={(event) => {
                setSelectedTrigger(event.currentTarget);
                setSelectedId(guest.id);
                setMessage("");
              }}
              className="focus-ring grid min-w-[790px] w-full grid-cols-[1.3fr_.75fr_.7fr_.75fr_.55fr] items-center gap-4 border-t border-[var(--line)] px-4 py-3.5 text-left hover:bg-[var(--paper)]"
            >
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={guest.displayName} index={index} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold">
                      {guest.displayName}
                    </span>
                    {guest.vip ? (
                      <Star className="size-3 fill-[var(--accent)] text-[var(--accent)]" />
                    ) : null}
                  </span>
                  <span className="mt-1 block truncate text-xs text-[var(--ink-faint)]">
                    {guest.visitCount} visits ·{" "}
                    {canReadGuestContact
                      ? guest.email || guest.phone || "No contact"
                      : "Contact restricted"}
                  </span>
                </span>
              </span>
              <span className="numeric text-xs text-[var(--ink-soft)]">
                {dateLabel(guest.lastVisitAt)}
              </span>
              <span className="numeric text-xs font-semibold">
                {canReadSensitiveGuestContext
                  ? formatMoney(guest.lifetimeSpendCents, model.currencyCode)
                  : "Restricted"}
              </span>
              <span>
                <span className="numeric block text-xs font-semibold">
                  {guest.currentLocationVisits}
                </span>
                <span className="mt-1 block text-xs text-[var(--ink-faint)]">
                  {canReadSensitiveGuestContext && canReadGuestContact
                    ? formatMoney(
                        guest.currentLocationSpendCents,
                        model.currencyCode,
                      )
                    : "Restricted"}
                </span>
              </span>
              <span>
                {canReadGuestContact ? (
                  consent ? (
                    <StatusPill tone={consentTone(consent.status)}>
                      {consent.status}
                    </StatusPill>
                  ) : (
                    <span className="text-xs text-[var(--ink-faint)]">
                      Unknown
                    </span>
                  )
                ) : (
                  <span className="text-xs text-[var(--ink-faint)]">
                    Restricted
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </section>

      {!filtered.length ? (
        <div className="px-5 py-14 text-center">
          <UsersRound className="mx-auto size-6 text-[var(--ink-faint)]" />
          <p className="mt-3 text-xs font-semibold">
            {model.search ? "No matching guests" : "No guest profiles yet"}
          </p>
          <p className="mt-1 text-xs text-[var(--ink-faint)]">
            {model.search
              ? "Try a different phrase or clear the search."
              : "Create the first profile manually or import approved source data."}
          </p>
        </div>
      ) : null}

      <div className="mt-7 flex items-start gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-3 text-xs leading-4 text-[var(--ink-soft)]">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
        <span>
          Consent is recorded as a timestamped history, not a mutable checkbox.
          Spend and visit totals are integration-derived evidence and are not
          editable from this profile screen.
        </span>
      </div>

      <Drawer
        open={Boolean(selected && !editingId && !noteOpen && !consentOpen)}
        onClose={() => setSelectedId(null)}
        labelledBy={guestProfileTitleId}
        width="lg"
        returnFocusTarget={selectedTrigger}
        className="p-5 sm:p-7"
      >
        {selected ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={selected.displayName} size="lg" />
                <div className="min-w-0">
                  <h2
                    id={guestProfileTitleId}
                    className="flex items-center gap-2 truncate text-lg font-semibold tracking-[-0.035em]"
                  >
                    {selected.displayName}
                    {selected.vip ? (
                      <Star className="size-4 shrink-0 fill-[var(--accent)] text-[var(--accent)]" />
                    ) : null}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">
                    {selected.visitCount} visits ·{" "}
                    {canReadSensitiveGuestContext
                      ? `${formatMoney(selected.lifetimeSpendCents, model.currencyCode)} lifetime · `
                      : ""}
                    {selected.source}
                  </p>
                </div>
              </div>
              <Button
                variant="quiet"
                size="icon"
                onClick={() => setSelectedId(null)}
                aria-label="Close guest profile"
              >
                <X className="size-4" />
              </Button>
            </div>
            <ObjectActionBar
              entity="guest"
              state="active"
              context={guestActionContext}
              label={`Actions for ${selected.displayName}`}
              className="mt-6 flex flex-wrap gap-2"
              size="sm"
              busy={busy}
              handlers={{
                ...(canReadGuestContact
                  ? {
                      "guest.toggle_vip": () => toggleVip(selected),
                      "guest.record_consent": () => {
                        setMessage("");
                        setConsentOpen(true);
                      },
                      "guest.edit": () => {
                        setMessage("");
                        setEditingId(selected.id);
                      },
                    }
                  : {}),
                ...(canReadGuestContact && canReadSensitiveGuestContext
                  ? {
                      "guest.add_note": () => {
                        setMessage("");
                        setNoteOpen(true);
                      },
                    }
                  : {}),
              }}
              labels={{
                "guest.toggle_vip": selected.vip ? "Remove VIP" : "Mark VIP",
              }}
              icons={{
                "guest.toggle_vip": <Star className="size-3.5" />,
                "guest.add_note": <MessageSquareText className="size-3.5" />,
                "guest.record_consent": <ShieldCheck className="size-3.5" />,
                "guest.edit": <Pencil className="size-3.5" />,
              }}
              variants={{
                "guest.toggle_vip": selected.vip ? "accent" : "secondary",
                "guest.add_note": "secondary",
                "guest.record_consent": "secondary",
                "guest.edit": "quiet",
              }}
            />

            {canReadGuestContact ? (
              <section className="mt-7 border-y border-[var(--line)] py-5">
                <SectionHeading title="Contact & consent" className="mb-4" />
                <div className="grid gap-3 text-xs sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <Mail className="size-3.5 text-[var(--ink-faint)]" />
                    <span className="truncate">
                      {selected.email || "No email"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="size-3.5 text-[var(--ink-faint)]" />
                    <span>{selected.phone || "No phone"}</span>
                  </div>
                </div>
                {selected.contacts.length ? (
                  <div className="mt-3 space-y-2">
                    {selected.contacts.map((contact) => (
                      <div
                        key={contact.id}
                        className="flex items-center gap-2 text-xs text-[var(--ink-faint)]"
                      >
                        <span className="capitalize">
                          {contact.label || contact.type}
                        </span>
                        <span>·</span>
                        <span className="truncate">{contact.value}</span>
                        {contact.verifiedAt ? (
                          <Check className="size-3 text-[var(--positive)]" />
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {selected.consents.slice(0, 8).map((consent) => (
                    <StatusPill
                      key={consent.id}
                      tone={consentTone(consent.status)}
                    >
                      {consent.channel}: {consent.status}
                    </StatusPill>
                  ))}
                  {!selected.consents.length ? (
                    <StatusPill tone="neutral">Consent unknown</StatusPill>
                  ) : null}
                </div>
              </section>
            ) : (
              <p className="mt-7 rounded-xl border border-[var(--line)] px-4 py-3 text-xs text-[var(--ink-faint)]">
                Contact and consent context requires guest management access.
              </p>
            )}

            {canReadSensitiveGuestContext ? (
              <section className="mt-6">
                <SectionHeading
                  title="Hospitality context"
                  detail="Human-entered, visible to authorized management"
                />
                <div className="space-y-5">
                  <div>
                    <p className="eyebrow mb-2">Allergies</p>
                    <div className="flex flex-wrap gap-1.5">
                      {splitText(selected.allergies).length ? (
                        splitText(selected.allergies).map((allergy) => (
                          <StatusPill key={allergy} tone="danger">
                            <AlertTriangle className="size-3" />
                            {allergy}
                          </StatusPill>
                        ))
                      ) : (
                        <span className="text-xs text-[var(--ink-faint)]">
                          None recorded—not the same as confirmed none.
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="eyebrow mb-2">Preferences</p>
                    <div className="flex flex-wrap gap-1.5">
                      {splitText(selected.preferences).length ? (
                        splitText(selected.preferences).map((preference) => (
                          <StatusPill key={preference} tone="accent">
                            {preference}
                          </StatusPill>
                        ))
                      ) : (
                        <span className="text-xs text-[var(--ink-faint)]">
                          No preferences recorded.
                        </span>
                      )}
                    </div>
                  </div>
                  {selected.tags.length ? (
                    <div>
                      <p className="eyebrow mb-2">Tags</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selected.tags.map((tag) => (
                          <StatusPill key={tag.id} tone="neutral">
                            <Tag className="size-3" />
                            {tag.name}
                          </StatusPill>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <p className="eyebrow mb-2">Profile note</p>
                    <p className="text-[13px] leading-5 text-[var(--ink-soft)]">
                      {selected.notes || "No profile note."}
                    </p>
                  </div>
                </div>
              </section>
            ) : (
              <p className="mt-6 rounded-xl border border-[var(--line)] px-4 py-3 text-xs text-[var(--ink-faint)]">
                Hospitality context is restricted to staff with sensitive guest
                access.
              </p>
            )}

            {canReadSensitiveGuestContext ? (
              <section className="mt-7">
                <SectionHeading
                  title="Hospitality notes"
                  detail="Append-only staff context"
                />
                <ConversationLog
                  label={`Hospitality notes for ${selected.displayName}`}
                  entries={selected.guestNotes.map((note) => ({
                    id: note.id,
                    summary: note.authorName,
                    body: note.note,
                    leading: note.sensitive ? (
                      <LockKeyhole className="size-3.5" />
                    ) : (
                      <MessageSquareText className="size-3.5" />
                    ),
                    context: (
                      <>
                        {note.sensitive ? (
                          <span>Sensitive</span>
                        ) : (
                          <span>Service note</span>
                        )}
                        {note.locationName ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{note.locationName}</span>
                          </>
                        ) : null}
                      </>
                    ),
                    timestamp: {
                      dateTime: note.createdAt,
                      label: dateLabel(note.createdAt, true),
                    },
                  }))}
                  empty="No hospitality notes yet."
                />
              </section>
            ) : null}

            <section className="mt-7">
              <SectionHeading
                title="Reservations"
                detail="Imported or manually recorded source history"
              />
              <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
                {selected.reservations.slice(0, 12).map((reservation) => (
                  <div
                    key={reservation.id}
                    className="flex items-center gap-3 py-3.5"
                  >
                    <span className="flex size-8 items-center justify-center rounded-xl bg-[var(--canvas-strong)]">
                      <CalendarDays className="size-3.5 text-[var(--ink-faint)]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold">
                        {dateLabel(
                          reservation.reservedAt,
                          true,
                          reservation.timeZone,
                        )}{" "}
                        · party of {reservation.partySize}
                      </p>
                      <p className="mt-1 truncate text-xs text-[var(--ink-faint)]">
                        {reservation.locationName} · {reservation.source}
                        {reservation.tableLabel
                          ? ` · ${reservation.tableLabel}`
                          : ""}
                      </p>
                      {reservation.specialRequests ? (
                        <p className="mt-1 text-xs text-[var(--ink-soft)]">
                          {reservation.specialRequests}
                        </p>
                      ) : null}
                    </div>
                    <StatusPill
                      tone={
                        ["completed", "seated"].includes(reservation.status)
                          ? "positive"
                          : ["cancelled", "no_show"].includes(
                                reservation.status,
                              )
                            ? "danger"
                            : "warning"
                      }
                    >
                      {reservation.status.replaceAll("_", " ")}
                    </StatusPill>
                  </div>
                ))}
                {!selected.reservations.length ? (
                  <p className="py-5 text-center text-xs text-[var(--ink-faint)]">
                    No reservation records yet.
                  </p>
                ) : null}
              </div>
            </section>

            {canReadSensitiveGuestContext ? (
              <section className="mt-7">
                <SectionHeading
                  title="Visit history"
                  detail="Location and spend evidence"
                />
                <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
                  {selected.visits.slice(0, 16).map((visit) => (
                    <div
                      key={visit.id}
                      className="flex items-center gap-3 py-3.5"
                    >
                      <span className="flex size-8 items-center justify-center rounded-xl bg-[var(--canvas-strong)]">
                        <Check className="size-3.5 text-[var(--positive)]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold">
                          {dateLabel(visit.visitedAt, true, visit.timeZone)}
                          {visit.partySize
                            ? ` · party of ${visit.partySize}`
                            : ""}
                        </p>
                        <p className="mt-1 truncate text-xs text-[var(--ink-faint)]">
                          {visit.locationName} · {visit.source}
                          {visit.notes ? ` · ${visit.notes}` : ""}
                        </p>
                      </div>
                      <span className="numeric text-xs font-semibold">
                        {visit.spendCents == null
                          ? "—"
                          : formatMoney(visit.spendCents, model.currencyCode)}
                      </span>
                    </div>
                  ))}
                  {!selected.visits.length ? (
                    <p className="py-5 text-center text-xs text-[var(--ink-faint)]">
                      No visit records yet.
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </Drawer>

      <>
        {editingId ? (
          <OverlayDialog
            title={editing ? "Edit guest" : "Add guest"}
            eyebrow="Guest profile"
            onClose={() => setEditingId(null)}
          >
            <form
              onSubmit={submitGuest}
              className="mt-6 grid gap-4 sm:grid-cols-2"
            >
              <Field label="First name">
                <input
                  name="firstName"
                  defaultValue={editing?.firstName ?? ""}
                  className={fieldClass}
                />
              </Field>
              <Field label="Last name">
                <input
                  name="lastName"
                  defaultValue={editing?.lastName ?? ""}
                  className={fieldClass}
                />
              </Field>
              <Field label="Display name" className="sm:col-span-2">
                <input
                  required
                  name="displayName"
                  defaultValue={editing?.displayName ?? ""}
                  className={fieldClass}
                />
              </Field>
              <Field label="Email">
                <input
                  name="email"
                  type="email"
                  defaultValue={editing?.email ?? ""}
                  className={fieldClass}
                />
              </Field>
              <Field label="Phone">
                <input
                  name="phone"
                  type="tel"
                  defaultValue={editing?.phone ?? ""}
                  className={fieldClass}
                />
              </Field>
              <Field label="Birthday">
                <input
                  name="birthday"
                  type="date"
                  defaultValue={editing?.birthday ?? ""}
                  className={fieldClass}
                />
              </Field>
              <label className="flex h-11 items-center gap-2 self-end rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs font-semibold">
                <input
                  name="vip"
                  type="checkbox"
                  defaultChecked={editing?.vip ?? false}
                  className="size-4 accent-[var(--accent)]"
                />
                <Star className="size-3.5" />
                VIP profile
              </label>
              {canReadSensitiveGuestContext ? (
                <>
                  <Field label="Allergies" className="sm:col-span-2">
                    <textarea
                      name="allergies"
                      rows={3}
                      defaultValue={editing?.allergies ?? ""}
                      className={areaClass}
                      placeholder="Record exact staff- or guest-provided wording"
                    />
                  </Field>
                  <Field label="Preferences" className="sm:col-span-2">
                    <textarea
                      name="preferences"
                      rows={3}
                      defaultValue={editing?.preferences ?? ""}
                      className={areaClass}
                    />
                  </Field>
                  <Field label="Profile note" className="sm:col-span-2">
                    <textarea
                      name="notes"
                      rows={3}
                      defaultValue={editing?.notes ?? ""}
                      className={areaClass}
                    />
                  </Field>
                </>
              ) : null}
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button variant="quiet" onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="accent" disabled={busy}>
                  {busy ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  {editing ? "Save changes" : "Create profile"}
                </Button>
              </div>
            </form>
          </OverlayDialog>
        ) : null}

        {noteOpen && selected ? (
          <OverlayDialog
            title="Add hospitality note"
            eyebrow={selected.displayName}
            onClose={() => setNoteOpen(false)}
          >
            <form onSubmit={submitNote} className="mt-6 space-y-4">
              <Field label="Note">
                <textarea
                  required
                  name="note"
                  rows={6}
                  className={areaClass}
                  placeholder="Record sourced, useful service context."
                />
              </Field>
              <label className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--canvas)] px-3 py-3 text-xs leading-4">
                <input
                  name="sensitive"
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--accent)]"
                />
                <span>
                  <strong className="block text-[var(--ink)]">
                    Sensitive management note
                  </strong>
                  <span className="text-[var(--ink-faint)]">
                    Use sparingly for context that should receive stricter
                    handling.
                  </span>
                </span>
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="quiet" onClick={() => setNoteOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="accent" disabled={busy}>
                  {busy ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <MessageSquareText className="size-4" />
                  )}
                  Add note
                </Button>
              </div>
            </form>
          </OverlayDialog>
        ) : null}

        {consentOpen && selected ? (
          <OverlayDialog
            title="Record consent event"
            eyebrow={selected.displayName}
            onClose={() => setConsentOpen(false)}
          >
            <form
              onSubmit={submitConsent}
              className="mt-6 grid gap-4 sm:grid-cols-2"
            >
              <Field label="Channel">
                <select name="channel" className={fieldClass}>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="phone">Phone</option>
                  <option value="profiling">Profiling</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Event">
                <select name="status" className={fieldClass}>
                  <option value="granted">Consent granted</option>
                  <option value="revoked">Consent revoked</option>
                </select>
              </Field>
              <Field label="Evidence note" className="sm:col-span-2">
                <textarea
                  name="evidenceNote"
                  rows={4}
                  className={areaClass}
                  placeholder="How and where the guest communicated this choice"
                />
              </Field>
              <div className="sm:col-span-2 flex items-start gap-3 rounded-xl bg-[var(--accent-soft)]/45 px-3 py-3 text-xs leading-4 text-[var(--accent-strong)]">
                <Clock3 className="mt-0.5 size-4 shrink-0" />
                <span>
                  The server records the event time and staff actor. A new event
                  is appended; earlier consent history is preserved.
                </span>
              </div>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button variant="quiet" onClick={() => setConsentOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="accent" disabled={busy}>
                  {busy ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-4" />
                  )}
                  Record event
                </Button>
              </div>
            </form>
          </OverlayDialog>
        ) : null}

        {duplicatesOpen ? (
          <OverlayDialog
            title="Possible duplicate profiles"
            eyebrow="Human review"
            onClose={() => setDuplicatesOpen(false)}
          >
            <div className="mt-6 divide-y divide-[var(--line)] border-y border-[var(--line)]">
              {model.duplicateCandidates.map((candidate) => (
                <div
                  key={`${candidate.leftGuestId}:${candidate.rightGuestId}`}
                  className="py-5"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--warning-soft)]">
                      <Merge className="size-4 text-[var(--warning)]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold">
                        {candidate.leftName}{" "}
                        <span className="text-[var(--ink-faint)]">and</span>{" "}
                        {candidate.rightName}
                      </p>
                      <p className="mt-1 text-xs text-[var(--ink-faint)]">
                        {candidate.reason}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => beginMergeReview(candidate, "left")}
                    >
                      Keep {candidate.leftName}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => beginMergeReview(candidate, "right")}
                    >
                      Keep {candidate.rightName}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-start gap-3 rounded-xl border border-[var(--line)] px-3 py-3 text-xs leading-4 text-[var(--ink-soft)]">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
              <span>
                Choosing a survivor opens a separate confirmation. The merge is
                atomic, idempotent, and recorded in immutable audit evidence; no
                profile is changed by detection alone.
              </span>
            </div>
            {model.duplicateScopeLimited ? (
              <p className="mt-3 text-xs text-[var(--ink-faint)]">
                Duplicate review is limited to the first 1,000 active profiles
                with phone or email data.
              </p>
            ) : null}
            <div className="mt-5 flex justify-end">
              <Button
                variant="secondary"
                onClick={() => setDuplicatesOpen(false)}
              >
                Done
              </Button>
            </div>
          </OverlayDialog>
        ) : null}

        {mergeReview ? (
          <OverlayDialog
            title="Confirm guest merge"
            eyebrow="Permanent consolidation"
            onClose={() => setMergeReview(null)}
          >
            <form onSubmit={submitMerge} className="mt-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <DuplicateProfileCard
                  profile={mergeReview.source}
                  role="Archive"
                  currencyCode={model.currencyCode}
                />
                <DuplicateProfileCard
                  profile={mergeReview.target}
                  role="Keep"
                  currencyCode={model.currencyCode}
                />
              </div>
              <div className="mt-4 flex items-start gap-3 rounded-[16px] bg-[var(--warning-soft)] px-4 py-3 text-xs leading-4 text-[var(--warning)]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  <strong className="block">
                    Review the survivor carefully.
                  </strong>{" "}
                  Visits, reservations, contacts, consent history, tags, notes,
                  and linked incidents move to {mergeReview.target.displayName}.
                  The other profile is retained as a merge tombstone and cannot
                  remain active.
                </span>
              </div>
              <p className="mt-4 text-xs text-[var(--ink-faint)]">
                Evidence: {mergeReview.reason}. Profile fields on the survivor
                are preserved; missing values may be filled from the archived
                profile.
              </p>
              <label className="mt-4 flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--canvas)] px-3 py-3 text-xs leading-4">
                <input
                  required
                  name="confirmMerge"
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--accent)]"
                />
                <span>
                  <strong className="block text-[var(--ink)]">
                    I reviewed both profiles and chose the correct survivor.
                  </strong>
                  <span className="text-[var(--ink-faint)]">
                    This confirmation and my identity are recorded with the
                    merge event.
                  </span>
                </span>
              </label>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => {
                    setMergeReview(null);
                    setDuplicatesOpen(true);
                  }}
                >
                  Back to matches
                </Button>
                <Button type="submit" variant="accent" disabled={busy}>
                  {busy ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Merge className="size-4" />
                  )}
                  Merge into {mergeReview.target.displayName}
                </Button>
              </div>
            </form>
          </OverlayDialog>
        ) : null}
      </>
    </PageFrame>
  );
}
