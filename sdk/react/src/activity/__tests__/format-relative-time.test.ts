import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "../format-relative-time";

// The recents rows' "why is this here" stamp: compact single-unit ages,
// then short dates. See format-relative-time.ts for the design rationale.

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-18T12:00:00Z");

  it("renders sub-minute ages as 'now'", () => {
    expect(formatRelativeTime(new Date("2026-07-18T11:59:30Z"), now)).toBe("now");
  });

  it("clamps future stamps (writer clock skew) to 'now'", () => {
    expect(formatRelativeTime(new Date("2026-07-18T12:00:45Z"), now)).toBe("now");
  });

  it("renders minutes under an hour", () => {
    expect(formatRelativeTime(new Date("2026-07-18T11:15:00Z"), now)).toBe("45m");
  });

  it("renders hours under a day", () => {
    expect(formatRelativeTime(new Date("2026-07-18T04:30:00Z"), now)).toBe("7h");
  });

  it("renders days under a week", () => {
    expect(formatRelativeTime(new Date("2026-07-15T12:00:00Z"), now)).toBe("3d");
  });

  it("renders a short date beyond a week, same year", () => {
    const result = formatRelativeTime(new Date("2026-06-01T12:00:00Z"), now);
    expect(result).toMatch(/Jun/);
    expect(result).not.toMatch(/2026/);
  });

  it("includes the year for prior-year dates", () => {
    const result = formatRelativeTime(new Date("2025-06-01T12:00:00Z"), now);
    expect(result).toMatch(/2025/);
  });
});
