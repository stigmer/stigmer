# temporal/ — the Temporal engine

The shared worker infrastructure and the per-domain workers. Landed with D4 #18 (agent-execution); workflow-execution (#21) and the schedule clock (#22) append their workers to the same manager.

## Layout

- `manager.ts` — TemporalManager (ports pkg/server/temporal_manager.go): non-fatal initial connect, 15s health monitor, reconnect with worker recreation, reconnect hooks. Domain code observes the CURRENT client through providers — there is no Go-style creator re-injection.
- `payload-codec.ts` — the decode-only payload codec (ports pkg/encryption/payloadcodec): encode is the identity, decode delegates to @stigmer/temporal-codecs.
- `workflow-source.ts` — prebuilt-bundle vs bundle-on-boot resolution (runner precedent); prebuilt bundles arrive with #24.
- `runner-failure.ts` — worker-shutdown classification shared by the execution workflows (ports pkg/runnerfailure, #776).
- `agentexecution/` — the agent-execution worker: byte-pinned names, dispatch resolution, the ConnectedExecutionEngine implementation, server-side activities, and `workflows/` (the deterministic sandbox bundle).

## Workflow-bundle import discipline

Everything reachable from a `workflows/` entry runs in Temporal's deterministic sandbox: only @temporalio/workflow, @temporalio/common, @bufbuild/protobuf, generated protos, and verified-pure domain modules (imported by DIRECT path, never via barrels — e.g. `filereview/gate.js`, whose sibling `digest.ts` pulls node:crypto). The SDK bundler hard-fails on node built-ins; keep it that way.

Queue names, workflow names, signal names, and memo keys are byte-pinned wire constants (D2 §4) — see `agentexecution/names.ts`.
