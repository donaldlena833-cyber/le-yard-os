"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  markChatReadInputSchema,
  sendChatMessageInputSchema,
} from "@/data/schemas";
import { markChatRead, sendChatMessage } from "@/data/workflows/chat";

export async function sendChatMessageAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "chat.send",
    schema: sendChatMessageInputSchema,
    input,
    run: sendChatMessage,
  });
  if (result.ok && result.persisted) revalidatePath("/messages");
  return result;
}

export async function markChatReadAction(input: unknown) {
  return executeWorkflowAction({
    operation: "chat.read",
    schema: markChatReadInputSchema,
    input,
    run: markChatRead,
  });
}

