import { describe, expect, it } from "vitest";

import { normalizeOperationalCapabilities } from "../../../src/lib/permissions/capabilities";

describe("operational capability normalization", () => {
  it("accepts the generated string-array RPC shape", () => {
    expect(
      normalizeOperationalCapabilities([
        "recipe.manage",
        "inventory.item.manage",
      ]),
    ).toEqual(["recipe.manage", "inventory.item.manage"]);
  });

  it("accepts the PostgREST single-column table row shape", () => {
    expect(
      normalizeOperationalCapabilities([
        { capability_key: "recipe.manage" },
        { capability_key: "inventory.vendor.manage" },
      ]),
    ).toEqual(["recipe.manage", "inventory.vendor.manage"]);
  });

  it("drops malformed and unknown capability values", () => {
    expect(
      normalizeOperationalCapabilities([
        null,
        { capability_key: null },
        { capability_key: "security.users.manage" },
        "unknown.capability",
      ]),
    ).toEqual([]);
  });
});
