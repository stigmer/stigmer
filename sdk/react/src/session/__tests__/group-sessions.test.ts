import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import {
  ApiResourceAuditStatusSchema,
  ApiResourceAuditSchema,
  ApiResourceAuditInfoSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import { groupSessionsByTime, type SessionGroup } from "../group-sessions";

const NOW = new Date("2026-03-18T14:00:00Z");

function makeSession(date: Date | null) {
  const session = create(SessionSchema);
  if (date) {
    const auditInfo = create(ApiResourceAuditInfoSchema);
    auditInfo.createdAt = timestampFromDate(date);
    const audit = create(ApiResourceAuditSchema);
    audit.specAudit = auditInfo;
    const status = create(ApiResourceAuditStatusSchema);
    status.audit = audit;
    session.status = status;
  }
  return session;
}

function daysAgo(days: number): Date {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  return d;
}

function labels(groups: readonly SessionGroup[]): string[] {
  return groups.map((g) => g.label);
}

describe("groupSessionsByTime", () => {
  it("returns empty array for empty input", () => {
    expect(groupSessionsByTime([], NOW)).toEqual([]);
  });

  it("groups a session created today into 'Today'", () => {
    const groups = groupSessionsByTime([makeSession(NOW)], NOW);
    expect(labels(groups)).toEqual(["Today"]);
    expect(groups[0].sessions).toHaveLength(1);
  });

  it("groups a session from yesterday into 'Yesterday'", () => {
    const groups = groupSessionsByTime([makeSession(daysAgo(1))], NOW);
    expect(labels(groups)).toEqual(["Yesterday"]);
  });

  it("groups a session from 3 days ago into 'Previous 7 Days'", () => {
    const groups = groupSessionsByTime([makeSession(daysAgo(3))], NOW);
    expect(labels(groups)).toEqual(["Previous 7 Days"]);
  });

  it("groups a session from 15 days ago into 'Previous 30 Days'", () => {
    const groups = groupSessionsByTime([makeSession(daysAgo(15))], NOW);
    expect(labels(groups)).toEqual(["Previous 30 Days"]);
  });

  it("groups a session from 60 days ago into 'Older'", () => {
    const groups = groupSessionsByTime([makeSession(daysAgo(60))], NOW);
    expect(labels(groups)).toEqual(["Older"]);
  });

  it("omits empty groups from the result", () => {
    const groups = groupSessionsByTime(
      [makeSession(NOW), makeSession(daysAgo(60))],
      NOW,
    );
    expect(labels(groups)).toEqual(["Today", "Older"]);
  });

  it("places sessions with missing timestamps in 'Older'", () => {
    const groups = groupSessionsByTime([makeSession(null)], NOW);
    expect(labels(groups)).toEqual(["Older"]);
    expect(groups[0].sessions).toHaveLength(1);
  });

  it("preserves input order within each group", () => {
    const s1 = makeSession(NOW);
    const s2 = makeSession(NOW);
    const s3 = makeSession(NOW);

    const groups = groupSessionsByTime([s1, s2, s3], NOW);
    expect(groups[0].sessions[0]).toBe(s1);
    expect(groups[0].sessions[1]).toBe(s2);
    expect(groups[0].sessions[2]).toBe(s3);
  });

  it("distributes sessions across all five buckets", () => {
    const sessions = [
      makeSession(NOW),
      makeSession(daysAgo(1)),
      makeSession(daysAgo(4)),
      makeSession(daysAgo(20)),
      makeSession(daysAgo(60)),
    ];

    const groups = groupSessionsByTime(sessions, NOW);
    expect(labels(groups)).toEqual([
      "Today",
      "Yesterday",
      "Previous 7 Days",
      "Previous 30 Days",
      "Older",
    ]);
    groups.forEach((g) => expect(g.sessions).toHaveLength(1));
  });
});
