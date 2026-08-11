"use server";

import { revalidatePath } from "next/cache";
import {
  createChatChannelInputSchema,
  configureJobRoleCapabilityInputSchema,
  saveExpenseCategoryInputSchema,
  setChatChannelArchivedInputSchema,
  setExpenseCategoryActiveInputSchema,
  setPrivateChatChannelMembersInputSchema,
} from "@/data/configuration-schemas";
import { executeWorkflowAction } from "@/data/execute";
import {
  createChatChannel,
  configureJobRoleCapability,
  saveExpenseCategory,
  setChatChannelArchived,
  setExpenseCategoryActive,
  setPrivateChatChannelMembers,
} from "@/data/workflows/configuration";

export async function configureJobRoleCapabilityAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "capability.job-role.configure",
    schema: configureJobRoleCapabilityInputSchema,
    input,
    run: configureJobRoleCapability,
  });
  if (result.ok && result.persisted) revalidateConfiguration(["/settings"]);
  return result;
}

function revalidateConfiguration(paths: readonly string[]) {
  for (const path of paths) revalidatePath(path);
}

export async function createChatChannelAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "chat.channel.create",
    schema: createChatChannelInputSchema,
    input,
    run: createChatChannel,
  });
  if (result.ok && result.persisted) revalidateConfiguration(["/messages"]);
  return result;
}

export async function setChatChannelArchivedAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "chat.channel.archive",
    schema: setChatChannelArchivedInputSchema,
    input,
    run: setChatChannelArchived,
  });
  if (result.ok && result.persisted) revalidateConfiguration(["/messages"]);
  return result;
}

export async function setPrivateChatChannelMembersAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "chat.channel.members.set",
    schema: setPrivateChatChannelMembersInputSchema,
    input,
    run: setPrivateChatChannelMembers,
  });
  if (result.ok && result.persisted) revalidateConfiguration(["/messages"]);
  return result;
}

export async function saveExpenseCategoryAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "expense-category.save",
    schema: saveExpenseCategoryInputSchema,
    input,
    run: saveExpenseCategory,
  });
  if (result.ok && result.persisted) {
    revalidateConfiguration(["/settings", "/receipts"]);
  }
  return result;
}

export async function setExpenseCategoryActiveAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "expense-category.active.set",
    schema: setExpenseCategoryActiveInputSchema,
    input,
    run: setExpenseCategoryActive,
  });
  if (result.ok && result.persisted) {
    revalidateConfiguration(["/settings", "/receipts"]);
  }
  return result;
}
