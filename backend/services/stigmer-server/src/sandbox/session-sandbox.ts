/**
 * The session sandbox, as the server asks for it: the turn's ensure and
 * the session delete's teardown. The postures the cloud edition proved in
 * production:
 *
 *   - EnsureSessionSandbox (agent executions): the turn's ensure, the only
 *     one the server makes. The agent-execution workflow runs it as its
 *     own activity (temporal/agentexecution/activities.ts) before each of
 *     the turn's runner invocations, with none of the turn's runner work
 *     in flight, so it always tells the driver the runner is idle
 *     (SandboxFacts.runnerIdle): a driver may restart a running sandbox
 *     started under another configuration only then. The run create and
 *     recover requests end at their workflow's start and never ask.
 *   - NON-critical. A provisioning failure never fails the turn here, but
 *     it is never silent either: ERROR-logged and PRE-STAMPED onto
 *     status.error first-non-empty-wins, so when the runner activity dies
 *     at its ScheduleToStartTimeout minutes later the user sees the root
 *     cause instead of a generic timeout. A warn-and-swallow here would
 *     hide a provisioning outage (a cloud quota, say) behind that
 *     timeout; the pre-stamp posture is contract.
 *   - "No room" is not a failure. The fleet's "no room"
 *     (SandboxNoRoomError anywhere in the error's cause chain,
 *     provisioner.ts `isSandboxNoRoom`) is logged at info and never
 *     stamped; the workflow waits and asks again
 *     (temporal/agentexecution/sandbox-wait.ts). Every ask makes room
 *     first: on "no room" it asks a provisioner that offers `makeRoom` to
 *     put one idle sandbox to sleep, and when one went to sleep asks for
 *     its own sandbox again on a short schedule
 *     (make-room.ts MAKE_ROOM_RETRY_DELAYS_MS), because Substrate's
 *     scheduler may see the freed seat a moment late. The retries hand the
 *     driver the same facts, so the runner's token is minted once per ask,
 *     and one run puts at most one sandbox to sleep per ask. A `makeRoom`
 *     that throws is logged and read as false: the turn waits as it would
 *     have, and the ask's one info line says whether room was made
 *     (`madeRoom`).
 *   - A sandbox whose files cannot be carried to this server's runner
 *     (SandboxNotCarriedError, provisioner.ts `isSandboxNotCarried`)
 *     answers `not_carried` and pre-stamps the person's sentence
 *     (temporal/agentexecution/sandbox-wait.ts SANDBOX_NOT_CARRIED_COPY),
 *     never the driver's words, which name templates. The workflow ends
 *     the turn on it at once and writes the same sentence; the stamp is
 *     for a workflow of a release before that end, whose turn then times
 *     out.
 *   - A sandbox killed for exceeding its memory limit
 *     (SandboxOutOfMemoryError, provisioner.ts `isSandboxOutOfMemory`)
 *     answers `out_of_memory` and stamps nothing: the driver has already
 *     put the sandbox back to sleep, and the workflow decides which turn
 *     the kill ends and writes the sentence itself
 *     (sandbox-wait.ts SANDBOX_OUT_OF_MEMORY_COPY, stigmer#3347).
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
 * The ensure and the teardown short-circuit when the lane is disabled,
 * and the ensure whenever no sandbox of this server serves the turn
 * (domain/run/placement.ts: a LOCAL target, or a conversation without a
 * computer that a shared runner serves): the conformance rosters run
 * entirely on those fast paths (byte-identity by construction).
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
import { setTimeout as delay } from "node:timers/promises";

import { create } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../boot/logger.js";
import type { AccountsByCaller } from "../domain/identityaccount/resolve.js";
import { accountForStamp } from "../domain/identityaccount/resolve.js";
import { createdByOf } from "../pipeline/steps/authorization-facts.js";
import type { AgentExecutionTemporalConfig } from "../domain/run/temporal/config.js";
import type { CallerIdentity } from "../extensions/identity.js";
import { resolveActivityTaskQueue } from "../temporal/agentexecution/dispatch.js";
import type { Store } from "../store/interface.js";
import { mintSandboxToken, type SandboxLane } from "./lane.js";
import { MAKE_ROOM_RETRY_DELAYS_MS } from "./make-room.js";
import {
  isSandboxNoRoom,
  isSandboxNotCarried,
  isSandboxOutOfMemory,
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
 * The facts about the turn's caller a sandbox ensure carries, cut from
 * the CallerIdentity the run's request carried (the
 * domain/identityaccount/actor.ts shape): the class, and the routine when
 * the request is a routine's fire, ride onto the driver's environment, so
 * a driver can decide the workspace's durability by who asked and why;
 * the id is minted for only under the trusted-local posture (the module
 * header: otherwise the session's creator is). The workflow's activity
 * rebuilds it from the workflow input; the pick keeps a test's fixture to
 * the fields the body reads.
 */
export type SandboxCaller = Pick<CallerIdentity, "identityId" | "callerClass" | "routineId">;

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

/**
 * The turn's sandbox ensure (module header, the first posture), run by the
 * agent-execution workflow's EnsureSessionSandbox activity before each
 * runner invocation. Dispatch is resolved here (one session read, on the
 * enabled arm only), so the condition for asking (a CLOUD target under
 * per-session routing) lives in this body alone.
 *
 * The credential mint (lane.ts) names the session's creator, read with a
 * point read of its own and resolved as the runner verifier resolves a
 * stamp (`accountForStamp`); `callerClass` and, for a routine's fire,
 * `routineId` ride onto the driver's environment as the request facts a
 * driver may decide durability by, and `executionId` names the turn's run
 * so a host can tie the sandbox's place to the start it accepted.
 *
 * Returns what the ensure came to (SandboxEnsureOutcome): the workflow
 * waits on `no_room` and ends the turn on `not_carried` and
 * `out_of_memory`.
 */
export async function ensureSessionSandboxForExecution(
  deps: EnsureSessionSandboxDeps,
  execution: Run,
  caller: SandboxCaller,
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
      lane.enabled,
    );
    if (dispatch.placement !== "sandbox") {
      // A LOCAL target, or a turn a shared runner serves (a conversation
      // without a computer, domain/run/placement.ts): no sandbox to start.
      // CLOUD under global routing lands here too; boot coherence
      // validation forbids that combination, so this is its
      // belt-and-braces skip.
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
      // Asked right before the runner is invoked, with none of the turn's
      // runner work in flight, so a driver may restart a sandbox started
      // under another configuration (stigmer#1843).
      runnerIdle: true,
    };
    const provisioner = lane.provisioner;
    try {
      await provisioner.ensureSessionSandbox(sessionId, facts);
    } catch (error) {
      // The run is waiting for its sandbox, so on "no room" the driver may
      // put an idle one to sleep for it (make-room.ts).
      if (provisioner.makeRoom === undefined || !isSandboxNoRoom(error)) {
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
    if (isSandboxOutOfMemory(error)) {
      // Stamped by no one here (module header): the workflow ends the turn
      // the kill belongs to.
      deps.logger.warn("The session's sandbox was killed for exceeding its memory limit", {
        executionId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return "out_of_memory";
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
  const sleep = deps.sleep ?? delay;
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
 * (module header, the last posture; a handler call after the delete
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
