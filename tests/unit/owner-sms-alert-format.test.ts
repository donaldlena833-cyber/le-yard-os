import { describe, expect, it } from "vitest";
import {
  formatOwnerSmsAlert,
  ownerSmsConversationUrl,
  ownerSmsReplyGuidance,
  ownerSmsSetupMessage,
} from "@/lib/owner-sms-alerts";

const sourceSid = `SM${"a".repeat(32)}`;
const from = "+12125550123";
const input = { sourceSid, from, body: "Can we reserve a table?", mediaCount: 0 };

function forwardedBody(part: string): string {
  return part.slice(part.indexOf("\n\n") + 2, part.lastIndexOf("\n\n"));
}

describe("owner SMS alert formatting", () => {
  it("identifies the guest, preserves the body, and directs replies to the shared inbox", () => {
    const [message] = formatOwnerSmsAlert({ ...input, guestName: "Alex Rivera" });
    expect(message).toContain(`Le Yard Messages\nFrom: Alex Rivera (${from})`);
    expect(forwardedBody(message)).toBe(input.body);
    expect(message).toContain(`Open conversation / reply as Le Yard:\n${ownerSmsConversationUrl(sourceSid)}`);
    expect(message).not.toContain(ownerSmsReplyGuidance());
    expect(message).not.toContain("Part ");
    expect(message).not.toContain("MMS:");
  });

  it("uses the sender alone for an absent or blank guest name", () => {
    for (const guestName of [undefined, " \n\t "]) {
      expect(formatOwnerSmsAlert({ ...input, guestName })[0]).toContain(`From: ${from}\n`);
    }
  });

  it("limits the guest name to 80 UTF-16 units without splitting an emoji", () => {
    const guestName = `${"A".repeat(79)}🪴More`;
    const [message] = formatOwnerSmsAlert({ ...input, guestName });
    expect(message).toContain(`From: ${"A".repeat(79)} (${from})`);
    expect(message).not.toContain("More");
    expect(message.isWellFormed()).toBe(true);
  });

  it("keeps guest identity on one line", () => {
    const [message] = formatOwnerSmsAlert({ ...input, guestName: "  Alex\nRivera\t " });
    expect(message).toContain(`From: Alex Rivera (${from})\n`);
  });

  it.each([
    `${"a".repeat(1149)}🪴${"b".repeat(1400)}`,
    "你好，Le Yard! 🧑🏽‍🍳 cafe\u0301\n\n  ".repeat(150),
    `${"🙂".repeat(1000)}\n\nReplying to this text\n\n${"x".repeat(1200)}  `,
  ])("preserves every body unit across Unicode-safe parts", (body) => {
    const parts = formatOwnerSmsAlert({ ...input, body });
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map(forwardedBody).join("")).toBe(body);
    parts.forEach((part, index) => {
      expect(part).toContain(`Le Yard Messages\nPart ${index + 1}/${parts.length}\n`);
      expect(part).toContain(`Open conversation / reply as Le Yard:\n${ownerSmsConversationUrl(sourceSid)}`);
      expect(part.length).toBeLessThanOrEqual(1600);
      expect(forwardedBody(part).length).toBeLessThanOrEqual(1150);
      expect(part.isWellFormed()).toBe(true);
    });
  });

  it("keeps all wrappers within 1600 units at the longest valid identity and count", () => {
    const body = "🪴".repeat(8000);
    const parts = formatOwnerSmsAlert({
      ...input,
      from: "A".repeat(40),
      guestName: "🧑".repeat(40),
      mediaCount: Number.MAX_SAFE_INTEGER,
      body,
    });
    expect(parts.length).toBeGreaterThanOrEqual(10);
    expect(parts.length).toBeLessThanOrEqual(16);
    expect(parts.map(forwardedBody).join("")).toBe(body);
    expect(parts.every((part) => part.length <= 1600)).toBe(true);
  });

  it.each([1, 3])("includes the MMS attachment count and inbox viewing instruction", (mediaCount) => {
    const sid = `MM${"b".repeat(32)}`;
    const [message] = formatOwnerSmsAlert({ ...input, sourceSid: sid, body: "", mediaCount });
    expect(message).toContain(`MMS: ${mediaCount} attachment${mediaCount === 1 ? "" : "s"}.`);
    expect(message).toContain("Open the shared inbox link to view.");
    expect(message).toContain(ownerSmsConversationUrl(sid));
    expect(forwardedBody(message)).toBe("");
  });

  it("accepts 16 payload parts and rejects excess content without truncating", () => {
    const body = "x".repeat(1150 * 16);
    const parts = formatOwnerSmsAlert({ ...input, body });
    expect(parts).toHaveLength(16);
    expect(parts.map(forwardedBody).join("")).toBe(body);
    expect(() => formatOwnerSmsAlert({ ...input, body: `${body}x` })).toThrow("16-part limit");
  });

  it("rejects a seventeenth part when preserving a surrogate pair reduces capacity", () => {
    const body = `x${"🙂".repeat(9199)}x`;
    expect(body.length).toBe(1150 * 16);
    expect(() => formatOwnerSmsAlert({ ...input, body })).toThrow("16-part limit");
  });

  it.each(["", "SMinvalid", `SM${"g".repeat(32)}`, `${sourceSid}&phone=${from}`, ` ${sourceSid}`, `CA${"a".repeat(32)}`])(
    "rejects invalid message SIDs",
    (sid) => {
      expect(() => ownerSmsConversationUrl(sid)).toThrow("valid source message SID");
      expect(() => formatOwnerSmsAlert({ ...input, sourceSid: sid })).toThrow("valid source message SID");
    },
  );

  it.each(["", " \t\n ", "+", "A".repeat(41), "sender?phone=123", "https://example.test", "sender\u0000label"])(
    "rejects an empty, unsafe, or overlong sender label",
    (sender) => {
      expect(() => formatOwnerSmsAlert({ ...input, from: sender })).toThrow("valid sender label");
    },
  );

  it.each(["12345", "LeYard", "Le-Yard", "ACME_1", "Provider Inc.", from])(
    "preserves numeric and alphanumeric sender labels without inventing phone numbers",
    (sender) => {
      const [message] = formatOwnerSmsAlert({ ...input, from: sender });
      expect(message).toContain(`From: ${sender}\n`);
      expect(forwardedBody(message)).toBe(input.body);
      expect(message).toContain(ownerSmsConversationUrl(sourceSid));
    },
  );

  it("normalizes control whitespace in a sender label to a single line", () => {
    const [message] = formatOwnerSmsAlert({ ...input, from: " \tACME\n Alerts\r " });
    expect(message).toContain("From: ACME Alerts\n");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid attachment count",
    (mediaCount) => {
      expect(() => formatOwnerSmsAlert({ ...input, mediaCount })).toThrow("attachment count");
    },
  );
});

