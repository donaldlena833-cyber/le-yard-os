// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChurchSquareReconciliation } from "@/components/today/church-square-reconciliation";
import {
  churchSquareReconciliationPath,
  type ChurchSquareReconciliationResponse,
} from "@/lib/integrations/church-square-reconciliation";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("marks only orders with an explicit manual recovery time and accepts older responses", async () => {
  const recoveredAt = "2026-11-14T18:02:00+00:00";
  const order = {
    kind: "order",
    reference: "order1",
    orderReference: null,
    status: "COMPLETED",
    amountCents: 1320,
    depositState: null,
    depositDueCents: null,
    depositCompletedCents: null,
    serviceDate: null,
    updatedAt: "2026-11-14T17:25:00Z",
  } as const;
  const fixture: ChurchSquareReconciliationResponse = {
    pending: 0,
    needsReview: 0,
    resources: [
      { ...order, recoveredAt },
      { ...order, reference: "old-order" },
      { ...order, reference: "null-order", recoveredAt: null },
      { ...order, kind: "payment", reference: "payment1", orderReference: "order1", recoveredAt },
    ],
  };
  const request = vi.fn().mockResolvedValue(Response.json(fixture));
  vi.stubGlobal("fetch", request);
  render(<ChurchSquareReconciliation />);
  const reconciliation = within(screen.getByRole("region", { name: "Square reconciliation" }));
  fireEvent.click(reconciliation.getByRole("button", { name: "Load reconciliation" }));

  const table = within(await reconciliation.findByRole("table"));
  expect(request).toHaveBeenCalledExactlyOnceWith(churchSquareReconciliationPath, expect.objectContaining({ cache: "no-store" }));
  const recovered = table.getByRole("rowheader", { name: /^Order order1/ });
  expect(recovered.textContent).toMatch(/Manually recovered Nov 14, 1:02 PM ET/);
  expect(recovered.querySelector("time")?.dateTime).toBe(recoveredAt);
  expect(table.getAllByText(/Manually recovered/)).toHaveLength(1);
  for (const name of ["Order old-order", "Order null-order", "Payment payment1"]) {
    expect(table.getByRole("rowheader", { name }).querySelector("time")).toBeNull();
  }
});
