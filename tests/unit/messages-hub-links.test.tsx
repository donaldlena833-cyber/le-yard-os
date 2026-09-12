// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/components/messages/sms-pilot-status", () => ({ SmsPilotStatus: () => null }));
vi.mock("@/components/messages/communication-groups", () => ({
  CommunicationGroups: ({ group, initialPhone }: { group: string; initialPhone?: string }) => {
    const [phone] = useState(initialPhone);
    return <div data-testid="conversation">{group}:{phone ?? "all"}</div>;
  },
}));

import { MessagesHub } from "@/components/messages/messages-hub";

afterEach(cleanup);

it("selects the linked guest and resets on navigation to another guest on the same page", () => {
  const { rerender } = render(<MessagesHub initialGroup="clients" initialPhone="+12125550123">Channels</MessagesHub>);
  expect(screen.getByTestId("conversation").textContent).toBe("clients:+12125550123");
  rerender(<MessagesHub initialGroup="clients" initialPhone="+12125550124">Channels</MessagesHub>);
  expect(screen.getByTestId("conversation").textContent).toBe("clients:+12125550124");
  rerender(<MessagesHub initialGroup="team" initialPhone="+12125550125">Channels</MessagesHub>);
  expect(screen.getByTestId("conversation").textContent).toBe("team:+12125550125");
});

it("does not open a conversation when the source link is unavailable", () => {
  render(<MessagesHub initialGroup="clients" messageLinkError="This conversation link is unavailable.">Channels</MessagesHub>);
  expect(screen.getByRole("alert").textContent).toContain("unavailable");
  expect(screen.queryByTestId("conversation")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Client conversations" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByTestId("conversation").textContent).toBe("clients:all");
});

it("clears the linked phone when an operator explicitly chooses another group", () => {
  render(<MessagesHub initialGroup="clients" initialPhone="+12125550123">Channels</MessagesHub>);
  fireEvent.click(screen.getByRole("button", { name: "Team requests" }));
  expect(screen.getByTestId("conversation").textContent).toBe("team:all");
  expect(window.location.search).toBe("?group=team");
  fireEvent.click(screen.getByRole("button", { name: "Team channels" }));
  expect(screen.getByText("Channels")).toBeTruthy();
});

it("offers the business contact and explains shared-inbox replies without claiming alerts are enabled", () => {
  render(<MessagesHub initialGroup="clients">Channels</MessagesHub>);
  const contact = screen.getByRole("link", { name: "Save Le Yard Messages contact" });
  expect(contact.getAttribute("href")).toBe("/le-yard-messages.vcf");
  expect(contact.hasAttribute("download")).toBe(true);
  expect(screen.getByText(/When phone alerts are enabled/).textContent).toContain("a manual reply pauses AI");
  expect(screen.getByText(/Replying to the alert text/).textContent).toContain("not to the guest");
});
