import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveInventoryWorkspace } from "@/components/inventory/live-inventory-workspace";
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
  reviewInventoryTransferAction: vi.fn(),
  reviewWasteRecordAction: vi.fn(),
  submitInventoryCountAction: vi.fn(),
  submitWasteRecordAction: vi.fn(),
}));

const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId: "10000000-0000-4000-8000-000000000001",
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
};

describe("connected Inventory UI", () => {
  it("renders honest tenant-scoped empty states without demo inventory", () => {
    const markup = renderToStaticMarkup(
      <LiveInventoryWorkspace
        workspace={workspace}
        result={{
          ok: true,
          data: {
            date: "2026-08-01",
            timeZone: "America/New_York",
            currencyCode: "USD",
            items: [],
            units: [],
            locations: [],
            counts: [],
            vendors: [],
            orders: [],
            deliveries: [],
            waste: [],
            transfers: [],
            recipes: [],
          },
        }}
      />,
    );

    expect(markup).toContain("Connected");
    expect(markup).toContain("Main Dining Room");
    expect(markup).toContain("No tracked inventory yet");
    expect(markup).toContain("No approved count yet");
    expect(markup).not.toContain("Roma tomatoes");
    expect(markup).not.toContain("Price watch");
  });

  it("fails closed instead of falling back to showcase records", () => {
    const markup = renderToStaticMarkup(
      <LiveInventoryWorkspace
        workspace={workspace}
        result={{ ok: false, message: "Management access is required." }}
      />,
    );

    expect(markup).toContain("Inventory unavailable");
    expect(markup).toContain("Management access is required.");
    expect(markup).not.toContain("Garden Room");
  });
});
