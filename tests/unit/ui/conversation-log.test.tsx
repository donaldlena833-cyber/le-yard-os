// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ConversationLog } from "@/components/ui/conversation-log";

afterEach(cleanup);

describe("ConversationLog", () => {
  it("renders source-ordered entries as a labelled semantic list", () => {
    render(
      <ConversationLog
        label="Hospitality notes"
        empty="No notes"
        entries={[
          {
            id: "note-1",
            summary: "Alex Manager",
            context: "Dining room · sensitive",
            body: "Guest requested the corner table.\nConfirm on arrival.",
            timestamp: {
              dateTime: "2026-08-10T22:30:00.000Z",
              label: "6:30 PM",
            },
          },
        ]}
      />,
    );

    const log = screen.getByRole("list", { name: "Hospitality notes" });
    expect(log.querySelectorAll("li")).toHaveLength(1);
    expect(log.textContent).toContain("Confirm on arrival");
    expect(log.querySelector("time")?.getAttribute("datetime")).toBe(
      "2026-08-10T22:30:00.000Z",
    );
  });

  it("announces a truthful empty state without an empty list", () => {
    render(
      <ConversationLog
        label="Manager handoffs"
        entries={[]}
        empty="No unresolved handoffs."
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "No unresolved handoffs.",
    );
    expect(screen.queryByRole("list")).toBeNull();
  });
});
