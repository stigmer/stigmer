/**
 * The schedule-clock worker factory — ports the registration half of
 * pkg/domain/schedule/temporal/worker_config.go.
 *
 * The tick runs on its own queue (schedule_stigmer): since a tick SPANS
 * its run, a burst of long-tracking ticks must never starve the
 * agent-execution queue's workers — and vice versa.
 *
 * The worker is created by the Temporal manager's factory list, which also
 * RE-creates it on every reconnect. Components that merely call Temporal
 * (the syncer, the reconciler) survive reconnects by reading the client
 * through a provider; the worker is the one piece that must genuinely be
 * rebuilt, because a worker is bound to the connection it was created
 * with.
 *
 * The tick workflow registers under its byte-pinned slash type via the
 * barrel's arbitrary export name (workflows/index.ts — Go's explicit
 * RegisterWorkflowWithOptions{Name: TickWorkflowType} twin); the five
 * activities register under their slash names as the activities object's
 * keys.
 */
import { Worker } from "@temporalio/worker";

import type { Logger } from "../../boot/logger.js";
import type { Store } from "../../store/interface.js";
import type { WorkerFactory } from "../manager.js";
import { resolveWorkflowSource } from "../workflow-source.js";
import { createScheduleTickActivities } from "./activities.js";
import type { ScheduleTemporalConfig } from "./config.js";
import type { RunStarter } from "./run-starter.js";
import type { ScheduleSyncer } from "./syncer.js";

export interface ScheduleWorkerDeps {
  readonly store: Store;
  readonly config: ScheduleTemporalConfig;
  readonly syncer: ScheduleSyncer;
  readonly runStarter: RunStarter;
  readonly logger: Logger;
}

export function newScheduleWorkerFactory(deps: ScheduleWorkerDeps): WorkerFactory {
  return async ({ nativeConnection, namespace, payloadCodecs }) => {
    const activities = createScheduleTickActivities({
      store: deps.store,
      config: deps.config,
      syncer: deps.syncer,
      runStarter: deps.runStarter,
      logger: deps.logger,
    });

    const workflowSource = resolveWorkflowSource({
      workflowsEntryCandidates: [
        // Compiled dist (how conformance and the CLI boot the server).
        new URL("./workflows/index.js", import.meta.url),
        // The tsx dev loop runs from src/ — the SDK bundler compiles TS.
        new URL("./workflows/index.ts", import.meta.url),
      ],
      prebuiltSibling: new URL("./workflow-bundle-schedule.js", import.meta.url),
    });

    deps.logger.info("Creating schedule-clock Temporal worker", {
      queue: deps.config.stigmerQueue,
      workflow_source: workflowSource.kind,
    });

    return Worker.create({
      connection: nativeConnection,
      namespace,
      taskQueue: deps.config.stigmerQueue,
      activities,
      ...(workflowSource.kind === "prebuilt"
        ? { workflowBundle: { codePath: workflowSource.codePath } }
        : { workflowsPath: workflowSource.workflowsPath }),
      // The decode-only codec chain (manager.ts's choke-point note) — the
      // tick's payloads are plain JSON today, but the worker's converter
      // must match the client's so a future encrypted payload in history
      // replays instead of wedging.
      ...(payloadCodecs.length > 0 ? { dataConverter: { payloadCodecs } } : {}),
    });
  };
}
