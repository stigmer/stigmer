# Task T01: Runner Architecture Simplification — Full Plan

**Created**: 2026-05-20
**Status**: PENDING REVIEW
**Type**: Refactoring (breaking change, no backward compatibility)

⚠️ **This plan requires your review before execution**

## Context

Based on the Gemini Deep Research report (`research.control-plane-runner-architecture-review/04.report.gemini.md`), the current Runner architecture is critically overengineered. The Runner API resource, bidi command stream, 6-phase lifecycle, launch tokens, and heartbeat protocol all duplicate what Temporal provides natively and create a barrier for customer integration.

**Key signals driving this work**:
- Customer not integrating the runner due to complexity
- Runner is now an NPM package — should be embeddable, not a managed service
- Desktop users should never manage runners
- Web users always go through cloud — runners are invisible
- Temporal already handles worker liveness, routing, and state

**Philosophy**: No backward compatibility. Clean break. Delete everything that's overbuilt.

**Relationship to other projects**:
- **unified-runner-migration** (20260518.01): Phase 5 complete, Phase 6 (Deployment) blocked on this project. The execution engine code (activities, middleware, workflow engine) is sound and stays. Only the runner management layer changes.
- **workflow-runner-typescript-rewrite** (20260519.01): Phase 4 complete, can run in parallel until deployment. Deployment depends on this project setting up how runners are managed.

## Architecture Overview (Before → After)

### Before (Current)
```
User → stigmer-service → creates Runner resource → Runner polls runner-scoped queue
                       → Session binds to Runner via session.spec.runner_id
                       → Runner heartbeats via bidi stream every 30s
                       → Server pushes ListDirectory/Stop commands via stream
                       → Launch token handshake for browser-to-CLI flow
```

### After (Target)
```
User → stigmer-service → creates Session → derives task queue from session ID
                       → starts Temporal workflow targeting session task queue
                       → Runner (embedded NPM package) polls session-scoped queue
                       → No Runner resource, no heartbeat, no bidi stream
```

### What Gets Deleted
- Runner protobuf API (7 proto files in `apis/ai/stigmer/agentic/runner/v1/`)
- RunnerQueryController + RunnerCommandController in stigmer-service
- Runner database tables/entity in stigmer-service
- Bidi command stream (connect RPC)
- Custom heartbeat protocol (30s heartbeat, 90s timeout)
- 6-phase lifecycle state machine (RunnerPhase enum)
- Launch token handshake (createLaunchToken, exchangeLaunchToken)
- `stigmer://` URL scheme handler
- `process_executions` map / multi-process tracking
- `RunnerConnectionInfo` (hostname, OS, arch, version)
- `session.spec.runner_id` binding

### What Stays (Unchanged)
- All execution engine code in `backend/services/runner/src/`:
  - Activities: execute-deep-agent, execute-cursor, call-http, call-grpc, call-llm, etc.
  - Middleware stack (10 modules)
  - Workflow engine (CNCF Serverless Workflow)
  - Shared infrastructure (MCP, HITL, artifacts, writeback, status, checkpointer, etc.)
  - All 1,057+ tests
- Temporal worker setup (refactored to use session-scoped queues)
- gRPC calls to stigmer-service for execution status updates, artifact storage

### What Gets Built New
- `createStigmerRunner()` factory function (public API surface)
- Per-session Temporal task queue routing
- Session-derived queue naming convention
- NPM package configuration (`package.json` exports, types)

## Phased Execution Plan

### Phase 1: Runner API Deletion (stigmer repo — OSS side)
**Scope**: Delete all Runner proto files and references from the OSS repo.
**Est.**: 1-2 sessions

1. **Delete Runner proto files**
   - [ ] Delete all 7 files in `apis/ai/stigmer/agentic/runner/v1/`
   - [ ] Remove Runner from any proto BUILD files or buf.yaml references
   - [ ] Remove Runner from any generated code outputs

2. **Remove runner_id from Session and Execution APIs**
   - [ ] Remove `runner_id` from `SessionSpec` (or wherever session→runner binding exists)
   - [ ] Remove `runner_id` from `AgentExecutionStatus`
   - [ ] Remove `runner_id` from `WorkflowExecutionStatus` (if present)
   - [ ] Add `task_queue` field to Session if needed for routing transparency

3. **Update any OSS code referencing Runner types**
   - [ ] Search for Runner proto imports across the codebase
   - [ ] Remove or refactor all references
   - [ ] Ensure proto compilation still passes

