"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Check,
  Download,
  FileText,
  Hash,
  Info,
  LockKeyhole,
  LoaderCircle,
  Megaphone,
  MessageCircleMore,
  Paperclip,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SmilePlus,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPrivateFileDownloadUrlAction } from "@/app/actions/workflows/files";
import {
  acknowledgeLiveAnnouncementAction,
  createChatAttachmentUploadUrlAction,
  finalizeChatAttachmentAction,
  toggleLiveChatReactionAction,
} from "@/app/actions/workflows/live-chat";
import { markChatReadAction, sendChatMessageAction } from "@/app/actions/workflows/chat";
import {
  createChatChannelAction,
  setChatChannelArchivedAction,
  setPrivateChatChannelMembersAction,
} from "@/app/actions/workflows/configuration";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageFrame } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type { LiveChatChannel, LiveChatMessage, LiveMessagesModel } from "@/data/read-models/messages";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createClient } from "@/lib/supabase/client";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import { validatePrivateFile } from "@/lib/storage/private-files";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database.generated";

const reactions = ["👍", "❤️", "✅", "👀", "🎉"] as const;
const chatAttachmentTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
const chatEvidenceRetryDelaysMs = [250, 1_000, 3_000] as const;
type ChatMessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];
type ChatReactionRow = Database["public"]["Tables"]["chat_reactions"]["Row"];
type ChatAttachmentRow = Database["public"]["Tables"]["chat_attachments"]["Row"];
type ChatAcknowledgementRow = Database["public"]["Tables"]["announcement_acknowledgements"]["Row"];

function MessagesReadError({ message }: { message: string }) {
  return (
    <PageFrame>
      <section className="mx-auto mt-[8svh] max-w-xl rounded-[28px] border border-[var(--line)] bg-[var(--paper-strong)] p-7 text-center shadow-[var(--shadow-card)]">
        <AlertCircle className="mx-auto size-6 text-[var(--danger)]" />
        <h2 className="mt-4 text-xl font-medium tracking-[-0.04em]">Messages unavailable</h2>
        <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">{message}</p>
      </section>
    </PageFrame>
  );
}

function ChannelIcon({ kind }: { kind: LiveChatChannel["kind"] }) {
  if (kind === "management") return <LockKeyhole className="size-3.5" />;
  if (kind === "all_staff") return <UsersRound className="size-3.5" />;
  if (kind === "private") return <ShieldCheck className="size-3.5" />;
  return <Hash className="size-3.5" />;
}

