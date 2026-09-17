/**
 * Workflow-side interceptors that carry a run's credential from the workflow
 * input to every activity the workflow schedules — as a Temporal activity
 * header, the SDK's channel for context that crosses the isolate boundary
 * without being anybody's argument (`shared/run-credential.ts` has the
 * whole story; `interceptors/run-credential-activity.ts` is the other end).
 *
 * Gated by WORKFLOW TYPE, not by input shape. The connect workflow's input
 * carries the same key for a different token — a clocked decrypt-lane token
 * bound to a synthetic id that no verifier admits as a run — and stamping it
 * onto that lane's activities would present it where it does not belong.
 * The gate is the positive list below: the workflow types whose input
 * carries a RUN credential. One entry today; a test pins each entry to an
 * export of `workflows/index.ts`, so the list cannot name a type that does
 * not exist.
 *
 * Per-run state lives on this factory's closure: the SDK instantiates the
 * factory once per workflow run, which is the documented contract. The
 * header is a pure function of the input, so replay recomputes exactly what
 * was recorded, and a credential-less input stamps nothing — an in-flight
 * run from before the credential existed replays byte for byte.
 *
 * TEMPORAL SANDBOX: this file is bundled into the workflow isolate. No Node
 * built-ins. It is baked into the pre-built bundle by
 * `scripts/bundle-slim.mjs` and passed to the runtime bundler by both worker
 * roots (`src/workflow-source.ts` names it beside the OTel module).
 */

import { workflowInfo } from "@temporalio/workflow";
import type {
  ActivityInput,
  LocalActivityInput,
  Next,
  WorkflowExecuteInput,
  WorkflowInboundCallsInterceptor,
  WorkflowInterceptorsFactory,
  WorkflowOutboundCallsInterceptor,
} from "@temporalio/workflow";
import { defaultPayloadConverter } from "@temporalio/common";

import {
  RUN_CREDENTIAL_HEADER,
  readRunCredentialFromInput,
} from "../../shared/run-credential.js";
import { EXECUTE_FROM_EXECUTION_WORKFLOW_TYPE } from "../execute-from-execution.js";

/**
 * The workflow types whose input carries a run credential. Byte-pinned wire
 * names; each must be an export alias of `workflows/index.ts`.
 */
export const RUN_WORKFLOW_TYPES: readonly string[] = [
  EXECUTE_FROM_EXECUTION_WORKFLOW_TYPE,
];

export const interceptors: WorkflowInterceptorsFactory = () => {
  let credential: string | undefined;

  const inbound: WorkflowInboundCallsInterceptor = {
    async execute(
      input: WorkflowExecuteInput,
      next: Next<WorkflowInboundCallsInterceptor, "execute">,
    ) {
      if (RUN_WORKFLOW_TYPES.includes(workflowInfo().workflowType)) {
        credential = readRunCredentialFromInput(input.args[0]);
      }
      return next(input);
    },
  };

  const outbound: WorkflowOutboundCallsInterceptor = {
    async scheduleActivity(
      input: ActivityInput,
      next: Next<WorkflowOutboundCallsInterceptor, "scheduleActivity">,
    ) {
      return next(stamped(input));
    },
    async scheduleLocalActivity(
      input: LocalActivityInput,
      next: Next<WorkflowOutboundCallsInterceptor, "scheduleLocalActivity">,
    ) {
      return next(stamped(input));
    },
  };

  function stamped<T extends { readonly headers: ActivityInput["headers"] }>(
    input: T,
  ): T {
    if (credential === undefined) {
      return input;
    }
    return {
      ...input,
      headers: {
        ...input.headers,
        [RUN_CREDENTIAL_HEADER]: defaultPayloadConverter.toPayload(credential),
      },
    };
  }

  return { inbound: [inbound], outbound: [outbound] };
};
