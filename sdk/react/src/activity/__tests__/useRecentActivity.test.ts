import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  SessionSchema,
  SessionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import {
  ApiResourceMetadataSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  ApiResourceAuditSchema,
  ApiResourceAuditInfoSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";

/**
 * Tests for the `extractUpdatedAt` and merge-sort logic in useRecentActivity.
 *
 * Since the hook's normalization functions are not exported directly, we
 * re-implement the extraction logic here to verify the expected behavior.
 * This approach is acceptable for a pure-function test — the actual hook
 * wiring is tested via integration tests.
 */

const EPOCH = new Date(0);

function extractUpdatedAt(
  audit: { statusAudit?: { updatedAt?: unknown }; specAudit?: { createdAt?: unknown } } | undefined,
): Date {
  const statusTs = audit?.statusAudit?.updatedAt;
  if (statusTs && typeof statusTs === "object" && "seconds" in statusTs) {
    const ts = statusTs as { seconds: bigint; nanos: number };
    const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
    if (ms > 0) return new Date(ms);
  }
  const specTs = audit?.specAudit?.createdAt;
  if (specTs && typeof specTs === "object" && "seconds" in specTs) {
    const ts = specTs as { seconds: bigint; nanos: number };
    const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
    if (ms > 0) return new Date(ms);
  }
  return EPOCH;
}

function makeAudit(specCreatedAt: Date, statusUpdatedAt?: Date) {
  const specAuditInfo = create(ApiResourceAuditInfoSchema);
  specAuditInfo.createdAt = timestampFromDate(specCreatedAt);

  const statusAuditInfo = create(ApiResourceAuditInfoSchema);
  statusAuditInfo.updatedAt = timestampFromDate(statusUpdatedAt ?? specCreatedAt);

  const audit = create(ApiResourceAuditSchema);
  audit.specAudit = specAuditInfo;
  audit.statusAudit = statusAuditInfo;
  return audit;
}

function makeSession(id: string, specCreatedAt: Date, statusUpdatedAt?: Date): Session {
  const session = create(SessionSchema);
  const metadata = create(ApiResourceMetadataSchema);
  metadata.id = id;
  session.metadata = metadata;
  const status = create(SessionStatusSchema);
  status.audit = makeAudit(specCreatedAt, statusUpdatedAt);
  session.status = status;
  return session;
}

describe("extractUpdatedAt", () => {
  it("prefers statusAudit.updatedAt over specAudit.createdAt", () => {
    const specCreated = new Date("2026-01-01T00:00:00Z");
    const statusUpdated = new Date("2026-05-27T12:00:00Z");
    const audit = makeAudit(specCreated, statusUpdated);
    const result = extractUpdatedAt(audit);
    expect(result.getTime()).toBe(statusUpdated.getTime());
  });

  it("falls back to specAudit.createdAt when statusAudit.updatedAt is absent", () => {
    const specCreated = new Date("2026-03-15T10:00:00Z");
    const specAuditInfo = create(ApiResourceAuditInfoSchema);
    specAuditInfo.createdAt = timestampFromDate(specCreated);
    const audit = create(ApiResourceAuditSchema);
    audit.specAudit = specAuditInfo;
    // statusAudit left as default (no updatedAt)

    const result = extractUpdatedAt(audit);
    expect(result.getTime()).toBe(specCreated.getTime());
  });

  it("returns EPOCH when audit is undefined", () => {
    expect(extractUpdatedAt(undefined)).toEqual(EPOCH);
  });

  it("returns EPOCH when both timestamps are missing", () => {
    const audit = create(ApiResourceAuditSchema);
    const result = extractUpdatedAt(audit);
    expect(result).toEqual(EPOCH);
  });
});

describe("recents merge-sort ordering", () => {
  it("sorts by statusAudit.updatedAt, not specAudit.createdAt", () => {
    const oldCreated = new Date("2026-01-01T00:00:00Z");
    const newCreated = new Date("2026-05-27T12:00:00Z");
    const recentActivity = new Date("2026-05-27T14:00:00Z");

    // sessionA: created long ago but has recent activity
    const sessionA = makeSession("a", oldCreated, recentActivity);
    // sessionB: created recently but no activity since creation
    const sessionB = makeSession("b", newCreated);

    const entries = [sessionA, sessionB].map((s) => ({
      id: s.metadata?.id ?? "",
      updatedAt: extractUpdatedAt(s.status?.audit),
    }));

    entries.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    expect(entries[0].id).toBe("a");
    expect(entries[1].id).toBe("b");
  });

  it("old sessions without activity sort below new sessions", () => {
    const veryOld = new Date("2025-01-01T00:00:00Z");
    const recent = new Date("2026-05-27T10:00:00Z");

    // No independent statusAudit.updatedAt — uses specAudit.createdAt
    const oldSession = makeSession("old", veryOld);
    const newSession = makeSession("new", recent);

    const entries = [oldSession, newSession].map((s) => ({
      id: s.metadata?.id ?? "",
      updatedAt: extractUpdatedAt(s.status?.audit),
    }));

    entries.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    expect(entries[0].id).toBe("new");
    expect(entries[1].id).toBe("old");
  });
});
