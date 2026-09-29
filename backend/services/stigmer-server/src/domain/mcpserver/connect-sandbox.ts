/**
 * Where one MCP connect runs: the one module that decides a connect's task
 * queue and owns the connect sandbox's lifecycle (stigmer/stigmer#1474).
 *
 * Without a sandbox provisioner (the external-runner posture, the OSS
 * default) a connect runs on the shared runner queue exactly as it always
 * has: an operator-managed runner polls it, and nothing is provisioned.
 *
 * With a provisioner composed, that queue has no poller at all: boot
 * requires a per-queue routing mode beside a provisioner
 * (boot/compose.ts), so session sandboxes serve `session:<id>`, workflow
 * sandboxes `wfexec:<id>`, and nobody serves `stigmer_runner`. A connect
 * started there waited until its run timeout with a "no runner" advisory
 * on its status. Here every connect instead gets a request-scoped connect
 * sandbox (the provisioner contract's CONNECT scope, sandbox/provisioner.ts)
 * whose runner polls the connect's own queue
 * (temporal/mcpserver/names.ts `connectTaskQueueFor`), and the lane that
 * started the run releases it when the run settles.
 *
 * The sandbox's credential acts as the person who asked for the connect.
 * The runner reads the McpServer and classifies its tools through the
 * proxy with the credential baked into its sandbox, so it is minted for
 * that person, scoped to this one connect (`scope: "connect"`,
 * runnerauth/runner-credential-provider.ts). On the OSS execution-scoped
 * lane the binding resolves the person from the connect's ExecutionContext
 * row (runnerauth/bound-execution.ts, the `mcp-connect` binding), which is
 * why prepareConnect always creates that row when a lane is composed, even
 * for a server that declares no env. A composed mintSandboxCredential
 * capability mints its own edition's equivalent from the same request.
 *
 * Failure posture: provisioning is CRITICAL here. A connect whose sandbox
 * cannot be created fails at once with an honest Unavailable instead of
 * starving to its run timeout (the ask of the closed stigmer-cloud#302),
 * the workflow sandbox's posture and copy shape (sandbox/steps.ts).
 * Release is best-effort and never throws: a settle must never fail on
 * teardown, and a sandbox a release could not delete is what the edition's
 * orphan sweep exists for (the cloud reaps every connect object past its
 * grace; OSS has no reaper, the workflow scope's known window).
 */
import type { Logger } from "../../boot/logger.js";
import { unavailableError } from "../../pipeline/errors.js";
import { mintSandboxToken, type SandboxLane } from "../../sandbox/lane.js";
import type { SandboxCaller } from "../../sandbox/steps.js";
import { connectTaskQueueFor } from "../../temporal/mcpserver/names.js";
import type { ConnectTaskQueue } from "./engine.js";

/** The refusal when a connect sandbox cannot be provisioned. */
export const CONNECT_SANDBOX_PROVISIONING_FAILED =
  "failed to provision connect sandbox";

/** A connect's route: the queue its run starts on, and how to give back what serving it took. */
export interface ConnectRoute {
  readonly taskQueue: ConnectTaskQueue;
  /** Tears down the connect sandbox, if one was provisioned. Idempotent; never throws. */
  release(): Promise<void>;
}

export interface ConnectRouteRequest {
  /** The connect's synthetic execution id — the sandbox's id, its queue's suffix, and its credential's binding. */
  readonly connectExecutionId: string;
  /** The organization the connect runs in (the caller's `input.org`). */
  readonly org: string;
  /** The person the sandbox's runner acts as. */
  readonly caller: SandboxCaller;
}

const SHARED_RUNNER_ROUTE: ConnectRoute = Object.freeze({
  taskQueue: Object.freeze({ kind: "runner" as const }),
  release: async () => {},
});

/**
 * Resolves where a connect runs, provisioning its sandbox when a lane is
 * composed. Throws Unavailable when provisioning fails; the caller has not
 * started a run yet, so nothing else needs undoing but its own
 * ExecutionContext.
 */
export async function acquireConnectRoute(
  lane: SandboxLane,
  logger: Logger,
  request: ConnectRouteRequest,
): Promise<ConnectRoute> {
  if (!lane.enabled) {
    return SHARED_RUNNER_ROUTE;
  }
  const { connectExecutionId, org, caller } = request;
  const taskQueue = connectTaskQueueFor(connectExecutionId);
  let sandboxId: string;
  try {
    sandboxId = await lane.provisioner.createConnectSandbox(
      connectExecutionId,
      {
        taskQueue,
        stigmerToken: mintSandboxToken(
          lane,
          {
            scope: "connect",
            sessionId: "",
            executionId: connectExecutionId,
            org,
            callerIdentityId: caller.identityId,
          },
          logger,
        ),
        callerClass: caller.callerClass,
      },
    );
  } catch (error) {
    logger.error("Connect sandbox provisioning failed - refusing the connect", {
      execution_id: connectExecutionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw unavailableError(CONNECT_SANDBOX_PROVISIONING_FAILED);
  }

  let released = false;
  return {
    taskQueue: { kind: "sandbox", name: taskQueue },
    async release() {
      if (released) {
        return;
      }
      released = true;
      try {
        await lane.provisioner.deprovisionConnectSandbox(sandboxId);
      } catch (error) {
        logger.warn("Failed to deprovision connect sandbox (non-fatal)", {
          execution_id: connectExecutionId,
          sandbox_id: sandboxId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
