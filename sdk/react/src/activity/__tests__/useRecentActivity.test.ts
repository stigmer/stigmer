import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate, timestampDate } from "@bufbuild/protobuf/wkt";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import {
  RecentActivityEntrySchema,
} from "@stigmer/protos/ai/stigmer/activity/v1/io_pb";
import type { RecentActivityEntry as ProtoEntry } from "@stigmer/protos/ai/stigmer/activity/v1/io_pb";
import { groupRecentActivityByTime } from "../group-activity";
import type { RecentActivityEntry } from "../types";

const EPOCH = new Date(0);

function makeProtoEntry(
  id: string,
  type: "session" | "workflow_execution",
  subject: string,
  updatedAt: Date,
  status?: string,
): ProtoEntry {
  const entry = create(RecentActivityEntrySchema);
  entry.id = id;
  entry.type = type;
  entry.subject = subject;
  entry.updatedAt = timestampFromDate(updatedAt);
  entry.status = status ?? "";
  return entry;
}

function normalizeEntry(entry: ProtoEntry): RecentActivityEntry {
  const updatedAt = entry.updatedAt
    ? timestampDate(entry.updatedAt)
    : EPOCH;

  return {
    id: entry.id,
    type: entry.type === "session" ? "session" : "workflow_execution",
    subject: entry.subject || (entry.type === "session" ? "Untitled session" : "Untitled execution"),
    updatedAt: updatedAt.getTime() > 0 ? updatedAt : EPOCH,
    status: entry.status || undefined,
  };
}

describe("normalizeEntry", () => {
  it("converts proto RecentActivityEntry to local type", () => {
    const ts = new Date("2026-05-27T12:00:00Z");
    const proto = makeProtoEntry("wfx_123", "workflow_execution", "my-workflow", ts, "completed");
    const result = normalizeEntry(proto);

    expect(result.id).toBe("wfx_123");
    expect(result.type).toBe("workflow_execution");
    expect(result.subject).toBe("my-workflow");
    expect(result.updatedAt.getTime()).toBe(ts.getTime());
    expect(result.status).toBe("completed");
  });

  it("falls back to 'Untitled session' for empty session subject", () => {
    const ts = new Date("2026-05-27T12:00:00Z");
    const proto = makeProtoEntry("sess_1", "session", "", ts);
    const result = normalizeEntry(proto);
    expect(result.subject).toBe("Untitled session");
  });

  it("falls back to 'Untitled execution' for empty execution subject", () => {
    const ts = new Date("2026-05-27T12:00:00Z");
    const proto = makeProtoEntry("wfx_1", "workflow_execution", "", ts);
    const result = normalizeEntry(proto);
    expect(result.subject).toBe("Untitled execution");
  });

  it("uses EPOCH when updatedAt is missing", () => {
    const entry = create(RecentActivityEntrySchema);
    entry.id = "sess_2";
    entry.type = "session";
    entry.subject = "test";
    const result = normalizeEntry(entry);
    expect(result.updatedAt).toEqual(EPOCH);
  });

  it("session entries have undefined status", () => {
    const ts = new Date("2026-05-27T12:00:00Z");
    const proto = makeProtoEntry("sess_3", "session", "hello", ts);
    const result = normalizeEntry(proto);
    expect(result.status).toBeUndefined();
  });
});

describe("groupRecentActivityByTime (server-sorted input)", () => {
  it("groups entries into Today bucket when all are recent", () => {
    const now = new Date("2026-05-27T18:00:00Z");
    const entries: RecentActivityEntry[] = [
      { id: "a", type: "workflow_execution", subject: "wf-a", updatedAt: new Date("2026-05-27T12:00:00Z") },
      { id: "b", type: "session", subject: "sess-b", updatedAt: new Date("2026-05-27T10:00:00Z") },
      { id: "c", type: "workflow_execution", subject: "wf-c", updatedAt: new Date("2026-05-27T08:00:00Z") },
    ];

    const groups = groupRecentActivityByTime(entries, now);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Today");
    expect(groups[0].entries).toHaveLength(3);
    expect(groups[0].entries[0].id).toBe("a");
    expect(groups[0].entries[1].id).toBe("b");
    expect(groups[0].entries[2].id).toBe("c");
  });

  it("preserves server sort order within each bucket", () => {
    const now = new Date("2026-05-27T18:00:00Z");
    const entries: RecentActivityEntry[] = [
      { id: "newest", type: "workflow_execution", subject: "wf", updatedAt: new Date("2026-05-27T14:00:00Z") },
      { id: "middle", type: "session", subject: "sess", updatedAt: new Date("2026-05-27T10:00:00Z") },
      { id: "oldest", type: "workflow_execution", subject: "wf2", updatedAt: new Date("2026-05-27T06:00:00Z") },
    ];

    const groups = groupRecentActivityByTime(entries, now);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("splits entries across Today and Yesterday", () => {
    const now = new Date("2026-05-27T18:00:00Z");
    const entries: RecentActivityEntry[] = [
      { id: "today", type: "session", subject: "t", updatedAt: new Date("2026-05-27T16:00:00Z") },
      { id: "yesterday", type: "workflow_execution", subject: "y", updatedAt: new Date("2026-05-25T12:00:00Z") },
    ];

    const groups = groupRecentActivityByTime(entries, now);
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(groups[0].label).toBe("Today");
    expect(groups[0].entries[0].id).toBe("today");
    const nonTodayGroup = groups.find((g) => g.label !== "Today");
    expect(nonTodayGroup).toBeDefined();
    expect(nonTodayGroup!.entries[0].id).toBe("yesterday");
  });
});
