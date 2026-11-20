/**
 * The session sandbox invocation surface — the postures the cloud
 * edition proved in production:
 *
 *   - EnsureSessionSandbox (agent executions): AFTER StartWorkflow,
 *     NON-critical. A provisioning failure never fails the launch, but it
 *     is never silent either — ERROR-logged and PRE-STAMPED onto
 *     status.error first-non-empty-wins, so when the agent activity dies
 *     at its ScheduleToStartTimeout minutes later the user sees the root
 *     cause instead of a generic timeout. A warn-and-swallow here would
 *     hide a provisioning outage (a cloud quota, say) behind that
 *     timeout — the pre-stamp posture is contract. The one exception is
 *     the fleet's "no room" (SandboxNoRoomError anywhere in the error's
 *     cause chain, provisioner.ts `isSandboxNoRoom`): it is
 *     logged at info and never stamped, because it is not a failure. The
 *     agent-execution workflow runs the same body as its own activity
 *     before the turn's first runner activity
 *     (temporal/agentexecution/activities.ts), and on "no room" waits and
 *     asks again (temporal/agentexecution/sandbox-wait.ts). The request's
 *     ensure stays beside it for now: a second ensure of an awake sandbox
 *     only rotates the token its runner would restart with, and a run
 *     created while an older server still runs the workflow's tasks during
 *     a rolling update is woken by the request's. Only the workflow's
 *     ensure says the runner is idle (SandboxFacts.runnerIdle), so only it
 *     may restart a running sandbox started under another configuration;
 *     the request's and the recover chain's race the turn's first runner
 *     activity and, during a rolling update, run on either release
 *     (stigmer#1843).
 *   - Making room. Only the workflow's ensure says a run is waiting
 *     (`options.makeRoom`): on "no room" it asks a provisioner that offers
 *     `makeRoom` to put one idle sandbox to sleep, and when one went to
 *     sleep asks for its own sandbox again on a short schedule
 *     (make-room.ts MAKE_ROOM_RETRY_DELAYS_MS), because Substrate's
 *     scheduler may see the freed seat a moment late. The retries hand the
 *     driver the same facts, so the runner's token is minted once per ask.
 *     The request's ensure never asks, so one run puts at most one sandbox
 *     to sleep per ask of its workflow. A `makeRoom` that throws is logged
 *     and read as false: the turn waits as it would have, and the ask's
 *     one info line says whether room was made (`madeRoom`).
 *   - A sandbox whose files cannot be carried to this server's runner
 *     (SandboxNotCarriedError, provisioner.ts `isSandboxNotCarried`)
 *     answers `not_carried` and pre-stamps the person's sentence
 *     (temporal/agentexecution/sandbox-wait.ts SANDBOX_NOT_CARRIED_COPY),
 *     never the driver's words, which name templates. The workflow ends
 *     the turn on it at once and writes the same sentence; the stamp is
 *     for a workflow of a release before that end, whose turn then times
 *     out.
 *   - DeprovisionSessionSandbox (session delete): best-effort teardown,
 *     ERROR-logged on failure, never fails the delete.
 *
 * The pre-stamp rides Store.updateResource (atomic read-modify-write) —
 * a whole-resource save here would race the runner's concurrent
 * UpdateStatus writes; load-then-save stays banned in status paths.
 *
 * The session's Environment rides the ensure as SandboxFacts.environment,
 * read from its current row each time (domain/run/environment-admission.ts
 * sessionEnvironmentFacts), so an edit reaches the conversation at its
 * sandbox's next start and its next turn. One that is gone fails the
 * provisioning, stamped on the run like any other; run create and recover
 * refuse the turn naming it.
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

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ExecutionTarget } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

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
import { MAKE_ROOM_RETRY_DELAYS_MS } from "./make-room.js";
import {
  isSandboxNoRoom,
  isSandboxNotCarried,
  type SandboxFacts,
  type SandboxProvisioner,
} from "./provisioner.js";
import {
  SANDBOX_NOT_CARRIED_COPY,
  type SandboxEnsureOutcome,
} from "../temporal/agentexecution/sandbox-wait.js";
import { sessionIdOf } from "../domain/run/target.js";
import { sessionEnvironmentFacts } from "../domain/run/environment-admission.js";

/**
 * The pre-stamped root-cause prefix — the cloud edition's
 * stampProvisioningFailure copy, kept identical (the same failure must
 * read the same on both editions).
 */
