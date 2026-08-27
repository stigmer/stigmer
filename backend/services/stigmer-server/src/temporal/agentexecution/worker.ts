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
import { Worker } from "@temporalio/worker";

import type { Logger } from "../../boot/logger.js";
import type { AgentExecutionTemporalConfig } from "../../domain/agentexecution/temporal/config.js";
import type { StreamBroker } from "../../domain/agentexecution/stream-broker.js";
import type { Store } from "../../store/interface.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type {
  AgentExecutionResponseDecorator,
  AgentExecutionStatusObserver,
} from "../../extensions/status-hooks.js";
import type { WorkerFactory } from "../manager.js";
import { resolveWorkflowSource } from "../workflow-source.js";
import { createAgentExecutionActivities } from "./activities.js";

export interface AgentExecutionWorkerDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly broker: StreamBroker;
  /** The composed Authorizer — the status-merge activity's updateStatus pipeline carries the Authorize step like every chain (O2). */
  readonly authorizer: Authorizer;
  /** The composed status hooks — the activity's updateStatus reuse (O4). */
  readonly statusObservers: ReadonlyArray<AgentExecutionStatusObserver>;
  readonly responseDecorators: ReadonlyArray<AgentExecutionResponseDecorator>;
  readonly temporalConfig: AgentExecutionTemporalConfig;
}

export function newAgentExecutionWorkerFactory(
  deps: AgentExecutionWorkerDeps,
): WorkerFactory {
  return async ({ nativeConnection, namespace, payloadCodecs, client }) => {
    const activities = createAgentExecutionActivities({
      store: deps.store,
      logger: deps.logger,
      broker: deps.broker,
      authorizer: deps.authorizer,
      statusObservers: deps.statusObservers,
      responseDecorators: deps.responseDecorators,
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

    return Worker.create({
      connection: nativeConnection,
      namespace,
      taskQueue: deps.temporalConfig.stigmerQueue,
      activities,
      ...(workflowSource.kind === "prebuilt"
        ? { workflowBundle: { codePath: workflowSource.codePath } }
        : { workflowsPath: workflowSource.workflowsPath }),
      // The decode-only codec chain: workflow tasks replay history
      // containing runner-encrypted activity results (manager.ts's
      // choke-point note).
      ...(payloadCodecs.length > 0 ? { dataConverter: { payloadCodecs } } : {}),
    });
  };
}
