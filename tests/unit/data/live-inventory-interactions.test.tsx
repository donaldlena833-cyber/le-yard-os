// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureInventoryCatalogAction,
  createInventoryTransferAction,
  createPurchaseOrderAction,
  receiveInventoryDeliveryAction,
  reviewDeliveryExceptionsAction,
  submitInventoryCountAction,
} from "@/app/actions/workflows/inventory";
import { LiveInventoryWorkspace } from "@/components/inventory/live-inventory-workspace";
import type { LiveInventoryModel } from "@/data/read-models/inventory";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/actions/workflows/inventory", () => ({
  approveInventoryCountAction: vi.fn(),
  configureInventoryCatalogAction: vi.fn(),
  createInventoryTransferAction: vi.fn(),
  createPurchaseOrderAction: vi.fn(),
  receiveInventoryDeliveryAction: vi.fn(),
  reviewDeliveryExceptionsAction: vi.fn(),
  reviewInventoryTransferAction: vi.fn(),
  reviewWasteRecordAction: vi.fn(),
  submitInventoryCountAction: vi.fn(),
  submitWasteRecordAction: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const channel = {
      on: vi.fn(),
      subscribe: vi.fn(),
    };
    channel.on.mockReturnValue(channel);
    channel.subscribe.mockReturnValue(channel);
    return {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    };
  },
}));

const draftStorage = new Map<string, string>();

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => draftStorage.get(key) ?? null,
      setItem: (key: string, value: string) => draftStorage.set(key, value),
      removeItem: (key: string) => draftStorage.delete(key),
      clear: () => draftStorage.clear(),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  draftStorage.clear();
});

const userId = "10000000-0000-4000-8000-000000000001";
const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId,
    displayName: "Connected Manager",
    email: "manager@example.com",
    aal: "aal2",
  },
  organization: {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Connected Restaurant",
  },
  activeLocation: {
    id: "30000000-0000-4000-8000-000000000001",
    organizationId: "20000000-0000-4000-8000-000000000001",
    name: "Main Dining Room",
    isPrimary: true,
  },
  locations: [],
  availableWorkspaces: [],
  membershipId: "40000000-0000-4000-8000-000000000001",
  role: "manager",
  organizationWide: false,
  capabilities: [
    "inventory.count.create",
    "inventory.count.approve",
    "inventory.purchase.create",
    "inventory.receive",
    "inventory.transfer.create",
    "inventory.transfer.approve",
    "inventory.waste.create",
    "inventory.waste.approve",
  ],
};

const model: LiveInventoryModel = {
  date: "2026-08-01",
  timeZone: "America/New_York",
  currencyCode: "USD",
  items: [
    {
      id: "50000000-0000-4000-8000-000000000001",
      name: "Lemons",
      sku: "PROD-LEMON",
      category: "Produce",
      baseUnitId: "60000000-0000-4000-8000-000000000001",
      unitSymbol: "ea",
      onHand: 24,
      par: 30,
      reorder: 12,
      lastUnitCostCents: 55,
      inventoryValueCents: 1_320,
      lastMovementAt: "2026-08-01T14:00:00.000Z",
      compatibleUnitIds: ["60000000-0000-4000-8000-000000000001"],
    },
  ],
  units: [
    {
      id: "60000000-0000-4000-8000-000000000001",
      name: "Each",
      symbol: "ea",
      dimension: "count",
    },
  ],
  locations: [
    { id: "30000000-0000-4000-8000-000000000001", name: "Main Dining Room" },
  ],
  counts: [
    {
      id: "70000000-0000-4000-8000-000000000001",
      status: "pending",
      countType: "full",
      countedAt: "2026-08-01T15:00:00.000Z",
      countedByUserId: userId,
      countedBy: "Connected Manager",
      approvedBy: null,
      approvedAt: null,
      notes: "Walk-in and bar counted.",
      lines: [
        {
          id: "80000000-0000-4000-8000-000000000001",
          inventoryItemId: "50000000-0000-4000-8000-000000000001",
          unitId: "60000000-0000-4000-8000-000000000001",
          expectedQuantity: 24,
          countedQuantity: 22,
          unitCostCents: 55,
        },
      ],
    },
  ],
  vendors: [],
  orders: [],
  deliveries: [],
  waste: [],
  transfers: [],
  recipes: [],
};

