import { describe, expect, it } from "vitest";
import { unreadCountForChannel } from "@/data/read-models/message-state";
import {
  addIsoDays,
  isIsoCalendarDate,
  isoDayDistance,
  localDateKey,
  startOfWeekDate,
  zonedLocalToIso,
} from "@/data/read-models/local-time";

describe("restaurant-local scheduling helpers", () => {
  it("derives the configured local week instead of the server timezone", () => {
    const instant = new Date("2026-08-02T02:00:00.000Z");
    expect(localDateKey(instant, "America/New_York")).toBe("2026-08-01");
    expect(startOfWeekDate(instant, "America/New_York", 1)).toBe("2026-07-27");
  });

  it("converts restaurant-local wall time to an ISO instant", () => {
    expect(zonedLocalToIso("2026-08-01", "18:30", "America/New_York")).toBe(
      "2026-08-01T22:30:00.000Z",
    );
  });

  it("rejects a wall time that does not exist during the DST jump", () => {
    expect(zonedLocalToIso("2026-03-08", "02:30", "America/New_York")).toBeNull();
  });

  it("handles calendar-day operations without runtime locale drift", () => {
    expect(isIsoCalendarDate("2026-02-28")).toBe(true);
    expect(isIsoCalendarDate("2026-02-30")).toBe(false);
    expect(addIsoDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(isoDayDistance("2026-12-31", "2027-01-02")).toBe(2);
  });
});

describe("live message unread positions", () => {
  const messages = [
    { id: "a", channel_id: "channel", author_id: "other", created_at: "2026-08-01T12:00:00.000Z" },
    { id: "b", channel_id: "channel", author_id: "me", created_at: "2026-08-01T12:01:00.000Z" },
    { id: "c", channel_id: "channel", author_id: "other", created_at: "2026-08-01T12:02:00.000Z" },
  ].map((message) => ({ ...message, reply_to_id: null, body: "message", is_announcement: false, edited_at: null }));

  it("counts only other authors after the last read record", () => {
    expect(unreadCountForChannel(messages, "me", "a")).toBe(1);
  });

  it("counts all other-author messages when no read receipt exists", () => {
    expect(unreadCountForChannel(messages, "me", null)).toBe(2);
  });

  it("uses message ids as a stable tie breaker for equal timestamps", () => {
    const tied = messages.map((message) => ({ ...message, created_at: messages[0].created_at }));
    expect(unreadCountForChannel(tied, "me", "b")).toBe(1);
  });
});
