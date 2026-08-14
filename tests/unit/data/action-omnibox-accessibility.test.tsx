// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionOmnibox } from "@/components/shell/action-omnibox";
import { ACTION_RECENTS_STORAGE_KEY } from "@/lib/actions/action-recents";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const storedValues = new Map<string, string>();
const localStorageDouble: Storage = {
  get length() {
    return storedValues.size;
  },
  clear: () => storedValues.clear(),
  getItem: (key) => storedValues.get(key) ?? null,
  key: (index) => [...storedValues.keys()][index] ?? null,
  removeItem: (key) => {
    storedValues.delete(key);
  },
  setItem: (key, value) => {
    storedValues.set(key, value);
  },
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
}));

const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId: "10000000-0000-4000-8000-000000000001",
    displayName: "Owner User",
    email: "owner@example.invalid",
    aal: "aal2",
  },
  organization: {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Le Yard",
  },
  activeLocation: {
    id: "30000000-0000-4000-8000-000000000001",
    organizationId: "20000000-0000-4000-8000-000000000001",
    name: "Dining Room",
    isPrimary: true,
  },
  locations: [],
  availableWorkspaces: [],
  membershipId: "40000000-0000-4000-8000-000000000001",
  role: "owner",
  organizationWide: true,
  capabilities: [],
};

beforeEach(() => {
  navigation.push.mockReset();
  localStorageDouble.clear();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorageDouble,
  });
});

afterEach(() => cleanup());

describe("action omnibox accessibility and privacy", () => {
  it("groups authorized actions, supports active-descendant keys, and stores no search text", async () => {
    const onClose = vi.fn();
    render(
      <ActionOmnibox
        open
        onClose={onClose}
        pathname="/today"
        workspace={workspace}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Actions" })).toBeTruthy();
    for (const group of ["Navigate", "Create", "Find", "Recent", "Contextual"]) {
      expect(screen.getByRole("group", { name: group })).toBeTruthy();
    }

    const input = screen.getByRole("combobox", { name: "Search authorized actions" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.getAttribute("aria-controls")).toBe("action-omnibox-results");
    const firstActiveId = input.getAttribute("aria-activedescendant");
    expect(firstActiveId).toBeTruthy();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).not.toBe(firstActiveId);
    fireEvent.keyDown(input, { key: "Home" });
    expect(input.getAttribute("aria-activedescendant")).toBe(firstActiveId);

    for (const option of screen.getAllByRole("option")) {
      expect(option.className).toContain("min-h-11");
      expect(option.getAttribute("tabindex")).toBe("-1");
    }
    expect(screen.getByRole("button", { name: "Close action menu" }).className).toContain(
      "size-11",
    );

    fireEvent.change(input, { target: { value: "Alice Example" } });
    fireEvent.click(
      screen.getByRole("option", { name: /Find guests for “Alice Example”/i }),
    );

    expect(navigation.push).toHaveBeenCalledWith("/guests?q=Alice+Example");
    expect(onClose).toHaveBeenCalledOnce();
    const stored = window.localStorage.getItem(ACTION_RECENTS_STORAGE_KEY);
    expect(stored).toContain('"actionId":"find.guests"');
    expect(stored).toContain('"path":"/guests"');
    expect(stored).not.toContain("Alice");
    expect(stored).not.toContain("?");
  });
});
