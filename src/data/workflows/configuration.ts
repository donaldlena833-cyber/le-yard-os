import "server-only";

import type {
  CreateChatChannelInput,
  SaveExpenseCategoryInput,
  SetChatChannelArchivedInput,
  SetExpenseCategoryActiveInput,
  SetPrivateChatChannelMembersInput,
} from "../configuration-schemas";
import { assertCondition, assertFound, throwDatabaseError } from "../errors";
import type { WorkflowContext } from "../execute";
import {
  requireLocationManagement,
  requireManagementRead,
  requireOrganizationOperations,
} from "../policy";

function nullable(value: string | null | undefined) {
  return value?.trim() || null;
}

function categoryAccess(context: WorkflowContext, organizationId: string) {
  const membership = requireManagementRead(context.actor, organizationId);
  assertCondition(
    membership.role === "owner" || membership.role === "admin",
    "forbidden",
    "Expense categories require Owner or Admin access.",
  );
  assertCondition(
    membership.role !== "owner" || context.actor.aal === "aal2",
    "forbidden",
    "Owner write actions require multi-factor authentication.",
  );
}

export async function createChatChannel(
  context: WorkflowContext,
  input: CreateChatChannelInput,
) {
  requireOrganizationOperations(context.actor, input.organizationId);
  if (input.locationId) {
    requireLocationManagement(context.actor, input.organizationId, input.locationId);
  }
  const { data, error } = await context.supabase.rpc(
    "create_chat_channel",
    {
      p_request_id: input.requestId,
      p_organization_id: input.organizationId,
      p_kind: input.kind,
      p_location_id: input.locationId,
      p_name: input.name,
      p_description: nullable(input.description),
      p_member_ids: input.memberIds,
    },
  );
  if (error) throwDatabaseError(error, "The channel could not be created.");
  const channel = assertFound(data, "The created channel was not returned.");
  return {
    id: channel.id,
    kind: channel.kind,
    locationId: channel.location_id,
    name: channel.name,
    description: channel.description,
    archived: channel.is_archived,
  };
}

async function requireManagedChannel(
  context: WorkflowContext,
  channelId: string,
) {
  const { data, error } = await context.supabase
    .from("chat_channels")
    .select("id, organization_id, location_id, kind, is_archived")
    .eq("id", channelId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The channel could not be verified.");
  const channel = assertFound(data, "The channel was not found.");
  requireOrganizationOperations(context.actor, channel.organization_id);
  if (channel.location_id) {
    requireLocationManagement(context.actor, channel.organization_id, channel.location_id);
  }
  return channel;
}

export async function setChatChannelArchived(
  context: WorkflowContext,
  input: SetChatChannelArchivedInput,
) {
  await requireManagedChannel(context, input.channelId);
  const { data, error } = await context.supabase.rpc(
    "set_chat_channel_archived",
    {
      p_request_id: input.requestId,
      p_channel_id: input.channelId,
      p_archived: input.archived,
    },
  );
  if (error) throwDatabaseError(error, "The channel state could not be saved.");
  const channel = assertFound(data, "The updated channel was not returned.");
  return { id: channel.id, archived: channel.is_archived };
}

export async function setPrivateChatChannelMembers(
  context: WorkflowContext,
  input: SetPrivateChatChannelMembersInput,
) {
  const source = await requireManagedChannel(context, input.channelId);
  assertCondition(
    source.kind === "private" && !source.is_archived,
    "conflict",
    "Only active private channels accept explicit members.",
  );
  const { data, error } = await context.supabase.rpc(
    "set_private_chat_channel_members",
    {
      p_request_id: input.requestId,
      p_channel_id: input.channelId,
      p_member_ids: input.memberIds,
    },
  );
  if (error) throwDatabaseError(error, "Private channel members could not be saved.");
  const channel = assertFound(data, "The updated private channel was not returned.");
  return { id: channel.id, archived: channel.is_archived };
}

export async function saveExpenseCategory(
  context: WorkflowContext,
  input: SaveExpenseCategoryInput,
) {
  categoryAccess(context, input.organizationId);
  const { data, error } = await context.supabase.rpc(
    "save_expense_category",
    {
      p_request_id: input.requestId,
      p_organization_id: input.organizationId,
      p_category_id: input.categoryId,
      p_name: input.name,
      p_accounting_code: nullable(input.accountingCode),
    },
  );
  if (error) throwDatabaseError(error, "The expense category could not be saved.");
  const category = assertFound(data, "The saved expense category was not returned.");
  return {
    id: category.id,
    name: category.name,
    accountingCode: category.accounting_code,
    active: category.is_active,
  };
}

export async function setExpenseCategoryActive(
  context: WorkflowContext,
  input: SetExpenseCategoryActiveInput,
) {
  const { data: source, error: sourceError } = await context.supabase
    .from("expense_categories")
    .select("id, organization_id")
    .eq("id", input.categoryId)
    .maybeSingle();
  if (sourceError) throwDatabaseError(sourceError, "The expense category could not be verified.");
  const category = assertFound(source, "The expense category was not found.");
  categoryAccess(context, category.organization_id);
  const { data, error } = await context.supabase.rpc(
    "set_expense_category_active",
    {
      p_request_id: input.requestId,
      p_category_id: input.categoryId,
      p_active: input.active,
    },
  );
  if (error) throwDatabaseError(error, "The expense category state could not be saved.");
  const result = assertFound(data, "The updated expense category was not returned.");
  return { id: result.id, active: result.is_active };
}