it("allows both source SID prefixes and case without including a phone in the link", () => {
  for (const sid of [sourceSid, `MM${"B".repeat(32)}`, `sm${"C".repeat(32)}`]) {
    expect(ownerSmsConversationUrl(sid)).toBe(`https://phone.leyardny.com/messages?message=${sid}`);
  }
});

it("clearly explains native replies and human takeover", () => {
  expect(ownerSmsReplyGuidance()).toContain("Replying to this text sends to Le Yard, not the guest.");
  expect(ownerSmsReplyGuidance()).toContain("Open the shared inbox to reply to the guest");
  expect(ownerSmsReplyGuidance()).toContain("https://phone.leyardny.com/messages");
  expect(ownerSmsReplyGuidance()).toContain("a manual reply pauses AI for that conversation");
});

it("labels setup as a test and links the business inbox and contact without personal numbers", () => {
  const message = ownerSmsSetupMessage();
  expect(message).toContain("Le Yard Messages");
  expect(message).toContain("Setup/test message for owner phone alerts. This is not a guest message.");
  expect(message).toContain("Shared inbox: https://phone.leyardny.com/messages");
  expect(message).toContain("Save the Le Yard Messages business contact: https://phone.leyardny.com/le-yard-messages.vcf");
  expect(message).toContain(ownerSmsReplyGuidance());
  expect(message).not.toMatch(/\+\d{8,15}/);
  expect(message.length).toBeLessThanOrEqual(1600);
});
