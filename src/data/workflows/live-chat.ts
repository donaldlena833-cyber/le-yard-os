import "server-only";

import { assertCondition, assertFound, isUniqueViolation, throwDatabaseError } from "../errors";
import { requireOrganizationAccess } from "../policy";
import type { WorkflowContext } from "../execute";
import { hasExpectedFileSignature } from "@/lib/storage/file-integrity";
import {
  buildPrivateObjectPath,
  normalizePrivateFileName,
  parsePrivateObjectPath,
  validatePrivateFile,
} from "@/lib/storage/private-files";

const chatAttachmentMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export interface ToggleReactionInput {
  requestId: string;
  messageId: string;
  emoji: string;
  active: boolean;
}

export interface AcknowledgeAnnouncementInput {
  requestId: string;
  messageId: string;
}

export interface ChatAttachmentUploadInput {
  uploadId: string;
  messageId: string;
  fileName: string;
  mimeType: (typeof chatAttachmentMimeTypes)[number];
  sizeBytes: number;
}

export interface FinalizeChatAttachmentInput extends ChatAttachmentUploadInput {
  objectPath: string;
}

function validateChatAttachment(input: ChatAttachmentUploadInput) {
  const validation = validatePrivateFile(
    "chat-attachments",
    input.mimeType,
    input.sizeBytes,
  );
  assertCondition(validation.ok, "validation", validation.message ?? "Invalid attachment.");
  assertCondition(
    chatAttachmentMimeTypes.includes(input.mimeType),
    "validation",
    "Chat attachments currently support JPEG, PNG, WebP, and PDF files.",
  );
}

