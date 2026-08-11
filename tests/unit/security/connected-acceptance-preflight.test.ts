import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTED_ACCEPTANCE_PROTOCOL,
  CONNECTED_ACCEPTANCE_ATTESTATION_SCHEMA_VERSION,
  signConnectedAcceptanceProof,
} from "@/lib/security/connected-acceptance-attestation";
import {
  connectedAcceptanceRoles,
  credentialVariableNames,
  runConnectedPreflight,
  validateConnectedConfigTarget,
} from "../../connected/attestation-preflight";

const targetId = "11111111-1111-4111-8111-111111111111";
const fixtureId = "22222222-2222-4222-8222-222222222222";
const deploymentCommit = "b".repeat(40);
const secret = "preflight-attestation-secret-".repeat(2);
const origin = "https://le-yard-os-git-fixture-example.vercel.app";

function releaseEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    E2E_CONNECTED_MODE: "release-acceptance",
    E2E_CONNECTED_APP_URL: origin,
    E2E_CONNECTED_ENVIRONMENT: "nonproduction_preview",
    E2E_CONNECTED_ATTESTATION_SECRET: secret,
    E2E_CONNECTED_TARGET_ID: targetId,
    E2E_CONNECTED_EXPECTED_DEPLOYMENT_COMMIT: deploymentCommit,
    E2E_CONNECTED_EXPECTED_SCHEMA_VERSION:
      CONNECTED_ACCEPTANCE_ATTESTATION_SCHEMA_VERSION,
    E2E_CONNECTED_FIXTURE_ID: fixtureId,
    E2E_CONNECTED_FIXTURE_REVISION: "role-matrix-v1",
    E2E_CONNECTED_EXPECTED_ORGANIZATION_NAME: "Synthetic Le Yard Acceptance",
    E2E_CONNECTED_EXPECTED_LOCATION_NAME: "Fixture Dining Room",
  };
  for (const role of connectedAcceptanceRoles) {
    const [email, password] = credentialVariableNames(role);
    environment[email] = `${role.toLowerCase()}@acceptance.invalid`;
    environment[password] = `synthetic-${role}-password`;
  }
  return environment;
}

function successfulFetch() {
  return vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      nonce: string;
      targetId: string;
      expectedDeploymentCommit: string;
      expectedSchemaVersion: string;
      fixtureId: string;
      fixtureRevision: string;
    };
    const unsigned = {
      protocol: CONNECTED_ACCEPTANCE_PROTOCOL,
      nonce: body.nonce,
      targetId: body.targetId,
      deploymentCommit: body.expectedDeploymentCommit,
      schemaVersion: body.expectedSchemaVersion,
      fixtureId: body.fixtureId,
      fixtureRevision: body.fixtureRevision,
      issuedAt: new Date().toISOString(),
    } as const;
    return Response.json(
      {
        ...unsigned,
        signature: signConnectedAcceptanceProof(unsigned, secret),
      },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("connected release preflight", () => {
  it("verifies the exact signed deployment/database proof before reading role credentials", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const source = releaseEnvironment();
    const credentialReads: string[] = [];
    const environment = new Proxy(source, {
      get(target, property, receiver) {
        if (
          typeof property === "string" &&
          (property.endsWith("_EMAIL") || property.endsWith("_PASSWORD"))
        )
          credentialReads.push(property);
        return Reflect.get(target, property, receiver);
      },
    });
    const fetchImplementation = successfulFetch();

    await runConnectedPreflight(
      environment,
      fetchImplementation as unknown as typeof fetch,
    );

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(credentialReads.length).toBeGreaterThan(0);
    expect(environment.E2E_CONNECTED_PREFLIGHT_COMPLETE).toMatch(/^release:/);
  });

  it("does not read any role credential when remote attestation fails", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const source = releaseEnvironment();
    const credentialReads: string[] = [];
    const environment = new Proxy(source, {
      get(target, property, receiver) {
        if (
          typeof property === "string" &&
          (property.endsWith("_EMAIL") || property.endsWith("_PASSWORD"))
        )
          credentialReads.push(property);
        return Reflect.get(target, property, receiver);
      },
    });

    await expect(
      runConnectedPreflight(
        environment,
        vi.fn(async () =>
          Response.json(
            { error: "Not found" },
            { status: 404, headers: { "cache-control": "no-store" } },
          ),
        ) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/before any user credential was read/i);
    expect(credentialReads).toEqual([]);
  });

  it("rejects a non-matching HMAC before reading role credentials", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const source = releaseEnvironment();
    const credentialReads: string[] = [];
    const environment = new Proxy(source, {
      get(target, property, receiver) {
        if (
          typeof property === "string" &&
          (property.endsWith("_EMAIL") || property.endsWith("_PASSWORD"))
        )
          credentialReads.push(property);
        return Reflect.get(target, property, receiver);
      },
    });
    const validFetch = successfulFetch();
    const tamperedFetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const response = await validFetch(input, init);
      const proof = (await response.json()) as Record<string, unknown>;
      return Response.json(
        { ...proof, signature: "0".repeat(64) },
        { headers: { "cache-control": "no-store" } },
      );
    });

    await expect(
      runConnectedPreflight(
        environment,
        tamperedFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/invalid or stale proof/i);
    expect(credentialReads).toEqual([]);
  });

  it("fails release acceptance instead of skipping an incomplete role matrix", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const environment = releaseEnvironment();
    delete environment.E2E_CONNECTED_CROSS_LOCATION_PASSWORD;

    await expect(
      runConnectedPreflight(
        environment,
        successfulFetch() as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/E2E_CONNECTED_CROSS_LOCATION_PASSWORD/);
    expect(environment.E2E_CONNECTED_PREFLIGHT_COMPLETE).toBeUndefined();
  });

  it("rejects production and local targets in release mode", () => {
    expect(() =>
      validateConnectedConfigTarget({
        NODE_ENV: "test",
        E2E_CONNECTED_MODE: "release-acceptance",
        E2E_CONNECTED_APP_URL: "https://le-yard-os.vercel.app",
        E2E_CONNECTED_ENVIRONMENT: "nonproduction_preview",
      }),
    ).toThrow(/production targets/i);
    expect(() =>
      validateConnectedConfigTarget({
        NODE_ENV: "test",
        E2E_CONNECTED_MODE: "release-acceptance",
        E2E_CONNECTED_APP_URL: "http://127.0.0.1:3000",
        E2E_CONNECTED_ENVIRONMENT: "nonproduction_preview",
      }),
    ).toThrow(/https/i);
  });

  it("allows developer smoke only on loopback and labels it as non-acceptance", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      E2E_CONNECTED_MODE: "developer-smoke",
      E2E_CONNECTED_APP_URL: "http://127.0.0.1:3000",
    };
    const fetchImplementation = vi.fn();

    await runConnectedPreflight(
      environment,
      fetchImplementation as unknown as typeof fetch,
    );

    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(environment.E2E_CONNECTED_PREFLIGHT_COMPLETE).toContain(
      "developer-smoke",
    );
    expect(write).toHaveBeenCalledWith(expect.stringMatching(/not release acceptance/i));
    expect(() =>
      validateConnectedConfigTarget({
        NODE_ENV: "test",
        E2E_CONNECTED_MODE: "developer-smoke",
        E2E_CONNECTED_APP_URL: origin,
      }),
    ).toThrow(/loopback/i);
  });
});
