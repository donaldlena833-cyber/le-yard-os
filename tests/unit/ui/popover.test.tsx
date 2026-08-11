// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Popover } from "@/components/ui/popover";

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Popover
        open={open}
        onOpenChange={setOpen}
        label="Actions"
        triggerLabel="Open actions"
        trigger="Open actions"
      >
        <button type="button">Context action</button>
      </Popover>
      <button type="button">Outside</button>
    </div>
  );
}

describe("Popover", () => {
  it("links its trigger to a non-modal dialog", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open actions" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Actions" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(dialog.id);
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBeNull();
  });

  it("dismisses with Escape and returns focus to the trigger", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open actions" });
    fireEvent.click(trigger);
    screen.getByRole("button", { name: "Context action" }).focus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Actions" })).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses when pointer interaction moves outside", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open actions" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Actions" })).toBeNull(),
    );
  });
});
