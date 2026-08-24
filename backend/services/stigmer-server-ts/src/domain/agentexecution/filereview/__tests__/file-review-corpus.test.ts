/**
 * The TS-server half of the cross-edition file-review projection corpus
 * (apis/testdata/hitl/file-review) — ports filereview/corpus_test.go:
 * replays a persisted file_review ledger through projectFileChangeSets
 * and asserts the normalized projected summary (derived status, ordered
 * change ids, decision count, aggregate digest, approved-snapshot
 * presence; diff_completeness / blocked_reasons / acknowledged ids where
 * the fixture declares them). Also pins the file-digest vector corpus
 * (apis/testdata/hitl/file-digest) against fileDigest/aggregateDigest.
 */
import path from "node:path";

import { create, enumFromJson, enumToJson, fromJson } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  FileReviewBlockReasonSchema,
  DiffCompletenessSchema,
  ExecutionPhase,
  ExecutionPhaseSchema,
  FileChangeSetStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  CapturedFileChangeSchema,
  FileReviewEventSchema,
  FileReviewEventStreamSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";

import { aggregateDigest, fileDigest } from "../digest.js";
import { projectFileChangeSets } from "../project.js";
import {
  corpusFiles,
  hitlCorpusDir,
  readCorpusJson,
} from "../../approval/__tests__/corpus-support.js";

interface FileReviewFixture {
  name: string;
  execution_id: string;
  phase: string;
  events: unknown[];
  expected: FileChangeSetSummary[];
}

interface FileChangeSetSummary {
  id: string;
  status: string;
  diff_completeness?: string;
  change_ids: string[];
  blocked_reasons?: string[];
  acknowledged_change_ids?: string[];
  decision_count: number;
  aggregate_digest: string;
  has_approved_snapshot: boolean;
}

function summarize(cs: FileChangeSet): FileChangeSetSummary {
  return {
    id: cs.id,
    status: enumToJson(FileChangeSetStatusSchema, cs.status) as string,
    diff_completeness: enumToJson(
      DiffCompletenessSchema,
      cs.diffCompleteness,
    ) as string,
    change_ids: cs.changes.map((c) => c.id),
    blocked_reasons: cs.changes.map(
      (c) => enumToJson(FileReviewBlockReasonSchema, c.blockedReason) as string,
    ),
    acknowledged_change_ids: cs.decisions
      .filter((d) => d.acknowledgeUnreviewable)
      .map((d) => d.fileChangeId),
    decision_count: cs.decisions.length,
    aggregate_digest: cs.aggregateDigest,
    has_approved_snapshot: cs.approvedSnapshot !== undefined,
  };
}

describe("shared file-review projection corpus", () => {
  const files = corpusFiles("file-review");

  // Guard the guard (Go asserts >= 5 too).
  it("discovers the corpus", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of files) {
    it(path.basename(file), () => {
      const fx = readCorpusJson(file) as unknown as FileReviewFixture;

      const stream = create(FileReviewEventStreamSchema, {
        executionId: fx.execution_id,
      });
      for (const raw of fx.events) {
        stream.events.push(fromJson(FileReviewEventSchema, raw as never));
      }

      const phase =
        fx.phase === undefined || fx.phase === ""
          ? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED
          : enumFromJson(ExecutionPhaseSchema, fx.phase);
      const got = projectFileChangeSets(phase, stream);

      expect(got.length, "projected change-set count").toBe(fx.expected.length);
      for (const [i, want] of fx.expected.entries()) {
        const summary = summarize(got[i] as FileChangeSet);
        expect(summary.id, `set[${i}] id`).toBe(want.id);
        expect(summary.status, `set[${i}] status`).toBe(want.status);
        // Optional assertions: only when the fixture declares them, so a
        // vector never has to enumerate the usually-default values.
        if (want.diff_completeness !== undefined && want.diff_completeness !== "") {
          expect(summary.diff_completeness, `set[${i}] diff_completeness`).toBe(
            want.diff_completeness,
          );
        }
        expect(summary.decision_count, `set[${i}] decision_count`).toBe(
          want.decision_count,
        );
        expect(summary.aggregate_digest, `set[${i}] aggregate_digest`).toBe(
          want.aggregate_digest,
        );
        expect(
          summary.has_approved_snapshot,
          `set[${i}] has_approved_snapshot`,
        ).toBe(want.has_approved_snapshot);
        expect(summary.change_ids, `set[${i}] change_ids`).toEqual(
          want.change_ids,
        );
        if ((want.blocked_reasons ?? []).length > 0) {
          expect(summary.blocked_reasons, `set[${i}] blocked_reasons`).toEqual(
            want.blocked_reasons,
          );
        }
        if ((want.acknowledged_change_ids ?? []).length > 0) {
          expect(
            summary.acknowledged_change_ids,
            `set[${i}] acknowledged_change_ids`,
          ).toEqual(want.acknowledged_change_ids);
        }
      }
    });
  }
});

interface FileDigestCase {
  name: string;
  path_before: string;
  path_after: string;
  kind: string;
  before_sha256: string;
  after_sha256: string;
  file_digest: string;
}

interface FileDigestAggregate {
  name: string;
  change_names: string[];
  aggregate_digest: string;
}

describe("shared file-digest corpus", () => {
  const doc = readCorpusJson(
    path.join(hitlCorpusDir(), "file-digest", "vectors.json"),
  ) as unknown as {
    cases: FileDigestCase[];
    aggregates: FileDigestAggregate[];
  };

  const changeOf = (c: FileDigestCase) =>
    fromJson(CapturedFileChangeSchema, {
      pathBefore: c.path_before,
      pathAfter: c.path_after,
      kind: c.kind,
      beforeSha256: c.before_sha256,
      afterSha256: c.after_sha256,
    } as never);

  it("discovers the corpus", () => {
    expect(doc.cases.length).toBeGreaterThanOrEqual(4);
    expect(doc.aggregates.length).toBeGreaterThanOrEqual(3);
  });

  for (const c of doc.cases) {
    it(`file_digest: ${c.name}`, () => {
      expect(fileDigest(changeOf(c))).toBe(c.file_digest);
    });
  }

  for (const agg of doc.aggregates) {
    it(`aggregate_digest: ${agg.name}`, () => {
      const byName = new Map(doc.cases.map((c) => [c.name, c]));
      const changes = agg.change_names.map((name) =>
        changeOf(byName.get(name) as FileDigestCase),
      );
      expect(aggregateDigest(changes)).toBe(agg.aggregate_digest);
    });
  }
});
