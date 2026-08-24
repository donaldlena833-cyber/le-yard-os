import { afterEach, describe, expect, it, vi } from "vitest";
import { runSub2ApiOwnerIntelligence } from "@/lib/ai/sub2api.server";

const input = {
  question: "Create a high-priority pickup review task",
  locationName: "Le Yard",
  localDate: "2026-08-20",
  evidence: [{
    sourceTable: "owner_request",
    sourceRecordId: "request-1",
    label: "Your instruction",
    excerpt: "Create a high-priority pickup review task",
  }],
};

const output = {
  title: "Pickup review",
  summary: "A task is ready for review.",
  confidence: 0.95,
  citations: [{
    sourceTable: "owner_request",
    sourceRecordId: "request-1",
    label: "Your instruction",
    excerpt: "Create a high-priority pickup review task",
    relevance: 1,
  }],
  proposal: {
    kind: "task.create",
    title: "Review pickup list",
    description: null,
    priority: "high",
    assignedEmployeeId: null,
    dueAt: null,
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Sub2API owner intelligence adapter", () => {
  it("sends a no-tool structured Responses request and validates the result", async () => {
    vi.stubEnv("LE_YARD_SUB2API_BASE_URL", "http://127.0.0.1:8080");
    vi.stubEnv("LE_YARD_SUB2API_API_KEY", "secret-test-key");
    vi.stubEnv("LE_YARD_SUB2API_MODEL", "gpt-5.6-luna");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runSub2ApiOwnerIntelligence(input)).resolves.toEqual(output);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://127.0.0.1:8080/v1/responses");
    expect(request.redirect).toBe("error");
    expect(request.headers).toMatchObject({ authorization: "Bearer secret-test-key" });
    const body = JSON.parse(String(request.body));
    expect(body.stream).toBe(false);
    expect(body.text.format.type).toBe("json_schema");
    expect(body.tools).toBeUndefined();
  });

  it("rejects an unencrypted remote gateway before sending owner data", async () => {
    vi.stubEnv("LE_YARD_SUB2API_BASE_URL", "http://gateway.example.com");
    vi.stubEnv("LE_YARD_SUB2API_API_KEY", "secret-test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(runSub2ApiOwnerIntelligence(input)).rejects.toThrow(/must use HTTPS/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not reflect an upstream response body into errors", async () => {
    vi.stubEnv("LE_YARD_SUB2API_BASE_URL", "https://gateway.example.com");
    vi.stubEnv("LE_YARD_SUB2API_API_KEY", "secret-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream-secret", { status: 401 })));

    await expect(runSub2ApiOwnerIntelligence(input)).rejects.toThrow("status 401");
    await expect(runSub2ApiOwnerIntelligence(input)).rejects.not.toThrow("upstream-secret");
  });
});
