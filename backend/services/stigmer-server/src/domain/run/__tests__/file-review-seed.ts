/**
 * Test seed for a run that captured file changes: the status a runner
 * leaves behind when its turn captured one change set — the set on the
 * run's file record (RunStatus.file_changes) with its candidate captured,
 * one complete MODIFY change with real digests, the run
 * WAITING_FOR_APPROVAL — so a decision against it passes the completeness
 * and digest gates. Shared by every suite that decides on a seeded change
 * set (the run wire suite, the store-fault and autokeep suites) so the
 * record's shape lives once.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";

import type { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import {
  DiffCompleteness,
  RunPhase,
  FileChangeKind,
  SnapshotKind,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import type {
  CapturedFileChange,
  FileChangeSet,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";

import { aggregateDigest, fileDigest } from "../filereview/digest.js";

export interface FileReviewSeed {
  /** The run status to seed: parked, with the change set captured on its record. */
  readonly status: MessageInitShape<typeof RunStatusSchema>;
  readonly change: CapturedFileChange;
  /** The change set's aggregate digest — a change-set decision's expected_digest. */
  readonly aggregate: string;
}

/** One complete MODIFY of `src/a.ts`, its file digest computed. */
export function reviewableChange(): CapturedFileChange {
  const change = create(CapturedFileChangeSchema, {
    id: "fc-1",
    pathBefore: "src/a.ts",
    pathAfter: "src/a.ts",
    kind: FileChangeKind.MODIFY,
    beforeSha256: "a".repeat(64),
    afterSha256: "b".repeat(64),
    diffComplete: true,
  });
  change.fileDigest = fileDigest(change);
  return change;
}

/**
 * A change set as the runner records it: its baseline and, when
 * `captured`, its candidate (the workspace at the turn's end), with
 * `changes` and their aggregate digest.
 */
export function capturedSet(
  changeSetId: string,
  changes: ReadonlyArray<CapturedFileChange> = [reviewableChange()],
  captured = true,
): FileChangeSet {
  return create(FileChangeSetSchema, {
    id: changeSetId,
    turnId: "turn-1",
    harnessId: "harness-1",
    baselineSnapshot: { kind: SnapshotKind.GIT_TREE_REF, git: { treeOid: "base", ref: "refs/stigmer/baseline" } },
    ...(captured
      ? {
          candidateSnapshot: { kind: SnapshotKind.GIT_TREE_REF, git: { treeOid: "after", ref: "refs/stigmer/candidate" } },
          changes: [...changes],
          aggregateDigest: aggregateDigest([...changes]),
          diffCompleteness: DiffCompleteness.COMPLETE,
        }
      : {}),
  });
}

export function fileReviewSeed(
  _runId: string,
  changeSetId: string,
): FileReviewSeed {
  const change = reviewableChange();
  const aggregate = aggregateDigest([change]);
  return {
    status: {
      phase: RunPhase.RUN_WAITING_FOR_APPROVAL,
      fileChanges: [capturedSet(changeSetId, [change])],
    },
    change,
    aggregate,
  };
}
