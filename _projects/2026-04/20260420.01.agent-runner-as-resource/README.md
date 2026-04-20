# Project: 20260420.01.agent-runner-as-resource

## Overview

Promote `AgentRunner` to a first-class API resource with three orthogonal axes (lifecycle, scope, placement); introduce a **Stigmer Side-Channel Proxy** that injects every platform secret server-side so runners carry only the triggering user's JWT; eliminate the platform-wide `can_impersonate` machine-account model; unify per-execution sandbox and agent-runner into a single Daytona container so each execution has one filesystem; enable browser-launched local runners via the `stigmer://` URL scheme.

**Created**: 2026-04-20
**Status**: Active

## Why this project exists

Today's cloud agent execution rests on three coupled assumptions, and each one is a problem:

1. **The runner has a `can_impersonate` superpower.** A single agent-runner pool serves every user. It authenticates with `MACHINE_ACCOUNT_CLIENT_ID/SECRET` and uses `grpc_client/auth/on_behalf_of_interceptor.py` to act as whichever user triggered the execution. The active `20260419.02.secrets-vault-migration` README explicitly names this as the binary superpower that no FGA refinement can remove.
2. **The runner holds platform secrets.** `DAYTONA_API_KEY`, LLM provider keys (OpenAI, Anthropic, Google), Mongo credentials, R2 credentials — all live as env vars in every runner pod. Any compromise of any pod leaks all of them.
3. **An execution spans two filesystems.** Today the agent-runner pod orchestrates from one filesystem; the Daytona sandbox where tools actually run is a different filesystem. Code in `worker/workspace/daytona.py` exists solely to bridge them. This violates the customer's mental model ("one execution, one workspace") and is the root of an entire class of bugs.

The combined fix is a single architectural shift: **the runner becomes a credential-free worker that authenticates as the triggering user, runs alongside the workspace in one sandbox, and routes every infrastructure call through a Stigmer-hosted proxy.**

## The keystone: Side-Channel Proxy

A new HTTP service (initially as endpoints inside `stigmer-service`, extracted to its own deployment if traffic warrants it) that fronts every external call the runner makes today.

```
runner          ─►  POST proxy.stigmer.ai/v1/llm/openai/chat/completions
   (carries        Authorization: Bearer <user JWT>
    only the
    user JWT)      proxy validates user, looks up OPENAI_API_KEY for org from vault,
                   substitutes Authorization, forwards to api.openai.com,
                   streams response back, logs usage to billing/audit
```

**Endpoint families** (one per backend the runner currently calls directly):

- `/v1/proxy/llm/openai/...`, `/v1/proxy/llm/anthropic/...`, `/v1/proxy/llm/google/...`, `/v1/proxy/llm/ollama/...` — transparent passthrough to provider APIs with key injection. Streaming (SSE/chunked) relayed verbatim.
- `/v1/state/checkpoints/...` — CRUD for LangGraph checkpoint reads/writes. stigmer-service accesses MongoDB server-side; runner drops `pymongo`/`motor` dependency entirely.
- `/v1/artifacts/...` — presigned-URL minting for R2 artifact download/upload. Runner uses plain HTTPS; drops R2 SDK dependency.
- Redis functionality moves server-side into stigmer-service directly. Runner drops `redis` dependency.
- Daytona sandbox creation is stigmer-service's responsibility — the runner is *inside* the sandbox and never calls Daytona APIs.

**On every request the proxy**:
1. Validates the user JWT (same Auth0 path the cloud UI uses).
2. Authorizes via FGA (does this user, in this org, have permission to invoke this provider/sandbox/path? cached for performance).
3. Resolves the right downstream credential from vault (the same vault `secrets-vault-migration` is building).
4. Substitutes the credential header and forwards. Streams responses verbatim.
5. Emits a structured audit/usage event (`user_id`, `org_id`, `provider`, `tokens_in/out`, `latency`, `cost`).

**Implementation (confirmed in review)**:

- **Proxy lives inside `stigmer-service`.** No new deployment; reuses existing auth, FGA, and key-resolution clients. Extract to its own service later only if traffic justifies it.
- **Scope covers everything** — not just LLM. LLM providers, state/checkpointer, artifact storage, and Redis replacement are all in V1. The runner must be truly credential-free from day one.
- **No dependency on `secrets-vault-migration`**: the proxy reads provider keys from wherever they live today (env vars, MongoDB, etc.). When the vault migration ships, the proxy switches its key resolution internally — invisible to the runner.

