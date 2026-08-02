"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { executeWorkflowAction } from "@/data/execute";
import {
  acknowledgeLiveAnnouncement,
  createChatAttachmentUploadUrl,
  finalizeChatAttachment,
  toggleLiveChatReaction,
} from "@/data/workflows/live-chat";

const commonEmoji = z.enum(["👍", "❤️", "✅", "👀", "🎉"]);
const toggleReactionSchema = z.object({ requestId: z.string().uuid(), messageId: z.string().uuid(), emoji: commonEmoji, active: z.boolean() }).strict();
const acknowledgeSchema = z.object({ requestId: z.string().uuid(), messageId: z.string().uuid() }).strict();
const attachmentMimeType = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const attachmentUploadSchema = z.object({
  uploadId: z.string().uuid(),
  messageId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(240),
  mimeType: attachmentMimeType,
  sizeBytes: z.number().int().positive().max(25 * 1_048_576),
}).strict();
const finalizeAttachmentSchema = attachmentUploadSchema.extend({
  objectPath: z.string().trim().min(1).max(1_024),
}).strict();

export async function toggleLiveChatReactionAction(input: unknown) {
  const result = await executeWorkflowAction({ operation: "chat.react", schema: toggleReactionSchema, input, run: toggleLiveChatReaction });
  if (result.ok && result.persisted) revalidatePath("/messages");
  return result;
}

export async function acknowledgeLiveAnnouncementAction(input: unknown) {
  const result = await executeWorkflowAction({ operation: "chat.announcement.acknowledge", schema: acknowledgeSchema, input, run: acknowledgeLiveAnnouncement });
  if (result.ok && result.persisted) revalidatePath("/messages");
  return result;
}

export async function createChatAttachmentUploadUrlAction(input: unknown) {
  return executeWorkflowAction({
    operation: "chat.attachment.prepare",
    schema: attachmentUploadSchema,
    input,
    persists: false,
    run: createChatAttachmentUploadUrl,
  });
}

export async function finalizeChatAttachmentAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "chat.attachment.finalize",
    schema: finalizeAttachmentSchema,
    input,
    run: finalizeChatAttachment,
  });
  if (result.ok && result.persisted) revalidatePath("/messages");
  return result;
}
