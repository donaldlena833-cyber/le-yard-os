import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createClient } from "@/lib/supabase/server";
import { readFailure, readSuccess, type LiveReadResult } from "./shared";
import { compareMessagePosition, unreadCountForChannel } from "./message-state";

export interface LiveChatReaction {
  emoji: string;
  userIds: string[];
}

export interface LiveChatMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  replyToId: string | null;
  body: string;
  isAnnouncement: boolean;
  editedAt: string | null;
  createdAt: string;
  reactions: LiveChatReaction[];
  attachments: {
    id: string;
    fileName: string;
    mimeType: string | null;
    sizeBytes: number | null;
    storagePath: string;
  }[];
  readByCount: number;
  acknowledgementCount: number;
  acknowledgedByMe: boolean;
}

export interface LiveChatChannel {
  id: string;
  name: string;
  description: string | null;
  kind: "all_staff" | "location" | "management" | "private";
  locationId: string | null;
  memberIds: string[];
  unreadCount: number;
}

export interface LiveChatProfile {
  id: string;
  name: string;
  role: string;
}

export interface LiveMessagesModel {
  channels: LiveChatChannel[];
  messages: LiveChatMessage[];
  profiles: LiveChatProfile[];
  locations: Array<{ id: string; name: string }>;
  canAnnounce: boolean;
  canManageChannels: boolean;
  timeZone: string;
}

type BasicMessage = {
  id: string;
  channel_id: string;
  author_id: string;
  reply_to_id: string | null;
  body: string;
  is_announcement: boolean;
  edited_at: string | null;
  created_at: string;
};

