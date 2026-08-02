import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

describe("PWA privacy boundary", () => {
  it("never caches an authenticated workspace or API response", async () => {
    const source = await readFile(new URL("../../../public/sw.js", import.meta.url), "utf8");
    const shellMatch = source.match(/const PUBLIC_SHELL = \[([\s\S]*?)\];/);
    expect(shellMatch?.[1]).toBeTruthy();
    expect(shellMatch?.[1]).not.toContain("/today");
    expect(shellMatch?.[1]).not.toContain("/api/");
    expect(source).not.toContain("cache.put(");
    expect(source).not.toContain("cache.add(event.request");
    expect(source).toContain('caches.match("/offline.html")');
  });

  it("keeps the offline fallback compatible with a strict CSP", async () => {
    const source = await readFile(
      new URL("../../../public/offline.html", import.meta.url),
      "utf8",
    );

    expect(source).toContain('href="/offline.css"');
    expect(source).not.toContain("<style");
    expect(source).not.toMatch(/\son[a-z]+=/i);
    expect(source).not.toContain("<script");
  });

  it.each([
    ["/messages?channel=team#latest", "/messages?channel=team#latest"],
    ["https://evil.example/phish", "/today"],
    ["//evil.example/phish", "/today"],
    ["/foo/..//evil.example", "/today"],
    ["/foo/%2e%2e//evil.example", "/today"],
    ["/\\evil.example", "/today"],
    ["/%255cevil.example", "/today"],
  ])("normalizes the push destination %s", async (input, expected) => {
    const source = await readFile(
      new URL("../../../public/sw.js", import.meta.url),
      "utf8",
    );
    const listeners = new Map<string, unknown>();
    const context = createContext({
      URL,
      caches: {},
      self: {
        location: { origin: "https://ops.example" },
        addEventListener: (name: string, listener: unknown) => {
          listeners.set(name, listener);
        },
        skipWaiting: () => undefined,
        clients: {},
        registration: {},
      },
    });
    runInContext(source, context);

    const actual = runInContext(
      `safeNotificationPath(${JSON.stringify(input)})`,
      context,
    );
    expect(actual).toBe(expected);
  });
});
