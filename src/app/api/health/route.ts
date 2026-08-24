import { NextResponse } from "next/server";
import { getServerRuntimeConfiguration } from "@/lib/env.server";
import { buildHealthState } from "@/lib/security/health";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  matchesRuntimeSchemaContract,
  type RuntimeSchemaContract,
} from "@/lib/security/schema-contract";
import { runtimeHealthFingerprints } from "@/lib/security/runtime-fingerprints.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SchemaContractPayload = Partial<RuntimeSchemaContract>;

async function loadSchemaContract() {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("schema contract timeout")), 2_000);
  });

  try {
    const request = createAdminClient().rpc("service_runtime_schema_contract");
    const result = await Promise.race([request, timeout]);
    if (result.error || !result.data || typeof result.data !== "object") {
      return null;
    }
    return result.data as SchemaContractPayload;
  } catch {
    return null;
  }
}

export async function GET() {
  const runtime = getServerRuntimeConfiguration();
  const schemaContract =
    runtime.mode === "demo" ? null : await loadSchemaContract();
  const ready =
    runtime.ready &&
    (runtime.mode === "demo"
      ? runtime.playground
      : matchesRuntimeSchemaContract(schemaContract));
  const health = buildHealthState(ready, new Date().toISOString());
  const fingerprints = runtimeHealthFingerprints({
    runtime,
    schemaFingerprint: schemaContract?.schemaFingerprint ?? null,
  });

  return NextResponse.json(health.body, {
    status: health.statusCode,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "X-Le-Yard-Config-Fingerprint": fingerprints.configuration,
      "X-Le-Yard-Release-Fingerprint": fingerprints.release,
      ...(fingerprints.schema
        ? { "X-Le-Yard-Schema-Fingerprint": fingerprints.schema }
        : {}),
    },
  });
}
