import { describe, expect, it } from "vitest";
import { throwDatabaseError } from "@/data/errors";

describe("stale workflow responses", () => {
  it.each(["PT409", "40001"])("keeps %s recognizable as a stale record", (code) => {
    expect(() => throwDatabaseError({ code, message: "Changed" })).toThrow(
      expect.objectContaining({ code: "stale" }),
    );
  });

  it("keeps a constraint conflict distinct", () => {
    expect(() => throwDatabaseError({ code: "23514", message: "Invalid state" })).toThrow(
      expect.objectContaining({ code: "conflict", message: "Invalid state" }),
    );
  });

  it("does not present a gateway timeout as a confirmed stale refusal", () => {
    expect(() => throwDatabaseError({ message: "The upstream server is timing out" })).toThrow(
      expect.objectContaining({ code: "database" }),
    );
  });
});
