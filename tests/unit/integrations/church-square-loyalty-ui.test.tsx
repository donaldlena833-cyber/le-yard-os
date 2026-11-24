// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChurchLoyaltyWorkspace } from "@/components/loyalty/church-loyalty-workspace";
import { emptyLoyaltySnapshot } from "@/lib/integrations/church-square-loyalty";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Loyalty workspace", () => {
  it("keeps member reads explicit and does not claim Wallet is enabled", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<ChurchLoyaltyWorkspace />);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/an active program alone does not confirm/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load from Square" })).toBeTruthy();
  });
  it("shows an inactive program without an empty active-member table", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(emptyLoyaltySnapshot("inactive"))));
    render(<ChurchLoyaltyWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Load from Square" }));
    expect(await screen.findByText("Square program inactive")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("shows masked member information and clears it when access is lost", async () => {
    const snapshot = emptyLoyaltySnapshot("active");
    snapshot.program = { pointsLabel: "points", rewards: [{ name: "Coffee", points: 9 }], sharedAcrossLocations: false };
    snapshot.members = [{ id: "member", name: "Emma Test", phoneSuffix: "0100", points: 5, lifetimePoints: 5,
      birthday: "02-14", enrolledAt: "2026-11-20T14:00:00Z", profileAvailable: true, nextReward: { name: "Coffee", pointsRemaining: 4 } }];
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(snapshot)).mockResolvedValueOnce(Response.json({ status: "forbidden" }, { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    render(<ChurchLoyaltyWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Load from Square" }));
    expect(await screen.findByText("Emma Test")).toBeTruthy();
    expect(screen.getByText("Phone ending 0100")).toBeTruthy();
    expect(screen.getByText("Feb 14")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh members" }));
    await waitFor(() => expect(screen.queryByText("Emma Test")).toBeNull());
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Your access changed"));
  });
});
