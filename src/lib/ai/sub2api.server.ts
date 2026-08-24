import "server-only";

import { z } from "zod";
import {
  buildOwnerIntelligencePrompt,
  type OwnerIntelligenceProviderInput,
} from "@/lib/ai/codex-subscription.server";
import {
  ownerIntelligenceJsonSchema,
  ownerIntelligenceOutputSchema,
  type OwnerIntelligenceOutput,
} from "@/lib/ai/intelligence-contract";

const responseEnvelopeSchema = z.object({
  output_text: z.string().optional(),
  output: z.array(z.object({
    type: z.string().optional(),
    content: z.array(z.object({
      type: z.string().optional(),
      text: z.string().optional(),
    }).passthrough()).optional(),
  }).passthrough()).optional(),
}).passthrough();

const maximumResponseBytes = 1_000_000;

function resolveSub2ApiUrl() {
  const raw = process.env.LE_YARD_SUB2API_BASE_URL?.trim();
  if (!raw) throw new Error("The Sub2API base URL is not configured.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The Sub2API base URL is invalid.");
  }
  const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("Sub2API must use HTTPS unless it is bound to this machine's loopback interface.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("The Sub2API base URL must not contain credentials, a query, or a fragment.");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/responses`;
  return url;
}

function extractOutputText(value: z.infer<typeof responseEnvelopeSchema>) {
  if (value.output_text?.trim()) return value.output_text;
  const parts = value.output
    ?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text) ?? [];
  if (!parts.length) throw new Error("Sub2API returned no owner-intelligence output.");
  return parts.join("");
}

export function sub2ApiOwnerIntelligenceEnabled() {
  return Boolean(
    process.env.LE_YARD_SUB2API_BASE_URL?.trim()
    && process.env.LE_YARD_SUB2API_API_KEY?.trim(),
  );
}

export function sub2ApiOwnerIntelligenceModel() {
  return process.env.LE_YARD_SUB2API_MODEL?.trim() || "gpt-5.6-luna";
}

export async function runSub2ApiOwnerIntelligence(
  input: OwnerIntelligenceProviderInput,
): Promise<OwnerIntelligenceOutput> {
  const apiKey = process.env.LE_YARD_SUB2API_API_KEY?.trim();
  if (!apiKey) throw new Error("The Sub2API API key is not configured.");

  const response = await fetch(resolveSub2ApiUrl(), {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: sub2ApiOwnerIntelligenceModel(),
      input: buildOwnerIntelligencePrompt(input),
      stream: false,
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: "owner_intelligence",
          strict: true,
          schema: ownerIntelligenceJsonSchema,
        },
      },
    }),
  });

  const responseText = await response.text();
  if (responseText.length > maximumResponseBytes) {
    throw new Error("Sub2API returned an oversized response.");
  }
  if (!response.ok) {
    throw new Error(`Sub2API request failed with status ${response.status}.`);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(responseText);
  } catch {
    throw new Error("Sub2API returned invalid JSON.");
  }
  const envelope = responseEnvelopeSchema.parse(decoded);
  let structured: unknown;
  try {
    structured = JSON.parse(extractOutputText(envelope));
  } catch {
    throw new Error("Sub2API returned invalid structured owner intelligence.");
  }
  return ownerIntelligenceOutputSchema.parse(structured);
}
