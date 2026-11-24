// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegularsStreakPanel } from "@/components/loyalty/regulars-streak-panel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("counter handoff recovery", () => {
  it("recovers a saved reservation after response loss and records the chosen croissant once", async () => {
    const user = userEvent.setup();
    const claimId = "10000000-0000-4000-8000-000000000001";
    let status: "available" | "reserved" | "fulfilled" = "available";
    const calls: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body)); calls.push(input);
      if (input.action === "reserve") { status = "reserved"; throw new TypeError("Response lost after server saved reservation"); }
      if (input.action === "fulfill") status = "fulfilled";
      return Response.json({ status: "active", journey: {
        currentStreak: 3, visitedToday: true, latestVisitDay: "2026-11-26", checkedAt: "2026-11-26T15:00:00Z", reviewClaims: [],
        rewards: [{ milestone: 3, name: "A croissant of their choice", earnedOn: "2026-11-26", cycleStart: "2026-11-24", cycleEnd: "2026-11-26",
          claim: status === "available" ? null : { id: claimId, milestone: 3, earnedOn: "2026-11-26", cycleStart: "2026-11-24", cycleEnd: "2026-11-26",
            status, reservedAt: "2026-11-26T15:00:00Z", fulfilledAt: status === "fulfilled" ? "2026-11-26T15:01:00Z" : null,
            itemLabel: status === "fulfilled" ? "Almond Croissant" : null } }],
      } });
    });
    vi.stubGlobal("fetch",fetcher);
    render(<RegularsStreakPanel accountId="member" />);
    await user.click(screen.getByRole("button", { name: "Check daily ritual" }));
    await user.click(await screen.findByRole("button", { name: "Reserve treat" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Reserve treat" }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Refresh daily ritual" }));
    await screen.findByText("Reserved for handoff");
    expect(screen.queryByRole("button", { name: "Reserve treat" })).toBeNull();
    await user.selectOptions(screen.getByRole("combobox"), "Almond Croissant");
    await user.click(screen.getByRole("button", { name: "Confirm handed over" }));
    await waitFor(() => expect(screen.getByText("Given: Almond Croissant")).toBeTruthy());
    expect(calls.filter(call => call.action === "reserve")).toHaveLength(1);
    expect(calls.filter(call => call.action === "fulfill")).toEqual([{ action: "fulfill", claimId, itemLabel: "Almond Croissant", accountId: "member" }]);
    expect(screen.queryByRole("button", { name: "Confirm handed over" })).toBeNull();
  });
});