export async function loadLiveMessages(
  workspace: WorkspaceContextValue,
): Promise<LiveReadResult<LiveMessagesModel>> {
  try {
    const supabase = await createClient();
    const organizationId = workspace.organization.id;
    const [channelResult, membershipResult, locationMembershipResult, explicitMemberResult, locationResult, activeLocationResult] = await Promise.all([
      supabase
        .from("chat_channels")
        .select("id, name, description, kind, location_id")
        .eq("organization_id", organizationId)
        .eq("is_archived", false)
        .order("created_at"),
      supabase
        .from("organization_memberships")
        .select("user_id, role")
        .eq("organization_id", organizationId)
        .eq("status", "active"),
      supabase
        .from("location_memberships")
        .select("user_id, location_id")
        .eq("organization_id", organizationId),
      supabase
        .from("chat_channel_members")
        .select("channel_id, user_id")
        .eq("organization_id", organizationId),
      supabase
        .from("locations")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("locations")
        .select("timezone")
        .eq("organization_id", organizationId)
        .eq("id", workspace.activeLocation.id)
        .single(),
    ]);
    if (channelResult.error || membershipResult.error || locationMembershipResult.error || explicitMemberResult.error || locationResult.error || activeLocationResult.error) {
      return readFailure("Allowed channels could not be loaded. Try again.");
    }

    const channelIds = (channelResult.data ?? []).map((channel) => channel.id);
    const messageResult = channelIds.length
      ? await supabase
          .from("chat_messages")
          .select("id, channel_id, author_id, reply_to_id, body, is_announcement, edited_at, created_at")
          .eq("organization_id", organizationId)
          .in("channel_id", channelIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1_000)
      : { data: [], error: null };
    if (messageResult.error) return readFailure("Messages could not be loaded. Try again.");
    const basicMessages = ((messageResult.data ?? []) as BasicMessage[]).sort(compareMessagePosition);
    const messageIds = basicMessages.map((message) => message.id);
    const [reactionResult, attachmentResult, receiptResult, acknowledgementResult] = await Promise.all([
      messageIds.length
        ? supabase
            .from("chat_reactions")
            .select("message_id, user_id, emoji")
            .eq("organization_id", organizationId)
            .in("message_id", messageIds)
        : Promise.resolve({ data: [], error: null }),
      messageIds.length
        ? supabase
          .from("chat_attachments")
            .select("id, message_id, file_name, mime_type, size_bytes, storage_path")
            .eq("organization_id", organizationId)
            .in("message_id", messageIds)
        : Promise.resolve({ data: [], error: null }),
      channelIds.length
        ? supabase
            .from("chat_read_receipts")
            .select("channel_id, user_id, last_read_message_id")
            .eq("organization_id", organizationId)
            .in("channel_id", channelIds)
        : Promise.resolve({ data: [], error: null }),
      messageIds.length
        ? supabase
            .from("announcement_acknowledgements")
            .select("message_id, user_id")
            .eq("organization_id", organizationId)
            .in("message_id", messageIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (reactionResult.error || attachmentResult.error || receiptResult.error || acknowledgementResult.error) {
      return readFailure("Message details could not be loaded. Try again.");
    }

    const userIds = [...new Set((membershipResult.data ?? []).map((membership) => membership.user_id))];
    const profileIds = [
      ...new Set([...userIds, ...basicMessages.map((message) => message.author_id)]),
    ];
    const { data: profiles, error: profileError } = profileIds.length
      ? await supabase.from("profiles").select("id, display_name, preferred_name").in("id", profileIds)
      : { data: [], error: null };
    if (profileError) return readFailure("Team identities could not be loaded. Try again.");
    const profileById = new Map(
      (profiles ?? []).map((profile) => [
        profile.id,
        profile.preferred_name?.trim() || profile.display_name,
      ]),
    );
    const roleById = new Map((membershipResult.data ?? []).map((membership) => [membership.user_id, membership.role]));
    const receipts = receiptResult.data ?? [];
    const acknowledgements = acknowledgementResult.data ?? [];

    const messages: LiveChatMessage[] = basicMessages.map((message) => {
      const groupedReactions = new Map<string, string[]>();
      for (const reaction of reactionResult.data ?? []) {
        if (reaction.message_id !== message.id) continue;
        groupedReactions.set(reaction.emoji, [...(groupedReactions.get(reaction.emoji) ?? []), reaction.user_id]);
      }
      const channelMessages = basicMessages.filter((candidate) => candidate.channel_id === message.channel_id);
      const messageIndex = channelMessages.findIndex((candidate) => candidate.id === message.id);
      const readByCount = receipts.filter((receipt) => {
        if (
          receipt.channel_id !== message.channel_id ||
          receipt.user_id === message.author_id ||
          !receipt.last_read_message_id
        ) return false;
        const readIndex = channelMessages.findIndex((candidate) => candidate.id === receipt.last_read_message_id);
        return readIndex >= messageIndex;
      }).length;
      return {
        id: message.id,
        channelId: message.channel_id,
        authorId: message.author_id,
        authorName: profileById.get(message.author_id) ?? "Team member",
        replyToId: message.reply_to_id,
        body: message.body,
        isAnnouncement: message.is_announcement,
        editedAt: message.edited_at,
        createdAt: message.created_at,
        reactions: [...groupedReactions.entries()].map(([emoji, reactionUserIds]) => ({ emoji, userIds: reactionUserIds })),
        attachments: (attachmentResult.data ?? []).filter((attachment) => attachment.message_id === message.id).map((attachment) => ({ id: attachment.id, fileName: attachment.file_name, mimeType: attachment.mime_type, sizeBytes: attachment.size_bytes == null ? null : Number(attachment.size_bytes), storagePath: attachment.storage_path })),
        readByCount,
        acknowledgementCount: acknowledgements.filter((ack) => ack.message_id === message.id).length,
        acknowledgedByMe: acknowledgements.some((ack) => ack.message_id === message.id && ack.user_id === workspace.identity.userId),
      };
    });

    const channels: LiveChatChannel[] = (channelResult.data ?? []).map((channel) => {
      const channelMessages = basicMessages.filter((message) => message.channel_id === channel.id);
      const ownReceipt = receipts.find((receipt) => receipt.channel_id === channel.id && receipt.user_id === workspace.identity.userId);
      let memberIds: string[];
      if (channel.kind === "all_staff") memberIds = userIds;
      else if (channel.kind === "management") memberIds = (membershipResult.data ?? []).filter((membership) => ["owner", "admin", "manager"].includes(membership.role)).map((membership) => membership.user_id);
      else if (channel.kind === "location") memberIds = (locationMembershipResult.data ?? []).filter((membership) => membership.location_id === channel.location_id).map((membership) => membership.user_id);
      else memberIds = (explicitMemberResult.data ?? []).filter((membership) => membership.channel_id === channel.id).map((membership) => membership.user_id);
      return {
        id: channel.id,
        name: channel.name,
        description: channel.description,
        kind: channel.kind,
        locationId: channel.location_id,
        memberIds: [...new Set(memberIds)],
        unreadCount: unreadCountForChannel(channelMessages, workspace.identity.userId, ownReceipt?.last_read_message_id ?? null),
      };
    });

    const kindOrder = { all_staff: 0, management: 1, location: 2, private: 3 };
    channels.sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind] || left.name.localeCompare(right.name));
    return readSuccess({
      channels,
      messages,
      profiles: userIds.map((id) => ({ id, name: profileById.get(id) ?? "Team member", role: roleById.get(id) ?? "employee" })),
      locations: (locationResult.data ?? []).map((location) => ({ id: location.id, name: location.name })),
      canAnnounce: ["owner", "admin", "manager"].includes(workspace.role),
      canManageChannels: ["owner", "admin", "manager"].includes(workspace.role),
      timeZone: activeLocationResult.data.timezone,
    });
  } catch {
    return readFailure("Live team messages could not be loaded. Try again.");
  }
}
