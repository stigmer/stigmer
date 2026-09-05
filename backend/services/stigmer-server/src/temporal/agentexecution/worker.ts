/**
 * The agent-execution worker factory — ports the registration half of
 * pkg/domain/agentexecution/temporal/worker_config.go.
 *
 * Queue architecture (worker_config.go's contract):
 *   - This worker polls ONLY the stigmer queue (agent_execution_stigmer):
 *     the invoke workflow + the server-side activities.
 *   - The TS unified runner polls the runner queue and owns EnsureThread,
 *     ExecuteDeepAgent, ExecuteCursor, GenerateSessionSubject. Each
 *     worker registers ONLY what it implements — a worker registering the
 *     other side's names would break queue-based routing.
 *
 * The workflow type registers under its byte-pinned slash name via the
 * barrel's arbitrary export name (workflows/index.ts); the SDK derives
 * workflow types from export names, so no explicit registration option
 * exists or is needed.
 *
 * Workflow source: runtime bundling from the compiled entry (ratified
 * brief #7 — the operative mode until #24 ships prebuilt bundles; the
 * prebuilt sibling is the hook it fills).
 */
import type { Logger } from "../../boot/logger.js";
import type { AgentExecutionTemporalConfig } from "../../domain/agentexecution/temporal/config.js";
import type { Store } from "../../store/interface.js";
import type { WorkerFactory } from "../manager.js";
import { resolveWorkflowSource } from "../workflow-source.js";
import type { ExecutionStatusWriter } from "./activities.js";
import { createAgentExecutionActivities } from "./activities.js";

export interface AgentExecutionWorkerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /**
   * The in-process status edge for the worker's own-behalf writes
   * (activities.ts header): the Authorizer, the status hooks, and the
   * broadcast all live in the handler this edge reaches — the worker
   * composes none of them itself.
   */
  readonly statusWriter: () => ExecutionStatusWriter;
  readonly temporalConfig: AgentExecutionTemporalConfig;
}

export function newAgentExecutionWorkerFactory(
  deps: AgentExecutionWorkerDeps,
): WorkerFactory {
  return async ({ createWorker, client }) => {
    const activities = createAgentExecutionActivities({
      store: deps.store,
      logger: deps.logger,
      statusWriter: deps.statusWriter,
      client,
    });

    const workflowSource = resolveWorkflowSource({
      workflowsEntryCandidates: [
        // Compiled dist (how conformance and the CLI boot the server).
        new URL("./workflows/index.js", import.meta.url),
        // The tsx dev loop runs from src/ — the SDK bundler compiles TS.
        new URL("./workflows/index.ts", import.meta.url),
      ],
      prebuiltSibling: new URL(
        "./workflow-bundle-agent-execution.js",
        import.meta.url,
      ),
    });

    deps.logger.info("Creating agent-execution Temporal worker", {
      stigmer_queue: deps.temporalConfig.stigmerQueue,
      runner_queue: deps.temporalConfig.runnerQueue,
      workflow_source: workflowSource.kind,
    });

    // Connection, namespace, and the decode-only codec chain are the
    // capability's concern (manager.ts's choke-point note) — the factory
    // decides only queue, activities, and workflow source.
    return createWorker({
      taskQueue: deps.temporalConfig.stigmerQueue,
      activities,
      workflows:
        workflowSource.kind === "prebuilt"
          ? { workflowBundle: { codePath: workflowSource.codePath } }
          : { workflowsPath: workflowSource.workflowsPath },
    });
  };
}
