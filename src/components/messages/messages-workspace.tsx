"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  ChevronRight,
  FileText,
  Hash,
  Info,
  LockKeyhole,
  Megaphone,
  MessageCircleMore,
  MoreHorizontal,
  Paperclip,
  Search,
  Send,
  ShieldCheck,
  SmilePlus,
  UsersRound,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageFrame } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { demoIds, demoWorkspace } from "@/lib/demo";
import { cn } from "@/lib/utils";
import type { ChatChannel, ChatMessage } from "@/types";

const initialUnread: Record<string, number> = {
  "channel-all-staff": 2,
  "channel-garden": 1,
  "channel-market": 0,
  "channel-management": 1,
};

const commonReactions = ["👍", "✨", "✅"];

function channelDescription(channel: ChatChannel) {
  if (channel.kind === "all_staff") {
    return "Everyone at Le Yard";
  }
  if (channel.kind === "management") return "Private · owners and managers";
  if (channel.kind === "location") return "Everyone assigned to this location";
  return "Private conversation";
}

function formatMessageTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function ChannelRow({
  channel,
  selected,
  unread,
  onSelect,
}: {
  channel: ChatChannel;
  selected: boolean;
  unread: number;
  onSelect: () => void;
}) {
  const Icon = channel.kind === "management" ? LockKeyhole : channel.kind === "all_staff" ? UsersRound : Hash;
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={cn("focus-ring group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[var(--paper)]", selected && "bg-[var(--paper-strong)] shadow-sm")}>
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl", selected ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "bg-[var(--canvas-strong)] text-[var(--ink-faint)]")}><Icon className="size-3.5" /></span>
      <span className="min-w-0 flex-1"><span className={cn("block truncate text-[11px]", unread ? "font-bold text-[var(--ink)]" : "font-semibold text-[var(--ink-soft)]")}>{channel.name}</span><span className="mt-0.5 block truncate text-[9px] text-[var(--ink-faint)]">{channelDescription(channel)}</span></span>
      {unread ? <span className="numeric flex min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 py-1 text-[9px] font-bold text-white" aria-label={`${unread} unread`}>{unread}</span> : <ChevronRight className="size-3.5 text-[var(--ink-faint)] opacity-0 transition-opacity group-hover:opacity-100" />}
    </button>
  );
}

