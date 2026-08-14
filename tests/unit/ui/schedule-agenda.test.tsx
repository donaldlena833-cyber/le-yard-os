// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ScheduleAgenda } from "@/components/schedule/schedule-agenda";

afterEach(cleanup);

describe("ScheduleAgenda", () => {
  const shifts = [
    { id: "later", label: "Dinner shift" },
    { id: "earlier", label: "Prep shift" },
  ];

  it("groups shifts into a linear semantic agenda without changing source order", () => {
    render(
      <ScheduleAgenda
        days={[
          {
            id: "2026-08-10",
            label: "Mon, Aug 10",
            detail: "14 scheduled hours",
            items: shifts,
          },
        ]}
        getItemKey={(shift) => shift.id}
        renderItem={(shift) => <button type="button">{shift.label}</button>}
      />,
    );

    const agenda = screen.getByLabelText("Weekly schedule agenda");
    const list = within(agenda).getByRole("list", {
      name: "Mon, Aug 10 shifts",
    });
    expect(
      within(list)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Dinner shift", "Prep shift"]);
    expect(within(agenda).getByLabelText("2 shifts")).toBeTruthy();
  });

  it("keeps empty days visible instead of dropping operational context", () => {
    render(
      <ScheduleAgenda
        days={[
          {
            id: "2026-08-11",
            label: "Tue, Aug 11",
            items: [],
          },
        ]}
        getItemKey={(shift: { id: string }) => shift.id}
        renderItem={() => null}
        emptyLabel="No published shifts"
      />,
    );

    expect(screen.getByRole("heading", { name: "Tue, Aug 11" })).toBeTruthy();
    expect(screen.getByText("No published shifts")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
