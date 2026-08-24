import { describe, expect, it } from "vitest";
import {
  createInventoryCountDraft,
  inventoryCountCatalogRevision,
  readInventoryCountDraft,
} from "@/lib/inventory/count-draft";

const context = {
  organizationId: "org-1",
  locationId: "location-1",
  userId: "user-1",
  businessDate: "2026-08-24",
  items: [
    { id: "lemon", baseUnitId: "each" },
    { id: "flour", baseUnitId: "gram" },
  ],
};
const now = new Date("2026-08-24T16:00:00.000Z");

describe("inventory count draft contract", () => {
  it("restores only a fresh, exact-scope, same-date, same-catalog draft", () => {
    const draft = createInventoryCountDraft(
      context,
      { submissionId: "submission-1", values: { lemon: "12", flour: "900" }, notes: "Walk-in complete" },
      now,
    );
    expect(readInventoryCountDraft(JSON.stringify(draft), context, new Date(now.valueOf() + 60_000))).toEqual({ status: "restored", draft });
  });

  it("rejects expired, cross-user, cross-date, and changed-catalog drafts", () => {
    const draft = createInventoryCountDraft(context, { submissionId: "submission-1", values: {}, notes: "" }, now);
    expect(readInventoryCountDraft(JSON.stringify(draft), context, new Date("2026-08-25T05:00:01.000Z")).status).toBe("expired");
    expect(readInventoryCountDraft(JSON.stringify(draft), { ...context, userId: "user-2" }, now).status).toBe("scope_mismatch");
    expect(readInventoryCountDraft(JSON.stringify(draft), { ...context, businessDate: "2026-08-25" }, now).status).toBe("business_date_mismatch");
    expect(readInventoryCountDraft(JSON.stringify(draft), { ...context, items: [...context.items, { id: "salt", baseUnitId: "gram" }] }, now).status).toBe("catalog_changed");
  });

  it("binds the catalog revision to both item and canonical base unit", () => {
    expect(inventoryCountCatalogRevision(context.items)).not.toBe(
      inventoryCountCatalogRevision([{ id: "lemon", baseUnitId: "case" }, context.items[1]]),
    );
    expect(readInventoryCountDraft("not json", context, now).status).toBe("invalid");
  });
});
