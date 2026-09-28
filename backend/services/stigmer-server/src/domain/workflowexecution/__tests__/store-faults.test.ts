/**
 * Pins the store-fault contract every workflow-execution load shares: a
 * typed ResourceNotFoundError answers NotFound with the surface's own pinned
 * copy, and any other store failure is an infrastructure fault answered as a
 * sanitized Internal, never a NotFound that tells a client the run (or its
 * workflow) does not exist (stigmer/stigmer#1345).
 *
 * The surfaces: the five lifecycle verbs (their shared LoadExecutionById
 * step), sendSignal, the two approval-forwarding verbs, the task-approval
 * signal, subscribe's snapshot read, subscribeEvents' existence check, and
 * create's CreateDefaultInstanceIfNeeded workflow load. The composed suites
 * reach only a real store, which cannot fail selectively, so each surface
 * runs here against a store whose one read throws. Every other dependency is
 * untouchable: a load that fails must stop the call before any of them.
 *
 * Out of scope: the NotFound copy itself (wire contract, pinned where each
 * surface is otherwise tested and by the conformance suites) and loads
 * outside this domain.
 */
import { create } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";
import { Code, ConnectError, createContextValues } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  ApprovalAction,
  FileDecisionAction,
  FileDecisionScope,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  CancelWorkflowExecutionInputSchema,
  PauseWorkflowExecutionInputSchema,
  RecoverWorkflowExecutionInputSchema,
  ResumeWorkflowExecutionInputSchema,
  SendSignalInputSchema,
  SubmitWorkflowApprovalInputSchema,
  SubmitWorkflowFileDecisionInputSchema,
  SubmitWorkflowTaskApprovalInputSchema,
  SubscribeEventsRequestSchema,
  SubscribeWorkflowExecutionRequestSchema,
  TerminateWorkflowExecutionInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { callerIdentityKey } from "../../../pipeline/interceptors/auth.js";
import {
  errorOf,
  failingStore,
  testCallerIdentity,
  untouchable,
} from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";

import { newCreateDefaultInstanceIfNeededStep } from "../create-steps.js";
import type { LifecycleDeps } from "../lifecycle.js";
import {
  cancelExecution,
  pauseExecution,
  recoverExecution,
  resumeExecution,
  terminateExecution,
} from "../lifecycle.js";
import { sendSignal } from "../send-signal.js";
import { StreamBroker } from "../stream-broker.js";
import { submitApproval } from "../submit-approval.js";
import { submitFileDecision } from "../submit-file-decision.js";
import { submitWorkflowTaskApproval } from "../submit-workflow-task-approval.js";
import { subscribeEvents } from "../subscribe-events.js";
import { subscribeExecution } from "../subscribe.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const EXECUTION_ID = "wex_storefault";
const WORKFLOW_ID = "wfl_storefault";

const EXECUTION_FAULT_COPY = "failed to load workflow execution";
const WORKFLOW_FAULT_COPY = "failed to load workflow";

