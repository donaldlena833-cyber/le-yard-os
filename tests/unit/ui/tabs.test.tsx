// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { TabPanel, Tabs } from "@/components/ui/tabs";

const items = [
  { value: "stock", label: "Stock" },
  { value: "count", label: "Counts", disabled: true },
  { value: "orders", label: "Orders", badge: 2 },
] as const;

afterEach(cleanup);

function Harness() {
  const [value, setValue] = useState<(typeof items)[number]["value"]>("stock");
  return (
    <>
      <Tabs
        id="inventory"
        label="Inventory sections"
        items={items}
        value={value}
        onValueChange={setValue}
      />
      <TabPanel id="inventory" value={value}>
        {value} panel
      </TabPanel>
    </>
  );
}

describe("Tabs", () => {
  it("links the selected tab and panel with one roving tab stop", () => {
    render(<Harness />);

    const stock = screen.getByRole("tab", { name: "Stock" });
    const orders = screen.getByRole("tab", { name: /Orders.*2/ });
    expect(stock.getAttribute("aria-selected")).toBe("true");
    expect(stock.getAttribute("tabindex")).toBe("0");
    expect(orders.getAttribute("tabindex")).toBe("-1");
    expect(stock.getAttribute("aria-controls")).toBe("inventory-panel-stock");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      "inventory-tab-stock",
    );
  });

  it("wraps with arrow keys and skips disabled tabs", () => {
    render(<Harness />);

    const stock = screen.getByRole("tab", { name: "Stock" });
    stock.focus();
    fireEvent.keyDown(stock, { key: "ArrowRight" });

    const orders = screen.getByRole("tab", { name: /Orders.*2/ });
    expect(document.activeElement).toBe(orders);
    expect(orders.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toContain("orders panel");

    fireEvent.keyDown(orders, { key: "ArrowRight" });
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Stock" }),
    );
  });

  it("supports Home and End navigation", () => {
    render(<Harness />);

    const stock = screen.getByRole("tab", { name: "Stock" });
    fireEvent.keyDown(stock, { key: "End" });
    const orders = screen.getByRole("tab", { name: /Orders.*2/ });
    expect(document.activeElement).toBe(orders);

    fireEvent.keyDown(orders, { key: "Home" });
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Stock" }),
    );
  });
});
