import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatPopupRelativeTime } from "../src/popupRelativeTime.js";

describe("formatPopupRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T02:00:00.000Z"));
  });

  it("formats invalid, future, and near-current timestamps as just now", () => {
    expect(formatPopupRelativeTime("invalid")).toBe("just now");
    expect(formatPopupRelativeTime("2026-07-21T02:00:01.000Z")).toBe("just now");
    expect(formatPopupRelativeTime("2026-07-21T01:59:57.000Z")).toBe("just now");
  });

  it("formats seconds, minutes, and hours for popup surfaces", () => {
    expect(formatPopupRelativeTime("2026-07-21T01:59:50.000Z")).toBe("10s ago");
    expect(formatPopupRelativeTime("2026-07-21T01:45:00.000Z")).toBe("15m ago");
    expect(formatPopupRelativeTime("2026-07-21T00:00:00.000Z")).toBe("2h ago");
  });

  it("can preserve minute-only queue progress copy", () => {
    expect(formatPopupRelativeTime("2026-07-21T00:00:00.000Z", { maxUnit: "minutes" })).toBe("120m ago");
  });
});