### Phase 2: Per-Session Task Queue Routing (runner service)
**Scope**: Refactor the runner service to use session-derived Temporal task queues instead of runner-scoped queues.
**Est.**: 2-3 sessions

1. **Define queue naming convention**
   - [ ] Convention: `session:{session-id}` (or `stigmer/session/{session-id}`)
   - [ ] Document how the control plane and runner agree on queue names
   - [ ] Handle the case where a session ID is not yet known at runner start (desktop: multiple sessions)

2. **Refactor Temporal worker setup**
   - [ ] Remove runner-ID-based queue creation
   - [ ] Support polling multiple session-scoped queues (desktop: user may have concurrent sessions)
   - [ ] Or: use a single well-known queue per runner instance, with session affinity handled by Temporal's task routing
   - [ ] Design decision needed: per-session queue vs. per-instance queue with Temporal Worker Sessions

3. **Refactor `main.ts` entry point**
   - [ ] Remove all Runner registration logic (apply, heartbeat, connect stream)
   - [ ] Simplify to: create Temporal worker → start polling → graceful shutdown
   - [ ] Accept configuration via constructor options, not CLI flags + server registration

4. **Update workflow dispatching**
   - [ ] Ensure `execute-serverless-workflow.ts` uses session-scoped task queues
   - [ ] Ensure ExecuteDeepAgent and ExecuteCursor respect session routing
   - [ ] Verify all `proxyActivities` calls use the correct task queue

### Phase 3: createStigmerRunner() Public API
**Scope**: Design and implement the NPM package's public API surface.
**Est.**: 1-2 sessions

1. **Design the factory function**
   ```typescript
   import { createStigmerRunner } from '@stigmer/runner';

   const runner = createStigmerRunner({
     // Required: Temporal connection
     temporalAddress: 'localhost:7233',
     temporalNamespace: 'default',

     // Required: Stigmer platform connection (for artifacts, status updates)
     stigmerEndpoint: 'https://api.stigmer.ai',
     stigmerToken: process.env.STIGMER_AUTH_TOKEN,

     // Required: What queue to poll
     taskQueue: 'session:abc-123',

     // Optional: Customization hooks
     middleware?: StigmerMiddleware[],
     customTools?: Tool[],
   });

   await runner.start();
   await runner.stop();
   ```

2. **Package configuration**
   - [ ] Configure `package.json` with proper `exports`, `types`, `main`, `module` fields
   - [ ] Ensure tree-shaking works (ESM + CJS dual publish if needed)
   - [ ] Define what's public API vs internal
   - [ ] Write JSDoc for the public surface

3. **Implement the factory**
   - [ ] `createStigmerRunner()` wraps Temporal `Worker` creation
   - [ ] Registers all activities (ExecuteDeepAgent, ExecuteCursor, ExecuteServerlessWorkflow)
   - [ ] Sets up gRPC client to stigmer-service for status updates
   - [ ] Returns `{ start(), stop() }` handle

4. **Tests for public API**
   - [ ] Test createStigmerRunner with minimal config
   - [ ] Test start/stop lifecycle
   - [ ] Test that activities are registered correctly
   - [ ] Test graceful shutdown

### Phase 4: Filesystem Browsing Replacement
**Scope**: Remove ListDirectory from the runner protocol and handle it properly in each deployment context.
**Est.**: 1-2 sessions

1. **Desktop (Electron IPC)**
   - [ ] Document that the desktop app should handle filesystem browsing via Electron IPC
   - [ ] The runner NPM package does NOT expose filesystem APIs
   - [ ] Provide a reference implementation or helper if needed

2. **Cloud (HTTP sidecar)**
   - [ ] Document that the cloud sandbox should deploy a lightweight HTTP file server
   - [ ] This is a separate concern from the runner — separate container/process
   - [ ] Can be as simple as a 50-line Express server with `readdir` endpoints

3. **Remove from runner codebase**
   - [ ] Delete any ListDirectory, filesystem browsing, or command handling code from the runner
   - [ ] Remove command/response types related to filesystem operations

### Phase 5: Control Plane Changes (stigmer-cloud / stigmer-service — Java side)
**Scope**: Refactor the Java control plane to route executions via session-derived task queues.
**Est.**: 3-4 sessions (largest phase — cross-repo)

