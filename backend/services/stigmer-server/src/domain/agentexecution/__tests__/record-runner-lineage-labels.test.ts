/**
 * Pins the lineage-label vouching step (parity entry 20260830.05, the
 * Java RecordRunnerLineageLabelsStep port): no lineage labels means no
 * capability consult; the capability's true vouches exactly the present
 * lineage keys (the guard then passes them while a smuggled sibling still
 * refuses); false vouches nothing; a binding-violation throw propagates;
 * and with no capability composed the step is a no-op — nothing vouched,
 * today's OSS behavior.
 */
import { describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import type { RunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { serverStampedReservedLabels } from "../../../pipeline/steps/server-stamped-reserved-labels.js";
import {
  newRecordRunnerLineageLabelsStep,
  WORKFLOW_EXECUTION_ID_LABEL,
  WORKFLOW_TASK_LABEL,
} from "../record-runner-lineage-labels.js";

/** A cloud-shaped runner caller (class = the token_type claim). */
const RUNNER: CallerIdentity = {
  identityId: "ida_runner",
  callerClass: "workflow_sandbox",
  issuer: "stigmer",
  rawToken: "opaque-to-oss",
};

function executionCtx(
  labels: Record<string, string>,
): RequestContext<typeof AgentExecutionSchema> {
  return new RequestContext(
    AgentExecutionSchema,
    create(AgentExecutionSchema, { metadata: { name: "e", labels } }),
    RUNNER,
    ApiResourceKind.agent_execution,
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

describe("RecordRunnerLineageLabels", () => {
  it("consults nothing when the request carries no lineage labels", () => {
    const step = newRecordRunnerLineageLabelsStep(
      providerWith(() => {
        throw new Error("must not be consulted");
      }),
    );
    const ctx = executionCtx({ ordinary: "fine" });
    step.execute(ctx);
    expect(serverStampedReservedLabels(ctx).size).toBe(0);
  });

  it("vouches exactly the present lineage keys on true", () => {
    const observed: string[] = [];
    const step = newRecordRunnerLineageLabelsStep(
      providerWith((_caller, workflowExecutionId) => {
        observed.push(workflowExecutionId);
        return true;
      }),
    );
    const ctx = executionCtx({
      [WORKFLOW_EXECUTION_ID_LABEL]: "wfe_1",
      [WORKFLOW_TASK_LABEL]: "notify",
      "stigmer.ai/default-agent": "true", // never vouched by this step
    });
    step.execute(ctx);
    expect(observed).toEqual(["wfe_1"]);
    const stamped = serverStampedReservedLabels(ctx);
    expect(stamped.has(WORKFLOW_EXECUTION_ID_LABEL)).toBe(true);
    expect(stamped.has(WORKFLOW_TASK_LABEL)).toBe(true);
    expect(stamped.has("stigmer.ai/default-agent")).toBe(false);
    expect(stamped.size).toBe(2);
  });

  it("vouches only the task key when the execution-id label is absent", () => {
    const step = newRecordRunnerLineageLabelsStep(providerWith(() => true));
    const ctx = executionCtx({ [WORKFLOW_TASK_LABEL]: "notify" });
    step.execute(ctx);
    const stamped = serverStampedReservedLabels(ctx);
    expect(stamped.has(WORKFLOW_TASK_LABEL)).toBe(true);
    expect(stamped.size).toBe(1);
  });

  it("vouches nothing for a non-runner credential (false)", () => {
    const step = newRecordRunnerLineageLabelsStep(providerWith(() => false));
    const ctx = executionCtx({ [WORKFLOW_EXECUTION_ID_LABEL]: "wfe_1" });
    step.execute(ctx);
    expect(serverStampedReservedLabels(ctx).size).toBe(0);
  });

  it("a binding-violation refusal propagates untouched", () => {
    const refusal = new ConnectError(
      "workflow lineage label names a workflow execution this runner credential is not bound to",
      Code.InvalidArgument,
    );
    const step = newRecordRunnerLineageLabelsStep(
      providerWith(() => {
        throw refusal;
      }),
    );
    let error: unknown;
    try {
      step.execute(executionCtx({ [WORKFLOW_EXECUTION_ID_LABEL]: "wfe_other" }));
    } catch (e) {
      error = e;
    }
    expect(error).toBe(refusal);
  });

  it("is a no-op with no capability composed — today's OSS behavior", () => {
    const step = newRecordRunnerLineageLabelsStep(providerWith());
    const ctx = executionCtx({ [WORKFLOW_EXECUTION_ID_LABEL]: "wfe_1" });
    step.execute(ctx);
    expect(serverStampedReservedLabels(ctx).size).toBe(0);
  });
});
