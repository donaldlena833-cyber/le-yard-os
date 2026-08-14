// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReadState } from "@/components/ui/read-state";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";

afterEach(cleanup);

describe("ReadState", () => {
  it("keeps static guidance quiet and exposes the exact state", () => {
    render(
      <ReadState
        state="empty"
        title="No records"
        description="Create the first record when the source is ready."
      />,
    );
    const region = screen.getByText("No records").closest("section");
    expect(region?.getAttribute("data-read-state")).toBe("empty");
    expect(region?.getAttribute("aria-live")).toBeNull();
    expect(region?.getAttribute("role")).toBeNull();
  });

  it("announces transient failures only when explicitly requested", () => {
    render(
      <ReadState
        state="unavailable"
        title="Read failed"
        description="Try again."
        announce="assertive"
        action={<button type="button">Retry</button>}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(
      within(alert).getByRole("button", { name: "Retry" }).closest("div")
        ?.className,
    ).toContain("min-h-11");
  });
});

describe("ResponsiveDataView", () => {
  const rows = [
    { id: "a", name: "Dinner", value: "$120" },
    { id: "b", name: "Brunch", value: "$80" },
  ];

  it("provides a semantic desktop table and a purpose-built mobile list", () => {
    render(
      <ResponsiveDataView
        items={rows}
        getItemKey={(row) => row.id}
        label="Service revenue"
        columns={[
          { key: "name", label: "Service", render: (row) => row.name },
          {
            key: "value",
            label: "Revenue",
            align: "right",
            render: (row) => row.value,
          },
        ]}
        renderCard={(row) => (
          <p>
            {row.name} · {row.value}
          </p>
        )}
        empty={<p>No service revenue</p>}
      />,
    );
    expect(screen.getByRole("table", { name: "Service revenue" })).toBeTruthy();
    expect(
      screen
        .getByRole("region", { name: "Service revenue" })
        .getAttribute("tabindex"),
    ).toBe("0");
    expect(
      screen.getByRole("list", { name: "Service revenue, mobile view" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders one honest empty boundary instead of empty table chrome", () => {
    render(
      <ResponsiveDataView
        items={[]}
        getItemKey={(row: { id: string }) => row.id}
        label="Empty evidence"
        columns={[]}
        renderCard={() => null}
        empty={
          <ReadState
            state="empty"
            title="No evidence"
            description="Nothing matched."
          />
        }
      />,
    );
    expect(screen.getByText("No evidence")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("keeps expanded evidence inside the semantic desktop table", () => {
    render(
      <ResponsiveDataView
        items={rows}
        getItemKey={(row) => row.id}
        label="Tip allocations"
        columns={[
          { key: "name", label: "Service", render: (row) => row.name },
          { key: "value", label: "Value", render: (row) => row.value },
        ]}
        renderCard={(row) => <p>{row.name}</p>}
        renderDetails={(row) =>
          row.id === "a" ? <p>Exact allocation evidence</p> : null
        }
        empty={<p>No allocations</p>}
      />,
    );

    const detail = screen.getByText("Exact allocation evidence");
    expect(detail.closest("td")?.getAttribute("colspan")).toBe("2");
  });
});

describe("StickyActionBar", () => {
  it("reserves the mobile dock and keeps repeated actions at least 44px", () => {
    render(
      <StickyActionBar
        label="Closeout actions"
        title="Dinner closeout"
        detail="Manager draft"
        actions={<button type="button">Submit closeout</button>}
      />,
    );

    const bar = screen.getByRole("region", { name: "Closeout actions" });
    expect(bar.className).toContain("env(safe-area-inset-bottom)");
    expect(
      screen.getByRole("button", { name: "Submit closeout" }).parentElement
        ?.className,
    ).toContain("[&>*]:grow");
  });
});
