/**
 * The site's two date helpers print the calendar day they are given, in
 * every reader's zone. Each date they take is a day ("2026-10-31"), not an
 * instant, so a reader west of UTC must not see the day before, and a page
 * that renders one at build and again on hydration must print it the same.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatDate, formatShortDate } from "../utils";

describe("the site's date helpers", () => {
  let zone: string | undefined;

  beforeEach(() => {
    zone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
  });

  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it("print the day they are given for a reader west of UTC", () => {
    expect(new Date("2026-10-31").getDate()).toBe(30);
    expect(formatDate("2026-10-31")).toBe("October 31, 2026");
    expect(formatShortDate("2026-10-31")).toBe("Oct 31, 2026");
  });

  it("print the first of a month as the first, not the month before's last day", () => {
    expect(formatDate("2026-11-01")).toBe("November 1, 2026");
  });
});
