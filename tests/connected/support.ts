import { expect, type Page, type Route } from "@playwright/test";
import {
  connectedTestMode,
  credentialVariableNames,
  type AcceptanceRole,
} from "./attestation-preflight";

export { credentialVariableNames, type AcceptanceRole };

const readOnlyMethods = new Set(["GET", "HEAD", "OPTIONS"]);

function requiredValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assertConnectedPreflight() {
  const proof = process.env.E2E_CONNECTED_PREFLIGHT_COMPLETE ?? "";
  const expectedPrefix =
    connectedTestMode() === "release-acceptance"
      ? "release:"
      : "developer-smoke:";
  if (!proof.startsWith(expectedPrefix))
    throw new Error(
      "Connected tests cannot read fixture values before their named global preflight completes.",
    );
}

export function missingEnvironment(names: readonly string[]): string[] {
  return names.filter((name) => !process.env[name]?.trim());
}

function credentials(role: AcceptanceRole | "Employee") {
  assertConnectedPreflight();
  const [emailName, passwordName] = credentialVariableNames(role);
  return {
    email: requiredValue(emailName),
    password: requiredValue(passwordName),
  };
}

export function connectedFixture() {
  assertConnectedPreflight();
  return {
    organizationName: requiredValue("E2E_CONNECTED_EXPECTED_ORGANIZATION_NAME"),
    locationName: requiredValue("E2E_CONNECTED_EXPECTED_LOCATION_NAME"),
  };
}

export async function signIn(
  page: Page,
  role: AcceptanceRole | "Employee",
): Promise<void> {
  const identity = credentials(role);
  await page.goto("/sign-in?next=/today");
  await expect(
    page.getByText("Private, tenant-scoped operator access", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Work email").fill(identity.email);
  await page.getByLabel("Password", { exact: false }).fill(identity.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  try {
    await expect(page).toHaveURL(/\/today(?:\?|$)/);
  } catch (error) {
    const alerts = await page.getByRole("alert").allTextContents();
    const detail = alerts.map((alert) => alert.trim()).filter(Boolean).join(" | ");
    throw new Error(
      `${role} connected sign-in did not reach /today${detail ? `: ${detail}` : "."}`,
      { cause: error },
    );
  }
}

export async function expectConnectedShell(
  page: Page,
  fixture: ReturnType<typeof connectedFixture>,
): Promise<void> {
  await expect(
    page.getByText(`${fixture.locationName} · ${fixture.organizationName}`, {
      exact: true,
    }).first(),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Synthetic Saturday service preview");
  await expect(page.locator("body")).not.toContainText("Connected data boundary");
}

function safeRequestLabel(route: Route): string {
  const request = route.request();
  const url = new URL(request.url());
  return `${request.method().toUpperCase()} ${url.origin}${url.pathname}`;
}

/**
 * Installed only after authentication. It blocks every non-read HTTP request so
 * a readiness check cannot accidentally submit a Server Action or write through
 * a browser-side Supabase client.
 */
export async function installReadOnlyRequestFirewall(page: Page) {
  const blockedRequests: string[] = [];
  const handler = async (route: Route) => {
    if (readOnlyMethods.has(route.request().method().toUpperCase())) {
      await route.continue();
      return;
    }
    blockedRequests.push(safeRequestLabel(route));
    await route.abort("blockedbyclient");
  };

  await page.route("**/*", handler);
  return {
    blockedRequests,
    async dispose() {
      await page.unroute("**/*", handler);
    },
  };
}

export function mutationFixture() {
  if (process.env.E2E_CONNECTED_ENABLE_MUTATIONS !== "true") {
    throw new Error("E2E_CONNECTED_ENABLE_MUTATIONS must equal true.");
  }
  if (process.env.E2E_CONNECTED_ENVIRONMENT !== "nonproduction_preview") {
    throw new Error(
      "E2E_CONNECTED_ENVIRONMENT must equal nonproduction_preview before connected writes are allowed.",
    );
  }

  const appUrl = new URL(requiredValue("E2E_CONNECTED_APP_URL"));
  const confirmedHost = requiredValue("E2E_CONNECTED_MUTATION_HOST").toLowerCase();
  if (appUrl.hostname.toLowerCase() !== confirmedHost) {
    throw new Error(
      "E2E_CONNECTED_MUTATION_HOST must exactly match the connected app hostname.",
    );
  }

  const runId = requiredValue("E2E_CONNECTED_RUN_ID");
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(runId)) {
    throw new Error(
      "E2E_CONNECTED_RUN_ID must be 1-80 letters, numbers, dots, underscores, or hyphens.",
    );
  }

  return {
    ...connectedFixture(),
    channelName: requiredValue("E2E_CONNECTED_CHAT_CHANNEL_NAME"),
    runId,
  };
}
