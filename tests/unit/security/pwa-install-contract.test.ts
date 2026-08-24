import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("Home Screen install contract", () => {
  it("keeps the OS inside one explicit standalone app scope", () => {
    expect(manifest()).toMatchObject({
      id: "/",
      start_url: "/today",
      scope: "/",
      display: "standalone",
    });
    expect(manifest()).not.toHaveProperty("display_override");
  });
});
