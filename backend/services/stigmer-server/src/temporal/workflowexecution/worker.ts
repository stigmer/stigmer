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
 * Workflow source: runtime bundling from the compiled entry (ratified
 * brief #7 of sub-project 20260824.03 — the operative mode until #24
 * ships prebuilt bundles; the prebuilt sibling is the hook it fills).
 */
import { Worker } from "@temporalio/worker";

import type { Logger } from "../../boot/logger.js";
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
  /** The activity persist site's sandbox teardown observer (§6d, O6). */
  readonly sandboxTerminalObserver: WorkflowSandboxTerminalObserver;
}

export function newWorkflowExecutionWorkerFactory(
  deps: WorkflowExecutionWorkerDeps,
): WorkerFactory {
  return async ({ nativeConnection, namespace, payloadCodecs }) => {
    const activities = createWorkflowExecutionActivities({
      store: deps.store,
      logger: deps.logger,
      broker: deps.broker,
      sandboxTerminalObserver: deps.sandboxTerminalObserver,
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

    return Worker.create({
      connection: nativeConnection,
      namespace,
      taskQueue: deps.temporalConfig.stigmerQueue,
      activities,
      ...(workflowSource.kind === "prebuilt"
        ? { workflowBundle: { codePath: workflowSource.codePath } }
        : { workflowsPath: workflowSource.workflowsPath }),
      // The decode-only codec chain: workflow tasks replay history
      // containing runner-encrypted payloads (manager.ts's choke-point
      // note).
      ...(payloadCodecs.length > 0
        ? { dataConverter: { payloadCodecs } }
        : {}),
    });
  };
}
