import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ScheduleSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/spec_pb";
import { ScheduleStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/status_pb";
import { deriveScheduleState, formatNextFire } from "../scheduleState";

const enabledSpec = create(ScheduleSpecSchema, {
  cron: "0 9 * * *",
  timeZone: "Asia/Kolkata",
  enabled: true,
});
const disabledSpec = create(ScheduleSpecSchema, {
  cron: "0 9 * * *",
  timeZone: "Asia/Kolkata",
  enabled: false,
});
const pausedStatus = create(ScheduleStatusSchema, {
  pausedReason: "5 consecutive failures",
  consecutiveFailures: 5,
});
const healthyStatus = create(ScheduleStatusSchema, {});

describe("deriveScheduleState", () => {
  // Every lever combination — the two levers must never collapse.
  const cases = [
    {
      name: "enabled + not paused → active",
      spec: enabledSpec,
      status: healthyStatus,
      state: "active",
      phase: "ready",
      label: "Active",
      isPaused: false,
    },
    {
      name: "enabled + paused → paused (platform latch)",
      spec: enabledSpec,
      status: pausedStatus,
      state: "paused",
      phase: "degraded",
      label: "Paused",
      isPaused: true,
    },
    {
      name: "disabled + not paused → disabled (owner switch)",
      spec: disabledSpec,
      status: healthyStatus,
      state: "disabled",
      phase: "disabled",
      label: "Disabled",
      isPaused: false,
    },
    {
      name: "disabled + paused → disabled wins, pause stays visible",
      spec: disabledSpec,
      status: pausedStatus,
      state: "disabled",
      phase: "disabled",
      label: "Disabled",
      isPaused: true,
    },
    {
      name: "missing spec → disabled (fails closed, like the server)",
      spec: undefined,
      status: healthyStatus,
      state: "disabled",
      phase: "disabled",
      label: "Disabled",
      isPaused: false,
    },
    {
      name: "missing status → not paused",
      spec: enabledSpec,
      status: undefined,
      state: "active",
      phase: "ready",
      label: "Active",
      isPaused: false,
    },
  ] as const;

  for (const c of cases) {
    it(c.name, () => {
      const info = deriveScheduleState(c.spec, c.status);
      expect(info.state).toBe(c.state);
      expect(info.phase).toBe(c.phase);
      expect(info.label).toBe(c.label);
      expect(info.isPaused).toBe(c.isPaused);
    });
  }
});

describe("formatNextFire", () => {
  const now = new Date("2026-08-04T10:00:00Z");
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it("renders sub-minute and past instants as 'now' (tick mid-flight)", () => {
    expect(formatNextFire(at(30_000), now)).toBe("now");
    expect(formatNextFire(at(-5 * MINUTE), now)).toBe("now");
  });

  it("renders minutes, hours, and days compactly", () => {
    expect(formatNextFire(at(5 * MINUTE), now)).toBe("in 5m");
    expect(formatNextFire(at(59 * MINUTE), now)).toBe("in 59m");
    expect(formatNextFire(at(3 * HOUR), now)).toBe("in 3h");
    expect(formatNextFire(at(23 * HOUR), now)).toBe("in 23h");
    expect(formatNextFire(at(DAY), now)).toBe("in 1d");
    expect(formatNextFire(at(6 * DAY + 23 * HOUR), now)).toBe("in 6d");
  });

  it("falls back to a short date beyond a week", () => {
    const target = at(10 * DAY);
    // Locale-independent expectation: same formatting call, same options.
    const expected = target.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    expect(formatNextFire(target, now)).toBe(expected);
  });

  it("includes the year when the date crosses a year boundary", () => {
    const target = new Date("2027-01-15T10:00:00Z");
    const expected = target.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    expect(formatNextFire(target, now)).toBe(expected);
  });
});