const mutationModel: LiveInventoryModel = {
  ...model,
  locations: [
    ...model.locations,
    { id: "30000000-0000-4000-8000-000000000002", name: "Garden Room" },
  ],
  vendors: [
    {
      id: "a0000000-0000-4000-8000-000000000001",
      name: "Hudson Produce",
      contactName: "Sam Rivera",
      email: "orders@hudson.example",
      phone: null,
      paymentTerms: "Net 14",
    },
  ],
  orders: [
    {
      id: "b0000000-0000-4000-8000-000000000001",
      vendorId: "a0000000-0000-4000-8000-000000000001",
      vendorName: "Hudson Produce",
      poNumber: "PO-2048",
      status: "partially_received",
      createdByUserId: "10000000-0000-4000-8000-000000000003",
      createdBy: "Alex Morgan",
      approvedBy: "Jamie Chen",
      approvedAt: "2026-08-01T15:00:00.000Z",
      orderedOn: "2026-08-01",
      expectedOn: "2026-08-02",
      subtotalCents: 625,
      taxCents: 0,
      shippingCents: 0,
      totalCents: 625,
      lineCount: 1,
      lines: [
        {
          id: "c0000000-0000-4000-8000-000000000001",
          inventoryItemId: model.items[0].id,
          itemName: "Lemons",
          unitId: model.items[0].baseUnitId,
          unitSymbol: "ea",
          quantity: 5,
          receivedQuantity: 2,
          unitPriceCents: 125,
          lineTotalCents: 625,
        },
      ],
    },
  ],
  deliveries: [
    {
      id: "d0000000-0000-4000-8000-000000000001",
      vendorId: "a0000000-0000-4000-8000-000000000001",
      vendorName: "Hudson Produce",
      purchaseOrderId: "b0000000-0000-4000-8000-000000000001",
      poNumber: "PO-2048",
      deliveredAt: "2026-08-01T14:00:00.000Z",
      invoiceNumber: "INV-1",
      receivedBy: "Maris",
      receivedByUserId: "10000000-0000-4000-8000-000000000002",
      notes: null,
      exceptionStatus: "pending_review",
      exceptionReviewNote: null,
      exceptions: [{
        inventoryItemId: model.items[0].id,
        itemName: "Lemons",
        unitSymbol: "ea",
        kind: "damaged",
        proposedAcceptedQuantity: 1,
        note: "One case crushed in transit",
      }],
      lines: [
        {
          id: "e0000000-0000-4000-8000-000000000001",
          inventoryItemId: model.items[0].id,
          itemName: "Lemons",
          unitId: model.items[0].baseUnitId,
          unitSymbol: "ea",
          quantity: 2,
          acceptedQuantity: 2,
          unitPriceCents: 125,
          lotCode: null,
          expiresOn: null,
        },
      ],
    },
  ],
  waste: [
    {
      id: "f0000000-0000-4000-8000-000000000001",
      inventoryItemId: model.items[0].id,
      itemName: "Lemons",
      unitId: model.items[0].baseUnitId,
      unitSymbol: "ea",
      quantity: 1,
      reasonCode: "quality",
      estimatedCostCents: 55,
      occurredAt: "2026-08-01T15:00:00.000Z",
      notes: "Mold found during prep.",
      status: "pending",
      recordedByUserId: userId,
      recordedBy: "Connected Manager",
      reviewedBy: null,
      approvedAt: null,
      reviewNote: null,
    },
  ],
};

