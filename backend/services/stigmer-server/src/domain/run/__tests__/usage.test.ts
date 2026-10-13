/**
 * Pins the usage reports' small helpers in usage.ts: the date bounds (a
 * date-only bound is a UTC day, `from` from its midnight and `to` through
 * its last instant; a full RFC 3339 bound is taken as given; anything else
 * is refused, an impossible date included), the distinct agent and
 * session sets the organization report counts, and the chronological run
 * order of the session and agent reports. The arithmetic is pinned in
 * usage-fold.test.ts, the pipelines in usage-report.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";

import {
  distinctAgentIds,
  distinctSessionIds,
  parseReportBound,
  sortExecutionsByStartedAt,
} from "../usage.js";

function makeRun(id: string, sessionId: string, agentId: string, startedAt = ""): Run {
  return create(RunSchema, {
    metadata: { id },
    spec: { target: { case: "sessionId", value: sessionId } },
    status: { agentId, startedAt },
  });
}

describe("parseReportBound", () => {
  it("a date-only from is its UTC midnight", () => {
    expect(parseReportBound("2026-10-13", "from")).toBe(Date.UTC(2026, 9, 13));
  });

  it("a date-only to is the last millisecond of its UTC day", () => {
    expect(parseReportBound("2026-10-13", "to")).toBe(Date.UTC(2026, 9, 14) - 1);
    // A run created at 09:00 on the day is inside, which a text comparison
    // of "2026-10-13T09:00:00Z" against "2026-10-13" was not.
    expect(Date.UTC(2026, 9, 13, 9)).toBeLessThanOrEqual(parseReportBound("2026-10-13", "to") ?? 0);
  });

  it("a full RFC 3339 bound is taken as given, on either side", () => {
    expect(parseReportBound("2026-10-13T09:30:00Z", "from")).toBe(Date.UTC(2026, 9, 13, 9, 30));
    expect(parseReportBound("2026-10-13T09:30:00Z", "to")).toBe(Date.UTC(2026, 9, 13, 9, 30));
    expect(parseReportBound("2026-10-13T11:30:00.250+02:00", "to")).toBe(Date.UTC(2026, 9, 13, 9, 30, 0, 250));
  });

  it("anything else is refused, an impossible date included", () => {
    for (const value of ["2026-02-30", "2026-13-01", "13/10/2026", "2026-10-13T09:30", "yesterday", "2026-10-13 09:30:00Z"]) {
      expect(parseReportBound(value, "from"), value).toBeUndefined();
    }
  });
});

describe("the organization report's distinct sets and the reports' run order", () => {
  it("distinct agents and sessions skip empties and sort", () => {
    const runs = [
      makeRun("e1", "s2", "a2"),
      makeRun("e2", "s1", "a1"),
      makeRun("e3", "s1", ""),
      makeRun("e4", "", "a1"),
    ];
    expect(distinctAgentIds(runs)).toEqual(["a1", "a2"]);
    expect(distinctSessionIds(runs)).toEqual(["s1", "s2"]);
  });

  it("sorts runs by started_at, unstarted first", () => {
    const runs = [
      makeRun("late", "s", "a", "2026-03-12T08:00:00Z"),
      makeRun("early", "s", "a", "2026-03-05T09:00:00Z"),
      makeRun("pending", "s", "a"),
    ];
    sortExecutionsByStartedAt(runs);
    expect(runs.map((r) => r.metadata?.id)).toEqual(["pending", "early", "late"]);
  });
});
