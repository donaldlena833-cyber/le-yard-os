// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { useModalDialog } from "@/lib/accessibility/use-modal-dialog";

function TestDialog({ onClose }: { onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useModalDialog({ dialogRef, overlayRef, onClose });

  return (
    <div ref={overlayRef}>
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Test dialog">
        <button data-modal-initial type="button" onClick={onClose}>Close</button>
        <button type="button">Last action</button>
      </section>
    </div>
  );
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <main>
      <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
      {open ? <TestDialog onClose={() => setOpen(false)} /> : null}
    </main>
  );
}

function SharedModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <main>
      <button type="button" onClick={() => setOpen(true)}>Open shared modal</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        labelledBy="shared-modal-title"
        initialFocusSelector="[data-modal-initial]"
      >
        <h2 id="shared-modal-title">Shared modal</h2>
        <button data-modal-initial type="button">First action</button>
      </Modal>
    </main>
  );
}

afterEach(() => cleanup());

describe("modal accessibility contract", () => {
  it("traps focus, closes on Escape, restores the page, and returns focus", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Test dialog" });
    const close = screen.getByRole("button", { name: "Close" });
    const last = screen.getByRole("button", { name: "Last action" });
    await waitFor(() => expect(document.activeElement).toBe(close));
    expect(trigger.inert).toBe(true);
    expect(trigger.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger.inert).toBe(false);
    expect(trigger.hasAttribute("aria-hidden")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(trigger);
  });

  it("gives the shared modal an accessible name and restores trigger focus", async () => {
    render(<SharedModalHarness />);
    const trigger = screen.getByRole("button", { name: "Open shared modal" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Shared modal" })).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "First action" }),
      ),
    );

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
