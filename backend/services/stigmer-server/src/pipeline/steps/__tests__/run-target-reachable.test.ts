/**
 * Pins RunTargetReachable (run-target-reachable.ts): the run's target is
 * asked about as the runner will ask, by a credential bound to the run's
 * organization and for `can_view`; a target outside that binding is refused
 * at create with FAILED_PRECONDITION naming it, while an inside, admitted or
 * missing target passes (missing is the not-found steps' to answer), as
 * does a run that names no target or no organization. A binding read fault
 * answers INTERNAL.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type {
  BindingTarget,
  BindingVerdict,
  CredentialBinding,
} from "../../../extensions/credential-binding.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { testCallerIdentity } from "../../__tests__/support.js";
import { RequestContext } from "../../request-context.js";
import { RUN_GATE_CHECKS, type RunTarget } from "../authorize-run-target.js";
import {
  newRunTargetReachableStep,
  runTargetUnreachableMessage,
} from "../run-target-reachable.js";

function bindingAnswering(answer: BindingVerdict | Error) {
  const asked: Array<{ caller: CallerIdentity; target: BindingTarget }> = [];
  const binding = {
    verdict: (caller: CallerIdentity, target: BindingTarget) => {
      asked.push({ caller, target });
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    },
  } as unknown as CredentialBinding;
  return { binding, asked };
}

const workflowTarget = (execution: WorkflowExecution): RunTarget | undefined =>
  execution.spec?.workflowId
    ? {
        ...RUN_GATE_CHECKS.workflow,
        resourceId: execution.spec.workflowId,
        deniedMessage: "",
      }
    : undefined;

/** The step's answer as a promise, whether it returned or threw. */
function settle(
  step: { execute(ctx: ReturnType<typeof runIn>): void | Promise<void> },
  ctx: ReturnType<typeof runIn>,
) {
  return Promise.resolve().then(() => step.execute(ctx));
}

function runIn(org: string, workflowId: string) {
  return new RequestContext(
    WorkflowExecutionSchema,
    create(WorkflowExecutionSchema, {
      metadata: { name: "run", org },
      spec: { workflowId },
    }),
    testCallerIdentity(),
    ApiResourceKind.workflow_execution,
  );
}

describe("RunTargetReachable", () => {
  it("asks as a credential bound to the run's organization, for can_view", async () => {
    const { binding, asked } = bindingAnswering("inside");
    await newRunTargetReachableStep<typeof WorkflowExecutionSchema>(
      binding,
      workflowTarget,
    ).execute(runIn("org_a", "wfl_1"));
    expect(asked).toHaveLength(1);
    expect(asked[0]?.caller.boundOrg).toBe("org_a");
    expect(asked[0]?.target).toEqual({
      kind: ApiResourceKind.workflow,
      id: "wfl_1",
      permission: "can_view",
    });
  });

  it("refuses a target the run's organization cannot read, naming it", async () => {
    const { binding } = bindingAnswering("outside");
    const error = await settle(
      newRunTargetReachableStep<typeof WorkflowExecutionSchema>(
        binding,
        workflowTarget,
      ),
      runIn("org_a", "wfl_elsewhere"),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(
      runTargetUnreachableMessage({
        ...RUN_GATE_CHECKS.workflow,
        resourceId: "wfl_elsewhere",
        deniedMessage: "",
      }),
    );
  });

  it("passes an admitted or missing target, and a run with no target or no organization", async () => {
    for (const answer of ["admitted", "missing"] as const) {
      await newRunTargetReachableStep<typeof WorkflowExecutionSchema>(
        bindingAnswering(answer).binding,
        workflowTarget,
      ).execute(runIn("org_a", "wfl_1"));
    }
    const { binding, asked } = bindingAnswering("outside");
    await newRunTargetReachableStep<typeof WorkflowExecutionSchema>(
      binding,
      workflowTarget,
    ).execute(runIn("org_a", ""));
    await newRunTargetReachableStep<typeof WorkflowExecutionSchema>(
      binding,
      workflowTarget,
    ).execute(runIn("", "wfl_1"));
    expect(asked).toEqual([]);
  });

  it("answers INTERNAL when the binding cannot read the target", async () => {
    const { binding } = bindingAnswering(new Error("store unavailable"));
    const error = await settle(
      newRunTargetReachableStep<typeof WorkflowExecutionSchema>(
        binding,
        workflowTarget,
      ),
      runIn("org_a", "wfl_1"),
    ).catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.Internal);
  });
});
