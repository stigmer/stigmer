/**
 * Pins the two steps that make a turn's link to its workflow run a fact
 * the server vouched for (vouch-workflow-parent.ts), and the queue rule the
 * link feeds:
 *   - no link: nothing is consulted;
 *   - a server-composed request passes without the provider or the
 *     Authorizer;
 *   - a runner the credential provider vouches for that run passes, and the
 *     provider is asked about the link's run; its binding refusal
 *     propagates;
 *   - otherwise only the platform's can_write_reserved_labels admits it
 *     (the permissive local posture), and a denial is INVALID_ARGUMENT with
 *     the pinned copy; an authorization outage is Internal, never an answer;
 *   - a link naming another run than the lineage label is refused before
 *     any trust decision;
 *   - on update the stored link is kept when the request leaves it out, an
 *     equal one passes, and a changed or introduced one is refused;
 *   - parentRunQueueOf routes a linked turn to its run's own queue only
 *     when the run has one.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type {
  AuthzCheck,
  AuthzDecision,
  Authorizer,
} from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import type { RunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";

import {
  WORKFLOW_PARENT_IMMUTABLE_MESSAGE,
  WORKFLOW_PARENT_NOT_VOUCHED_MESSAGE,
} from "../constants.js";
import { WORKFLOW_EXECUTION_ID_LABEL } from "../record-runner-lineage-labels.js";
import {
  newValidateParentImmutabilityStep,
  newVouchWorkflowParentStep,
  parentRunQueueOf,
} from "../vouch-workflow-parent.js";

const RUNNER: CallerIdentity = testCallerIdentity({
  identityId: "ida_runner",
  callerClass: "workflow_sandbox",
});

function turn(options: {
  readonly parentRun?: string;
  readonly labelledRun?: string;
}): AgentRun {
  return create(AgentRunSchema, {
    metadata: {
      name: "child",
      labels:
        options.labelledRun === undefined
          ? {}
          : { [WORKFLOW_EXECUTION_ID_LABEL]: options.labelledRun },
    },
    spec: {
      message: "go",
      parent:
        options.parentRun === undefined
          ? undefined
          : {
              workflowExecutionId: options.parentRun,
              signalWorkflowId: "workflow-exec-wfx_1",
              callbackToken: new Uint8Array([1, 2, 3]),
            },
    },
  });
}

function ctxFor(
  execution: AgentRun,
  caller: CallerIdentity,
): RequestContext<typeof AgentRunSchema> {
  return new RequestContext(
    AgentRunSchema,
    execution,
    caller,
    ApiResourceKind.agent_run,
  );
}

function providerWith(
  vouch?: (caller: CallerIdentity, workflowExecutionId: string) => boolean,
): RunnerCredentialProvider {
  return {
    isEnabled: () => false,
    mint: () => {
      throw new Error("not under test");
    },
    verify: () => {
      throw new Error("not under test");
    },
    ...(vouch === undefined ? {} : { vouchRunnerLineageLabels: vouch }),
  };
}

function authorizerAnswering(decision: AuthzDecision): {
  authorizer: Authorizer;
  checks: AuthzCheck[];
} {
  const checks: AuthzCheck[] = [];
  return {
    checks,
    authorizer: {
      authorize(_caller, check) {
        checks.push(check);
        return Promise.resolve(decision);
      },
    },
  };
}

const UNTOUCHED: Authorizer = {
  authorize() {
    throw new Error("the Authorizer must not be consulted");
  },
};

async function refusal(run: () => void | Promise<void>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a refusal");
}

describe("VouchWorkflowParent", () => {
  it("consults nothing for a turn with no link", async () => {
    const step = newVouchWorkflowParentStep(
      providerWith(() => {
        throw new Error("must not be consulted");
      }),
      UNTOUCHED,
    );
    await step.execute(ctxFor(turn({}), RUNNER));
  });

  it("passes a request the server composed", async () => {
    const step = newVouchWorkflowParentStep(providerWith(), UNTOUCHED);
    await step.execute(
      ctxFor(
        turn({ parentRun: "wfx_1" }),
        testCallerIdentity({ callerClass: "internal" }),
      ),
    );
  });

  it("passes a runner vouched for the run the link names", async () => {
    const asked: string[] = [];
    const step = newVouchWorkflowParentStep(
      providerWith((_caller, run) => {
        asked.push(run);
        return true;
      }),
      UNTOUCHED,
    );
    await step.execute(ctxFor(turn({ parentRun: "wfx_1" }), RUNNER));
    expect(asked).toEqual(["wfx_1"]);
  });

  it("propagates the provider's refusal of a runner bound to another run", async () => {
    const step = newVouchWorkflowParentStep(
      providerWith(() => {
        throw new ConnectError("bound to another run", Code.PermissionDenied);
      }),
      UNTOUCHED,
    );
    const error = await refusal(() =>
      step.execute(ctxFor(turn({ parentRun: "wfx_other" }), RUNNER)),
    );
    expect(error.code).toBe(Code.PermissionDenied);
  });

  it("admits an unvouched caller holding can_write_reserved_labels", async () => {
    const { authorizer, checks } = authorizerAnswering({ kind: "allow" });
    const step = newVouchWorkflowParentStep(
      providerWith(() => false),
      authorizer,
    );
    await step.execute(
      ctxFor(turn({ parentRun: "wfx_1" }), testCallerIdentity()),
    );
    expect(checks).toEqual([
      {
        permission: IamPermission.can_write_reserved_labels,
        resourceKind: ApiResourceKind.platform,
        resourceId: "stigmer",
      },
    ]);
  });

  it("refuses an unvouched caller the Authorizer denies, with the pinned copy", async () => {
    const step = newVouchWorkflowParentStep(
      providerWith(),
      authorizerAnswering({ kind: "deny", reason: "not an operator" })
        .authorizer,
    );
    const error = await refusal(() =>
      step.execute(ctxFor(turn({ parentRun: "wfx_1" }), testCallerIdentity())),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(WORKFLOW_PARENT_NOT_VOUCHED_MESSAGE);
  });

  it("fails Internal when the operator check cannot be answered", async () => {
    const step = newVouchWorkflowParentStep(
      providerWith(),
      authorizerAnswering({
        kind: "unavailable",
        cause: new Error("authorization backend down"),
      }).authorizer,
    );
    const error = await refusal(() =>
      step.execute(ctxFor(turn({ parentRun: "wfx_1" }), testCallerIdentity())),
    );
    expect(error.code).toBe(Code.Internal);
  });

  it("refuses a link that names another run than the lineage label, before trusting anyone", async () => {
    const step = newVouchWorkflowParentStep(
      providerWith(() => {
        throw new Error("must not be consulted");
      }),
      UNTOUCHED,
    );
    const error = await refusal(() =>
      step.execute(
        ctxFor(
          turn({ parentRun: "wfx_1", labelledRun: "wfx_2" }),
          testCallerIdentity({ callerClass: "internal" }),
        ),
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(
      "parent.workflow_execution_id 'wfx_1' differs from the stigmer.ai/workflow-execution-id label 'wfx_2'; a turn belongs to one workflow run",
    );
  });
});

describe("ValidateParentImmutability", () => {
  function updateCtx(
    request: AgentRun,
    stored: AgentRun,
  ): RequestContext<typeof AgentRunSchema> {
    const ctx = ctxFor(request, testCallerIdentity());
    ctx.set(EXISTING_RESOURCE_KEY, stored);
    return ctx;
  }

  it("keeps the stored link when the update leaves it out", () => {
    const ctx = updateCtx(turn({}), turn({ parentRun: "wfx_1" }));
    newValidateParentImmutabilityStep().execute(ctx);
    expect(ctx.newState.spec?.parent?.workflowRunId).toBe("wfx_1");
  });

  it("passes an update that echoes the stored link", () => {
    const ctx = updateCtx(
      turn({ parentRun: "wfx_1" }),
      turn({ parentRun: "wfx_1" }),
    );
    newValidateParentImmutabilityStep().execute(ctx);
    expect(ctx.newState.spec?.parent?.workflowRunId).toBe("wfx_1");
  });

  it("refuses an update that changes the link", () => {
    const ctx = updateCtx(
      turn({ parentRun: "wfx_2" }),
      turn({ parentRun: "wfx_1" }),
    );
    expect(() => newValidateParentImmutabilityStep().execute(ctx)).toThrow(
      WORKFLOW_PARENT_IMMUTABLE_MESSAGE,
    );
  });

  it("refuses an update that links a turn created without one", () => {
    const ctx = updateCtx(turn({ parentRun: "wfx_1" }), turn({}));
    expect(() => newValidateParentImmutabilityStep().execute(ctx)).toThrow(
      WORKFLOW_PARENT_IMMUTABLE_MESSAGE,
    );
  });
});

describe("parentRunQueueOf", () => {
  const ownQueue = (run: string): string => `wfexec:${run}`;
  const noOwnQueue = (): string => "";

  it("routes a linked turn to its run's own queue", () => {
    expect(parentRunQueueOf(turn({ parentRun: "wfx_1" }), ownQueue)).toBe(
      "wfexec:wfx_1",
    );
  });

  it("routes a linked turn normally when its run has no queue of its own", () => {
    expect(parentRunQueueOf(turn({ parentRun: "wfx_1" }), noOwnQueue)).toBe("");
  });

  it("routes a turn with no link normally", () => {
    expect(parentRunQueueOf(turn({}), ownQueue)).toBe("");
  });
});