## The new domain resource: `AgentRunner`

Promoted from "infrastructure module" to a first-class resource in the `agentic` bounded context, sitting alongside `Agent`, `AgentInstance`, `Session`, `AgentExecution`.

### Three orthogonal axes (NOT two enum values)

The earlier framing of "user-initiated runners" vs "system runners" conflates three independent concerns. The clean domain model exposes them as three orthogonal fields:

- **`lifecycle`**: `Ephemeral` (created for one execution, dies after) or `Persistent` (long-lived, accepts many executions over time).
- **`scope`**: who/what can dispatch to it — `Execution` (just this one), `User` (all of one user's executions), `Org` (org-wide pool), or `Agent` (pinned to specific agents).
- **`placement`**: where it physically runs — `Cloud` (Stigmer-managed) or `Local` (user's machine), with a `runtime` sub-field that is the actual implementation (`daytona-sandbox`, `k8s-pod`, `cli-daemon`, `docker`).

Two boolean facts fall out cleanly:
- "Show this in the UI?" = `lifecycle == Persistent` (ephemerals are implementation detail, like K8s Pods owned by Jobs — visible only via "show system runners" debug toggle).
- "Is it pre-existing or do I need to spawn one?" = look up Persistent runners matching the execution's scope; if none, spawn an Ephemeral.

### Resource shape

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentRunner
metadata:
  name: alice-mac-runner
  org: acme
  ownerRef: { kind: IdentityAccount, name: alice }
spec:
  lifecycle: Persistent          # Ephemeral | Persistent
  scope:
    type: User                   # Execution | User | Org | Agent
    userRef: alice
  placement:
    type: Local                  # Cloud | Local
    runtime: cli-daemon          # daytona-sandbox | k8s-pod | cli-daemon | docker
status:
  phase: Ready                   # Pending | Ready | Busy | Idle | Stopped | Failed
  taskQueue: agent-runner:user-alice
  lastHeartbeatAt: 2026-04-20T12:34:56Z
  lastTaskAt: 2026-04-20T12:30:01Z
  capacity: { current: 0, max: 3 }
```

### Aggregate boundaries

- `AgentRunner` is its own aggregate root. Lifecycle, capacity, and placement are its invariants.
- `AgentExecution` references the `AgentRunner` that accepted it via `status.executedByRunnerRef` (set once, immutable). Cross-aggregate ID reference, not embedding.
- `AgentRunner` does NOT embed executions — dispatch happens via Temporal task queue, never via direct mutation of the runner aggregate.
- Lifecycle ownership: Persistent runners are owned by the user (created/updated/deleted via API). Ephemeral runners are owned by the `AgentExecution` workflow.

## The unified Daytona runtime (for Ephemeral cloud runners)

For Ephemeral cloud runners with `placement.runtime: daytona-sandbox`, the runner *is* the sandbox: one process, one filesystem, one lifecycle.

Why this is right:
- Mirrors the OSS execution model exactly. In OSS, the runner runs on the user's machine using the local FS directly — no two-filesystem problem. Cloud should match.
- Deletes a whole class of code: file sync between agent-runner and Daytona, the Daytona SDK dependency in agent-runner Python code, sandbox-lifecycle-management-from-runner.
- Aligns the implementation with the customer's mental model ("an execution is a sandbox").

Architectural discipline:
- **Don't bake "Daytona" into the domain.** Daytona is one implementation of `placement.runtime`. The domain speaks `daytona-sandbox | k8s-pod | cli-daemon | docker` — a customer never sees "Daytona" hardcoded in YAML.
- **Keep `Sandbox` and `AgentRunner` as distinct concepts** even when co-located. A future Persistent runner might process 100 executions over its lifetime, each in its own throwaway sandbox.

Operational gates (must confirm before committing to this default):
- Daytona sandboxes can sustain outbound TLS to Temporal/proxy/stigmer-service.
- Daytona idle timeouts can be configured to span agent run length (multi-minute, occasionally multi-hour).
- Multi-process (Python interpreter + tool subprocesses) is reliable inside one sandbox.
- Image-pull cost (cold start) is acceptable as the per-execution startup tax.

## The dispatch logic

When `AgentExecution` is submitted:

```
candidates = AgentRunner.list(
    scope.matches(execution),
    status.phase == Ready,
    status.capacity.current < status.capacity.max
)
if candidates:
    runner = pick(candidates)            # round-robin, least-loaded, etc.
    execution.dispatchTo(runner.taskQueue)
else:
    runner = spawn Ephemeral AgentRunner(
        scope = Execution(execution.id),
        placement = org.defaults.cloudPlacement   # daytona-sandbox by default
    )
    execution.dispatchTo(runner.taskQueue)
```

This logic lives in the `AgentExecution` workflow, not in `AgentRunner`. The execution aggregate knows how to find a runner; the runner aggregate knows nothing about executions.

## The `stigmer://` launch flow

For "Launch local runner from cloud UI" (browser button), the user must have Stigmer Desktop or CLI installed at least once. The flow is the same custom URL scheme pattern Slack, Zoom, and JetBrains Toolbox use:

1. User clicks **Launch Local Runner** in cloud UI.
2. Browser POSTs to `stigmer-service` for a one-time launch token (TTL 60s, single-use).
3. Browser navigates to `stigmer://launch-runner?token=<jwt>&runtime=cli-daemon`.
4. OS dispatches the URL to the registered handler (Stigmer Desktop or CLI).
5. Handler exchanges the one-time token with `stigmer-service` → receives a long-lived runner JWT.
6. Handler creates an `AgentRunner` resource via API (`placement: Local`, `runtime: cli-daemon`).
7. Handler spawns the agent-runner subprocess (or `docker run` for `runtime: docker`).
8. Subprocess starts heartbeating → `AgentRunner.status.phase = Ready`.
9. Browser polls until ready, then surfaces the runner in the UI.

Without an installed helper this is not possible — there is no browser API that launches arbitrary processes. The "install Stigmer Desktop/CLI once" step is an acceptable onboarding cost.

## RunnerLauncher abstraction (in stigmer-service)

To handle the polymorphism cleanly, stigmer-service exposes a single Java interface with one implementation per `placement.runtime`:

```java
public interface RunnerLauncher {
    AgentRunner ensureRunnerForExecution(AgentExecution execution, String userJwt);
}

class DaytonaSandboxRunnerLauncher implements RunnerLauncher { ... }
class KubernetesPodRunnerLauncher implements RunnerLauncher { ... }
class LambdaRunnerLauncher implements RunnerLauncher { ... }     // optional future
class NoopRunnerLauncher implements RunnerLauncher { ... }       // for Local placement
```

For Local placement the launcher is a no-op — the user's CLI daemon is already polling its task queue. stigmer-service simply enqueues to `agent-runner:user-X` and the local runner picks it up. If the local runner is offline, the task waits in the queue (with UI fallback to "run on Stigmer Cloud instead" after a configurable timeout).

## Phased delivery (9–12 weeks)

| Phase | Scope | Effort | Risk |
|-------|-------|--------|------|
| **Phase 0** | Side-Channel Proxy in stigmer-service: LLM passthrough, state/checkpointer API, artifact presigned URLs, Redis migration server-side. Runner drops ALL infra secrets. | 3-4 weeks | Medium |
| **Phase 1** | `AgentRunner` proto + aggregate + dispatch logic. Per-user task queue routing. Auth0 token-exchange flow. Runner reads user JWT, drops machine account. | 2-3 weeks | Medium |
| **Phase 2** | Unified Daytona runtime: agent-runner runs inside Daytona sandbox; `worker/workspace/daytona.py` deleted; one filesystem per execution. | 2 weeks | High (Daytona compatibility gates) |
| **Phase 3** | User-managed Persistent runners: Settings → Runners UI, `stigmer://` URL scheme, Launch Local Runner button, dispatch picks Persistent before Ephemeral. | 2-3 weeks | Low |

Each phase is independently shippable. Phase 0 alone makes the runner fully credential-free. Phase 1 eliminates `can_impersonate`. Phase 2 simplifies the Python codebase and customer mental model. Phase 3 delivers the "use my computer" feature.

## Dependencies

- **No hard dependency on `secrets-vault-migration`**: the proxy reads provider keys from wherever they live today. The two projects proceed in parallel and compose naturally.
- **Auth0 token exchange (RFC 8693)**: Phase 1 needs this for minting user-scoped runner JWTs. Confirm the Auth0 tenant supports it (it does on paid tiers).
- **Daytona runtime characteristics**: Phase 2 is gated on operational confirmation — outbound networking, configurable idle timeouts, multi-process reliability.

## Success Criteria

- No machine account env vars on agent-runner pods (`MACHINE_ACCOUNT_CLIENT_ID/SECRET` deleted from manifests).
- Every gRPC call from runner to `stigmer-service` is authenticated as the triggering user — no `on-behalf-of` impersonation header anywhere in production code paths.
- Every LLM/Daytona/storage call from runner routes through the Side-Channel Proxy carrying only the user JWT.
- `AgentRunner` is a queryable API resource with create/list/delete operations and a UI surface for Persistent runners.
- A user can install Stigmer Desktop, click **Launch local runner** in the cloud UI, and see it appear as `Ready` in their AgentRunner list within 30 seconds.
- Per-execution Daytona sandbox runs both the agent-runner process and tool execution against one filesystem (no file sync code).
- `AgentExecution` dispatch picks a matching Persistent `AgentRunner` before falling back to spawning an Ephemeral one.
- OSS edition continues to work unchanged (`local cli-daemon` placement is the OSS path; OSS already does this today via `client-apps/cli/internal/cli/daemon/agent_runner_native.go`).

## Known Risks & Mitigations

- **Daytona may not tolerate hosting a long-running Temporal worker** (idle timeouts, networking, multi-process reliability). Mitigation: validate operational gates in Phase 2 design before committing; fall back to `k8s-pod` placement if Daytona doesn't pass.
- **Side-Channel Proxy adds latency on every LLM call**, and SSE relay across two hops needs careful streaming. Mitigation: WebFlux `Flux<DataBuffer>` for zero-copy relay; co-locate proxy with provider PoPs; benchmark against direct calls in Phase 0.
- **Auth0 token exchange flow needs careful caching and refresh** for multi-hour executions. Mitigation: stigmer-service refreshes runner JWT on heartbeat and pushes to runner over its existing gRPC stream.
- **Coordination with active `secrets-vault-migration` project** — shared vault clients and key resolution. Mitigation: explicit dependency, sequence Phase 0 to start after `secrets-vault-migration` Phase 0 (OpenBAO deployed) lands.
- **Per-user task queue routing in `stigmer-service`** is a non-trivial change to the workflow start path. Mitigation: design doc + reviewer pass before implementation; keep legacy shared queue alive in parallel until cutover.
- **Browser `stigmer://` URL scheme requires installed helper**. Mitigation: clear onboarding ("install once, click any time"); fall back to "run on Stigmer Cloud" if user opts out.

## Project Structure

This project follows the **Next Project Framework**:

- **`tasks/`** — Detailed task planning and execution logs (update freely)
- **`checkpoints/`** — Major milestone summaries (ASK before creating)
- **`design-decisions/`** — Significant architectural choices (ASK before creating)
- **`coding-guidelines/`** — Project-wide code standards (ASK before creating)
- **`wrong-assumptions/`** — Important misconceptions (ASK before creating)
- **`dont-dos/`** — Critical anti-patterns (ASK before creating)

## Current Status

### Active Task
See [tasks/T01_0_plan.md](tasks/T01_0_plan.md) — phased design plan, pending review.

### Progress Tracking
- [x] Project initialized
- [ ] T01: Architecture and design (PENDING REVIEW)
- [ ] Phase 0: Side-Channel Proxy V1
- [ ] Phase 1: AgentRunner resource + dispatch + token exchange
- [ ] Phase 2: Unified Daytona runtime
- [ ] Phase 3: User-managed Persistent runners + browser launch
- [ ] Project completed

## How to Resume Work

**Quick Resume**: Drag and drop [next-task.md](next-task.md) into your AI conversation.

## Quick Links

- [Next Task](next-task.md) — **Drag this into chat to resume**
- [Current Task](tasks/T01_0_plan.md)
- [Latest Checkpoint](checkpoints/)
- [Design Decisions](design-decisions/)
- [Coding Guidelines](coding-guidelines/)
