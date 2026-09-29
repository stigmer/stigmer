/**
 * Test seed for an agent execution parked on file review: the status block
 * a runner leaves behind when it offers one captured change set — the
 * BASELINE and CANDIDATE events on the file-review ledger, one complete
 * MODIFY change with real digests, the execution WAITING_FOR_APPROVAL —
 * so a submitFileDecision against it passes the completeness and digest
 * gates. Shared by every suite that decides on a seeded change set (the
 * agentexecution wire suite, the workflow forwarding suite, the forwarded
 * attribution test) so the ledger shape lives once.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";

import type { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  DiffCompleteness,
  ExecutionPhase,
  FileChangeKind,
  FileReviewEventType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { CapturedFileChangeSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";

import { aggregateDigest, fileDigest } from "../filereview/digest.js";

export interface FileReviewSeed {
  /** The execution status to seed: parked, with the change set captured. */
  readonly status: MessageInitShape<typeof AgentExecutionStatusSchema>;
  readonly change: CapturedFileChange;
  /** The change set's aggregate digest — a CHANGE_SET decision's expected_digest. */
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

export function fileReviewSeed(
  executionId: string,
  changeSetId: string,
): FileReviewSeed {
  const change = reviewableChange();
  const aggregate = aggregateDigest([change]);
  return {
    status: {
      phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      fileReviewEventStream: {
        executionId,
        events: [
          {
            eventId: `${changeSetId}:${changeSetId}:BASELINE`,
            changeSetId,
            eventType: FileReviewEventType.BASELINE_CAPTURED,
            actor: "runner",
            payload: {
              case: "baselineCaptured",
              value: { turnId: "turn-1", harnessId: "harness-1" },
            },
          },
          {
            eventId: `${changeSetId}:${changeSetId}:CANDIDATE`,
            changeSetId,
            eventType: FileReviewEventType.CANDIDATE_CAPTURED,
            actor: "runner",
            payload: {
              case: "candidateCaptured",
              value: {
                changes: [change],
                aggregateDigest: aggregate,
                diffCompleteness: DiffCompleteness.COMPLETE,
              },
            },
          },
        ],
      },
    },
    change,
    aggregate,
  };
}
