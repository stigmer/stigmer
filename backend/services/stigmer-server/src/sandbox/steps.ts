/**
 * The session sandbox invocation surface — the postures the cloud
 * edition proved in production:
 *
 *   - EnsureSessionSandbox (agent executions): AFTER StartWorkflow,
 *     NON-critical. A provisioning failure never fails the launch, but it
 *     is never silent either — ERROR-logged and PRE-STAMPED onto
 *     status.error first-non-empty-wins, so when the agent activity dies
 *     at its ScheduleToStartTimeout minutes later the user sees the root
 *     cause instead of a generic timeout. The 2026-07 cloud quota outage
 *     hid for two days behind this step's former WARN-and-swallow — the
 *     pre-stamp posture is contract.
 *   - DeprovisionSessionSandbox (session delete): best-effort teardown,
 *     ERROR-logged on failure, never fails the delete (the Java
 *     SessionDeleteHandler posture).
 *
 * The pre-stamp rides Store.updateResource (atomic read-modify-write) —
 * a whole-resource save here would race the runner's concurrent
 * UpdateStatus writes; load-then-save stays banned in status paths.
 *
 * Every step short-circuits when the lane is disabled or the execution's
 * resolved target is LOCAL — the conformance rosters run entirely on
 * those fast paths (byte-identity by construction).
 *
 * One conversation, one workspace, one runner, acting as the
 * conversation's creator: a session has one sandbox, and its runner
 * credential is minted for the person the session's creator stamp names,
 * whoever's turn creates, restores or repairs it. A person a conversation
 * is shared with may send a turn that finds its sandbox archived; minting
 * for that sender would move the runner, and every later turn's status
 * reports, to them (stigmer#2075). A stamp that names nobody (a deleted
 * account, "system") mints nothing: the sandbox launches tokenless and its
 * values fetch is refused, so the conversation fails closed rather than
 * running as the sender. Under the trusted-local posture (no accounts
 * port) the one operator is every session's creator and the caller is
 * minted for, as before.
 */
import { create } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../boot/logger.js";
import type { AccountsByCaller } from "../domain/identityaccount/resolve.js";
import { accountForStamp } from "../domain/identityaccount/resolve.js";
import { createdByOf } from "../pipeline/steps/authorization-facts.js";
import type { AgentExecutionTemporalConfig } from "../domain/run/temporal/config.js";
import type { CallerIdentity } from "../extensions/identity.js";
import type { PipelineStep } from "../pipeline/pipeline.js";
import {
  formatSessionTaskQueue,
  resolveActivityTaskQueue,
} from "../temporal/agentexecution/dispatch.js";
import type { Store } from "../store/interface.js";
import { mintSandboxToken, type SandboxLane } from "./lane.js";
import { sessionIdOf } from "../domain/run/target.js";

/**
 * The pre-stamped root-cause prefix — the cloud edition's
 * stampProvisioningFailure copy, kept identical (the same failure must
 * read the same on both editions).
 */
export const SANDBOX_PROVISIONING_FAILED_PREFIX =
  "Sandbox provisioning failed: ";

/**
 * The two facts about the requesting caller a sandbox ensure carries, cut
 * from the chain's CallerIdentity (the domain/identityaccount/actor.ts
 * shape): the class rides onto the driver's environment, so a driver can
 * decide the workspace's durability by who asked; the id is minted for
 * only under the trusted-local posture (the module header: otherwise the
 * session's creator is). A step hands `ctx.callerIdentity` in whole; the
 * pick keeps a test's fixture to the two fields the body reads.
 */
export type SandboxCaller = Pick<CallerIdentity, "identityId" | "callerClass">;

type AgentExecutionCreateDesc = typeof RunSchema;

export interface EnsureSessionSandboxDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly lane: SandboxLane;
  readonly temporalConfig: AgentExecutionTemporalConfig;
  /**
   * Resolves the session's creator stamp to the account the runner acts
   * as; undefined under the trusted-local posture, where the caller is the
   * one operator (the module header).
   */
  readonly accounts: AccountsByCaller | undefined;
}

/**
 * The session-lane ensure step (module header, the first posture). Placed after
 * StartWorkflow in the agent-execution create chain and after
 * StartFreshWorkflow in recover — the sandbox boots concurrently with the
 * workflow's first activity ScheduleToStart window.
 *
 * Dispatch is re-resolved here (one extra session read, on the
 * enabled+CLOUD arm only) so the step stays self-contained — the same
 * choice the Java step makes rather than threading dispatch results
 * through the chain.
 */
export function newEnsureSessionSandboxStep(
  deps: EnsureSessionSandboxDeps,
): PipelineStep<AgentExecutionCreateDesc> {
  return {
    name: "EnsureSessionSandbox",
    async execute(ctx) {
      await ensureSessionSandboxForExecution(
        deps,
        ctx.newState,
        ctx.callerIdentity,
      );
    },
  };
}

