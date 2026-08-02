// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";

vi.mock("@/app/actions/auth", () => ({
  signOutAction: vi.fn(),
}));

vi.mock("@/components/settings/mfa-enrollment", () => ({
  MfaEnrollment: () => <div>MFA playground placeholder</div>,
}));

afterEach(() => cleanup());

describe("playground Settings", () => {
  it("identifies Le Yard while clearly labeling the rest of the tenant as playground data", () => {
    render(<SettingsWorkspace />);

    expect(screen.getByText("Le Yard playground")).toBeTruthy();
    expect(screen.getByText(/858 9th Ave, New York, NY 10019/)).toBeTruthy();
    expect(screen.getByText(/Staff profiles, job codes, schedules, receipts/)).toBeTruthy();
    expect(screen.getByText(/synthetic mock data/)).toBeTruthy();
  });

  it("shows every owner assumption as unpublished and disconnected from calculations", () => {
    render(<SettingsWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Operating draft" }));

    expect(screen.getByText("Owner draft · unpublished")).toBeTruthy();
    expect(screen.getByText("Reference only.")).toBeTruthy();
    expect(screen.getByText("No calculations")).toBeTruthy();
    expect(screen.getByText(">6h → 30 min unpaid")).toBeTruthy();
    expect(screen.getByText("1.5× owner input")).toBeTruthy();
    expect(screen.getByText("Customer choice")).toBeTruthy();
    expect(screen.getByText("10% event fee")).toBeTruthy();
    expect(screen.getByText(/Threshold, workweek, and exemptions are not configured/)).toBeTruthy();
    expect(screen.getByText(/Retention means how long receipts, employee records/)).toBeTruthy();
    expect(screen.getAllByText("Undecided")).toHaveLength(1);
  });
});
