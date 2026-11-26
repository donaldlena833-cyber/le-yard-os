import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { churchSquareClosePreviewResponse, type ChurchSquareClosePreviewSnapshot } from "@/lib/integrations/church-square-close-preview";
import { ChurchSquareOrderClient, churchSquareOrderConfiguration } from "@/lib/integrations/church-square-orders.server";
import { churchSquareCloseDates, churchSquareCloseWindow, loadChurchSquareClosePreview } from "./church-square-close-preview.server";
import { canRequestChurchSquareOrderWindow, verifyChurchSquareOrderWindowScope } from "./church-square-order-window.server";
import { readFailure, readSuccess, type LiveReadResult } from "./shared";

export async function loadChurchSquareLiveIncome(
  workspace: WorkspaceContextValue,
): Promise<LiveReadResult<ChurchSquareClosePreviewSnapshot> | null> {
  if (!canRequestChurchSquareOrderWindow(workspace)) return null;

  const unavailable = "Could not refresh Church Street payments and refunds from Square.";
  try {
    if (!await verifyChurchSquareOrderWindowScope(workspace)) return null;
    const config = churchSquareOrderConfiguration();
    const now = new Date();
    const { today } = churchSquareCloseDates(now);
    const window = churchSquareCloseWindow(today, now);
    if (!config || !window || window.from === window.to) return readFailure(unavailable);

    const snapshot = churchSquareClosePreviewResponse.safeParse(await loadChurchSquareClosePreview(
      new ChurchSquareOrderClient(config), today, now, window, { maxPages: 20 },
    ));
    if (!snapshot.success ||
      (snapshot.data.payments.coverage === "unavailable" && snapshot.data.refunds.coverage === "unavailable")) {
      return readFailure(unavailable);
    }
    return readSuccess(snapshot.data);
  } catch {
    return readFailure(unavailable);
  }
}