async function requireVisibleMessage(context: WorkflowContext, messageId: string) {
  const { data, error } = await context.supabase
    .from("chat_messages")
    .select("id, organization_id, channel_id, author_id, is_announcement, deleted_at")
    .eq("id", messageId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The message could not be loaded.");
  const message = assertFound(data, "The message was not found.");
  requireOrganizationAccess(context.actor, message.organization_id);
  assertCondition(!message.deleted_at, "conflict", "The message has been deleted.");
  return message;
}

async function requireOwnMessage(context: WorkflowContext, messageId: string) {
  const message = await requireVisibleMessage(context, messageId);
  assertCondition(
    message.author_id === context.actor.userId,
    "forbidden",
    "Only the message author can add an attachment.",
  );
  const { data: channel, error } = await context.supabase
    .from("chat_channels")
    .select("id, organization_id, location_id")
    .eq("id", message.channel_id)
    .eq("organization_id", message.organization_id)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The attachment channel could not be verified.");
  return { message, channel: assertFound(channel, "The attachment channel was not found.") };
}

export async function createChatAttachmentUploadUrl(
  context: WorkflowContext,
  input: ChatAttachmentUploadInput,
) {
  validateChatAttachment(input);
  const { message, channel } = await requireOwnMessage(context, input.messageId);
  const objectPath = buildPrivateObjectPath({
    organizationId: message.organization_id,
    locationId: channel.location_id ?? "global",
    resourceKind: "channels",
    resourceId: channel.id,
    uploadId: input.uploadId,
    fileName: input.fileName,
  });

  const { data: existing, error: existingError } = await context.supabase
    .from("chat_attachments")
    .select("id, message_id, storage_path, mime_type, size_bytes, uploaded_by")
    .eq("id", input.uploadId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError, "The attachment request could not be checked.");
  if (existing) {
    assertCondition(
      existing.message_id === message.id &&
        existing.storage_path === objectPath &&
        existing.mime_type === input.mimeType &&
        Number(existing.size_bytes) === input.sizeBytes &&
        existing.uploaded_by === context.actor.userId,
      "conflict",
      "This upload identifier is already bound to another attachment.",
    );
    return {
      attachmentId: existing.id,
      objectPath,
      signedUrl: null,
      token: null,
      alreadyFinalized: true,
    };
  }

  const { data, error } = await context.supabase.storage
    .from("chat-attachments")
    .createSignedUploadUrl(objectPath, { upsert: false });
  if (error) throwDatabaseError(error, "A private attachment upload could not be prepared.");
  const upload = assertFound(data, "The private attachment upload URL was not returned.");
  assertCondition(
    upload.path === objectPath,
    "database",
    "The storage service returned an unexpected attachment path.",
  );
  return {
    attachmentId: input.uploadId,
    objectPath,
    signedUrl: upload.signedUrl,
    token: upload.token,
    alreadyFinalized: false,
  };
}

export async function finalizeChatAttachment(
  context: WorkflowContext,
  input: FinalizeChatAttachmentInput,
) {
  validateChatAttachment(input);
  const { supabase, actor } = context;
  const { message, channel } = await requireOwnMessage(context, input.messageId);
  const parsedPath = parsePrivateObjectPath(input.objectPath);
  const expectedLocation = channel.location_id ?? "global";
  assertCondition(
    parsedPath?.organizationId === message.organization_id &&
      parsedPath.locationId === expectedLocation &&
      parsedPath.segments[2] === "channels" &&
      parsedPath.segments[3] === channel.id &&
      parsedPath.segments[4]?.startsWith(`${input.uploadId}-`),
    "forbidden",
    "The uploaded object is outside this message's private scope.",
  );

  const { data: existing, error: existingError } = await supabase
    .from("chat_attachments")
    .select("id, message_id, storage_path, file_name, mime_type, size_bytes, uploaded_by")
    .eq("id", input.uploadId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError, "The attachment could not be checked.");
  if (existing) {
    assertCondition(
      existing.message_id === message.id &&
        existing.storage_path === input.objectPath &&
        existing.mime_type === input.mimeType &&
        Number(existing.size_bytes) === input.sizeBytes &&
        existing.uploaded_by === actor.userId,
      "conflict",
      "This attachment is already bound with different metadata.",
    );
    return {
      id: existing.id,
      messageId: message.id,
      objectPath: existing.storage_path,
      fileName: existing.file_name,
      mimeType: existing.mime_type,
      sizeBytes: Number(existing.size_bytes),
      alreadyApplied: true,
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("chat_attachments")
    .insert({
      id: input.uploadId,
      organization_id: message.organization_id,
      message_id: message.id,
      storage_path: input.objectPath,
      file_name: normalizePrivateFileName(input.fileName),
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      uploaded_by: actor.userId,
    })
    .select("id, file_name, mime_type, size_bytes")
    .single();
  if (insertError) throwDatabaseError(insertError, "The private attachment could not be finalized.");

  const cleanup = async () => {
    await supabase.from("chat_attachments").delete().eq("id", inserted.id);
    await supabase.storage.from("chat-attachments").remove([input.objectPath]);
  };
  const { data: blob, error: objectError } = await supabase.storage
    .from("chat-attachments")
    .download(input.objectPath);
  if (objectError || !blob) {
    await cleanup();
    throwDatabaseError(objectError, "Upload the private file before finalizing the attachment.");
  }
  if (blob.size !== input.sizeBytes) {
    await cleanup();
    assertCondition(false, "conflict", "The uploaded attachment size does not match.");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!hasExpectedFileSignature(bytes, input.mimeType)) {
    await cleanup();
    assertCondition(
      false,
      "validation",
      "The uploaded file contents do not match the selected attachment type.",
    );
  }

  return {
    id: inserted.id,
    messageId: message.id,
    objectPath: input.objectPath,
    fileName: inserted.file_name,
    mimeType: inserted.mime_type,
    sizeBytes: Number(inserted.size_bytes),
    alreadyApplied: false,
  };
}

export async function toggleLiveChatReaction(
  context: WorkflowContext,
  input: ToggleReactionInput,
) {
  const { supabase, actor } = context;
  const message = await requireVisibleMessage(context, input.messageId);
  const { data: existing, error: existingError } = await supabase
    .from("chat_reactions")
    .select("id")
    .eq("message_id", message.id)
    .eq("user_id", actor.userId)
    .eq("emoji", input.emoji)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError);

  if (!input.active) {
    if (!existing) return { messageId: message.id, emoji: input.emoji, active: false, alreadyApplied: true };
    const { error } = await supabase.from("chat_reactions").delete().eq("id", existing.id);
    if (error) throwDatabaseError(error, "The reaction could not be removed.");
    return { messageId: message.id, emoji: input.emoji, active: false, alreadyApplied: false };
  }
  if (existing) return { messageId: message.id, emoji: input.emoji, active: true, alreadyApplied: true };
  const { error } = await supabase.from("chat_reactions").insert({
    id: input.requestId,
    organization_id: message.organization_id,
    message_id: message.id,
    user_id: actor.userId,
    emoji: input.emoji,
  });
  if (error) {
    if (isUniqueViolation(error)) {
      const { data: raced, error: racedError } = await supabase
        .from("chat_reactions")
        .select("id")
        .eq("message_id", message.id)
        .eq("user_id", actor.userId)
        .eq("emoji", input.emoji)
        .maybeSingle();
      if (racedError) throwDatabaseError(racedError);
      if (raced) {
        return { messageId: message.id, emoji: input.emoji, active: true, alreadyApplied: true };
      }
    }
    throwDatabaseError(error, "The reaction could not be saved.");
  }
  return { messageId: message.id, emoji: input.emoji, active: true, alreadyApplied: false };
}

export async function acknowledgeLiveAnnouncement(
  context: WorkflowContext,
  input: AcknowledgeAnnouncementInput,
) {
  const { supabase, actor } = context;
  const message = await requireVisibleMessage(context, input.messageId);
  assertCondition(message.is_announcement, "conflict", "Only announcements can be acknowledged.");
  const { data: existing, error: existingError } = await supabase
    .from("announcement_acknowledgements")
    .select("id, acknowledged_at")
    .eq("message_id", message.id)
    .eq("user_id", actor.userId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError);
  if (existing) return { id: existing.id, acknowledgedAt: existing.acknowledged_at, alreadyApplied: true };
  const { data, error } = await supabase
    .from("announcement_acknowledgements")
    .insert({ id: input.requestId, organization_id: message.organization_id, message_id: message.id, user_id: actor.userId })
    .select("id, acknowledged_at")
    .single();
  if (error) {
    if (isUniqueViolation(error)) {
      const { data: raced, error: racedError } = await supabase
        .from("announcement_acknowledgements")
        .select("id, acknowledged_at")
        .eq("message_id", message.id)
        .eq("user_id", actor.userId)
        .maybeSingle();
      if (racedError) throwDatabaseError(racedError);
      if (raced) {
        return { id: raced.id, acknowledgedAt: raced.acknowledged_at, alreadyApplied: true };
      }
    }
    throwDatabaseError(error, "The announcement acknowledgement could not be saved.");
  }
  return { id: data.id, acknowledgedAt: data.acknowledged_at, alreadyApplied: false };
}