/**
 * The session-lane body, shared by the create step above and the recover
 * chain's post-StartFreshWorkflow invocation (lifecycle.ts) — the Java
 * precedent wires ONE step bean into both pipelines; here the two
 * chains' differing context shapes (newState vs loaded execution) meet
 * at this seam instead.
 *
 * The credential mint (lane.ts) names the session's creator, read with a
 * point read of its own and resolved as the runner verifier resolves a
 * stamp (`accountForStamp`); `callerClass` rides onto the driver's
 * environment as the one request fact a driver may decide durability by.
 * The chain always has a caller: the in-process transport mints
 * `internal` for the server's own calls.
 */
export async function ensureSessionSandboxForExecution(
  deps: EnsureSessionSandboxDeps,
  execution: Run,
  caller: SandboxCaller,
): Promise<void> {
  if (!deps.lane.enabled) {
    return;
  }
  const lane = deps.lane;
  const executionId = execution.metadata?.id ?? "";
  const sessionId = sessionIdOf(execution.spec);
  if (sessionId === "") {
    return;
  }
  try {
    const dispatch = await resolveActivityTaskQueue(
      deps.store,
      sessionId,
      deps.temporalConfig,
      deps.logger,
    );
    if (dispatch.executionTarget !== ExecutionTarget.CLOUD) {
      return;
    }
    if (dispatch.taskQueue !== formatSessionTaskQueue(sessionId)) {
      // CLOUD target under global routing: the sandbox would have to
      // poll the shared queue, which is the external-runner posture —
      // boot coherence validation forbids the combination; this arm is
      // the belt-and-braces skip.
      deps.logger.warn(
        "Sandbox provisioning skipped: session routing is not per-session",
        { executionId, sessionId, taskQueue: dispatch.taskQueue },
      );
      return;
    }
    await lane.provisioner.ensureSessionSandbox(sessionId, {
      taskQueue: dispatch.taskQueue,
      stigmerToken: mintSandboxToken(
        lane,
        {
          scope: "session",
          sessionId,
          executionId,
          org: execution.metadata?.org ?? "",
          callerIdentityId: await sandboxPersonOf(deps, sessionId, caller),
        },
        deps.logger,
      ),
      callerClass: caller.callerClass,
    });
  } catch (error) {
    // Non-critical: never fail the launch — but never silent either
    // (module header). The real error goes to the log; the sanitized
    // root cause is pre-stamped for the timeout the user will see.
    deps.logger.error(
      "Session sandbox provisioning failed - execution will time out unless a runner polls its queue",
      {
        executionId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    await stampProvisioningFailure(deps.store, deps.logger, executionId, error);
  }
}

/**
 * The account a session's runner acts as: its creator's (the module
 * header), or "" when the stamp names nobody, which the mint answers
 * tokenless. Under the trusted-local posture, the caller's.
 */
async function sandboxPersonOf(
  deps: EnsureSessionSandboxDeps,
  sessionId: string,
  caller: SandboxCaller,
): Promise<string> {
  if (deps.accounts === undefined) {
    return caller.identityId;
  }
  const session = await deps.store.getResource(
    ApiResourceKind.session,
    sessionId,
    SessionSchema,
  );
  const creator = await accountForStamp(deps.accounts, createdByOf(session));
  return creator?.metadata?.id ?? "";
}

/**
 * First-non-empty-wins stamp of the provisioning root cause onto
 * status.error (the Java setStatusErrorIfEmpty semantic) via the store's
 * atomic read-modify-write. Touches ONLY the error field — phase stays
 * the runner-owned lane. Best-effort: a stamp failure is logged, never
 * thrown (the execution is already launched).
 */
async function stampProvisioningFailure(
  store: Store,
  logger: Logger,
  executionId: string,
  cause: unknown,
): Promise<void> {
  const message =
    SANDBOX_PROVISIONING_FAILED_PREFIX +
    (cause instanceof Error ? cause.message : String(cause));
  try {
    await store.updateResource(
      ApiResourceKind.run,
      executionId,
      RunSchema,
      (execution: Run) => {
        execution.status ??= create(RunStatusSchema);
        if (execution.status.error === "") {
          execution.status.error = message;
        }
      },
    );
  } catch (error) {
    logger.error("Failed to pre-stamp sandbox provisioning failure", {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Best-effort session-sandbox teardown for the session delete handler
 * (module header, the second posture; the Java SessionDeleteHandler shape — a
 * handler call after the delete pipeline, not a pipeline step). A
 * failure never fails the delete (the row is already gone) but is
 * ERROR-logged — no reaper exists to catch a leak.
 */
export async function deprovisionSessionSandboxBestEffort(
  lane: SandboxLane,
  logger: Logger,
  sessionId: string,
): Promise<void> {
  if (!lane.enabled || sessionId === "") {
    return;
  }
  try {
    await lane.provisioner.deprovisionSessionSandbox(sessionId);
  } catch (error) {
    logger.error("Session sandbox deprovision failed - sandbox may be leaked", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
