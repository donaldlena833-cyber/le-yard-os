// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Drawer } from "@/components/ui/drawer";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("Drawer", () => {
  it("portals a labelled modal drawer only while open", () => {
    const { rerender } = render(
      <Drawer open={false} onClose={() => undefined} ariaLabel="Details">
        Drawer content
      </Drawer>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(
      <Drawer open onClose={() => undefined} ariaLabel="Details">
        Drawer content
      </Drawer>,
    );
    const dialog = screen.getByRole("dialog", { name: "Details" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Drawer content");
  });

  it("dismisses from Escape and the backdrop, but not panel clicks", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} labelledBy="drawer-title">
        <h2 id="drawer-title">Drawer title</h2>
        <button type="button">Inside</button>
      </Drawer>,
    );

    const dialog = screen.getByRole("dialog", { name: "Drawer title" });
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