export const SANDBOX_PROVISIONING_FAILED_PREFIX =
  "Sandbox provisioning failed: ";

/**
 * The facts about the requesting caller a sandbox ensure carries, cut
 * from the chain's CallerIdentity (the domain/identityaccount/actor.ts
 * shape): the class, and the routine when the request is a routine's
 * fire, ride onto the driver's environment, so a driver can decide the
 * workspace's durability by who asked and why; the id is minted for only
 * under the trusted-local posture (the module header: otherwise the
 * session's creator is). A step hands `ctx.callerIdentity` in whole; the
 * pick keeps a test's fixture to the fields the body reads.
 */
export type SandboxCaller = Pick<CallerIdentity, "identityId" | "callerClass" | "routineId">;

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
  /** Waits between asks once room was made; a real timer when absent (tests pass their own). */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** What only the workflow's ensure says (module header). */
export interface EnsureSessionSandboxOptions {
  /** The workflow asks with none of the turn's runner work in flight. */
  readonly runnerIdle?: boolean;
  /** The run is waiting for its sandbox: on "no room", ask the provisioner to make room. */
  readonly makeRoom?: boolean;
}

/**
 * The session-lane ensure step (module header, the first posture). Placed after
 * StartWorkflow in the agent-execution create chain and after
 * StartFreshWorkflow in recover — the sandbox boots concurrently with the
 * workflow's first activity ScheduleToStart window.
 *
 * Dispatch is re-resolved here (one extra session read, on the
 * enabled+CLOUD arm only) so the step stays self-contained rather than
 * threading dispatch results through the chain.
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
 * chain's post-StartFreshWorkflow invocation (lifecycle.ts): one body for
 * both pipelines, whose differing context shapes (newState vs loaded
 * execution) meet at this seam.
 *
 * The credential mint (lane.ts) names the session's creator, read with a
 * point read of its own and resolved as the runner verifier resolves a
 * stamp (`accountForStamp`); `callerClass` and, for a routine's fire,
 * `routineId` ride onto the driver's environment as the request facts a
 * driver may decide durability by, and `executionId` names the turn's run
 * so a host can tie the sandbox's place to the start it accepted.
 * The chain always has a caller: the in-process transport mints
 * `internal` for the server's own calls.
 *
 * Returns what the ensure came to (SandboxEnsureOutcome): the request's
 * steps ignore it, and the workflow's activity waits on `no_room` and ends
 * the turn on `not_carried`. `options.runnerIdle` and `options.makeRoom`
 * are the workflow's activity's alone (module header).
 */