function MessageBubble({
  message,
  mine,
  currentUserId,
  onToggleReaction,
}: {
  message: ChatMessage;
  mine: boolean;
  currentUserId: string;
  onToggleReaction: (emoji: string) => void;
}) {
  const author = demoWorkspace.people.find((person) => person.id === message.authorId);
  const authorIndex = demoWorkspace.people.findIndex((person) => person.id === message.authorId);

  return (
    <motion.article layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn("group flex items-start gap-3", mine && "flex-row-reverse")}>
      <Avatar name={author?.displayName ?? "Team member"} size="sm" index={authorIndex} />
      <div className={cn("min-w-0 max-w-[min(78%,620px)]", mine && "items-end text-right")}>
        <div className={cn("mb-1 flex items-center gap-2", mine && "justify-end")}><p className="text-[10px] font-semibold">{author?.displayName ?? "Team member"}</p><time className="numeric text-[9px] text-[var(--ink-faint)]" dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>{message.editedAt ? <span className="text-[8px] text-[var(--ink-faint)]">edited</span> : null}</div>
        <div className={cn("rounded-[18px] px-3.5 py-2.5 text-left text-[11px] leading-5", mine ? "rounded-tr-md bg-[var(--ink)] text-[var(--paper)] dark:bg-[var(--accent)] dark:text-[#171a17]" : "rounded-tl-md border border-[var(--line)] bg-[var(--paper-strong)] text-[var(--ink)]")}>
          <p>{message.body}</p>
          {message.attachmentIds.map((attachmentId) => <button key={attachmentId} type="button" className={cn("mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left", mine ? "bg-white/10" : "bg-[var(--canvas)]")}><FileText className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate text-[9px] font-semibold">{attachmentId.includes("produce") ? "demo-produce-invoice.pdf" : "private-attachment"}</span><span className="text-[8px] opacity-60">Private</span></button>)}
        </div>
        <div className={cn("mt-1.5 flex flex-wrap items-center gap-1", mine && "justify-end")}>
          {message.reactions.map((reaction) => <button key={reaction.emoji} type="button" onClick={() => onToggleReaction(reaction.emoji)} aria-label={`${reaction.emoji} reaction from ${reaction.personIds.length} people`} className={cn("focus-ring inline-flex min-h-6 items-center gap-1 rounded-full border px-2 text-[9px]", reaction.personIds.includes(currentUserId) ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--paper)]")}><span>{reaction.emoji}</span><span className="numeric text-[var(--ink-faint)]">{reaction.personIds.length}</span></button>)}
          <div className="relative opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"><details><summary className="focus-ring flex size-6 list-none items-center justify-center rounded-full text-[var(--ink-faint)] hover:bg-[var(--canvas-strong)]" aria-label="Add reaction"><SmilePlus className="size-3" /></summary><div className="absolute bottom-7 left-0 z-10 flex rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-1 shadow-lg">{commonReactions.map((emoji) => <button key={emoji} type="button" className="flex size-8 items-center justify-center rounded-lg hover:bg-[var(--canvas)]" onClick={() => onToggleReaction(emoji)} aria-label={`React ${emoji}`}>{emoji}</button>)}</div></details></div>
        </div>
        {mine ? <p className="mt-1.5 flex items-center justify-end gap-1 text-[8px] text-[var(--ink-faint)]"><Check className="size-2.5" />{message.readBy.length ? `Read by ${message.readBy.length}` : "Sent"}</p> : null}
      </div>
    </motion.article>
  );
}

export function MessagesWorkspace() {
  const workspace = useWorkspaceContext();
  const currentUserId = workspace.identity.userId;
  const [selectedChannelId, setSelectedChannelId] = useState<string>("channel-all-staff");
  const [messages, setMessages] = useState<ChatMessage[]>(demoWorkspace.chatMessages);
  const [unread, setUnread] = useState(initialUnread);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [channelQuery, setChannelQuery] = useState("");
  const [notificationsMuted, setNotificationsMuted] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [mobileInfoOpen, setMobileInfoOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const visibleChannels = useMemo(() => demoWorkspace.chatChannels
    .filter((channel) => !channel.locationId || workspace.locations.some((location) => location.id === channel.locationId))
    .map((channel) => channel.locationId ? { ...channel, name: workspace.locations.find((location) => location.id === channel.locationId)?.name ?? channel.name } : channel)
    .filter((channel) => channel.name.toLowerCase().includes(channelQuery.trim().toLowerCase())), [channelQuery, workspace.locations]);
  const selectedChannel = useMemo(() => visibleChannels.find((channel) => channel.id === selectedChannelId) ?? visibleChannels[0] ?? demoWorkspace.chatChannels[0], [selectedChannelId, visibleChannels]);
  const channelMessages = messages.filter((message) => message.channelId === selectedChannel.id);

  const channelMembers = useMemo(() => {
    if (selectedChannel.participantIds.length) return demoWorkspace.people.filter((person) => selectedChannel.participantIds.includes(person.id));
    if (selectedChannel.locationId) return demoWorkspace.people.filter((person) => person.locationIds.includes(selectedChannel.locationId!));
    return demoWorkspace.people.filter((person) => person.status === "active");
  }, [selectedChannel]);

  function selectChannel(channelId: string) {
    setSelectedChannelId(channelId);
    setUnread((current) => ({ ...current, [channelId]: 0 }));
    setMobileChatOpen(true);
    setMobileInfoOpen(false);
  }

  function sendMessage(formData: FormData) {
    const body = String(formData.get("message") ?? "").trim();
    if (!body && !attachment) return;
    const now = new Date().toISOString();
    const message: ChatMessage = {
      id: `message-demo-${Date.now()}`,
      organizationId: demoIds.organization,
      channelId: selectedChannel.id,
      authorId: currentUserId,
      body: body || `Attached ${attachment?.name}`,
      attachmentIds: attachment ? [`attachment-demo-${Date.now()}`] : [],
      reactions: [],
      readBy: [],
      editedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    setMessages((current) => [...current, message]);
    setDraft("");
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function toggleReaction(messageId: string, emoji: string) {
    setMessages((current) => current.map((message) => {
      if (message.id !== messageId) return message;
      const existing = message.reactions.find((reaction) => reaction.emoji === emoji);
      if (!existing) return { ...message, reactions: [...message.reactions, { emoji, personIds: [currentUserId] }] };
      const personIds = existing.personIds.includes(currentUserId) ? existing.personIds.filter((id) => id !== currentUserId) : [...existing.personIds, currentUserId];
      return { ...message, reactions: personIds.length ? message.reactions.map((reaction) => reaction.emoji === emoji ? { ...reaction, personIds } : reaction) : message.reactions.filter((reaction) => reaction.emoji !== emoji) };
    }));
  }

  const announcement = demoWorkspace.announcements[0];
  const totalUnread = Object.values(unread).reduce((sum, count) => sum + count, 0);

  return (
    <PageFrame width="full" className="max-w-[1680px] pb-3 lg:pb-8">
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="flex items-center gap-2"><StatusPill tone={totalUnread ? "accent" : "positive"} dot>{totalUnread ? `${totalUnread} unread` : "Caught up"}</StatusPill><span className="text-[10px] text-[var(--ink-faint)]">Realtime team workspace</span></div><h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Stay close to service</h2><p className="mt-1 text-[11px] text-[var(--ink-faint)]">One place for all-staff updates, location conversations, and private management work.</p></div>
        <Button variant="secondary" size="sm" onClick={() => setNotificationsMuted((current) => !current)}>{notificationsMuted ? <BellOff className="size-3.5" /> : <Bell className="size-3.5" />}{notificationsMuted ? "Notifications muted" : "Notifications on"}</Button>
      </div>

      <div className="grid min-h-[calc(100svh-190px)] overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--paper)] shadow-[0_12px_42px_rgba(25,28,24,.04)] lg:grid-cols-[270px_minmax(0,1fr)] xl:grid-cols-[270px_minmax(0,1fr)_290px]">
        <nav aria-label="Message channels" className={cn("border-[var(--line)] bg-[var(--canvas)] p-3 lg:block lg:border-r", mobileChatOpen ? "hidden" : "block")}>
          <div className="px-2 pt-2 pb-4"><div className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-xl bg-[var(--graphite)] text-white"><MessageCircleMore className="size-3.5" /></span><div><p className="text-[11px] font-semibold">Le Yard</p><p className="mt-0.5 text-[9px] text-[var(--ink-faint)]">Team chat · main dining room</p></div></div></div>
          <label className="relative mb-4 block"><span className="sr-only">Search channels</span><Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" /><input type="search" value={channelQuery} onChange={(event) => setChannelQuery(event.target.value)} placeholder="Find a channel" className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] pr-3 pl-9 text-[10px] placeholder:text-[var(--ink-faint)]" /></label>
          <div className="space-y-5">
            <section><p className="px-3 text-[9px] font-semibold tracking-[0.12em] text-[var(--ink-faint)] uppercase">Team</p><div className="mt-2 space-y-1">{visibleChannels.filter((channel) => ["all_staff", "management"].includes(channel.kind)).map((channel) => <ChannelRow key={channel.id} channel={channel} selected={channel.id === selectedChannel.id} unread={unread[channel.id] ?? 0} onSelect={() => selectChannel(channel.id)} />)}</div></section>
            <section><p className="px-3 text-[9px] font-semibold tracking-[0.12em] text-[var(--ink-faint)] uppercase">Locations</p><div className="mt-2 space-y-1">{visibleChannels.filter((channel) => channel.kind === "location").map((channel) => <ChannelRow key={channel.id} channel={channel} selected={channel.id === selectedChannel.id} unread={unread[channel.id] ?? 0} onSelect={() => selectChannel(channel.id)} />)}</div></section>
          </div>
          <div className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-3"><div className="flex -space-x-1.5">{demoWorkspace.people.slice(0, 5).map((person, index) => <Avatar key={person.id} name={person.displayName} size="sm" index={index} />)}</div><p className="mt-3 text-[10px] font-semibold">5 teammates online</p><p className="mt-1 text-[9px] leading-4 text-[var(--ink-faint)]">Presence is scoped to your organization.</p></div>
        </nav>

        <main className={cn("min-w-0 flex-col bg-[var(--paper-strong)] lg:flex", mobileChatOpen ? "flex" : "hidden")} aria-label={`${selectedChannel.name} conversation`}>
          <header className="flex min-h-[72px] items-center gap-3 border-b border-[var(--line)] px-3 sm:px-5"><Button variant="quiet" size="icon" className="lg:hidden" aria-label="Back to channels" onClick={() => setMobileChatOpen(false)}><ArrowLeft className="size-4" /></Button><span className={cn("flex size-9 items-center justify-center rounded-xl", selectedChannel.kind === "management" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]")}>{selectedChannel.kind === "management" ? <LockKeyhole className="size-4" /> : selectedChannel.kind === "all_staff" ? <UsersRound className="size-4" /> : <Hash className="size-4" />}</span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-semibold">{selectedChannel.name}</h3>{selectedChannel.kind === "management" ? <StatusPill tone="danger">Private</StatusPill> : null}</div><p className="mt-0.5 truncate text-[9px] text-[var(--ink-faint)]">{channelDescription(selectedChannel)}</p></div><Button variant="quiet" size="icon" aria-label="Channel information" onClick={() => setMobileInfoOpen((current) => !current)}><Info className="size-4" /></Button><Button variant="quiet" size="icon" aria-label="More channel actions"><MoreHorizontal className="size-4" /></Button></header>

          <div className="flex-1 overflow-y-auto px-3 py-5 sm:px-6 sm:py-6">
            {selectedChannel.kind === "all_staff" ? <section className="mb-6 rounded-[18px] border border-[var(--accent)]/20 bg-[var(--accent-soft)]/40 p-4" aria-label="Pinned announcement"><div className="flex items-start gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]"><Megaphone className="size-3.5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-[10px] font-semibold tracking-[0.08em] uppercase">Pinned announcement</p><StatusPill tone={announcement.priority === "important" ? "warning" : "neutral"}>{announcement.priority}</StatusPill></div><h4 className="mt-2 text-xs font-semibold">{announcement.title}</h4><p className="mt-1 text-[10px] leading-4 text-[var(--ink-soft)]">{announcement.body}</p><p className="mt-3 text-[9px] text-[var(--ink-faint)]">{announcement.acknowledgedBy.length} acknowledged · posted by Maris</p></div></div></section> : null}
            <div className="mb-6 flex items-center gap-3"><span className="h-px flex-1 bg-[var(--line)]" /><span className="text-[9px] font-semibold text-[var(--ink-faint)]">Today</span><span className="h-px flex-1 bg-[var(--line)]" /></div>
            <div className="space-y-5">
              <AnimatePresence initial={false}>{channelMessages.map((message) => <MessageBubble key={message.id} message={message} mine={message.authorId === currentUserId} currentUserId={currentUserId} onToggleReaction={(emoji) => toggleReaction(message.id, emoji)} />)}</AnimatePresence>
              {!channelMessages.length ? <div className="flex min-h-64 flex-col items-center justify-center text-center"><span className="flex size-12 items-center justify-center rounded-2xl bg-[var(--canvas)] text-[var(--ink-faint)]"><MessageCircleMore className="size-5" /></span><p className="mt-4 text-xs font-semibold">Start the conversation</p><p className="mt-1 max-w-xs text-[10px] leading-4 text-[var(--ink-faint)]">Messages here are visible only to people with access to {selectedChannel.name}.</p></div> : null}
            </div>
          </div>

          <footer className="border-t border-[var(--line)] bg-[var(--paper-strong)] p-3 sm:p-4">
            {attachment ? <div className="mb-2 flex items-center gap-2 rounded-xl bg-[var(--canvas)] px-3 py-2 text-[9px]"><FileText className="size-3.5 text-[var(--accent)]" /><span className="min-w-0 flex-1 truncate font-semibold">{attachment.name}</span><span className="text-[var(--ink-faint)]">Private attachment</span><button type="button" onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} aria-label="Remove attachment"><X className="size-3.5" /></button></div> : null}
            <form action={sendMessage} className="flex items-end gap-2 rounded-[18px] border border-[var(--line)] bg-[var(--paper)] p-2 focus-within:border-[var(--line-strong)]">
              <input ref={fileInputRef} type="file" className="sr-only" accept="image/*,application/pdf" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} aria-label="Attach a file" />
              <Button variant="quiet" size="icon" className="shrink-0" aria-label="Attach file" onClick={() => fileInputRef.current?.click()}><Paperclip className="size-4" /></Button>
              <label className="min-w-0 flex-1"><span className="sr-only">Message {selectedChannel.name}</span><textarea name="message" value={draft} onChange={(event) => setDraft(event.target.value)} rows={1} placeholder={`Message ${selectedChannel.name}`} className="max-h-28 min-h-10 w-full resize-none bg-transparent px-1 py-2.5 text-xs outline-none placeholder:text-[var(--ink-faint)]" /></label>
              <Button type="submit" variant="accent" size="icon" className="shrink-0" disabled={!draft.trim() && !attachment} aria-label="Send message"><Send className="size-4" /></Button>
            </form>
            <p className="mt-2 px-2 text-[8px] text-[var(--ink-faint)]">Attachments stay private and use signed access links in production.</p>
          </footer>
        </main>

        <aside className={cn("border-l border-[var(--line)] bg-[var(--canvas)] p-5 xl:block", mobileInfoOpen ? "fixed inset-0 z-40 block overflow-y-auto" : "hidden")} aria-label="Channel information">
          <div className="flex items-center justify-between"><p className="text-xs font-semibold">Channel details</p><Button variant="quiet" size="icon" className="xl:hidden" onClick={() => setMobileInfoOpen(false)} aria-label="Close channel details"><X className="size-4" /></Button></div>
          <div className="mt-6 flex flex-col items-center text-center"><span className={cn("flex size-14 items-center justify-center rounded-[18px]", selectedChannel.kind === "management" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]")}>{selectedChannel.kind === "management" ? <ShieldCheck className="size-5" /> : <Hash className="size-5" />}</span><h4 className="mt-3 text-sm font-semibold">{selectedChannel.name}</h4><p className="mt-1 text-[9px] leading-4 text-[var(--ink-faint)]">{channelDescription(selectedChannel)}</p></div>
          <div className="mt-6 grid grid-cols-2 gap-2"><Button variant="secondary" size="sm" onClick={() => setNotificationsMuted((current) => !current)}>{notificationsMuted ? <BellOff className="size-3.5" /> : <Bell className="size-3.5" />}{notificationsMuted ? "Muted" : "Notify"}</Button><Button variant="secondary" size="sm"><Search className="size-3.5" /> Search</Button></div>
          <section className="mt-7 border-t border-[var(--line)] pt-5"><div className="flex items-center justify-between"><p className="text-[10px] font-semibold">Members</p><span className="numeric text-[9px] text-[var(--ink-faint)]">{channelMembers.length}</span></div><div className="mt-3 space-y-3">{channelMembers.slice(0, 6).map((person, index) => <div key={person.id} className="flex items-center gap-2.5"><Avatar name={person.displayName} size="sm" index={index} /><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-semibold">{person.displayName}</p><p className="mt-0.5 truncate text-[8px] text-[var(--ink-faint)]">{person.primaryRole}</p></div>{person.id === currentUserId ? <span className="text-[8px] text-[var(--ink-faint)]">You</span> : null}</div>)}</div>{channelMembers.length > 6 ? <button type="button" className="mt-3 text-[9px] font-semibold text-[var(--accent-strong)]">View all {channelMembers.length}</button> : null}</section>
          <section className="mt-7 border-t border-[var(--line)] pt-5"><p className="text-[10px] font-semibold">Shared files</p><button type="button" className="mt-3 flex w-full items-center gap-2.5 rounded-xl bg-[var(--paper)] px-3 py-3 text-left"><FileText className="size-3.5 text-[var(--accent)]" /><span className="min-w-0 flex-1 truncate text-[9px] font-semibold">demo-produce-invoice.pdf</span><ChevronRight className="size-3 text-[var(--ink-faint)]" /></button></section>
          {selectedChannel.kind === "management" ? <div className="mt-7 flex items-start gap-2 rounded-xl bg-[var(--danger-soft)] px-3 py-3 text-[9px] leading-4 text-[var(--danger)]"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" /><span>Membership is limited to owners and managers. Access is checked on every message.</span></div> : null}
        </aside>
      </div>
    </PageFrame>
  );
}
