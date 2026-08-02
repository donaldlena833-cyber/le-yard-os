import { expect, test } from "@playwright/test";

test("serves a nonce-bearing policy without blocking the app shell", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /content security policy|refused to (?:load|execute|apply|connect)/i.test(
        message.text(),
      )
    ) {
      violations.push(message.text());
    }
  });

  const response = await page.goto("/today");
  expect(response).not.toBeNull();

  const policy = await response!.headerValue("content-security-policy");
  expect(policy).toContain("default-src 'self'");
  expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=_-]+'/);
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toContain("script-src-attr 'none'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");

  const secondResponse = await page.request.get("/today");
  const secondPolicy = secondResponse.headers()["content-security-policy"];
  expect(secondPolicy).toMatch(/'nonce-[A-Za-z0-9+/=_-]+'/);
  expect(secondPolicy).not.toBe(policy);

  await expect(
    page.getByRole("heading", { name: "Good afternoon, Donald." }),
  ).toBeVisible();
  expect(violations).toEqual([]);
});