1. **Remove Runner entity and controllers**
   - [ ] Delete RunnerCommandController.java
   - [ ] Delete RunnerQueryController.java
   - [ ] Delete Runner entity / repository / database migration
   - [ ] Delete RunnerHeartbeatHandler, RunnerStreamHandler (bidi stream server side)
   - [ ] Delete LaunchTokenService
   - [ ] Remove Runner from FGA authorization model

2. **Refactor session routing**
   - [ ] When a session starts, derive the Temporal task queue name from the session ID
   - [ ] Store the task queue on the Session status (for observability)
   - [ ] Update AgentExecutionService to dispatch workflows to session-derived queues
   - [ ] Update WorkflowExecutionService similarly

3. **Refactor sandbox provisioning**
   - [ ] Cloud sandbox boot: inject session ID (not runner ID) as environment variable
   - [ ] Remove Runner resource creation from the sandbox provisioning workflow
   - [ ] Remove Runner resource cleanup from the sandbox deprovisioning workflow
   - [ ] The sandbox just starts `@stigmer/runner` with `taskQueue: session:{sessionId}`

4. **Update web UI**
   - [ ] Remove "Runner" concept from session composer (if it shows runner selection)
   - [ ] Remove runner status indicators from the UI
   - [ ] Sessions just show execution status (which comes from Temporal/execution status updates)

5. **Database migration**
   - [ ] Create migration to drop Runner tables
   - [ ] Migrate any session records that reference runner_id (set to null or remove column)

### Phase 6: Integration Testing & Deployment
**Scope**: End-to-end validation that the simplified architecture works.
**Est.**: 2-3 sessions

1. **Local integration test**
   - [ ] Start a runner with `createStigmerRunner()` pointing to local Temporal
   - [ ] Dispatch an ExecuteDeepAgent workflow to the session queue
   - [ ] Verify execution completes and status updates flow

2. **Cloud integration test**
   - [ ] Provision sandbox with session ID
   - [ ] Verify runner boots and polls the correct queue
   - [ ] Verify execution completes end-to-end

3. **Deployment coordination**
   - [ ] This phase unblocks unified-runner-migration Phase 6 (Deployment)
   - [ ] This phase also sets the deployment pattern for workflow-runner-typescript-rewrite
   - [ ] Docker image: single `@stigmer/runner` image, booted with session ID env var
   - [ ] CI/CD: update release workflows

## Design Decisions Needed (During Execution)

1. **Queue naming convention**: `session:{id}` vs `stigmer/session/{id}` vs just the session ID
2. **Multiple sessions on desktop**: Does the embedded runner poll one queue or many? Dynamic queue addition?
3. **Queue cleanup**: Rely on Temporal's automatic GC, or explicit cleanup on session close?
4. **NPM package scope**: `@stigmer/runner` — monorepo package or standalone repo?
5. **Shared queue for desktop**: Should the desktop runner poll a single well-known queue (e.g., `local:{machine-id}`) with Temporal Worker Sessions for affinity, rather than per-session queues?

## Success Criteria

1. Runner API protos (all 7 files) deleted
2. No `RunnerQueryController` or `RunnerCommandController` in stigmer-service
3. No Runner database tables
4. `@stigmer/runner` NPM package with `createStigmerRunner()` API
5. Per-session Temporal task queue routing working end-to-end
6. Desktop app can embed runner without user management
7. Cloud sandbox boots with session ID, no Runner resource
8. All existing execution engine tests still pass (1,057+)
9. No backward compatibility — clean break

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Java control plane changes larger than expected | HIGH | MEDIUM | Phase 5 is scoped separately; can be done incrementally |
| Multiple concurrent sessions on desktop need design | MEDIUM | HIGH | Design decision in Phase 2; Temporal Worker Sessions pattern |
| Filesystem browsing gap during transition | LOW | LOW | Desktop: Electron IPC. Cloud: HTTP sidecar. Neither is in the runner. |
| Customer communication on API change | MEDIUM | CERTAIN | No backward compat = clean break. Communicate via changelog. |

## Notes

- **No backward compatibility**: This is a clean break. Old runners, old session.spec.runner_id, old bidi streams — all deleted. No migration path for existing Runner resources.
- **Execution engine is untouched**: All 1,057+ tests, all middleware, all activities, all workflow engine code stays exactly as-is. We're only changing the management and routing layer.
- **This unblocks deployment**: Both the unified-runner-migration and workflow-runner-typescript-rewrite projects need this resolved before they can deploy.
