/**
 * Pins how a wire recent-activity entry becomes the sidebar's entry (an
 * empty subject reads "Untitled session", a missing timestamp sorts as the
 * epoch) and how entries fall into the time buckets the recents section
 * renders, keeping the server's order within each bucket.
 */
import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  RecentActivityEntrySchema,
} from "@stigmer/protos/ai/stigmer/activity/v1/io_pb";
import type { RecentActivityEntry as ProtoEntry } from "@stigmer/protos/ai/stigmer/activity/v1/io_pb";
import { groupRecentActivityByTime } from "../group-activity";
import { normalizeRecentActivityEntry } from "../useRecentActivity";
import type { RecentActivityEntry } from "../types";

const EPOCH = new Date(0);

function makeProtoEntry(
  id: string,
  subject: string,
  updatedAt: Date,
): ProtoEntry {
  const entry = create(RecentActivityEntrySchema);
  entry.id = id;
  entry.subject = subject;
  entry.updatedAt = timestampFromDate(updatedAt);
  return entry;
}

describe("normalizeRecentActivityEntry", () => {
  it("converts proto RecentActivityEntry to local type", () => {
    const ts = new Date("2026-05-27T12:00:00Z");
    const proto = makeProtoEntry("ses_123", "triage the inbox", ts);
    const result = normalizeRecentActivityEntry(proto);

    expect(result).toEqual({
      id: "ses_123",
      subject: "triage the inbox",
      updatedAt: ts,
    });
  });

  it("falls back to 'Untitled session' for an empty subject", () => {
    const ts = new Date("2026-05-27T12:00:00Z");
    const proto = makeProtoEntry("ses_1", "", ts);
    const result = normalizeRecentActivityEntry(proto);
    expect(result.subject).toBe("Untitled session");
  });

  it("uses EPOCH when updatedAt is missing", () => {
    const entry = create(RecentActivityEntrySchema);
    entry.id = "ses_2";
    entry.subject = "test";
    const result = normalizeRecentActivityEntry(entry);
    expect(result.updatedAt).toEqual(EPOCH);
  });
});

describe("groupRecentActivityByTime (server-sorted input)", () => {
  it("groups entries into Today bucket when all are recent", () => {
    const now = new Date("2026-05-27T18:00:00Z");
    const entries: RecentActivityEntry[] = [
      { id: "a", subject: "sess-a", updatedAt: new Date("2026-05-27T12:00:00Z") },
      { id: "b", subject: "sess-b", updatedAt: new Date("2026-05-27T10:00:00Z") },
      { id: "c", subject: "sess-c", updatedAt: new Date("2026-05-27T08:00:00Z") },
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
      { id: "newest", subject: "sess1", updatedAt: new Date("2026-05-27T14:00:00Z") },
      { id: "middle", subject: "sess", updatedAt: new Date("2026-05-27T10:00:00Z") },
      { id: "oldest", subject: "sess2", updatedAt: new Date("2026-05-27T06:00:00Z") },
    ];

    const groups = groupRecentActivityByTime(entries, now);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("splits entries across Today and Yesterday", () => {
    const now = new Date("2026-05-27T18:00:00Z");
    const entries: RecentActivityEntry[] = [
      { id: "today", subject: "t", updatedAt: new Date("2026-05-27T16:00:00Z") },
      { id: "yesterday", subject: "y", updatedAt: new Date("2026-05-25T12:00:00Z") },
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