function ChannelRow({
  channel,
  selected,
  unread,
  onSelect,
}: {
  channel: LiveChatChannel;
  selected: boolean;
  unread: number;
  onSelect: () => void;
}) {
  return (
    <button type="button" onClick={onSelect} aria-current={selected ? "page" : undefined} className={cn("focus-ring flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[var(--paper)]", selected && "bg-[var(--paper-strong)] shadow-sm")}>
      <span className={cn("flex size-7 items-center justify-center rounded-lg", channel.kind === "management" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]")}><ChannelIcon kind={channel.kind} /></span>
      <span className="min-w-0 flex-1 truncate text-xs font-semibold">{channel.name}</span>
      {unread ? <span className="numeric flex min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-xs font-semibold text-[#171a17]" aria-label={`${unread} unread`}>{unread}</span> : null}
    </button>
  );
}

function MessageBubble({
  message,
  mine,
  currentUserId,
  timeZone,
  busy,
  onReact,
  onAcknowledge,
  onOpenAttachment,
}: {
  message: LiveChatMessage;
  mine: boolean;
  currentUserId: string;
  timeZone: string;
  busy: boolean;
  onReact: (message: LiveChatMessage, emoji: (typeof reactions)[number]) => void;
  onAcknowledge: (message: LiveChatMessage) => void;
  onOpenAttachment: (attachment: LiveChatMessage["attachments"][number]) => void;
}) {
  return (
    <article className={cn("group flex items-start gap-3", mine && "flex-row-reverse")}>
      <Avatar name={message.authorName} size="sm" />
      <div className={cn("min-w-0 max-w-[min(82%,680px)]", mine && "text-right")}>
        <div className={cn("mb-1 flex flex-wrap items-center gap-2", mine && "justify-end")}><p className="text-xs font-semibold">{message.authorName}</p><time className="numeric text-xs text-[var(--ink-faint)]" dateTime={message.createdAt}>{new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(message.createdAt))}</time>{message.editedAt ? <span className="text-xs text-[var(--ink-faint)]">edited</span> : null}{message.isAnnouncement ? <StatusPill tone="warning">Announcement</StatusPill> : null}</div>
        <div className={cn("rounded-[18px] px-3.5 py-2.5 text-left text-[13px] leading-5", mine ? "rounded-tr-md bg-[var(--ink)] text-[var(--paper)] dark:bg-[var(--accent)] dark:text-[#171a17]" : message.isAnnouncement ? "rounded-tl-md border border-[var(--accent)]/30 bg-[var(--accent-soft)]/35 text-[var(--ink)]" : "rounded-tl-md border border-[var(--line)] bg-[var(--paper-strong)] text-[var(--ink)]")}>
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
          {message.attachments.map((attachment) => <button type="button" key={attachment.id} onClick={() => onOpenAttachment(attachment)} className={cn("focus-ring mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left", mine ? "bg-white/10" : "bg-[var(--canvas)]")}><FileText className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate text-xs font-semibold">{attachment.fileName}</span><span className="text-xs opacity-60">Private</span><Download className="size-3 shrink-0 opacity-60" /></button>)}
        </div>
        <div className={cn("mt-1.5 flex flex-wrap items-center gap-1", mine && "justify-end")}>
          {message.reactions.map((reaction) => <button key={reaction.emoji} type="button" disabled={busy} onClick={() => onReact(message, reaction.emoji as (typeof reactions)[number])} aria-label={`${reaction.emoji} reaction from ${reaction.userIds.length} people`} className={cn("focus-ring inline-flex min-h-6 items-center gap-1 rounded-full border px-2 text-xs", reaction.userIds.includes(currentUserId) ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--paper)]")}><span>{reaction.emoji}</span><span className="numeric text-[var(--ink-faint)]">{reaction.userIds.length}</span></button>)}
          <details className="relative"><summary className="focus-ring flex size-6 list-none items-center justify-center rounded-full text-[var(--ink-faint)] hover:bg-[var(--canvas-strong)]" aria-label="Add reaction"><SmilePlus className="size-3" /></summary><div className="absolute bottom-7 left-0 z-10 flex rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-1 shadow-lg">{reactions.map((emoji) => <button key={emoji} type="button" disabled={busy} className="flex size-8 items-center justify-center rounded-lg hover:bg-[var(--canvas)]" onClick={() => onReact(message, emoji)} aria-label={`React ${emoji}`}>{emoji}</button>)}</div></details>
        </div>
        <div className={cn("mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-faint)]", mine && "justify-end")}>
          {mine ? <span className="inline-flex items-center gap-1"><Check className="size-2.5" />{message.readByCount ? `Read by ${message.readByCount}` : "Sent"}</span> : null}
          {message.isAnnouncement ? <>{message.acknowledgedByMe ? <span className="text-[var(--positive)]">Acknowledged</span> : <button type="button" disabled={busy} onClick={() => onAcknowledge(message)} className="focus-ring rounded-md px-1 font-semibold text-[var(--accent-strong)]">Acknowledge</button>}<span>{message.acknowledgementCount} total</span></> : null}
        </div>
      </div>
    </article>
  );
}

export function LiveMessagesWorkspace({
  workspace,
  model,
}: {
  workspace: WorkspaceContextValue;
  model: { ok: true; data: LiveMessagesModel } | { ok: false; message: string };
}) {
  if (!model.ok) return <MessagesReadError message={model.message} />;
  return <LiveMessagesContent workspace={workspace} data={model.data} />;
}

function ChannelManagementPanel({
  workspace,
  data,
  busy,
  onClose,
}: {
  workspace: WorkspaceContextValue;
  data: LiveMessagesModel;
  busy: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<LiveChatChannel["kind"]>("location");
  const [locationId, setLocationId] = useState(workspace.activeLocation.id);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [privateChannelId, setPrivateChannelId] = useState("");
  const [privateMemberIds, setPrivateMemberIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { requestIdFor, rotateRequestId, rotateAllRequestIds } = useStableRequestIds();
  const privateChannels = data.channels.filter((channel) => channel.kind === "private");

  function toggleMember(current: string[], userId: string) {
    return current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId];
  }

  function createChannel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      organizationId: workspace.organization.id,
      kind,
      locationId: kind === "location" ? locationId : null,
      name: name.trim(),
      description: description.trim() || null,
      memberIds: kind === "private" ? memberIds : [],
    };
    setMessage(null);
    startTransition(async () => {
      const result = await createChatChannelAction({
        requestId: requestIdFor("chat.channel.create", payload),
        ...payload,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      rotateRequestId("chat.channel.create");
      setName("");
      setDescription("");
      setMemberIds([]);
      setMessage("Channel created with server-validated access.");
      router.refresh();
    });
  }

  function archiveChannel(channelId: string) {
    const scope = `chat.channel.archive:${channelId}`;
    setMessage(null);
    startTransition(async () => {
      const result = await setChatChannelArchivedAction({
        requestId: requestIdFor(scope, { channelId, archived: true }),
        channelId,
        archived: true,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      rotateRequestId(scope);
      setMessage("Channel archived. Historical messages remain retained.");
      router.refresh();
    });
  }

  function choosePrivateChannel(channelId: string) {
    const channel = privateChannels.find((candidate) => candidate.id === channelId);
    rotateRequestId("chat.channel.members");
    setPrivateChannelId(channelId);
    setPrivateMemberIds(channel?.memberIds ?? []);
  }

  function savePrivateMembers() {
    if (!privateChannelId) return;
    const payload = { channelId: privateChannelId, memberIds: privateMemberIds };
    setMessage(null);
    startTransition(async () => {
      const result = await setPrivateChatChannelMembersAction({
        requestId: requestIdFor("chat.channel.members", payload),
        ...payload,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      rotateRequestId("chat.channel.members");
      setMessage("Private channel membership updated.");
      router.refresh();
    });
  }

  function closePanel() {
    rotateAllRequestIds();
    onClose();
  }

  return (
    <section aria-label="Channel management" className="mb-5 border-y border-[var(--line)] bg-[var(--paper-strong)] px-4 py-5 sm:px-5">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold">Channel management</p><p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">Create tenant-scoped rooms. Canonical all-staff, management, and location channels cannot be duplicated.</p></div><Button variant="quiet" size="icon" onClick={closePanel} aria-label="Close channel management"><X className="size-4" /></Button></div>
      <form onSubmit={createChannel} className="mt-5 grid gap-3 lg:grid-cols-[150px_180px_minmax(0,1fr)_auto] lg:items-end">
        <label><span className="mb-1.5 block text-xs font-semibold text-[var(--ink-faint)]">Kind</span><select value={kind} onChange={(event) => { const nextKind = event.target.value as LiveChatChannel["kind"]; setKind(nextKind); rotateRequestId("chat.channel.create"); }} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"><option value="all_staff">All staff</option><option value="location">Location</option><option value="management">Management</option><option value="private">Private</option></select></label>
        {kind === "location" ? <label><span className="mb-1.5 block text-xs font-semibold text-[var(--ink-faint)]">Location</span><select value={locationId} onChange={(event) => setLocationId(event.target.value)} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs">{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label> : <label><span className="mb-1.5 block text-xs font-semibold text-[var(--ink-faint)]">Scope</span><span className="flex h-10 items-center rounded-xl bg-[var(--canvas)] px-3 text-xs text-[var(--ink-faint)]">Organization-wide</span></label>}
        <label><span className="mb-1.5 block text-xs font-semibold text-[var(--ink-faint)]">Name</span><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === "location" ? "Downtown" : kind === "private" ? "Event planning" : kind === "management" ? "Management" : "All staff"} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" /></label>
        <Button type="submit" variant="accent" size="sm" disabled={busy || pending || !name.trim() || (kind === "private" && !memberIds.length)}>{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Settings2 className="size-3.5" />}Create</Button>
        <label className="lg:col-span-3"><span className="mb-1.5 block text-xs font-semibold text-[var(--ink-faint)]">Description</span><input maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional operating context" className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" /></label>
      </form>
      {kind === "private" ? <fieldset className="mt-4"><legend className="text-xs font-semibold text-[var(--ink-faint)]">Private members · your account is added automatically</legend><div className="mt-2 flex flex-wrap gap-2">{data.profiles.filter((profile) => profile.id !== workspace.identity.userId).map((profile) => <label key={profile.id} className={cn("flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-xs", memberIds.includes(profile.id) ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)]")}><input type="checkbox" checked={memberIds.includes(profile.id)} onChange={() => setMemberIds((current) => toggleMember(current, profile.id))} className="size-3.5 accent-[var(--accent)]" />{profile.name}</label>)}</div></fieldset> : null}
      {data.channels.length ? <div className="mt-6 border-t border-[var(--line)] pt-4"><p className="text-xs font-semibold text-[var(--ink-faint)]">Active channels</p><div className="mt-2 flex flex-wrap gap-2">{data.channels.map((channel) => <div key={channel.id} className="flex items-center gap-2 rounded-full bg-[var(--canvas)] py-1.5 pr-1.5 pl-3"><span className="text-xs font-semibold">{channel.name}</span><button type="button" disabled={pending || busy} onClick={() => archiveChannel(channel.id)} className="focus-ring flex size-7 items-center justify-center rounded-full text-[var(--ink-faint)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]" aria-label={`Archive ${channel.name}`}><Archive className="size-3" /></button></div>)}</div></div> : null}
      {privateChannels.length ? <div className="mt-5 grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-[220px_minmax(0,1fr)_auto] sm:items-end"><label><span className="mb-1.5 block text-xs font-semibold text-[var(--ink-faint)]">Edit private members</span><select value={privateChannelId} onChange={(event) => choosePrivateChannel(event.target.value)} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"><option value="">Choose a private channel</option>{privateChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label><div className="flex flex-wrap gap-2">{privateChannelId ? data.profiles.map((profile) => <label key={profile.id} className={cn("flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-xs", privateMemberIds.includes(profile.id) ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)]")}><input type="checkbox" checked={privateMemberIds.includes(profile.id)} onChange={() => setPrivateMemberIds((current) => toggleMember(current, profile.id))} className="size-3.5 accent-[var(--accent)]" />{profile.name}</label>) : <span className="text-xs text-[var(--ink-faint)]">Choose a private channel to replace its explicit member set.</span>}</div><Button type="button" variant="secondary" size="sm" disabled={!privateChannelId || pending || busy || privateMemberIds.length < 2} onClick={savePrivateMembers}>Save members</Button></div> : null}
      {message ? <p role="status" aria-live="polite" className="mt-4 rounded-xl bg-[var(--canvas)] px-3 py-2 text-xs">{message}</p> : null}
    </section>
  );
}

function LiveMessagesContent({ workspace, data }: { workspace: WorkspaceContextValue; data: LiveMessagesModel }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const evidenceFallbackRequestedRef = useRef(false);
  const [selectedChannelId, setSelectedChannelId] = useState(data.channels[0]?.id ?? "");
  const [messages, setMessages] = useState(data.messages);
  const dataMessagesRef = useRef(data.messages);
  const messagesRef = useRef(messages);
  const [unread, setUnread] = useState<Record<string, number>>(() => Object.fromEntries(data.channels.map((channel) => [channel.id, channel.unreadCount])));
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState(false);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [query, setQuery] = useState("");
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [mobileInfoOpen, setMobileInfoOpen] = useState(false);
  const [realtimeState, setRealtimeState] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [notice, setNotice] = useState<string | null>(null);
  const [managingChannels, setManagingChannels] = useState(false);
  const [isPending, startTransition] = useTransition();
  const selectedChannel = data.channels.find((channel) => channel.id === selectedChannelId) ?? data.channels[0] ?? null;
  const channelMessages = useMemo(() => messages.filter((message) => message.channelId === selectedChannelId), [messages, selectedChannelId]);
  const profilesById = useMemo(() => new Map(data.profiles.map((profile) => [profile.id, profile])), [data.profiles]);
  const latestMessageId = channelMessages.at(-1)?.id ?? null;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (dataMessagesRef.current === data.messages) return;
    dataMessagesRef.current = data.messages;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      messagesRef.current = data.messages;
      setMessages(data.messages);
      evidenceFallbackRequestedRef.current = false;
    });
    return () => {
      cancelled = true;
    };
  }, [data.messages]);

  useEffect(() => {
    if (!selectedChannel) return;
    void markChatReadAction({
      channelId: selectedChannel.id,
      lastReadMessageId: latestMessageId,
    }).then((result) => {
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setUnread((current) => ({ ...current, [selectedChannel.id]: 0 }));
    });
  }, [latestMessageId, selectedChannel]);

  useEffect(() => {
    if (!selectedChannel) return;
    const supabase = createClient();
    let stopped = false;
    let realtimeChannel: RealtimeChannel | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    type EvidenceRefreshControl = {
      failures: number;
      generation: number;
      retryTimer: ReturnType<typeof setTimeout> | null;
      rerun: boolean;
      running: boolean;
    };
    const evidenceRefreshControls = new Map<string, EvidenceRefreshControl>();

    const evidenceRefreshControl = (messageId: string) => {
      const existing = evidenceRefreshControls.get(messageId);
      if (existing) return existing;
      const created: EvidenceRefreshControl = {
        failures: 0,
        generation: 0,
        retryTimer: null,
        rerun: false,
        running: false,
      };
      evidenceRefreshControls.set(messageId, created);
      return created;
    };

    const readMessageEvidence = async (messageId: string) =>
      Promise.all([
          supabase
            .from("chat_reactions")
            .select("message_id, user_id, emoji, created_at")
            .eq("organization_id", workspace.organization.id)
            .eq("message_id", messageId)
            .order("created_at", { ascending: true })
            .limit(5_000),
          supabase
            .from("chat_attachments")
            .select("id, message_id, file_name, mime_type, size_bytes, storage_path, created_at")
            .eq("organization_id", workspace.organization.id)
            .eq("message_id", messageId)
            .order("created_at", { ascending: true })
            .limit(500),
          supabase
            .from("announcement_acknowledgements")
            .select("message_id, user_id, acknowledged_at")
            .eq("organization_id", workspace.organization.id)
            .eq("message_id", messageId)
            .order("acknowledged_at", { ascending: true })
            .limit(5_000),
        ]);

    const applyMessageEvidence = (
      messageId: string,
      reactionRows: Awaited<ReturnType<typeof readMessageEvidence>>[0]["data"],
      attachmentRows: Awaited<ReturnType<typeof readMessageEvidence>>[1]["data"],
      acknowledgementRows: Awaited<ReturnType<typeof readMessageEvidence>>[2]["data"],
    ) => {
      const groupedReactions = new Map<string, string[]>();
      for (const reaction of reactionRows ?? []) {
        groupedReactions.set(reaction.emoji, [
          ...(groupedReactions.get(reaction.emoji) ?? []),
          reaction.user_id,
        ]);
      }
      const acknowledgedUserIds = (acknowledgementRows ?? []).map(
        (acknowledgement) => acknowledgement.user_id,
      );
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                reactions: [...groupedReactions.entries()].map(
                  ([emoji, userIds]) => ({ emoji, userIds }),
                ),
                attachments: (attachmentRows ?? []).map((attachment) => ({
                  id: attachment.id,
                  fileName: attachment.file_name,
                  mimeType: attachment.mime_type,
                  sizeBytes:
                    attachment.size_bytes == null
                      ? null
                      : Number(attachment.size_bytes),
                  storagePath: attachment.storage_path,
                })),
                acknowledgedByMe: acknowledgedUserIds.includes(
                  workspace.identity.userId,
                ),
                acknowledgementCount: acknowledgedUserIds.length,
              }
            : message,
        ),
      );
    };

    const runEvidenceRefresh = async (
      messageId: string,
      control: EvidenceRefreshControl,
    ) => {
      if (stopped || control.running) return;
      control.running = true;
      try {
        while (!stopped && control.rerun) {
          control.rerun = false;
          const generation = control.generation;
          let results: Awaited<ReturnType<typeof readMessageEvidence>> | null = null;
          try {
            results = await readMessageEvidence(messageId);
          } catch {
            results = null;
          }
          if (stopped) return;
          const failed =
            !results ||
            results[0].error ||
            results[1].error ||
            results[2].error;
          if (failed) {
            control.failures += 1;
            control.rerun = true;
            const delay = chatEvidenceRetryDelaysMs[control.failures - 1];
            if (delay != null) {
              control.retryTimer = setTimeout(() => {
                control.retryTimer = null;
                void runEvidenceRefresh(messageId, control);
              }, delay);
            } else {
              control.rerun = false;
              setNotice("Live message details could not catch up. Refreshing authoritative message data.");
              if (!evidenceFallbackRequestedRef.current) {
                evidenceFallbackRequestedRef.current = true;
                router.refresh();
              }
            }
            return;
          }
          if (!results) return;
          control.failures = 0;
          evidenceFallbackRequestedRef.current = false;
          if (control.generation !== generation) {
            control.rerun = true;
            continue;
          }
          applyMessageEvidence(
            messageId,
            results[0].data,
            results[1].data,
            results[2].data,
          );
        }
      } finally {
        control.running = false;
      }
    };

    const requestEvidenceRefresh = (messageId: string) => {
      const control = evidenceRefreshControl(messageId);
      control.generation += 1;
      control.rerun = true;
      if (control.retryTimer) {
        clearTimeout(control.retryTimer);
        control.retryTimer = null;
      }
      void runEvidenceRefresh(messageId, control);
    };

    const recordEvidenceInsert = (messageId: string) => {
      const control = evidenceRefreshControl(messageId);
      control.generation += 1;
      if (control.running) control.rerun = true;
    };

    const refreshSelectedChannelEvidence = () => {
      for (const message of messagesRef.current) {
        if (message.channelId === selectedChannel.id) {
          requestEvidenceRefresh(message.id);
        }
      }
    };

    const connect = () => {
      if (stopped) return;
      realtimeChannel = supabase
        .channel(`chat:${selectedChannel.id}:${workspace.identity.userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `channel_id=eq.${selectedChannel.id}` }, (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as ChatMessageRow;
            if (row.deleted_at) return;
            setMessages((current) => current.some((message) => message.id === row.id) ? current : [...current, { id: row.id, channelId: row.channel_id, authorId: row.author_id, authorName: profilesById.get(row.author_id)?.name ?? "Team member", replyToId: row.reply_to_id, body: row.body, isAnnouncement: row.is_announcement, editedAt: row.edited_at, createdAt: row.created_at, reactions: [], attachments: [], readByCount: 0, acknowledgementCount: 0, acknowledgedByMe: false }]);
            if (row.author_id !== workspace.identity.userId) setUnread((current) => selectedChannelId === row.channel_id ? current : ({ ...current, [row.channel_id]: (current[row.channel_id] ?? 0) + 1 }));
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as ChatMessageRow;
            setMessages((current) => row.deleted_at ? current.filter((message) => message.id !== row.id) : current.map((message) => message.id === row.id ? { ...message, body: row.body, editedAt: row.edited_at, isAnnouncement: row.is_announcement } : message));
            if (!row.deleted_at) requestEvidenceRefresh(row.id);
          } else {
            const row = payload.old as Partial<ChatMessageRow>;
            if (row.id) setMessages((current) => current.filter((message) => message.id !== row.id));
          }
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_reactions", filter: `organization_id=eq.${workspace.organization.id}` }, (payload) => {
          const row = payload.new as Partial<ChatReactionRow>;
          if (!row.message_id || !row.user_id || !row.emoji) return;
          recordEvidenceInsert(row.message_id);
          setMessages((current) => current.map((message) => {
            if (message.id !== row.message_id) return message;
            const existing = message.reactions.find((reaction) => reaction.emoji === row.emoji);
            if (existing?.userIds.includes(row.user_id!)) return message;
            return { ...message, reactions: existing ? message.reactions.map((reaction) => reaction.emoji === row.emoji ? { ...reaction, userIds: [...reaction.userIds, row.user_id!] } : reaction) : [...message.reactions, { emoji: row.emoji!, userIds: [row.user_id!] }] };
          }));
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_attachments", filter: `organization_id=eq.${workspace.organization.id}` }, (payload) => {
          const row = payload.new as Partial<ChatAttachmentRow>;
          if (!row.id) return;
          if (!row.message_id) return;
          recordEvidenceInsert(row.message_id);
          setMessages((current) => current.map((message) => {
            if (message.id !== row.message_id) return message;
            if (!row.file_name || !row.storage_path) return message;
            const attachment = {
              id: row.id!,
              fileName: row.file_name,
              mimeType: row.mime_type ?? null,
              sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
              storagePath: row.storage_path,
            };
            return {
              ...message,
              attachments: message.attachments.some((candidate) => candidate.id === attachment.id)
                ? message.attachments.map((candidate) => candidate.id === attachment.id ? attachment : candidate)
                : [...message.attachments, attachment],
            };
          }));
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcement_acknowledgements", filter: `organization_id=eq.${workspace.organization.id}` }, (payload) => {
          const row = payload.new as Partial<ChatAcknowledgementRow>;
          if (!row.message_id) return;
          recordEvidenceInsert(row.message_id);
          setMessages((current) => current.map((message) => {
            if (message.id !== row.message_id) return message;
            const ownAcknowledgementAlreadyApplied =
              row.user_id === workspace.identity.userId && message.acknowledgedByMe;
            const acknowledgedByMe = row.user_id === workspace.identity.userId
              ? true
              : message.acknowledgedByMe;
            const acknowledgementCount = ownAcknowledgementAlreadyApplied
              ? message.acknowledgementCount
              : message.acknowledgementCount + 1;
            return { ...message, acknowledgedByMe, acknowledgementCount };
          }));
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_read_receipts", filter: `channel_id=eq.${selectedChannel.id}` }, () => {
          void supabase.from("chat_read_receipts").select("user_id, last_read_message_id").eq("organization_id", workspace.organization.id).eq("channel_id", selectedChannel.id).then(({ data: receiptRows }) => {
            if (!receiptRows) return;
            setMessages((current) => {
              const ordered = current.filter((message) => message.channelId === selectedChannel.id).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
              return current.map((message) => {
                if (message.channelId !== selectedChannel.id) return message;
                const messageIndex = ordered.findIndex((candidate) => candidate.id === message.id);
                const readByCount = receiptRows.filter((receipt) => receipt.user_id !== message.authorId && receipt.last_read_message_id && ordered.findIndex((candidate) => candidate.id === receipt.last_read_message_id) >= messageIndex).length;
                return { ...message, readByCount };
              });
            });
          });
        })
        .subscribe((status) => {
          if (stopped) return;
          if (status === "SUBSCRIBED") {
            setRealtimeState("live");
            refreshSelectedChannelEvidence();
          }
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setRealtimeState("reconnecting");
            if (retry) clearTimeout(retry);
            retry = setTimeout(() => {
              if (realtimeChannel) void supabase.removeChannel(realtimeChannel);
              connect();
            }, 1_500);
          }
        });
      void supabase.auth.getSession().then(({ data: sessionData }) => {
        if (!stopped && sessionData.session?.access_token) {
          return supabase.realtime.setAuth(sessionData.session.access_token);
        }
        return undefined;
      }).catch(() => undefined);
    };
    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      for (const control of evidenceRefreshControls.values()) {
        if (control.retryTimer) clearTimeout(control.retryTimer);
      }
      if (realtimeChannel) void supabase.removeChannel(realtimeChannel);
    };
  }, [profilesById, router, selectedChannel, selectedChannelId, workspace.identity.userId, workspace.organization.id]);

  function selectChannel(channel: LiveChatChannel) {
    if (channel.id !== selectedChannelId) setRealtimeState("connecting");
    setSelectedChannelId(channel.id);
    setMobileChatOpen(true);
    setMobileInfoOpen(false);
  }

  function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedChannel || (!draft.trim() && !attachmentFile)) return;
    const file = attachmentFile;
    const body = draft.trim() || `Shared an attachment: ${file!.name}`;
    const requestId = crypto.randomUUID();
    setNotice(null);
    startTransition(async () => {
      const result = await sendChatMessageAction({ requestId, channelId: selectedChannel.id, body, replyToId: null, isAnnouncement: announcement });
      if (!result.ok) setNotice(result.message);
      else {
        const createdAt = result.persisted ? result.data.createdAt : new Date().toISOString();
        setMessages((current) => current.some((message) => message.id === requestId) ? current : [...current, { id: requestId, channelId: selectedChannel.id, authorId: workspace.identity.userId, authorName: workspace.identity.displayName, replyToId: null, body, isAnnouncement: announcement, editedAt: null, createdAt, reactions: [], attachments: [], readByCount: 0, acknowledgementCount: 0, acknowledgedByMe: false }]);
        setDraft("");
        setAnnouncement(false);
        setAttachmentFile(null);

        if (!file) return;
        const uploadId = crypto.randomUUID();
        const attachmentInput = {
          uploadId,
          messageId: requestId,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        };
        const prepared = await createChatAttachmentUploadUrlAction(attachmentInput);
        if (!prepared.ok || !("data" in prepared)) {
          setNotice(prepared.ok ? "The message was sent, but the private attachment could not start." : `${prepared.message} The message was sent without the attachment.`);
          return;
        }
        if (!prepared.data.alreadyFinalized) {
          if (!prepared.data.token) {
            setNotice("The message was sent, but storage did not return a private upload token.");
            return;
          }
          const supabase = createClient();
          const uploaded = await supabase.storage.from("chat-attachments").uploadToSignedUrl(
            prepared.data.objectPath,
            prepared.data.token,
            file,
            { contentType: file.type },
          );
          if (uploaded.error) {
            setNotice("The message was sent, but the encrypted attachment transfer did not finish.");
            return;
          }
        }
        const finalized = await finalizeChatAttachmentAction({
          ...attachmentInput,
          objectPath: prepared.data.objectPath,
        });
        if (!finalized.ok || !("data" in finalized)) {
          setNotice(finalized.ok ? "The message was sent, but the private attachment could not be finalized." : `${finalized.message} The message was sent without a usable attachment.`);
          return;
        }
        const attachment = {
          id: finalized.data.id,
          fileName: finalized.data.fileName,
          mimeType: finalized.data.mimeType,
          sizeBytes: finalized.data.sizeBytes,
          storagePath: finalized.data.objectPath,
        };
        setMessages((current) => current.map((message) => message.id === requestId
          ? { ...message, attachments: message.attachments.some((candidate) => candidate.id === attachment.id) ? message.attachments : [...message.attachments, attachment] }
          : message));
      }
    });
  }

  function chooseAttachment(file: File | undefined) {
    if (!file) return;
    const validation = validatePrivateFile("chat-attachments", file.type, file.size);
    if (!validation.ok || !chatAttachmentTypes.includes(file.type as (typeof chatAttachmentTypes)[number])) {
      setAttachmentFile(null);
      setNotice(validation.ok ? "Chat attachments support JPEG, PNG, WebP, and PDF files." : validation.message ?? "Choose a supported attachment.");
      return;
    }
    setNotice(null);
    setAttachmentFile(file);
  }

  function openAttachment(attachment: LiveChatMessage["attachments"][number]) {
    setNotice(null);
    startTransition(async () => {
      const result = await createPrivateFileDownloadUrlAction({
        bucket: "chat-attachments",
        objectPath: attachment.storagePath,
        downloadFileName: attachment.fileName,
      });
      if (!result.ok || !("data" in result)) {
        setNotice(result.ok ? "The private attachment is unavailable." : result.message);
        return;
      }
      window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
    });
  }

  function toggleReaction(message: LiveChatMessage, emoji: (typeof reactions)[number]) {
    const active = !(message.reactions.find((reaction) => reaction.emoji === emoji)?.userIds.includes(workspace.identity.userId) ?? false);
    startTransition(async () => {
      const result = await toggleLiveChatReactionAction({ requestId: crypto.randomUUID(), messageId: message.id, emoji, active });
      if (!result.ok) { setNotice(result.message); return; }
      setMessages((current) => current.map((candidate) => {
        if (candidate.id !== message.id) return candidate;
        const existing = candidate.reactions.find((reaction) => reaction.emoji === emoji);
        if (active) return { ...candidate, reactions: existing ? candidate.reactions.map((reaction) => reaction.emoji === emoji && !reaction.userIds.includes(workspace.identity.userId) ? { ...reaction, userIds: [...reaction.userIds, workspace.identity.userId] } : reaction) : [...candidate.reactions, { emoji, userIds: [workspace.identity.userId] }] };
        if (!existing) return candidate;
        const userIds = existing.userIds.filter((id) => id !== workspace.identity.userId);
        return { ...candidate, reactions: userIds.length ? candidate.reactions.map((reaction) => reaction.emoji === emoji ? { ...reaction, userIds } : reaction) : candidate.reactions.filter((reaction) => reaction.emoji !== emoji) };
      }));
    });
  }

  function acknowledge(message: LiveChatMessage) {
    startTransition(async () => {
      const result = await acknowledgeLiveAnnouncementAction({ requestId: crypto.randomUUID(), messageId: message.id });
      if (!result.ok) { setNotice(result.message); return; }
      setMessages((current) => current.map((candidate) => candidate.id === message.id && !candidate.acknowledgedByMe ? { ...candidate, acknowledgedByMe: true, acknowledgementCount: candidate.acknowledgementCount + 1 } : candidate));
    });
  }

  const visibleChannels = data.channels.filter((channel) => channel.name.toLowerCase().includes(query.trim().toLowerCase()));
  const memberProfiles = selectedChannel ? selectedChannel.memberIds.map((id) => profilesById.get(id)).filter((profile): profile is LiveMessagesModel["profiles"][number] => Boolean(profile)) : [];
  const totalUnread = Object.values(unread).reduce((sum, count) => sum + count, 0);

  return (
    <PageFrame width="full" className="max-w-[1680px] pb-3 lg:pb-8">
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="flex items-center gap-2"><StatusPill tone={totalUnread ? "accent" : "positive"} dot>{totalUnread ? `${totalUnread} unread` : "Caught up"}</StatusPill><StatusPill tone={realtimeState === "live" ? "positive" : "warning"}>{realtimeState === "live" ? "Realtime live" : realtimeState === "connecting" ? "Connecting" : "Reconnecting"}</StatusPill></div><h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Stay close to service</h2><p className="mt-1 text-[13px] text-[var(--ink-faint)]">Live channels are filtered by organization, location, and management access.</p></div><div className="flex items-center gap-2">{data.canManageChannels ? <Button variant="secondary" size="sm" onClick={() => setManagingChannels((current) => !current)}><Settings2 className="size-3.5" />Manage channels</Button> : null}<StatusPill tone="neutral">Notification preferences apply</StatusPill></div></div>

      {managingChannels ? <ChannelManagementPanel workspace={workspace} data={data} busy={isPending} onClose={() => setManagingChannels(false)} /> : null}

      {!data.channels.length ? <section className="rounded-[24px] border border-dashed border-[var(--line-strong)] bg-[var(--paper-strong)] p-10 text-center"><MessageCircleMore className="mx-auto size-7 text-[var(--ink-faint)]" /><h3 className="mt-4 text-lg font-medium tracking-[-0.035em]">No channels are available</h3><p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[var(--ink-faint)]">{data.canManageChannels ? "Create the first all-staff, location, management, or private channel above. No synthetic conversation is shown." : "Ask a manager to create an all-staff or location channel. No synthetic conversation is shown."}</p>{data.canManageChannels && !managingChannels ? <Button className="mt-5" variant="accent" size="sm" onClick={() => setManagingChannels(true)}><Settings2 className="size-3.5" />Create first channel</Button> : null}</section> : (
        <div className="grid min-h-[calc(100svh-190px)] overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--paper)] shadow-[0_12px_42px_rgba(25,28,24,.04)] lg:grid-cols-[270px_minmax(0,1fr)] xl:grid-cols-[270px_minmax(0,1fr)_290px]">
          <nav aria-label="Message channels" className={cn("border-[var(--line)] bg-[var(--canvas)] p-3 lg:block lg:border-r", mobileChatOpen ? "hidden" : "block")}><div className="px-2 pt-2 pb-4"><div className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-xl bg-[var(--graphite)] text-white"><MessageCircleMore className="size-3.5" /></span><div><p className="text-[13px] font-semibold">{workspace.organization.name}</p><p className="mt-0.5 text-xs text-[var(--ink-faint)]">{data.profiles.length} people · {data.channels.length} channels</p></div></div></div><label className="relative mb-4 block"><span className="sr-only">Search channels</span><Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a channel" className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] pr-3 pl-9 text-xs placeholder:text-[var(--ink-faint)]" /></label><div className="space-y-5"><section><p className="px-3 text-xs font-semibold tracking-[0.12em] text-[var(--ink-faint)] uppercase">Team</p><div className="mt-2 space-y-1">{visibleChannels.filter((channel) => channel.kind !== "location").map((channel) => <ChannelRow key={channel.id} channel={channel} selected={channel.id === selectedChannelId} unread={unread[channel.id] ?? 0} onSelect={() => selectChannel(channel)} />)}</div></section><section><p className="px-3 text-xs font-semibold tracking-[0.12em] text-[var(--ink-faint)] uppercase">Locations</p><div className="mt-2 space-y-1">{visibleChannels.filter((channel) => channel.kind === "location").map((channel) => <ChannelRow key={channel.id} channel={channel} selected={channel.id === selectedChannelId} unread={unread[channel.id] ?? 0} onSelect={() => selectChannel(channel)} />)}</div></section></div></nav>

          <main className={cn("min-w-0 flex-col bg-[var(--paper-strong)] lg:flex", mobileChatOpen ? "flex" : "hidden")} aria-label={`${selectedChannel?.name ?? "Channel"} conversation`}><header className="flex min-h-[72px] items-center gap-3 border-b border-[var(--line)] px-3 sm:px-5"><Button variant="quiet" size="icon" className="lg:hidden" aria-label="Back to channels" onClick={() => setMobileChatOpen(false)}><ArrowLeft className="size-4" /></Button><span className={cn("flex size-9 items-center justify-center rounded-xl", selectedChannel?.kind === "management" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]")}>{selectedChannel ? <ChannelIcon kind={selectedChannel.kind} /> : null}</span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-semibold">{selectedChannel?.name}</h3>{selectedChannel?.kind === "management" ? <StatusPill tone="danger">Private</StatusPill> : null}</div><p className="mt-0.5 truncate text-xs text-[var(--ink-faint)]">{selectedChannel?.description || `${selectedChannel?.memberIds.length ?? 0} people with verified access`}</p></div><Button variant="quiet" size="icon" aria-label="Channel information" onClick={() => setMobileInfoOpen(true)}><Info className="size-4" /></Button></header>

            <div className="flex-1 overflow-y-auto px-3 py-5 sm:px-6 sm:py-6"><div className="space-y-5">{channelMessages.map((message) => <MessageBubble key={message.id} message={message} mine={message.authorId === workspace.identity.userId} currentUserId={workspace.identity.userId} timeZone={data.timeZone} busy={isPending} onReact={toggleReaction} onAcknowledge={acknowledge} onOpenAttachment={openAttachment} />)}{!channelMessages.length ? <div className="flex min-h-64 flex-col items-center justify-center text-center"><span className="flex size-12 items-center justify-center rounded-2xl bg-[var(--canvas)] text-[var(--ink-faint)]"><MessageCircleMore className="size-5" /></span><p className="mt-4 text-xs font-semibold">Start the conversation</p><p className="mt-1 max-w-xs text-xs leading-4 text-[var(--ink-faint)]">Only people allowed into this live channel can read its messages.</p></div> : null}</div></div>

            <footer className="border-t border-[var(--line)] bg-[var(--paper-strong)] p-3 sm:p-4"><form onSubmit={sendMessage} className="rounded-[18px] border border-[var(--line)] bg-[var(--paper)] p-2 focus-within:border-[var(--line-strong)]"><div className="flex items-end gap-2"><input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(event) => { chooseAttachment(event.target.files?.[0]); event.currentTarget.value = ""; }} /><Button variant="quiet" size="icon" disabled={isPending} onClick={() => fileInputRef.current?.click()} title="Attach a private image or PDF" aria-label="Attach a private image or PDF"><Paperclip className="size-4" /></Button><label className="min-w-0 flex-1"><span className="sr-only">Message {selectedChannel?.name}</span><textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={1} maxLength={10_000} placeholder={`Message ${selectedChannel?.name ?? "channel"}`} className="max-h-28 min-h-10 w-full resize-none bg-transparent px-1 py-2.5 text-xs outline-none placeholder:text-[var(--ink-faint)]" /></label><Button type="submit" variant="accent" size="icon" disabled={isPending || (!draft.trim() && !attachmentFile)} aria-label="Send message">{isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}</Button></div>{attachmentFile ? <div className="mx-2 mt-1 flex items-center gap-2 rounded-xl bg-[var(--canvas)] px-3 py-2 text-xs"><FileText className="size-3.5 shrink-0 text-[var(--accent-strong)]" /><span className="min-w-0 flex-1 truncate font-semibold">{attachmentFile.name}</span><span className="numeric text-xs text-[var(--ink-faint)]">{(attachmentFile.size / 1_048_576).toFixed(1)} MB</span><button type="button" onClick={() => setAttachmentFile(null)} className="focus-ring rounded-md p-1 text-[var(--ink-faint)]" aria-label="Remove attachment"><X className="size-3" /></button></div> : null}{data.canAnnounce ? <label className="mt-1 flex items-center gap-2 px-2 py-1 text-xs text-[var(--ink-faint)]"><input type="checkbox" checked={announcement} onChange={(event) => setAnnouncement(event.target.checked)} className="size-3.5 accent-[var(--accent)]" /><Megaphone className="size-3" />Post as an announcement</label> : null}</form><p className="mt-2 px-2 text-xs text-[var(--ink-faint)]">Images and PDFs use private signed transfer; files are visible only to authorized channel members.</p>{notice ? <p role="status" className="mt-2 rounded-xl bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">{notice}</p> : null}</footer>
          </main>

          <aside className={cn("border-l border-[var(--line)] bg-[var(--canvas)] p-5 xl:block", mobileInfoOpen ? "fixed inset-0 z-40 block overflow-y-auto" : "hidden")} aria-label="Channel information"><div className="flex items-center justify-between"><p className="text-xs font-semibold">Channel details</p><Button variant="quiet" size="icon" className="xl:hidden" onClick={() => setMobileInfoOpen(false)} aria-label="Close channel details"><X className="size-4" /></Button></div><div className="mt-6 flex flex-col items-center text-center"><span className={cn("flex size-14 items-center justify-center rounded-[18px]", selectedChannel?.kind === "management" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]")}>{selectedChannel ? <ChannelIcon kind={selectedChannel.kind} /> : null}</span><h4 className="mt-3 text-sm font-semibold">{selectedChannel?.name}</h4><p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">{selectedChannel?.description || "Access follows the channel’s tenant scope."}</p></div><section className="mt-7 border-t border-[var(--line)] pt-5"><div className="flex items-center justify-between"><p className="text-xs font-semibold">Members</p><span className="numeric text-xs text-[var(--ink-faint)]">{memberProfiles.length}</span></div><div className="mt-3 space-y-3">{memberProfiles.slice(0, 8).map((profile, index) => <div key={profile.id} className="flex items-center gap-2.5"><Avatar name={profile.name} size="sm" index={index} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{profile.name}</p><p className="mt-0.5 truncate text-xs text-[var(--ink-faint)] capitalize">{profile.role}</p></div>{profile.id === workspace.identity.userId ? <span className="text-xs text-[var(--ink-faint)]">You</span> : null}</div>)}</div></section>{selectedChannel?.kind === "management" ? <div className="mt-7 flex items-start gap-2 rounded-xl bg-[var(--danger-soft)] px-3 py-3 text-xs leading-4 text-[var(--danger)]"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" />Membership is restricted to authorized management and checked by RLS.</div> : null}</aside>
        </div>
      )}
    </PageFrame>
  );
}