const MISSING = (): Error =>
  new ResourceNotFoundError(`workflow_execution/${EXECUTION_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

function handlerContext(): HandlerContext {
  const values = createContextValues();
  values.set(callerIdentityKey, testCallerIdentity());
  return { signal: new AbortController().signal, values } as HandlerContext;
}

function lifecycleDeps(store: Store): LifecycleDeps {
  return {
    store,
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    broker: untouchable("broker"),
    engineState: untouchable("engineState"),
    executionContextBuilder: untouchable("executionContextBuilder"),
    sandboxLane: untouchable("sandboxLane"),
    temporalConfig: untouchable("temporalConfig"),
    sandboxTerminalObserver: untouchable("sandboxTerminalObserver"),
    gateSteps: new Map(),
  };
}

const LIFECYCLE_VERBS: ReadonlyArray<
  readonly [string, (deps: LifecycleDeps) => Promise<unknown>]
> = [
  [
    "cancel",
    (deps) =>
      cancelExecution(
        deps,
        create(CancelWorkflowExecutionInputSchema, { id: EXECUTION_ID }),
        testCallerIdentity(),
      ),
  ],
  [
    "terminate",
    (deps) =>
      terminateExecution(
        deps,
        create(TerminateWorkflowExecutionInputSchema, { id: EXECUTION_ID }),
        testCallerIdentity(),
      ),
  ],
  [
    "pause",
    (deps) =>
      pauseExecution(
        deps,
        create(PauseWorkflowExecutionInputSchema, { id: EXECUTION_ID }),
        testCallerIdentity(),
      ),
  ],
  [
    "resume",
    (deps) =>
      resumeExecution(
        deps,
        create(ResumeWorkflowExecutionInputSchema, { id: EXECUTION_ID }),
        testCallerIdentity(),
      ),
  ],
  [
    "recover",
    (deps) =>
      recoverExecution(
        deps,
        create(RecoverWorkflowExecutionInputSchema, { id: EXECUTION_ID }),
        testCallerIdentity(),
      ),
  ],
];

describe.each(LIFECYCLE_VERBS)("%s — LoadExecutionById", (_verb, run) => {
  it("a missing execution answers NotFound with the lifecycle copy", async () => {
    const error = await errorOf(() =>
      run(lifecycleDeps(failingStore(MISSING()))),
    );

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(
      `workflow_execution not found: ${EXECUTION_ID}`,
    );
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await errorOf(() =>
      run(lifecycleDeps(failingStore(LOCKED()))),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(EXECUTION_FAULT_COPY);
  });
});

/**
 * The pipeline verbs with their own load step: each runs Authorize and its
 * input validation (a hand-written step or ValidateProto) first, so the
 * inputs carry every field the validation requires, and the load is the
 * first step that reads the store.
 */
const COMMAND_VERBS: ReadonlyArray<
  readonly [string, string, (store: Store) => Promise<unknown>]
> = [
  [
    "sendSignal — LoadExecutionByExecutionId",
    `workflow_execution not found: ${EXECUTION_ID}`,
    (store) =>
      sendSignal(
        {
          store,
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          engineState: untouchable("engineState"),
        },
        create(SendSignalInputSchema, {
          executionId: EXECUTION_ID,
          signalName: "resume",
        }),
        testCallerIdentity(),
      ),
  ],
  [
    "submitApproval — LoadExisting",
    `workflow_execution not found: ${EXECUTION_ID}`,
    (store) =>
      submitApproval(
        {
          store,
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          approvalForwarder: untouchable("approvalForwarder"),
        },
        create(SubmitWorkflowApprovalInputSchema, {
          executionId: EXECUTION_ID,
          toolCallId: "call_storefault",
          action: ApprovalAction.APPROVE,
        }),
        testCallerIdentity(),
      ),
  ],
  [
    "submitFileDecision — LoadExisting",
    `workflow_execution not found: ${EXECUTION_ID}`,
    (store) =>
      submitFileDecision(
        {
          store,
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          fileDecisionForwarder: untouchable("fileDecisionForwarder"),
        },
        create(SubmitWorkflowFileDecisionInputSchema, {
          executionId: EXECUTION_ID,
          childAgentExecutionId: "aex_storefault",
          changeSetId: "chs_storefault",
          scope: FileDecisionScope.CHANGE_SET,
          action: FileDecisionAction.APPROVE,
          expectedDigest: "sha256:storefault",
        }),
        testCallerIdentity(),
      ),
  ],
  [
    "submitWorkflowTaskApproval — LoadExecutionForApproval",
    `WorkflowExecution not found: ${EXECUTION_ID}`,
    (store) =>
      submitWorkflowTaskApproval(
        {
          store,
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          engineState: untouchable("engineState"),
        },
        create(SubmitWorkflowTaskApprovalInputSchema, {
          executionId: EXECUTION_ID,
          taskName: "review",
          outcome: "approved",
        }),
        testCallerIdentity(),
      ),
  ],
];

describe.each(COMMAND_VERBS)("%s", (_verb, notFoundCopy, run) => {
  it("a missing execution answers NotFound with the verb's copy", async () => {
    const error = await errorOf(() => run(failingStore(MISSING())));

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(notFoundCopy);
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await errorOf(() => run(failingStore(LOCKED())));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(EXECUTION_FAULT_COPY);
  });
});

describe("subscribe — the snapshot read", () => {
  function subscribeError(
    store: Store,
    broker: StreamBroker,
  ): Promise<ConnectError> {
    return errorOf(() =>
      subscribeExecution(
        {
          store,
          logger: silentLogger,
          broker,
          authorizer: newPermissiveSingleTeamAuthorizer(),
        },
        create(SubscribeWorkflowExecutionRequestSchema, {
          executionId: EXECUTION_ID,
        }),
        handlerContext(),
      ).next(),
    );
  }

  it("a missing execution answers NotFound with the subscribe copy and releases the subscription", async () => {
    const broker = new StreamBroker(silentLogger);
    const error = await subscribeError(failingStore(MISSING()), broker);

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(
      `WorkflowExecution not found: ${EXECUTION_ID}`,
    );
    expect(broker.getSubscriberCount(EXECUTION_ID)).toBe(0);
  });

  it("any other store failure answers a sanitized Internal and releases the subscription", async () => {
    const broker = new StreamBroker(silentLogger);
    const error = await subscribeError(failingStore(LOCKED()), broker);

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(EXECUTION_FAULT_COPY);
    expect(broker.getSubscriberCount(EXECUTION_ID)).toBe(0);
  });
});

describe("subscribeEvents — the existence check", () => {
  function subscribeEventsError(store: Store): Promise<ConnectError> {
    return errorOf(() =>
      subscribeEvents(
        {
          store,
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
        },
        create(SubscribeEventsRequestSchema, { executionId: EXECUTION_ID }),
        handlerContext(),
      ).next(),
    );
  }

  it("a missing execution answers NotFound with the stream's copy", async () => {
    const error = await subscribeEventsError(failingStore(MISSING()));

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(
      `WorkflowExecution not found: ${EXECUTION_ID}`,
    );
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await subscribeEventsError(failingStore(LOCKED()));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(EXECUTION_FAULT_COPY);
  });
});

describe("create — CreateDefaultInstanceIfNeeded's workflow load", () => {
  async function runStep(store: Store): Promise<void> {
    const ctx = new RequestContext(
      WorkflowExecutionSchema,
      create(WorkflowExecutionSchema, { spec: { workflowId: WORKFLOW_ID } }),
      testCallerIdentity(),
      ApiResourceKind.workflow_execution,
    );
    await newCreateDefaultInstanceIfNeededStep({
      store,
      logger: silentLogger,
      workflowInstanceCreator: () => {
        throw new Error("workflowInstanceCreator reached after a failed load");
      },
    }).execute(ctx);
  }

  it("a missing workflow answers NotFound with the create copy", async () => {
    const error = await errorOf(() =>
      runStep(
        failingStore(new ResourceNotFoundError(`workflow/${WORKFLOW_ID}`)),
      ),
    );

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(`Workflow not found: ${WORKFLOW_ID}`);
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await errorOf(() => runStep(failingStore(LOCKED())));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(WORKFLOW_FAULT_COPY);
  });
});
