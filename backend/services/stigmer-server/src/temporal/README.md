# temporal/ — the Temporal engine

The shared worker infrastructure and the per-domain workers: agent-execution, the routines' schedule clock, grading and evals each register their workers with the same manager.

## Layout

- `manager.ts` — TemporalManager: non-fatal initial connect, 15s health monitor, reconnect with worker recreation, reconnect hooks. Domain code observes the CURRENT client through providers — there is no creator re-injection step.
- `sdk-logger.ts` — routes the Temporal SDK's own log lines (activity failures, worker lifecycle, workflow `log.*`) through the server logger by installing the SDK's Runtime logger before the first native connect; the header holds the field-redaction table (#1037).
- `payload-codec.ts` — the decode-only payload codec: encode is the identity, decode delegates to @stigmer/temporal-codecs.
- `workflow-source.ts` — prebuilt-bundle vs bundle-on-boot resolution (runner precedent); slim artifacts carry the prebuilt bundles.
- `runner-failure.ts` — worker-shutdown classification for the agent-execution workflow (#776).
- `agentexecution/` — the agent-execution worker: byte-pinned names, dispatch resolution, the ConnectedExecutionEngine implementation, server-side activities, and `workflows/` (the deterministic sandbox bundle).
- `routine/` — the routines' schedule clock worker: the tick workflow, its activities and its byte-pinned names, on its own queue (`schedule_stigmer`).
- `grading/` — the grading worker: `stigmer/grading/grade-run` grades a completed run with the free run-health checks and records the score through the score's create chain, on its own queue (`grading_stigmer`, `TEMPORAL_GRADING_STIGMER_TASK_QUEUE`); `names.ts` holds its byte-pinned names. The run-status observer that starts it is `domain/score/grading-observer.ts`.
- `evals/` — the eval worker: `stigmer/evals/eval-run` runs an eval run's cases, and `stigmer/evals/eval-run-case` each of its tries as a child, through the suite, case and spend activities, on its own queue (`evals_stigmer`, `TEMPORAL_EVALS_STIGMER_TASK_QUEUE`); the activities read the eval run and what its tries load (`context.ts`), and `names.ts` holds the byte-pinned names. Create starts the suite workflow (`domain/eval-run/workflows.ts`); `__tests__/replay.test.ts` replays committed suite histories.

## Workflow-bundle import discipline

Everything reachable from a `workflows/` entry runs in Temporal's deterministic sandbox: only @temporalio/workflow, @temporalio/common, @bufbuild/protobuf, generated protos, and verified-pure domain modules (imported by DIRECT path, never via barrels — e.g. `filereview/gate.js`, whose sibling `digest.ts` pulls node:crypto). The SDK bundler hard-fails on node built-ins; keep it that way.

Queue names, workflow names, signal names, and memo keys are byte-pinned wire constants — see `agentexecution/names.ts`.
