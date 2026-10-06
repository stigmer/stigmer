/**
 * Pins the empty-run-id refusal every workflow-run entry point that names a
 * run by id shares: the call answers InvalidArgument whose copy names the
 * wire field `run_id`, and it stops before any store read, broker, forwarder
 * or engine is touched. The copy is wire contract: the run-model rename moved
 * it from `execution_id`, and a client that matches on it reads the new field
 * name. The two decision-forwarding verbs refuse at ValidateProto (the
 * field's min_len rule), so their copy is the validator's; the others refuse
 * in their own hand-written check, the streams before the first yield.
 *
 * Every dependency but the authorizer is untouchable, so a refusal that
 * leaked past validation fails the test loudly instead of passing on an
 * empty store.
 */
import { create } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";
import { Code, createContextValues } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  ApprovalAction,
  FileDecisionAction,
  FileDecisionScope,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { WorkflowRunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import {
  GetEventLogRequestSchema,
  SubmitWorkflowApprovalInputSchema,
  SubmitWorkflowFileDecisionInputSchema,
  SubmitWorkflowTaskApprovalInputSchema,
  SubscribeEventsRequestSchema,
  SubscribeWorkflowRunRequestSchema,
  WorkflowRunUpdateStatusInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";

import { createLogger } from "../../../boot/logger.js";
import { callerIdentityKey } from "../../../pipeline/interceptors/auth.js";
import {
  errorOf,
  testCallerIdentity,
  untouchable,
} from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";

import { getEventLog } from "../get-event-log.js";
import { submitApproval } from "../submit-approval.js";
import { submitFileDecision } from "../submit-file-decision.js";
import { submitWorkflowTaskApproval } from "../submit-workflow-task-approval.js";
import { subscribeEvents } from "../subscribe-events.js";
import { subscribeExecution } from "../subscribe.js";
import { updateStatus } from "../update-status.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const RUN_ID_REQUIRED = "run_id is required";
const RUN_ID_MIN_LEN = "run_id: must be at least 1 characters [string.min_len]";

function handlerContext(): HandlerContext {
  const values = createContextValues();
  values.set(callerIdentityKey, testCallerIdentity());
  return { signal: new AbortController().signal, values } as HandlerContext;
}

const ENTRY_POINTS: ReadonlyArray<
  readonly [string, string, () => Promise<unknown>]
> = [
  [
    "getEventLog",
    RUN_ID_REQUIRED,
    () =>
      getEventLog(
        {
          store: untouchable("store"),
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
        },
        create(GetEventLogRequestSchema, { runId: "" }),
        testCallerIdentity(),
      ),
  ],
  [
    "subscribeEvents — before the first event",
    RUN_ID_REQUIRED,
    () =>
      subscribeEvents(
        {
          store: untouchable("store"),
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
        },
        create(SubscribeEventsRequestSchema, { runId: "" }),
        handlerContext(),
      ).next(),
  ],
  [
    "subscribe — before the first snapshot",
    RUN_ID_REQUIRED,
    () =>
      subscribeExecution(
        {
          store: untouchable("store"),
          logger: silentLogger,
          broker: untouchable("broker"),
          authorizer: newPermissiveSingleTeamAuthorizer(),
        },
        create(SubscribeWorkflowRunRequestSchema, { runId: "" }),
        handlerContext(),
      ).next(),
  ],
  [
    "updateStatus — ValidateUpdateStatusInput",
    RUN_ID_REQUIRED,
    () =>
      updateStatus(
        {
          store: untouchable("store"),
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          broker: untouchable("broker"),
          sandboxTerminalObserver: untouchable("sandboxTerminalObserver"),
        },
        create(WorkflowRunUpdateStatusInputSchema, {
          runId: "",
          status: create(WorkflowRunStatusSchema),
        }),
        testCallerIdentity(),
      ),
  ],
  [
    "submitWorkflowTaskApproval — ValidateTaskApprovalInput",
    RUN_ID_REQUIRED,
    () =>
      submitWorkflowTaskApproval(
        {
          store: untouchable("store"),
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          engineState: untouchable("engineState"),
        },
        create(SubmitWorkflowTaskApprovalInputSchema, {
          runId: "",
          taskName: "review",
          outcome: "approved",
        }),
        testCallerIdentity(),
      ),
  ],
  [
    "submitApproval — ValidateProto",
    RUN_ID_MIN_LEN,
    () =>
      submitApproval(
        {
          store: untouchable("store"),
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          approvalForwarder: untouchable("approvalForwarder"),
        },
        create(SubmitWorkflowApprovalInputSchema, {
          runId: "",
          toolCallId: "call_1",
          action: ApprovalAction.APPROVE,
        }),
        testCallerIdentity(),
      ),
  ],
  [
    "submitFileDecision — ValidateProto",
    RUN_ID_MIN_LEN,
    () =>
      submitFileDecision(
        {
          store: untouchable("store"),
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          fileDecisionForwarder: untouchable("fileDecisionForwarder"),
        },
        create(SubmitWorkflowFileDecisionInputSchema, {
          runId: "",
          childAgentRunId: "aex_1",
          changeSetId: "chs_1",
          scope: FileDecisionScope.CHANGE_SET,
          action: FileDecisionAction.APPROVE,
          expectedDigest: "sha256:abc",
        }),
        testCallerIdentity(),
      ),
  ],
];

describe.each(ENTRY_POINTS)("%s", (_entry, copy, call) => {
  it("an empty run id answers InvalidArgument naming run_id", async () => {
    const error = await errorOf(call);

    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(copy);
  });
});
