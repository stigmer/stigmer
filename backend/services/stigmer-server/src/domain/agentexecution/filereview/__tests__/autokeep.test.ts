/**
 * Pins the approved-command auto-keep policy (autokeep.ts): a captured
 * change set whose every mutation came from commands the human approved is
 * kept by a policy decision, and every claim the server cannot verify
 * against its own records falls back to manual review. The seed is the
 * shared one-change file-review ledger (../../__tests__/file-review-seed.ts)
 * with the runner's command provenance added to its candidate.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalAction,
  FileDecisionOrigin,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { TurnCommandProvenanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

import type { LogFields, Logger } from "../../../../boot/logger.js";
import { fileReviewSeed } from "../../__tests__/file-review-seed.js";
import { autoKeepApprovedCommandSets } from "../autokeep.js";
import { projectFileChangeSets } from "../project.js";

const EXECUTION_ID = "aex_autokeep";
const CHANGE_SET_ID = "cs-1";
const CONSENT_TOOL_CALL = "tc-shell-1";

interface Line {
  readonly level: "info" | "warn";
  readonly message: string;
  readonly fields: LogFields | undefined;
}

function capturingLogger(): { logger: Logger; lines: Line[] } {
  const lines: Line[] = [];
  return {
    lines,
    logger: {
      debug: () => undefined,
      info: (message, fields) => lines.push({ level: "info", message, fields }),
      warn: (message, fields) => lines.push({ level: "warn", message, fields }),
      error: () => undefined,
    },
  };
}

/**
 * The seeded execution with the candidate's command provenance set and,
 * when `approval` is given, the cited shell call on the transcript carrying
 * that server-authored approval.
 */
function statusWithProvenance(options: {
  readonly approval?: ApprovalAction;
  readonly authorizedByAutoApproveAll?: boolean;
}): AgentExecutionStatus {
  const status = create(AgentExecutionStatusSchema, fileReviewSeed(EXECUTION_ID, CHANGE_SET_ID).status);
  const candidate = status.fileReviewEventStream?.events[1];
  if (candidate?.payload.case !== "candidateCaptured") {
    throw new Error("the seed's second event is the candidate");
  }
  candidate.payload.value.commandProvenance = create(TurnCommandProvenanceSchema, {
    consentToolCallIds: options.authorizedByAutoApproveAll === true ? [] : [CONSENT_TOOL_CALL],
    authorizedByAutoApproveAll: options.authorizedByAutoApproveAll === true,
  });
  if (options.approval !== undefined) {
    status.messages.push(
      create(AgentMessageSchema, {
        toolCalls: [{ id: CONSENT_TOOL_CALL, name: "run_shell", approvalAction: options.approval }],
      }),
    );
  }
  return status;
}

function decisionsOf(status: AgentExecutionStatus) {
  const stream = status.fileReviewEventStream;
  if (stream === undefined) throw new Error("the seed carries a file-review ledger");
  const [cs] = projectFileChangeSets(status.phase, stream);
  return cs?.decisions ?? [];
}

describe("autoKeepApprovedCommandSets", () => {
  it("keeps a reviewable set whose every command the human approved, as a policy decision, and says so", () => {
    const { logger, lines } = capturingLogger();
    const status = statusWithProvenance({ approval: ApprovalAction.APPROVE });

    expect(autoKeepApprovedCommandSets(status, EXECUTION_ID, false, logger)).toBe(1);

    const decisions = decisionsOf(status);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.origin).toBe(FileDecisionOrigin.POLICY_APPROVED_COMMAND);
    expect(lines).toEqual([
      {
        level: "info",
        message: "Auto-kept change set: every change produced by an approved command",
        fields: {
          executionId: EXECUTION_ID,
          changeSetId: CHANGE_SET_ID,
          consentToolCallIds: [CONSENT_TOOL_CALL],
          authorizedByAutoApproveAll: false,
        },
      },
    ]);
  });

  it("is a no-op on a second pass: the decision already exists", () => {
    const { logger } = capturingLogger();
    const status = statusWithProvenance({ approval: ApprovalAction.APPROVE });
    autoKeepApprovedCommandSets(status, EXECUTION_ID, false, logger);

    expect(autoKeepApprovedCommandSets(status, EXECUTION_ID, false, logger)).toBe(0);
    expect(decisionsOf(status)).toHaveLength(1);
  });

  it("leaves the set for manual review when the cited command carries no server-authored approval", () => {
    const { logger, lines } = capturingLogger();
    const status = statusWithProvenance({ approval: ApprovalAction.REJECT });

    expect(autoKeepApprovedCommandSets(status, EXECUTION_ID, false, logger)).toBe(0);
    expect(decisionsOf(status)).toHaveLength(0);
    expect(lines.map((l) => [l.level, l.message])).toEqual([
      [
        "warn",
        "Auto-keep skipped: claimed consent did not verify against server-authored approvals — manual review",
      ],
    ]);
  });

  it("leaves the set for manual review when the cited command is not on the transcript at all", () => {
    const { logger } = capturingLogger();
    const status = statusWithProvenance({});

    expect(autoKeepApprovedCommandSets(status, EXECUTION_ID, false, logger)).toBe(0);
    expect(decisionsOf(status)).toHaveLength(0);
  });

  it("refuses an auto-approve-all claim the execution's spec does not grant, and honours one it does", () => {
    const refused = statusWithProvenance({ authorizedByAutoApproveAll: true });
    expect(autoKeepApprovedCommandSets(refused, EXECUTION_ID, false, capturingLogger().logger)).toBe(0);

    const granted = statusWithProvenance({ authorizedByAutoApproveAll: true });
    expect(autoKeepApprovedCommandSets(granted, EXECUTION_ID, true, capturingLogger().logger)).toBe(1);
    expect(decisionsOf(granted)[0]?.origin).toBe(FileDecisionOrigin.POLICY_APPROVED_COMMAND);
  });
});
