# Next Task: 20260420.01.agent-runner-as-resource

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260420.01.agent-runner-as-resource

**Description**: Promote AgentRunner to a first-class API resource with orthogonal lifecycle/scope/placement axes; introduce a Stigmer Side-Channel Proxy that injects all platform secrets so runners carry only the user JWT; eliminate the can_impersonate machine-account model; unify per-execution sandbox and agent-runner into a single Daytona container; enable browser-launched local runners via stigmer:// URL scheme.
**Goal**: Eliminate the platform-wide can_impersonate superpower for agent execution by making every agent-runner authenticate as the triggering user and routing all infrastructure secrets through a Stigmer-hosted side-channel proxy that the runner never sees.
**Tech Stack**: Java/Spring Boot WebFlux (stigmer-service), Python (agent-runner), Protobuf, OpenBAO/Vault, Daytona, Temporal, Auth0, Tauri/Go (CLI/Desktop)
**Components**: apis/ai/stigmer/agentic/agent_runner/v1 (new proto resource); backend/services/stigmer-service (proxy endpoints, AgentRunner aggregate, dispatch logic, RunnerLauncher abstraction); backend/services/agent-runner (remove machine account, point clients at proxy, run inside Daytona); client-apps/cli and Stigmer Desktop (stigmer:// URL handler, register-as-AgentRunner flow); cloud frontend (AgentRunner UI for Persistent runners)

## Current State
- **Status**: Phase 0 code complete (including LLM wiring), pending deploy and validation
- **Last Session**: 2026-04-20 — LLM proxy base_url wiring across all 6 construction paths
- **Active Task**: Phase 0 validation and deploy → then Phase 1

## Session Progress (2026-04-20, Session 2 — LLM Proxy Wiring)

### Accomplished
- Completed Step 7 from the previous session's next-steps: runner-side LLM `base_url` wiring
- Thorough codebase exploration identified all 6 LLM client construction paths (not just the 1 mentioned in previous session notes)
- Discovered and fixed pre-existing bugs: sub-agent `model_kwargs` gap, `CheckpointerConfig` rejecting `http` type, summarization middleware back door
- Discovered Anthropic SDK auth header mismatch (sends `x-api-key` not `Authorization: Bearer`) — solved with custom `BearerTokenResolver` on proxy (Option A, user-approved)
- Centralized duplicated `llm_kwargs` construction into `LLMConfig.build_llm_kwargs()`
- Handled provider-specific `base_url` convention difference (OpenAI SDK includes `/v1`, Anthropic does not)

### Key Decisions Made
7. **Proxy awareness lives in runner config, NOT in graphton library** — `parse_model_string` stays proxy-unaware, kwargs flow through existing `**model_kwargs` path
8. **Custom BearerTokenResolver on proxy** (Option A) for Anthropic SDK auth — cleaner than client-side `default_headers` workaround
9. **Summarization middleware routes through `parse_model_string`** — eliminated three provider-specific back-door methods, unified all model construction through one path

### Files Modified (this session)

**stigmer (7 files, +145/-135):**
- `worker/config.py` — `LLMConfig.build_llm_kwargs()`, proxy-aware validation, `CheckpointerConfig` http support
- `worker/activities/graphton/setup.py` — centralized `llm_kwargs`
- `worker/activities/generate_session_subject.py` — centralized `llm_kwargs`
- `worker/activities/classify_tool_approvals.py` — centralized `llm_kwargs`
- `worker/activities/graphton/handlers/sub_agent.py` — centralized `llm_kwargs`
- `graphton/core/agent.py` — sub-agent `model_kwargs` forwarding + summarization `llm_kwargs`
- `graphton/core/summarization_middleware.py` — `parse_model_string` delegation, `llm_kwargs` constructor param

**stigmer-cloud (1 file):**
- `HttpSecurityConfig.java` — `resolveProxyBearerToken()` for dual-header auth

## Session Progress (2026-04-20, Session 1 — Phase 0 Proxy)

### Accomplished
- Full infrastructure investigation: discovered stigmer-service is gRPC-only, KubernetesDeployment module supports one ingress port, runner uses API key + OBO (not machine accounts), Redis is dead code
- Designed HTTP proxy architecture on separate hostname (`proxy.stigmer.ai`) after ruling out gRPC adapter approach (maintenance trap with LangChain) and cluster-internal-only approach (Daytona sandboxes are outside K8s)
- Implemented all Phase 0 sub-tasks:
  - P0.1: HTTP serving infra (spring-boot-starter-web on port 8081, HttpSecurityConfig, health endpoint)
  - P0.2: LLM transparent proxy (OpenAI + Anthropic passthrough with key injection and SSE streaming)
  - P0.3: Checkpointer REST API (MongoDB proxy) + HttpCheckpointSaver in runner
  - P0.4: Artifact presigned URL API + ProxyArtifactStorage in runner
  - P0.5: Redis dead code removal (worker.py, config.py, redis_config.py deleted, dependency removed)
  - P0.6: Runner-side integration (proxy endpoint config, http checkpointer, proxy artifact storage)
  - P0.7: Deployment (second port on KubernetesDeployment, Gateway API resources for proxy.stigmer.ai, runner env vars updated)
- Committed in both repos:
  - stigmer-cloud: `0329220b` — proxy controllers + Gateway API + changelog
  - stigmer: `e690b95ff` — runner-side proxy clients + cleanup

### Key Decisions Made
1. **HTTP, not gRPC** for all proxy endpoints — avoids custom LangChain adapters, leverages `base_url` parameter natively
2. **Single hostname** (`proxy.stigmer.ai`) with path-based routing for LLM/checkpointer/artifacts
3. **Ollama excluded** from Phase 0 (local-only demo provider)
4. **Temporal stays direct** — no secrets to inject, bidirectional streaming impractical to proxy
5. **Gateway API resources created manually** in `_ops/planton/infra-hub/kubernetes/` (OpenMCF module supports only one hostname per deployment)
6. **Provider API keys move to stigmer-service env** (from runner env) — vault integration is a later improvement

## Next Steps

1. **Validate Bazel build** — run `bazel build //backend/services/stigmer-service:stigmer_service_fatjar` to confirm gRPC + Tomcat coexistence works in the Bazel build
2. **Deploy proxy to staging** — deploy stigmer-service with the new HTTP port and verify `/health` on port 8081 is reachable
3. **DNS setup** — create `proxy.stigmer.ai` DNS record pointing at the Istio ingress gateway
4. **Apply Gateway API resources** — `kubectl apply` the 4 YAML files in `_ops/planton/infra-hub/kubernetes/`
5. **Create Planton secrets group** — `stigmer-llm-proxy-credentials` with OpenAI and Anthropic API keys
6. **End-to-end test** — trigger an agent execution and verify LLM calls, checkpoint persistence, and artifact storage all route through the proxy
7. **Commit stigmer-cloud HttpSecurityConfig.java change** — the BearerTokenResolver addition is uncommitted in stigmer-cloud (mixed with vault-migration files from a separate project)
8. **Begin Phase 1** — AgentRunner proto + aggregate + dispatch + token exchange

## Context for Resume
- Both repos are on the `feat/secrets-vault-migration` branch (shared with the vault migration project)
- The stigmer-cloud repo has additional uncommitted vault-migration files (vault-starter, OpenBAO, GCP KMS) — those are from a separate project. Only `HttpSecurityConfig.java` is from this session.
- The plan file for this session is at `~/.cursor/plans/llm_proxy_wiring_c3114ce2.plan.md`
- The T01 design doc is at `_projects/2026-04/20260420.01.agent-runner-as-resource/tasks/T01_0_plan.md`
- All 6 LLM construction paths are now proxy-wired. The runner is credential-free for LLM, checkpointer, and artifact calls when `STIGMER_PROXY_ENDPOINT` is set.
- `STIGMER_API_KEY` is used as the proxy auth token (sent via `api_key` kwarg to LangChain SDKs → proxy validates → strips → injects real provider key)

## Blockers
- None blocking. Steps 1-6 above are operational tasks (deploy, DNS, kubectl).

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-04/20260420.01.agent-runner-as-resource/next-task.md`

## Quick Commands
- "Continue with Phase 0 validation" - Verify build, deploy, test
- "Begin Phase 1" - Start AgentRunner proto + resource design
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
