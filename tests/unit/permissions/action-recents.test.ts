import { describe, expect, it } from "vitest";
import {
  ACTION_RECENTS_LIMIT,
  ACTION_RECENTS_STORAGE_KEY,
  readRecentActionReferences,
  recordRecentAction,
} from "@/lib/actions/action-recents";
import { getActionDefinition } from "@/lib/actions/action-registry";

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    value: () => value,
  };
}

describe("action recents", () => {
  it("stores only a versioned action ID and query-free base path", () => {
    const storage = memoryStorage();
    recordRecentAction(storage, getActionDefinition("find.guests"));

    expect(storage.value()).toBe(
      JSON.stringify({
        version: 1,
        entries: [{ actionId: "find.guests", path: "/guests" }],
      }),
    );
    expect(storage.value()).not.toContain("?");
    expect(ACTION_RECENTS_STORAGE_KEY).toContain(":v1");
  });

  it("deduplicates, caps, and rejects malformed or query-bearing references", () => {
    const storage = memoryStorage();
    const ids = [
      "navigate.today",
      "navigate.schedule",
      "navigate.messages",
      "navigate.tasks",
      "navigate.earnings",
      "navigate.service",
    ] as const;
    for (const id of ids) recordRecentAction(storage, getActionDefinition(id));
    recordRecentAction(storage, getActionDefinition("navigate.messages"));

    const entries = readRecentActionReferences(storage);
    expect(entries).toHaveLength(ACTION_RECENTS_LIMIT);
    expect(entries[0].actionId).toBe("navigate.messages");
    expect(entries.filter((entry) => entry.actionId === "navigate.messages")).toHaveLength(1);

    const unsafe = memoryStorage(
      JSON.stringify({
        version: 1,
        entries: [
          { actionId: "find.guests", path: "/guests?q=Private+Guest" },
          { actionId: "navigate.today", path: "/today" },
        ],
      }),
    );
    expect(readRecentActionReferences(unsafe)).toEqual([
      { actionId: "navigate.today", path: "/today" },
    ]);
  });
});
