/**
 * SessionCommandController.bindHarnessState: the runner records the
 * harness's conversation id its run's session continues from (a LangGraph
 * thread id, a Cursor agent id), and the id it replaces joins the
 * session's history.
 *
 * The id is runner-owned state, so it lives in the session's status and
 * has this one door: no person writes it, and an editor's etag never moves
 * when a turn binds it. The door is admitted exactly as appendEvents is
 * (events/append.ts mayAppend): a runner credential for this run, the run
 * not finished, and the session the run's own, never one the request
 * names. The write names its fields inside the store's atomic write on the
 * live row, so it never undoes an edit and two binds never lose each
 * other's id.
 *
 * Proven by __tests__/bind-harness.test.ts and the execution conformance
 * suite.
 */
import { create } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import {
  BindHarnessStateResponseSchema,
  type BindHarnessStateInput,
  type BindHarnessStateResponse,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { SessionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
  permissionDeniedError,
} from "../../pipeline/errors.js";
import { parseBearerToken } from "../../pipeline/interceptors/auth.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { isTerminalExecutionPhase } from "../run/phases.js";
import { mayAppend } from "./events/append.js";
import type { AppendSessionEventsDeps } from "./events/append.js";
import { sessionIdOfRun } from "./events/transitions.js";
import { recordHarnessState } from "./steps.js";

/** The one refusal every caller outside the door gets, whatever the reason. */
export const NOT_THE_RUNS_RUNNER_TO_BIND_MESSAGE =
  "only the runner acting for this run may record its session's harness state";

export type BindHarnessStateDeps = Pick<
  AppendSessionEventsDeps,
  "store" | "logger" | "runnerAuth"
>;

export async function bindHarnessState(
  deps: BindHarnessStateDeps,
  input: BindHarnessStateInput,
  ctx: HandlerContext,
): Promise<BindHarnessStateResponse> {
  if (input.runId === "") {
    throw invalidArgumentError("run_id is required");
  }
  if (input.harnessStateId === "") {
    throw invalidArgumentError("harness_state_id is required");
  }
  const token = parseBearerToken(ctx.requestHeader.get("authorization") ?? "");
  if (token === "" || !(await mayAppend(deps, token, input.runId))) {
    throw permissionDeniedError(NOT_THE_RUNS_RUNNER_TO_BIND_MESSAGE);
  }

  const run = await loadRun(deps.store, input.runId);
  if (isTerminalExecutionPhase(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED)) {
    throw failedPreconditionError(
      `run '${input.runId}' is finished; it records no more harness state`,
    );
  }
  const sessionId = sessionIdOfRun(run);
  if (sessionId === "") {
    throw failedPreconditionError(
      `run '${input.runId}' is in no session; it has no harness state to record`,
    );
  }

  let written;
  try {
    written = await deps.store.updateResource(
      ApiResourceKind.session,
      sessionId,
      SessionSchema,
      (session) => {
        session.status ??= create(SessionStatusSchema);
        recordHarnessState(session.status, input.harnessStateId);
      },
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError("session", sessionId);
    }
    throw internalError(error, "failed to record the session's harness state");
  }
  return create(BindHarnessStateResponseSchema, {
    harnessStateId: written.status?.harnessStateId ?? "",
    harnessStateIdHistory: [...(written.status?.harnessStateIdHistory ?? [])],
  });
}

async function loadRun(store: Store, runId: string): Promise<Run> {
  try {
    return await store.getResource(ApiResourceKind.run, runId, RunSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw permissionDeniedError(NOT_THE_RUNS_RUNNER_TO_BIND_MESSAGE);
    }
    throw internalError(error, "failed to load the run");
  }
}
