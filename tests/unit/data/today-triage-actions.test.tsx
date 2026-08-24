// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SaturdayServiceTodayWorkspace } from "@/components/today/today-workspace";

afterEach(cleanup);

describe("Today triage truth", () => {
  it("routes every exception to its source and exposes no local resolve control", () => {
    render(<SaturdayServiceTodayWorkspace firstName="Donald" />);

    expect(screen.getByRole("link", { name: "Review in Reservations" }).getAttribute("href")).toContain("/reservations?date=");
    expect(screen.getByRole("link", { name: "Review in Service" }).getAttribute("href")).toBe("/service");
    expect(screen.getByRole("link", { name: "Review in Schedule" }).getAttribute("href")).toBe("/schedule");
    expect(screen.queryByRole("button", { name: /resolve/i })).toBeNull();
    expect(screen.getByText(/These cards do not resolve records/i)).toBeTruthy();
  });
});
