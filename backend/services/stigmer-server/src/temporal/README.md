# temporal/ — the Temporal engine

The shared worker infrastructure and the per-domain workers: agent-execution, the schedule clock and grading each register their workers with the same manager.

## Layout

- `manager.ts` — TemporalManager (ports pkg/server/temporal_manager.go): non-fatal initial connect, 15s health monitor, reconnect with worker recreation, reconnect hooks. Domain code observes the CURRENT client through providers — there is no Go-style creator re-injection.
- `sdk-logger.ts` — routes the Temporal SDK's own log lines (activity failures, worker lifecycle, workflow `log.*`) through the server logger by installing the SDK's Runtime logger before the first native connect; the header holds the field-redaction table (#1037).
- `payload-codec.ts` — the decode-only payload codec (ports pkg/encryption/payloadcodec): encode is the identity, decode delegates to @stigmer/temporal-codecs.
- `workflow-source.ts` — prebuilt-bundle vs bundle-on-boot resolution (runner precedent); slim artifacts carry the prebuilt bundles.
- `runner-failure.ts` — worker-shutdown classification for the agent-execution workflow (ports pkg/runnerfailure, #776).
- `agentexecution/` — the agent-execution worker: byte-pinned names, dispatch resolution, the ConnectedExecutionEngine implementation, server-side activities, and `workflows/` (the deterministic sandbox bundle).
- `schedule/` — the schedule clock's worker: the tick workflow, its activities and its byte-pinned names, on its own queue (`schedule_stigmer`).
- `grading/` — the grading worker: `stigmer/grading/grade-run` grades a completed run with the free run-health checks and records the score through the score's create chain, on its own queue (`grading_stigmer`, `TEMPORAL_GRADING_STIGMER_TASK_QUEUE`); `names.ts` holds its byte-pinned names. The run-status observer that starts it is `domain/score/grading-observer.ts`.

## Workflow-bundle import discipline

Everything reachable from a `workflows/` entry runs in Temporal's deterministic sandbox: only @temporalio/workflow, @temporalio/common, @bufbuild/protobuf, generated protos, and verified-pure domain modules (imported by DIRECT path, never via barrels — e.g. `filereview/gate.js`, whose sibling `digest.ts` pulls node:crypto). The SDK bundler hard-fails on node built-ins; keep it that way.

Queue names, workflow names, signal names, and memo keys are byte-pinned wire constants — see `agentexecution/names.ts`.
