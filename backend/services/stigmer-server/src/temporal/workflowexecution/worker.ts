/**
 * The workflow-execution worker factory — ports the registration half of
 * pkg/domain/workflowexecution/temporal/worker_config.go.
 *
 * Queue architecture (worker_config.go's contract):
 *   - This worker polls ONLY the stigmer queue
 *     (workflow_execution_stigmer): the orchestrator workflow + the
 *     server-side activities (UpdateWorkflowExecutionStatus,
 *     DeleteExecutionContext).
 *   - The TS unified runner polls the runner queue and owns the child
 *     workflow "stigmer/workflow/execute-from-execution". Each worker
 *     registers ONLY what it implements — registering the other side's
 *     names would break queue-based routing.
 *
 * The workflow type registers under its byte-pinned slash name via the
 *
 * barrel's arbitrary export name (workflows/index.ts); the SDK derives
 * workflow types from export names, so no explicit registration option
 * exists or is needed.
 *
 * Workflow source: runtime bundling from the compiled entry in a tsc
 * build, and the prebuilt sibling bundle in a slim artifact (see
 * workflow-source.ts).
 */
import type { Logger } from "../../boot/logger.js";
import type { ExecutionContextDeleter } from "../../domain/executioncontext/internal-delete.js";
import type { WorkflowExecutionTemporalConfig } from "../../domain/workflowexecution/temporal/config.js";
import type { StreamBroker } from "../../domain/workflowexecution/stream-broker.js";
import type { WorkflowSandboxTerminalObserver } from "../../sandbox/steps.js";
import type { Store } from "../../store/interface.js";
import type { WorkerFactory } from "../manager.js";
import { resolveWorkflowSource } from "../workflow-source.js";
import { createWorkflowExecutionActivities } from "./activities.js";

export interface WorkflowExecutionWorkerDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly broker: StreamBroker;
  readonly temporalConfig: WorkflowExecutionTemporalConfig;
  /** The activity persist site's sandbox teardown observer. */
  readonly sandboxTerminalObserver: WorkflowSandboxTerminalObserver;
  /**
   * The server's own delete of a run's ExecutionContext (the run-end
   * activity): the context's delete chain over the in-process transport,
   * resolved lazily because the worker is built before the routes exist.
   */
  readonly executionContextDeleter: () => ExecutionContextDeleter;
}

export function newWorkflowExecutionWorkerFactory(
  deps: WorkflowExecutionWorkerDeps,
): WorkerFactory {
  return async ({ createWorker }) => {
    const activities = createWorkflowExecutionActivities({
      store: deps.store,
      logger: deps.logger,
      broker: deps.broker,
      sandboxTerminalObserver: deps.sandboxTerminalObserver,
      executionContextDeleter: deps.executionContextDeleter,
    });

    const workflowSource = resolveWorkflowSource({
      workflowsEntryCandidates: [
        // Compiled dist (how conformance and the CLI boot the server).
        new URL("./workflows/index.js", import.meta.url),
        // The tsx dev loop runs from src/ — the SDK bundler compiles TS.
        new URL("./workflows/index.ts", import.meta.url),
      ],
      prebuiltSibling: new URL(
        "./workflow-bundle-workflow-execution.js",
        import.meta.url,
      ),
    });

    deps.logger.info("Creating workflow-execution Temporal worker", {
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
