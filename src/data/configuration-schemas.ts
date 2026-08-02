import { z } from "zod";

const uuid = z.string().uuid();

export const createChatChannelInputSchema = z
  .object({
    requestId: uuid,
    organizationId: uuid,
    kind: z.enum(["all_staff", "location", "management", "private"]),
    locationId: uuid.nullable(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1_000).nullable().optional(),
    memberIds: z.array(uuid).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "location" && !value.locationId) {
      context.addIssue({ code: "custom", path: ["locationId"], message: "Choose a location." });
    }
    if (value.kind !== "location" && value.locationId) {
      context.addIssue({ code: "custom", path: ["locationId"], message: "Only location channels accept a location." });
    }
    if (value.kind === "private" && value.memberIds.length < 1) {
      context.addIssue({ code: "custom", path: ["memberIds"], message: "Choose at least one other member." });
    }
    if (value.kind !== "private" && value.memberIds.length > 0) {
      context.addIssue({ code: "custom", path: ["memberIds"], message: "Membership is derived for this channel kind." });
    }
    if (new Set(value.memberIds).size !== value.memberIds.length) {
      context.addIssue({ code: "custom", path: ["memberIds"], message: "Channel members must be unique." });
    }
  });

export const setChatChannelArchivedInputSchema = z
  .object({ requestId: uuid, channelId: uuid, archived: z.boolean() })
  .strict();

export const setPrivateChatChannelMembersInputSchema = z
  .object({
    requestId: uuid,
    channelId: uuid,
    memberIds: z.array(uuid).min(1).max(100),
  })
  .strict()
  .refine((value) => new Set(value.memberIds).size === value.memberIds.length, {
    path: ["memberIds"],
    message: "Channel members must be unique.",
  });

export const saveExpenseCategoryInputSchema = z
  .object({
    requestId: uuid,
    organizationId: uuid,
    categoryId: uuid.nullable(),
    name: z.string().trim().min(1).max(120),
    accountingCode: z.string().trim().max(64).nullable().optional(),
  })
  .strict();

export const setExpenseCategoryActiveInputSchema = z
  .object({ requestId: uuid, categoryId: uuid, active: z.boolean() })
  .strict();

export type CreateChatChannelInput = z.infer<typeof createChatChannelInputSchema>;
export type SetChatChannelArchivedInput = z.infer<typeof setChatChannelArchivedInputSchema>;
export type SetPrivateChatChannelMembersInput = z.infer<typeof setPrivateChatChannelMembersInputSchema>;
export type SaveExpenseCategoryInput = z.infer<typeof saveExpenseCategoryInputSchema>;
export type SetExpenseCategoryActiveInput = z.infer<typeof setExpenseCategoryActiveInputSchema>;