describe("connected Inventory review interactions", () => {
  it("opens item evidence in a Drawer and prefills named object actions", async () => {
    render(
      <LiveInventoryWorkspace
        workspace={workspace}
        result={{ ok: true, data: mutationModel }}
      />,
    );

    const row = screen.getByRole("button", {
      name: "Open Lemons inventory details",
    });
    row.focus();
    fireEvent.click(row);

    const drawer = screen.getByRole("dialog", { name: "Lemons" });
    expect(within(drawer).getByText("24 ea")).toBeTruthy();
    expect(within(drawer).getByText("$13.2")).toBeTruthy();
    expect(
      within(drawer).getByRole("button", { name: "Record waste" }),
    ).toBeTruthy();
    expect(
      within(drawer).getByRole("button", { name: "Start transfer" }),
    ).toBeTruthy();

    fireEvent.click(
      within(drawer).getByRole("button", { name: "Record waste" }),
    );
    const wasteDialog = screen.getByRole("dialog", { name: "Record waste" });
    expect(
      (within(wasteDialog).getByLabelText("Item") as HTMLSelectElement).value,
    ).toBe(model.items[0].id);
    fireEvent.click(
      within(wasteDialog).getByRole("button", { name: "Close dialog" }),
    );
    await waitFor(() => expect(document.activeElement).toBe(row));

    fireEvent.click(row);
    const reopenedDrawer = await screen.findByRole(
      "dialog",
      { name: "Lemons" },
      { timeout: 5_000 },
    );
    fireEvent.click(
      within(reopenedDrawer).getByRole("button", { name: "Start transfer" }),
    );
    const transferDialog = screen.getByRole("dialog", {
      name: "Create transfer",
    });
    expect(
      (within(transferDialog).getByLabelText("Item 1") as HTMLSelectElement)
        .value,
    ).toBe(model.items[0].id);
  });

  it("opens a complete recipe editor from the Recipes tab and persists manual changes", async () => {
    const chefWorkspace = {
      ...workspace,
      capabilities: [...workspace.capabilities, "recipe.manage"],
    } satisfies WorkspaceContextValue;
    const recipeId = "91000000-0000-4000-8000-000000000001";
    const recipeModel: LiveInventoryModel = {
      ...model,
      recipes: [
        {
          id: recipeId,
          name: "Affogato",
          yieldQuantity: 1,
          yieldUnit: "ea",
          menuPriceCents: 1000,
          ingredientCount: 1,
          batchCostCents: 55,
          portionCostCents: 55,
          foodCostPercent: 4.58,
          missingCostCount: 0,
        },
      ],
      catalog: {
        units: [
          {
            ...model.units[0],
            isBase: true,
            isActive: true,
            updatedAt: "2026-08-01T12:00:00Z",
          },
        ],
        conversions: [],
        categories: [],
        vendors: [],
        items: [
          {
            id: model.items[0].id,
            name: "Lemons",
            sku: model.items[0].sku,
            description: null,
            categoryId: null,
            baseUnitId: model.items[0].baseUnitId,
            trackInventory: true,
            isActive: true,
          },
        ],
        vendorItems: [],
        priceHistory: [],
        pars: [],
        recipes: [
          {
            id: recipeId,
            name: "Affogato",
            yieldQuantity: 1,
            yieldUnitId: model.items[0].baseUnitId,
            menuPriceCents: 1000,
            isActive: true,
            ingredients: [
              {
                inventoryItemId: model.items[0].id,
                unitId: model.items[0].baseUnitId,
                quantity: 1,
                wasteFactor: 0,
              },
            ],
          },
        ],
      },
    };
    vi.mocked(configureInventoryCatalogAction).mockResolvedValue({
      ok: true,
      persisted: true,
      mode: "live",
      data: { id: recipeId, command: "recipe.save", replayed: false },
    });

    render(
      <LiveInventoryWorkspace
        workspace={chefWorkspace}
        result={{ ok: true, data: recipeModel }}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Recipes" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Affogato" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Edit Affogato" });
    expect(dialog.dataset.inventoryModalLayout).toBe("task");
    expect(
      dialog.querySelector("[data-recipe-editor-scroll]")?.className,
    ).toContain("overflow-y-auto");
    expect(
      (within(dialog).getByLabelText("Recipe name") as HTMLInputElement).value,
    ).toBe("Affogato");
    expect(
      (within(dialog).getByLabelText("Ingredient item 1") as HTMLSelectElement)
        .value,
    ).toBe(model.items[0].id);
    fireEvent.change(within(dialog).getByLabelText("Menu price · USD"), {
      target: { value: "12.00" },
    });
    fireEvent.change(within(dialog).getByLabelText("Ingredient quantity 1"), {
      target: { value: "2" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save change" }),
    );

    await waitFor(() =>
      expect(configureInventoryCatalogAction).toHaveBeenCalledOnce(),
    );
    expect(
      vi.mocked(configureInventoryCatalogAction).mock.calls[0][0],
    ).toMatchObject({
      command: "recipe.save",
      id: recipeId,
      name: "Affogato",
      menuPriceCents: 1200,
      ingredients: [{ inventoryItemId: model.items[0].id, quantity: 2 }],
    });
  });

  it("renders the count as a body-ported single-scroll task with safe actions and no input autofocus", async () => {
    render(
      <LiveInventoryWorkspace
        workspace={workspace}
        result={{ ok: true, data: model }}
      />,
    );
    const opener = screen.getByRole("button", { name: "Start or resume full count" });
    opener.focus();

    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Full inventory count" });
    const overlay = dialog.closest<HTMLElement>(
      "[data-inventory-modal-overlay]",
    );
    const modalBody = dialog.querySelector<HTMLElement>(
      "[data-inventory-modal-body]",
    );
    const countScroll = dialog.querySelector<HTMLElement>(
      "[data-inventory-count-scroll]",
    );
    const actions = dialog.querySelector<HTMLElement>(
      "[data-inventory-count-actions]",
    );
    const row = dialog.querySelector<HTMLElement>("[data-inventory-count-row]");
    const input = within(dialog).getByRole("spinbutton", {
      name: "Counted quantity for Lemons",
    });
    const close = within(dialog).getByRole("button", { name: "Close dialog" });

    expect(within(dialog).queryByText("Expected")).toBeNull();
    expect(within(dialog).queryByText("Variance")).toBeNull();

    expect(overlay?.parentElement).toBe(document.body);
    expect(dialog.dataset.inventoryModalLayout).toBe("task");
    expect(modalBody?.className).toContain("overflow-hidden");
    expect(countScroll?.className).toContain("overflow-y-auto");
    expect(countScroll?.className).not.toContain("overflow-x-auto");
    expect(row?.className).not.toContain("min-w-");
    expect(input.hasAttribute("autofocus")).toBe(false);
    expect(actions?.className).toContain("safe-area-inset-bottom");
    await waitFor(() => expect(document.activeElement).toBe(close));

    fireEvent.click(close);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("saves and resumes a blind count draft on the same scoped device", async () => {
    render(
      <LiveInventoryWorkspace
        workspace={workspace}
        result={{ ok: true, data: model }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start or resume full count" }),
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Counted quantity for Lemons" }),
      { target: { value: "19.25" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save & close" }));
    expect(await screen.findByText(/draft saved on this device/i)).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Full inventory count" }),
      ).toBeNull(),
    );
    const resume = screen.getByRole("button", { name: "Start or resume full count" });
    fireEvent.click(resume);
    expect(
      (
        screen.getByRole("spinbutton", {
          name: "Counted quantity for Lemons",
        }) as HTMLInputElement
      ).value,
    ).toBe("19.25");
    expect(screen.queryByText("Expected 24 ea")).toBeNull();
  });

  it("offers save, discard, and continue when a dirty count is dismissed", async () => {
    render(
      <LiveInventoryWorkspace
        workspace={workspace}
        result={{ ok: true, data: model }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start or resume full count" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Counted quantity for Lemons" }), {
      target: { value: "18" },
    });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Full inventory count" })).getByRole("button", { name: "Close dialog" }));

    const decision = await screen.findByRole("alertdialog", { name: "Leave this count?" });
    expect(within(decision).getByRole("button", { name: "Continue counting" })).toBeTruthy();
    expect(within(decision).getByRole("button", { name: "Discard & close" })).toBeTruthy();
    expect(within(decision).getByRole("button", { name: "Save draft & close" })).toBeTruthy();
    fireEvent.click(within(decision).getByRole("button", { name: "Continue counting" }));
    expect(screen.getByRole("dialog", { name: "Full inventory count" })).toBeTruthy();
  });

  it("submits counted quantities while leaving expected stock and cost to the server", async () => {
    vi.mocked(submitInventoryCountAction).mockResolvedValue({
      ok: true,
      persisted: true,
      mode: "live",
      data: {
        id: "90000000-0000-4000-8000-000000000001",
        status: "pending",
        countedAt: "2026-08-01T16:00:00.000Z",
        lineCount: 1,
        alreadyApplied: false,
      },
    });
    render(
      <LiveInventoryWorkspace
        workspace={workspace}
        result={{ ok: true, data: model }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start or resume full count" }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Counted quantity for Lemons" }),
      {
        target: { value: "22.5" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    expect(await screen.findByText(/Full count submitted/)).toBeTruthy();
    expect(submitInventoryCountAction).toHaveBeenCalledOnce();
    const input = vi.mocked(submitInventoryCountAction).mock.calls[0][0] as {
      lines: Array<Record<string, unknown>>;
    };
    expect(input.lines).toEqual([
      {
        inventoryItemId: model.items[0].id,
        unitId: model.items[0].baseUnitId,
        countedQuantity: 22.5,
      },
    ]);
    expect(input.lines[0]).not.toHaveProperty("expectedQuantity");
    expect(input.lines[0]).not.toHaveProperty("unitCostCents");
  });

  it("prevents a counter from reviewing their own pending count", async () => {
    render(
      <LiveInventoryWorkspace
        workspace={workspace}
        result={{ ok: true, data: model }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Counts/ }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Full count · Connected Manager/,
      }),
    );

    expect(
      screen.getByRole("dialog", { name: "Inventory count review" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "You submitted this count. A different manager must review it.",
      ),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Approve & post",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("creates a purchase order with exact integer-cent prices and no trusted actor fields", async () => {
    vi.mocked(createPurchaseOrderAction).mockResolvedValue({
      ok: true,
    } as never);
    render(
      <LiveInventoryWorkspace
        workspace={workspace}
        result={{ ok: true, data: mutationModel }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    expect((screen.getByLabelText("PO number") as HTMLInputElement).value).toBe(
      "",
    );
    fireEvent.change(screen.getByLabelText("PO number"), {
      target: { value: "PO-2049" },
    });
    fireEvent.change(screen.getByLabelText("Order quantity 1"), {
      target: { value: "2.5" },
    });
    fireEvent.change(screen.getByLabelText("Unit price 1"), {
      target: { value: "1.29" },
    });
    fireEvent.change(screen.getByLabelText("Tax · USD"), {
      target: { value: "0.07" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create order" }));

    expect(await screen.findByText(/Purchase order created/)).toBeTruthy();
    expect(createPurchaseOrderAction).toHaveBeenCalledOnce();
    const input = vi.mocked(createPurchaseOrderAction).mock
      .calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({
      locationId: workspace.activeLocation.id,
      vendorId: mutationModel.vendors[0].id,
      taxCents: 7,
      shippingCents: 0,
      lines: [
        {
          inventoryItemId: model.items[0].id,
          unitId: model.items[0].baseUnitId,
          quantity: 2.5,
          unitPriceCents: 129,
          notes: null,
        },
      ],
    });
    expect(input).not.toHaveProperty("organizationId");
    expect(input).not.toHaveProperty("actorId");
  });

  it("reuses a request ID for an ambiguous retry and rotates it for a newly opened order", async () => {
    vi.mocked(createPurchaseOrderAction)
      .mockReset()
      .mockResolvedValueOnce({
        ok: false,
        message: "The response was interrupted. Retry this order.",
      } as never)
      .mockResolvedValueOnce({ ok: true } as never)
      .mockResolvedValueOnce({ ok: true } as never);
    render(
      <LiveInventoryWorkspace
        workspace={workspace}
        result={{ ok: true, data: mutationModel }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    fireEvent.change(screen.getByLabelText("PO number"), {
      target: { value: "PO-2050" },
    });
    fireEvent.change(screen.getByLabelText("Order quantity 1"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Unit price 1"), {
      target: { value: "1.25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create order" }));

    const alert = await within(
      screen.getByRole("dialog", { name: "Create purchase order" }),
    ).findByRole("alert");
    expect(alert.textContent).toContain(
      "The response was interrupted. Retry this order.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Create order" }));
    expect(await screen.findByText(/Purchase order created/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByRole("button", { name: "New order" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    fireEvent.change(screen.getByLabelText("PO number"), {
      target: { value: "PO-2050" },
    });
    fireEvent.change(screen.getByLabelText("Order quantity 1"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Unit price 1"), {
      target: { value: "1.25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create order" }));
    await waitFor(() =>
      expect(createPurchaseOrderAction).toHaveBeenCalledTimes(3),
    );

    const [first, retry, reopened] = vi
      .mocked(createPurchaseOrderAction)
      .mock.calls.map(([input]) => input as Record<string, unknown>);
    expect(retry).toEqual(first);
    expect(reopened.requestId).not.toBe(first.requestId);
  });

  it("receives only the unfilled purchase-order quantity after a partial delivery", async () => {
    vi.mocked(receiveInventoryDeliveryAction).mockResolvedValue({
      ok: true,
    } as never);
    render(
      <LiveInventoryWorkspace
        workspace={workspace}
        result={{ ok: true, data: { ...mutationModel, deliveries: [] } }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Orders/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Receive" }));

    expect(
      (screen.getByLabelText("Delivered quantity 1") as HTMLInputElement).value,
    ).toBe("3");
    fireEvent.change(screen.getByLabelText("Accepted quantity 1"), {
      target: { value: "2.75" },
    });
    fireEvent.change(screen.getByLabelText("Receiving condition 1"), {
      target: { value: "damaged" },
    });
    fireEvent.change(screen.getByLabelText("Receiving exception note 1"), {
      target: { value: "One carton crushed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review delivery" }));

    expect(receiveInventoryDeliveryAction).not.toHaveBeenCalled();
    const review = await screen.findByRole("alertdialog", { name: "Post this delivery to stock?" });
    expect(within(review).getByText(/accepted 2.75 ea/i)).toBeTruthy();
    expect(within(review).getByText(/Damaged · One carton crushed/i)).toBeTruthy();
    fireEvent.click(within(review).getByRole("button", { name: "Confirm & post delivery" }));

    expect(await screen.findByText(/Delivery received/)).toBeTruthy();
    expect(receiveInventoryDeliveryAction).toHaveBeenCalledOnce();
    expect(
      vi.mocked(receiveInventoryDeliveryAction).mock.calls[0][0],
    ).toMatchObject({
      locationId: workspace.activeLocation.id,
      vendorId: mutationModel.vendors[0].id,
      purchaseOrderId: mutationModel.orders[0].id,
      lines: [
        {
          inventoryItemId: model.items[0].id,
          unitId: model.items[0].baseUnitId,
          quantity: 3,
          acceptedQuantity: 2.75,
          unitPriceCents: 125,
          exceptionKind: "damaged",
          exceptionNote: "One carton crushed",
        },
      ],
    });
  });

  it("shows structured receiving evidence and requires a different receiver to approve the correction", async () => {
    vi.mocked(reviewDeliveryExceptionsAction).mockResolvedValue({ ok: true } as never);
    render(
      <LiveInventoryWorkspace
        workspace={workspace}
        result={{ ok: true, data: mutationModel }}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Orders/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Review exceptions" }));
    const dialog = screen.getByRole("dialog", { name: "Review receiving exceptions" });
    expect(within(dialog).getByText("One case crushed in transit")).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Review note" }), {
      target: { value: "Damage confirmed at dock" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve & post correction" }));
    await waitFor(() => expect(reviewDeliveryExceptionsAction).toHaveBeenCalledOnce());
    expect(vi.mocked(reviewDeliveryExceptionsAction).mock.calls[0][0]).toMatchObject({
      deliveryId: mutationModel.deliveries[0].id,
      approve: true,
      note: "Damage confirmed at dock",
    });
  });

  it("keeps editable delivery quantities ungrouped above one thousand", async () => {
    const bulkModel: LiveInventoryModel = {
      ...mutationModel,
      deliveries: [],
      orders: [
        {
          ...mutationModel.orders[0],
          lines: [
            {
              ...mutationModel.orders[0].lines[0],
              quantity: 1_200,
              receivedQuantity: 200,
            },
          ],
        },
      ],
    };
    render(
      <LiveInventoryWorkspace
        workspace={workspace}
        result={{ ok: true, data: bulkModel }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Orders/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Receive" }));

    expect(
      (screen.getByLabelText("Delivered quantity 1") as HTMLInputElement).value,
    ).toBe("1000");
    expect(
      (screen.getByLabelText("Accepted quantity 1") as HTMLInputElement).value,
    ).toBe("1000");
  });

  it("traps dialog focus, inerts the workspace, and returns focus to the opener", async () => {
    render(
      <LiveInventoryWorkspace
        workspace={workspace}
        result={{ ok: true, data: mutationModel }}
      />,
    );
    const opener = screen.getByRole("button", { name: "New order" });
    opener.focus();

    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", {
      name: "Create purchase order",
    });
    const close = within(dialog).getByRole("button", { name: "Close dialog" });
    const submit = within(dialog).getByRole("button", { name: "Create order" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(opener.closest('[aria-hidden="true"]')).not.toBeNull();

    submit.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(opener);
      expect(opener.closest('[aria-hidden="true"]')).toBeNull();
    });
  });

  it("keeps a waste recorder from approving their own observation", async () => {
    render(
      <LiveInventoryWorkspace
        workspace={workspace}
        result={{ ok: true, data: mutationModel }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Waste/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Review" }));

    expect(screen.getByRole("dialog", { name: "Review waste" })).toBeTruthy();
    expect(
      screen.getByText(
        "You recorded this waste. A different manager must review it.",
      ),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Approve & post",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("submits a transfer as pending evidence without posting a client-side stock movement", async () => {
    vi.mocked(createInventoryTransferAction).mockResolvedValue({
      ok: true,
    } as never);
    render(
      <LiveInventoryWorkspace
        workspace={workspace}
        result={{ ok: true, data: mutationModel }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Transfers/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "New transfer" }),
    );
    fireEvent.change(screen.getByLabelText("Send quantity 1"), {
      target: { value: "4.25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit transfer" }));

    expect(await screen.findByText(/Transfer submitted/)).toBeTruthy();
    expect(createInventoryTransferAction).toHaveBeenCalledOnce();
    const input = vi.mocked(createInventoryTransferAction).mock
      .calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({
      fromLocationId: workspace.activeLocation.id,
      toLocationId: mutationModel.locations[1].id,
      lines: [
        {
          inventoryItemId: model.items[0].id,
          unitId: model.items[0].baseUnitId,
          sentQuantity: 4.25,
        },
      ],
    });
    expect(input).not.toHaveProperty("status");
    expect(input).not.toHaveProperty("approvedBy");
  });
});

describe("inventory catalog setup", () => {
  it("starts an empty tenant with an actor-free, location-derived unit command", async () => {
    const adminWorkspace: WorkspaceContextValue = {
      ...workspace,
      role: "admin",
      organizationWide: true,
      capabilities: [],
    };
    vi.mocked(configureInventoryCatalogAction)
      .mockResolvedValueOnce({
        ok: false,
        persisted: false,
        code: "database",
        message: "The connection ended before confirmation.",
      })
      .mockResolvedValueOnce({
        ok: true,
        persisted: true,
        mode: "live",
        data: {
          id: "90000000-0000-4000-8000-000000000001",
          command: "unit.save",
          replayed: false,
        },
      });
    render(
      <LiveInventoryWorkspace
        workspace={adminWorkspace}
        result={{
          ok: true,
          data: {
            ...model,
            items: [],
            units: [],
            catalog: {
              units: [],
              conversions: [],
              categories: [],
              vendors: [],
              items: [],
              vendorItems: [],
              pars: [],
              recipes: [],
            },
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
    expect(await screen.findByText("Inventory foundation")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Unit" }));
    const dialog = screen.getByRole("dialog", { name: "Add measurement unit" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Ounce" },
    });
    fireEvent.change(within(dialog).getByLabelText("Symbol"), {
      target: { value: "oz" },
    });
    fireEvent.change(within(dialog).getByLabelText("Dimension"), {
      target: { value: "mass" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save change" }),
    );

    await waitFor(() =>
      expect(configureInventoryCatalogAction).toHaveBeenCalledTimes(1),
    );
    expect(within(dialog).getByRole("alert").textContent).toContain(
      "connection ended",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save change" }),
    );
    await waitFor(() =>
      expect(configureInventoryCatalogAction).toHaveBeenCalledTimes(2),
    );
    const input = vi.mocked(configureInventoryCatalogAction).mock
      .calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({
      workspaceLocationId: workspace.activeLocation.id,
      command: "unit.save",
      name: "Ounce",
      symbol: "oz",
      dimension: "mass",
      isActive: true,
    });
    expect(input.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      vi.mocked(configureInventoryCatalogAction).mock.calls[1][0],
    ).toMatchObject({
      requestId: input.requestId,
    });
    expect(input).not.toHaveProperty("organizationId");
    expect(input).not.toHaveProperty("actorId");
  });
});
