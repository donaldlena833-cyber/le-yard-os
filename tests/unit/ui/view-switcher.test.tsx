// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ViewSwitcher } from "@/components/ui/view-switcher";

afterEach(cleanup);

describe("ViewSwitcher", () => {
  const items = [
    { id: "book", label: "Book", badge: 8, controls: "book-region" },
    { id: "floor", label: "Floor", badge: 17, controls: "floor-region" },
    { id: "service", label: "Service", badge: 2, controls: "service-region" },
  ] as const;

  it("exposes one pressed view and its controlled region", () => {
    render(
      <ViewSwitcher
        items={items}
        value="book"
        onValueChange={() => undefined}
        label="Reservation workspace view"
      />,
    );

    const book = screen.getByRole("button", { name: /Book.*8/ });
    expect(book.getAttribute("aria-pressed")).toBe("true");
    expect(book.getAttribute("aria-controls")).toBe("book-region");
    expect(
      screen
        .getByRole("button", { name: /Floor.*17/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("activates adjacent and boundary views with one keyboard action", () => {
    const onValueChange = vi.fn();
    render(
      <ViewSwitcher
        items={items}
        value="book"
        onValueChange={onValueChange}
        label="Reservation workspace view"
      />,
    );

    const book = screen.getByRole("button", { name: /Book.*8/ });
    book.focus();
    fireEvent.keyDown(book, { key: "ArrowRight" });
    expect(onValueChange).toHaveBeenLastCalledWith("floor");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Floor.*17/ }),
    );

    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(onValueChange).toHaveBeenLastCalledWith("service");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Service.*2/ }),
    );
  });
});
