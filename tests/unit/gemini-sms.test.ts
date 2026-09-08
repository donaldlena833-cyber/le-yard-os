import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { classifySms } from "@/lib/gemini-sms.server";
const decision = {
  intent: "contact",
  date: null,
  partySize: null,
  time: null,
  summary: "Contact question",
  photoDescription: null,
};
const input = {
  today: "2026-09-08",
  messages: [{ direction: "inbound", body: "How do I contact you?" }],
};
const fetcher = vi.fn();
beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "unit-test-only");
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function result(finishReason = "STOP", text = JSON.stringify(decision)) {
  return {
    candidates: [{ finishReason, content: { parts: [{ text }] } }],
    usageMetadata: {
      promptTokenCount: 1000,
      candidatesTokenCount: 100,
      thoughtsTokenCount: 100,
    },
  };
}
it("uses a fixed model, minimal thinking, a bounded answer, and includes reasoning in cost", async () => {
  fetcher.mockResolvedValue(Response.json(result()));
  expect(await classifySms(input)).toMatchObject({
    decision,
    cost: 550,
    inputTokens: 1000,
    outputTokens: 200,
  });
  const [url, request] = fetcher.mock.calls[0];
  expect(url).toBe(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
  );
  expect(url).not.toContain("unit-test-only");
  expect(JSON.parse(request.body).generationConfig).toMatchObject({
    maxOutputTokens: 512,
    thinkingConfig: { thinkingLevel: "minimal" },
    responseMimeType: "application/json",
  });
});
it.each(["MAX_TOKENS", "SAFETY"])("rejects %s results", async (reason) => {
  fetcher.mockResolvedValue(Response.json(result(reason)));
  await expect(classifySms(input)).rejects.toThrow("gemini_incomplete");
});
it("does not expose provider error bodies or retry paid calls", async () => {
  fetcher.mockResolvedValue(
    Response.json(
      { error: { message: "secret provider details" } },
      { status: 429 },
    ),
  );
  await expect(classifySms(input)).rejects.toThrow("gemini_http_429");
  expect(fetcher).toHaveBeenCalledOnce();
});
it("rejects malformed or over-budget outputs", async () => {
  fetcher.mockResolvedValue(
    Response.json(result("STOP", '{"intent":"send_money"}')),
  );
  await expect(classifySms(input)).rejects.toThrow("gemini_invalid_result");
  const body = result();
  body.usageMetadata.promptTokenCount = 1_000_000;
  fetcher.mockResolvedValue(Response.json(body));
  await expect(classifySms(input)).rejects.toThrow(
    "gemini_usage_exceeded_reservation",
  );
});
it("rejects oversized context before a paid call", async () => {
  await expect(
    classifySms({
      ...input,
      messages: [{ direction: "inbound", body: "x".repeat(18000) }],
    }),
  ).rejects.toThrow("input_too_large");
  expect(fetcher).not.toHaveBeenCalled();
});
