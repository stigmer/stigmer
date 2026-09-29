/**
 * Pins who a workflow human_input decision names (stigmer#1415): the
 * reviewer and reviewer_actor that submitWorkflowTaskApproval puts on the
 * relay signal are the caller the chain authorized, never the client's
 * `reviewer` field. One arm per caller shape the editions produce — a
 * person with and without a client-supplied name, a PlatformClient user
 * token (a person spoken for by a third-party client), and a composition's
 * own lane class — each read from the payload the stub engine recorded.
 * The validation and phase arms, and the engineless refusal, are pinned
 * over the wire in workflowexecution.test.ts.
 */
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  ExecutionPhase,
  WorkflowTaskStatus,
  WorkflowTaskType,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { SubmitWorkflowTaskApprovalInputSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { SqliteStore } from "../../../store/sqlite/store.js";

import {
  HUMAN_INPUT_SIGNAL_PREFIX,
  RELAY_SIGNAL_CHANNEL_NAME,
} from "../constants.js";
import { submitWorkflowTaskApproval } from "../submit-workflow-task-approval.js";
import { stubConnectedEngine } from "./engine-stub.js";

const GATE = "manager_approval";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let dir: string;
let store: SqliteStore;
let counter = 0;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wfexec-task-approval-"));
  store = SqliteStore.open(path.join(dir, "test.db"));
});

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A running execution whose one task is a human_input gate awaiting a decision. */
async function seedGate(): Promise<string> {
  counter += 1;
  const id = `wfx_gate_${counter}`;
  await store.saveResource(
    ApiResourceKind.workflow_execution,
    id,
    WorkflowExecutionSchema,
    create(WorkflowExecutionSchema, {
      metadata: { id, name: id, org: "acme" },
      spec: {
        workflowId: `wf_${counter}`,
        workflowInstanceId: `wfi_${counter}`,
      },
      status: {
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        temporalWorkflowId: `temporal_${counter}`,
        tasks: [
          {
            taskName: GATE,
            taskType: WorkflowTaskType.WORKFLOW_TASK_APPROVAL,
            status: WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL,
          },
        ],
      },
    }),
  );
  return id;
}

/** Submits a decision as `caller` and returns the human_input payload the engine was handed. */
async function decide(
  caller: CallerIdentity,
  clientReviewer = "",
): Promise<Record<string, unknown>> {
  const engine = stubConnectedEngine();
  await submitWorkflowTaskApproval(
    {
      store,
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      engineState: () => engine.state,
    },
    create(SubmitWorkflowTaskApprovalInputSchema, {
      executionId: await seedGate(),
      taskName: GATE,
      outcome: "approve",
      reviewer: clientReviewer,
    }),
    caller,
  );

  const starts = engine.calls.filter(
    (call) => call.method === "signalWithStart",
  );
  expect(starts).toHaveLength(1);
  const [, channel, envelope] = starts[0]!.args as [
    unknown,
    string,
    { signalName: string; payload: Record<string, unknown> },
  ];
  expect(channel).toBe(RELAY_SIGNAL_CHANNEL_NAME);
  expect(envelope.signalName).toBe(HUMAN_INPUT_SIGNAL_PREFIX + GATE);
  return envelope.payload;
}

describe("submitWorkflowTaskApproval reviewer attribution (stigmer#1415)", () => {
  it("a person who names no reviewer is recorded as themselves, with their display snapshot", async () => {
    const payload = await decide(
      testCallerIdentity({
        identityId: "ia_erin",
        email: "erin@example.com",
        displayName: "Erin Example",
      }),
    );

    expect(payload["outcome"]).toBe("approve");
    expect(payload["reviewer"]).toBe("ia_erin");
    expect(payload["reviewer_actor"]).toEqual({
      id: "ia_erin",
      display_name: "Erin Example",
      email: "erin@example.com",
      avatar: "",
    });
  });

  it("a person who names someone else is still recorded as themselves", async () => {
    const payload = await decide(
      testCallerIdentity({ identityId: "ia_erin", email: "erin@example.com" }),
      "ia_someone_else",
    );

    expect(payload["reviewer"]).toBe("ia_erin");
    expect(payload["reviewer_actor"]).toEqual({
      id: "ia_erin",
      display_name: "",
      email: "erin@example.com",
      avatar: "",
    });
  });

  it("a PlatformClient user token records the end user it names, not the client", async () => {
    const payload = await decide(
      testCallerIdentity({
        identityId: "ia_end_user",
        email: "user@partner.example",
        platformClientId: "pcl_partner",
      }),
    );

    expect(payload["reviewer"]).toBe("ia_end_user");
    expect(payload["reviewer_actor"]).toEqual({
      id: "ia_end_user",
      display_name: "",
      email: "user@partner.example",
      avatar: "",
    });
  });

  it("a composition's own lane class is attributed to its principal, whatever it sends", async () => {
    const payload = await decide(
      testCallerIdentity({ identityId: "ia_broker", callerClass: "channel" }),
      "U_SLACK_USER",
    );

    expect(payload["reviewer"]).toBe("ia_broker");
    expect(payload["reviewer_actor"]).toEqual({
      id: "ia_broker",
      display_name: "",
      email: "",
      avatar: "",
    });
  });
});