export async function ensureSessionSandboxForExecution(
  deps: EnsureSessionSandboxDeps,
  execution: Run,
  caller: SandboxCaller,
  options?: EnsureSessionSandboxOptions,
): Promise<SandboxEnsureOutcome> {
  if (!deps.lane.enabled) {
    return "skipped";
  }
  const lane = deps.lane;
  const executionId = execution.metadata?.id ?? "";
  const sessionId = sessionIdOf(execution.spec);
  if (sessionId === "") {
    return "skipped";
  }
  // Whether this ask made room: absent when it did not ask (module header).
  let madeRoom: boolean | undefined;
  try {
    const dispatch = await resolveActivityTaskQueue(
      deps.store,
      sessionId,
      deps.temporalConfig,
      deps.logger,
    );
    if (dispatch.executionTarget !== ExecutionTarget.CLOUD) {
      return "skipped";
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
      return "skipped";
    }
    const environment = await sessionEnvironmentFacts(
      deps.store,
      await deps.store.getResource(ApiResourceKind.session, sessionId, SessionSchema),
    );
    const facts: SandboxFacts = {
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
      executionId,
      ...(caller.routineId !== undefined ? { routineId: caller.routineId } : {}),
      ...(environment !== undefined ? { environment } : {}),
      ...(options?.runnerIdle === true ? { runnerIdle: true } : {}),
    };
    const provisioner = lane.provisioner;
    try {
      await provisioner.ensureSessionSandbox(sessionId, facts);
    } catch (error) {
      if (
        options?.makeRoom !== true ||
        provisioner.makeRoom === undefined ||
        !isSandboxNoRoom(error)
      ) {
        throw error;
      }
      madeRoom = await askForRoom(deps.logger, provisioner, sessionId, executionId);
      if (!madeRoom) {
        throw error;
      }
      await ensureOnceRoomIsSeen(deps, provisioner, sessionId, facts);
    }
    return "ready";
  } catch (error) {
    if (isSandboxNoRoom(error)) {
      // Not a failure (module header): the turn waits and asks again.
      deps.logger.info("No sandbox has room for the session now", {
        executionId,
        sessionId,
        ...(madeRoom !== undefined ? { madeRoom } : {}),
        error: error instanceof Error ? error.message : String(error),
      });
      return "no_room";
    }
    if (isSandboxNotCarried(error)) {
      // Not run on its old runner (module header): the turn ends with the
      // person's sentence, stamped here for a workflow that does not end it.
      deps.logger.warn("The session's sandbox cannot be carried to this server's runner", {
        executionId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      await stampProvisioningFailure(deps.store, deps.logger, executionId, SANDBOX_NOT_CARRIED_COPY, "");
      return "not_carried";
    }
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
    return "failed";
  }
}

/**
 * Asks the provisioner to put one idle sandbox to sleep for the waiting
 * session; a rejection is logged and read as false (module header).
 */
async function askForRoom(
  logger: Logger,
  provisioner: SandboxProvisioner,
  sessionId: string,
  executionId: string,
): Promise<boolean> {
  try {
    return (await provisioner.makeRoom?.(sessionId)) === true;
  } catch (error) {
    logger.warn("Could not put an idle sandbox to sleep for a waiting run; it waits for room as before", {
      executionId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Asks for the sandbox again once room was made, on MAKE_ROOM_RETRY_DELAYS_MS,
 * with the same facts; rethrows the last "no room" when the freed seat is
 * still not seen, and any other error at once.
 */
async function ensureOnceRoomIsSeen(
  deps: EnsureSessionSandboxDeps,
  provisioner: SandboxProvisioner,
  sessionId: string,
  facts: SandboxFacts,
): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let last: unknown;
  for (const delay of MAKE_ROOM_RETRY_DELAYS_MS) {
    await sleep(delay);
    try {
      await provisioner.ensureSessionSandbox(sessionId, facts);
      return;
    } catch (error) {
      if (!isSandboxNoRoom(error)) {
        throw error;
      }
      last = error;
    }
  }
  throw last;
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
 * status.error via the store's
 * atomic read-modify-write. Touches ONLY the error field — phase stays
 * the runner-owned lane. Best-effort: a stamp failure is logged, never
 * thrown (the execution is already launched).
 */
async function stampProvisioningFailure(
  store: Store,
  logger: Logger,
  executionId: string,
  cause: unknown,
  prefix = SANDBOX_PROVISIONING_FAILED_PREFIX,
): Promise<void> {
  const message =
    prefix + (cause instanceof Error ? cause.message : String(cause));
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
 * (module header, the second posture; a handler call after the delete
 * pipeline, not a pipeline step). A
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
