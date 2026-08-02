import { describe, expect, it, vi } from "vitest";
import type { WorkflowContext } from "@/data/execute";
import {
  createChatChannelInputSchema,
  saveExpenseCategoryInputSchema,
  setPrivateChatChannelMembersInputSchema,
} from "@/data/configuration-schemas";
import {
  createChatChannel,
  saveExpenseCategory,
  setChatChannelArchived,
  setExpenseCategoryActive,
  setPrivateChatChannelMembers,
} from "@/data/workflows/configuration";

vi.mock("server-only", () => ({}));

const ids = {
  request: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  location: "33333333-3333-4333-8333-333333333333",
  otherLocation: "33333333-3333-4333-8333-333333333334",
  channel: "44444444-4444-4444-8444-444444444444",
  category: "55555555-5555-4555-8555-555555555555",
  member: "66666666-6666-4666-8666-666666666666",
  user: "77777777-7777-4777-8777-777777777777",
};

function query(row: unknown) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  return builder;
}

function context(role: "admin" | "manager" = "admin") {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    void args;
    if (name === "save_expense_category" || name === "set_expense_category_active") {
      return {
        data: {
          id: ids.category,
          organization_id: ids.organization,
          name: "Food cost",
          accounting_code: "5000",
          is_active: name === "save_expense_category",
        },
        error: null,
      };
    }
    return {
      data: {
        id: ids.channel,
        organization_id: ids.organization,
        location_id: null,
        kind: "private",
        name: "Event planning",
        description: null,
        is_archived: name === "set_chat_channel_archived",
      },
      error: null,
    };
  });
  const supabase = {
    from: vi.fn((table: string) => query(
      table === "chat_channels"
        ? {
            id: ids.channel,
            organization_id: ids.organization,
            location_id: null,
            kind: "private",
            is_archived: false,
          }
        : { id: ids.category, organization_id: ids.organization },
    )),
    rpc,
  };
  return {
    workflow: {
      supabase,
      actor: {
        userId: ids.user,
        aal: "aal2",
        memberships: [{
          organizationId: ids.organization,
          role,
          locationIds: [ids.location],
          organizationWide: false,
        }],
      },
    } as unknown as WorkflowContext,
    rpc,
  };
}

describe("operations security configuration contracts", () => {
  it("accepts only coherent actor-free channel and category inputs", () => {
    expect(createChatChannelInputSchema.safeParse({
      requestId: ids.request,
      organizationId: ids.organization,
      kind: "location",
      locationId: ids.location,
      name: "Main dining room",
      description: null,
      memberIds: [],
    }).success).toBe(true);
    expect(createChatChannelInputSchema.safeParse({
      requestId: ids.request,
      organizationId: ids.organization,
      kind: "private",
      locationId: null,
      name: "Event planning",
      memberIds: [],
    }).success).toBe(false);
    expect(setPrivateChatChannelMembersInputSchema.safeParse({
      requestId: ids.request,
      channelId: ids.channel,
      memberIds: [ids.member, ids.member],
    }).success).toBe(false);
    expect(saveExpenseCategoryInputSchema.safeParse({
      requestId: ids.request,
      organizationId: ids.organization,
      categoryId: null,
      name: "Food cost",
      accountingCode: "5000",
      actorId: ids.user,
    }).success).toBe(false);
  });

  it("routes every command through the actor-derived 021 RPC", async () => {
    const { workflow, rpc } = context();
    await createChatChannel(workflow, {
      requestId: ids.request,
      organizationId: ids.organization,
      kind: "private",
      locationId: null,
      name: "Event planning",
      description: null,
      memberIds: [ids.member],
    });
    await setPrivateChatChannelMembers(workflow, {
      requestId: ids.request,
      channelId: ids.channel,
      memberIds: [ids.user, ids.member],
    });
    await setChatChannelArchived(workflow, {
      requestId: ids.request,
      channelId: ids.channel,
      archived: true,
    });
    await saveExpenseCategory(workflow, {
      requestId: ids.request,
      organizationId: ids.organization,
      categoryId: null,
      name: "Food cost",
      accountingCode: "5000",
    });
    await setExpenseCategoryActive(workflow, {
      requestId: ids.request,
      categoryId: ids.category,
      active: false,
    });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "create_chat_channel",
      "set_private_chat_channel_members",
      "set_chat_channel_archived",
      "save_expense_category",
      "set_expense_category_active",
    ]);
    expect(rpc.mock.calls[0][1]).toEqual({
      p_request_id: ids.request,
      p_organization_id: ids.organization,
      p_kind: "private",
      p_location_id: null,
      p_name: "Event planning",
      p_description: null,
      p_member_ids: [ids.member],
    });
    expect(rpc.mock.calls[3][1]).toEqual({
      p_request_id: ids.request,
      p_organization_id: ids.organization,
      p_category_id: null,
      p_name: "Food cost",
      p_accounting_code: "5000",
    });
  });

  it("blocks manager category writes and out-of-scope location channels before RPC", async () => {
    const manager = context("manager");
    await expect(saveExpenseCategory(manager.workflow, {
      requestId: ids.request,
      organizationId: ids.organization,
      categoryId: null,
      name: "Food cost",
      accountingCode: null,
    })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createChatChannel(manager.workflow, {
      requestId: ids.request,
      organizationId: ids.organization,
      kind: "location",
      locationId: ids.otherLocation,
      name: "Other location",
      description: null,
      memberIds: [],
    })).rejects.toMatchObject({ code: "forbidden" });
    expect(manager.rpc).not.toHaveBeenCalled();
  });
});
