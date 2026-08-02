import "server-only";

import {
  assertCondition,
  assertFound,
  isUniqueViolation,
  throwDatabaseError,
  WorkflowError,
} from "../errors";
import {
  requireLocationAccess,
  requireManagementRead,
  requireOrganizationAccess,
} from "../policy";
import type { WorkflowContext } from "../execute";
import type {
  MarkChatReadInput,
  SendChatMessageInput,
} from "../schemas";

interface ChannelScope {
  id: string;
  organizationId: string;
  locationId: string | null;
  kind: "all_staff" | "location" | "management" | "private";
}

async function requireChannel(
  { supabase, actor }: WorkflowContext,
  channelId: string,
): Promise<ChannelScope> {
  const { data, error } = await supabase
    .from("chat_channels")
    .select("id, organization_id, location_id, kind, is_archived")
    .eq("id", channelId)
    .maybeSingle();

  if (error) throwDatabaseError(error, "The channel could not be loaded.");
  const channel = assertFound(data, "The channel was not found.");
  requireOrganizationAccess(actor, channel.organization_id);

  if (channel.kind === "location") {
    assertCondition(
      channel.location_id,
      "conflict",
      "The location channel has no location scope.",
    );
    requireLocationAccess(actor, channel.organization_id, channel.location_id);
  } else if (channel.kind === "management") {
    requireManagementRead(actor, channel.organization_id);
  } else if (channel.kind === "private") {
    const { data: membership, error: membershipError } = await supabase
      .from("chat_channel_members")
      .select("id")
      .eq("channel_id", channel.id)
      .eq("user_id", actor.userId)
      .maybeSingle();
    if (membershipError) throwDatabaseError(membershipError, "Channel access could not be verified.");
    assertFound(membership, "The channel was not found.");
  }

  if (channel.is_archived) {
    throw new WorkflowError("conflict", "This channel is archived.");
  }

  return {
    id: channel.id,
    organizationId: channel.organization_id,
    locationId: channel.location_id,
    kind: channel.kind,
  };
}

export async function sendChatMessage(
  context: WorkflowContext,
  input: SendChatMessageInput,
) {
  const { supabase, actor } = context;
  const channel = await requireChannel(context, input.channelId);
  if (input.isAnnouncement) requireManagementRead(actor, channel.organizationId);

  if (input.replyToId) {
    const { data: reply, error } = await supabase
      .from("chat_messages")
      .select("id, channel_id, deleted_at")
      .eq("id", input.replyToId)
      .maybeSingle();
    if (error) throwDatabaseError(error, "The reply target could not be verified.");
    const target = assertFound(reply, "The reply target was not found.");
    assertCondition(
      target.channel_id === channel.id && target.deleted_at === null,
      "conflict",
      "Replies must target a visible message in the same channel.",
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("chat_messages")
    .select("id, channel_id, author_id, body, reply_to_id, is_announcement, created_at")
    .eq("id", input.requestId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError, "The message request could not be checked.");
  if (existing) {
    assertCondition(
      existing.channel_id === channel.id &&
        existing.author_id === actor.userId &&
        existing.body === input.body &&
        existing.reply_to_id === (input.replyToId ?? null) &&
        existing.is_announcement === input.isAnnouncement,
      "conflict",
      "This request ID was already used for a different message.",
    );
    return {
      id: existing.id as string,
      channelId: existing.channel_id as string,
      createdAt: existing.created_at as string,
      alreadyApplied: true,
    };
  }

  const payload = {
    id: input.requestId,
    organization_id: channel.organizationId,
    channel_id: channel.id,
    author_id: actor.userId,
    reply_to_id: input.replyToId ?? null,
    body: input.body,
    is_announcement: input.isAnnouncement,
  };
  const { data: inserted, error: insertError } = await supabase
    .from("chat_messages")
    .insert(payload)
    .select("id, channel_id, created_at")
    .single();

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      const { data: raced, error: racedError } = await supabase
        .from("chat_messages")
        .select("id, channel_id, author_id, body, reply_to_id, is_announcement, created_at")
        .eq("id", input.requestId)
        .maybeSingle();
      if (racedError) throwDatabaseError(racedError);
      if (
        raced &&
        raced.channel_id === channel.id &&
        raced.author_id === actor.userId &&
        raced.body === input.body &&
        raced.reply_to_id === (input.replyToId ?? null) &&
        raced.is_announcement === input.isAnnouncement
      ) {
        return {
          id: raced.id as string,
          channelId: raced.channel_id as string,
          createdAt: raced.created_at as string,
          alreadyApplied: true,
        };
      }
    }
    throwDatabaseError(insertError, "The message could not be sent.");
  }

  return {
    id: inserted.id as string,
    channelId: inserted.channel_id as string,
    createdAt: inserted.created_at as string,
    alreadyApplied: false,
  };
}

export async function markChatRead(
  context: WorkflowContext,
  input: MarkChatReadInput,
) {
  const { supabase, actor } = context;
  const channel = await requireChannel(context, input.channelId);

  if (input.lastReadMessageId) {
    const { data: target, error } = await supabase
      .from("chat_messages")
      .select("id, channel_id")
      .eq("id", input.lastReadMessageId)
      .maybeSingle();
    if (error) throwDatabaseError(error, "The read position could not be verified.");
    const message = assertFound(target, "The read position was not found.");
    assertCondition(
      message.channel_id === channel.id,
      "conflict",
      "The read position must belong to this channel.",
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("chat_read_receipts")
    .select("id, last_read_message_id, last_read_at")
    .eq("channel_id", channel.id)
    .eq("user_id", actor.userId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError, "The current read position could not be loaded.");

  if (existing?.last_read_message_id === input.lastReadMessageId) {
    return {
      id: existing.id as string,
      channelId: channel.id,
      lastReadMessageId: existing.last_read_message_id as string | null,
      lastReadAt: existing.last_read_at as string,
      alreadyApplied: true,
    };
  }

  if (existing && input.lastReadMessageId === null) {
    return {
      id: existing.id as string,
      channelId: channel.id,
      lastReadMessageId: existing.last_read_message_id as string | null,
      lastReadAt: existing.last_read_at as string,
      alreadyApplied: true,
    };
  }

  const { data: saved, error: saveError } = await supabase.rpc(
    "mark_channel_read",
    {
      p_channel_id: channel.id,
      p_last_read_message_id: input.lastReadMessageId,
    },
  );
  if (saveError) throwDatabaseError(saveError, "The read position could not be saved.");
  const result = assertFound(saved, "The saved read position was not returned.");

  return {
    id: result.id as string,
    channelId: channel.id,
    lastReadMessageId: result.last_read_message_id as string | null,
    lastReadAt: result.last_read_at as string,
    alreadyApplied: result.last_read_message_id !== input.lastReadMessageId,
  };
}
