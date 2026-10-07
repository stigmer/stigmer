/**
 * Pins the empty-run-id refusal every run entry point that names a run
 * by id shares: the call answers InvalidArgument whose copy names the wire
 * field (`run_id`, or `run_id` on the two decision verbs), and it stops
 * before any store read, broker or engine is touched. The copy is wire
 * contract: the run rename moved it from `execution_id`, and a client
 * that matches on it reads the new field name. The two decision verbs refuse
 * at ValidateProto (the field's min_len rule), so their copy is the
 * validator's; the others refuse in their own hand-written step.
 *
 * Every dependency but the authorizer is untouchable, so a refusal that
 * leaked past validation fails the test loudly instead of passing on an
 * empty store.
 */
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  ApprovalAction,
  FileDecisionAction,
  FileDecisionScope,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  RunUpdateStatusInputSchema,
  SubmitApprovalInputSchema,
  SubmitFileDecisionInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { RunQueryController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/query_pb";

import { createLogger } from "../../../boot/logger.js";
import {
  errorOf,
  testCallerIdentity,
  untouchable,
} from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";

import { submitApproval } from "../submit-approval.js";
import { submitFileDecision } from "../submit-file-decision.js";
import { updateStatus } from "../update-status.js";
import { getRunUsageReport } from "../usage.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const ENTRY_POINTS: ReadonlyArray<
  readonly [string, string, () => Promise<unknown>]
> = [
  [
    "updateStatus — ValidateUpdateStatusInput",
    "run_id is required",
    () =>
      updateStatus(
        {
          store: untouchable("store"),
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          broker: untouchable("broker"),
          statusObservers: [],
          responseDecorators: [],
        },
        create(RunUpdateStatusInputSchema, {
          runId: "",
          status: create(RunStatusSchema),
        }),
        testCallerIdentity(),
      ),
  ],
  [
    "getRunUsageReport — ValidateExecutionUsageReport",
    "run_id is required",
    () =>
      getRunUsageReport(
        {
          store: untouchable("store"),
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          listReadScope: undefined,
        },
        create(RunQueryController.method.getRunUsageReport.input, {
          runId: "",
        }),
        testCallerIdentity(),
      ),
  ],
  [
    "submitApproval — ValidateProto",
    "run_id: must be at least 1 characters [string.min_len]",
    () =>
      submitApproval(
        {
          store: untouchable("store"),
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          broker: untouchable("broker"),
          engineState: untouchable("engineState"),
          gateSteps: new Map(),
          statusObservers: [],
        },
        create(SubmitApprovalInputSchema, {
          runId: "",
          toolCallId: "call_1",
          action: ApprovalAction.APPROVE,
        }),
        testCallerIdentity(),
      ),
  ],
  [
    "submitFileDecision — ValidateProto",
    "run_id: must be at least 1 characters [string.min_len]",
    () =>
      submitFileDecision(
        {
          store: untouchable("store"),
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          broker: untouchable("broker"),
          engineState: untouchable("engineState"),
          statusObservers: [],
        },
        create(SubmitFileDecisionInputSchema, {
          runId: "",
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
  it("an empty run id answers InvalidArgument naming the wire field", async () => {
    const error = await errorOf(call);

    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(copy);
  });
});
