# Workflow-Runner LLM Proxy Integration

**Date**: May 15, 2026

## Summary

Unified the workflow-runner's LLM call pattern with agent-runner and cursor-runner by adding Side-Channel Proxy support. In cloud mode, the workflow-runner no longer needs provider API keys — it routes LLM calls through the Stigmer proxy using only a Stigmer token, matching the other runners. A new `X-Stigmer-Workflow-Execution-Id` header enables per-workflow-execution billing and usage metering.

## Problem Statement

The workflow-runner's `CallLlmActivity` called Anthropic and OpenAI APIs directly using provider API keys from environment variables. This created an inconsistency: agent-runner and cursor-runner route through the Stigmer Side-Channel Proxy for centralized billing, security, and API key management, but workflow-runner bypassed all of that.

### Pain Points

- Workflow-runner required `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` in cloud deployments — a security concern since platform-owned keys should never leave the server
- No usage metering or billing for workflow-runner LLM calls in cloud mode
- Different configuration patterns across runners (direct keys vs proxy token)
- No FGA authorization for workflow-runner LLM calls

## Solution

Implemented dual-mode LLM calls in the workflow-runner: proxy mode (cloud) routes through the Stigmer proxy with a Stigmer token, while direct mode (OSS) preserves the current API key behavior. Extended the Java proxy to recognize a new `X-Stigmer-Workflow-Execution-Id` header for FGA authorization and billing metering tied to workflow executions.

## Implementation Details

### Go Side (stigmer repo)

**New `LlmProxyConfig`** (`pkg/config/llm_config.go`): Reads `STIGMER_PROXY_ENDPOINT` to determine mode. When set, proxy mode activates and `STIGMER_TOKEN`/`STIGMER_API_KEY` is used for auth. When unset, falls back to direct provider API keys. Mirrors agent-runner's `LLMConfig.load_from_env(proxy_active=...)`.

**Refactored `CallLlmActivity`**: In proxy mode, both Anthropic and OpenAI SDKs are configured with:
- `WithBaseURL` / `config.BaseURL` pointing to `{proxy}/v1/proxy/llm/{provider}/...`
- A custom `proxyRoundTripper` injecting `Authorization: Bearer {stigmer_token}` and `X-Stigmer-Workflow-Execution-Id: {id}` headers on every request

The activity now accepts a `workflowExecutionId` parameter extracted from `workflow.GetInfo(ctx).WorkflowExecution.ID`.

### Java Side (stigmer-cloud repo)

**`ProxyScopeResult`**: Added `workflowExecutionId` field and `effectiveExecutionId()` that prefers agent execution over workflow execution for billing.

**`ProxyAuthorizationService`**: `authorizeProxyScopes` now accepts the new header, performing FGA `can_edit` on `workflow_execution` resource kind.

**Both proxy controllers**: Read `X-Stigmer-Workflow-Execution-Id`, pass to authorization, use effective execution ID for usage reporting.

**`RecordLlmCallUsageHandler`**: Added `WorkflowExecutionRepo` dependency and a fallback org resolution path — when `ExecutionReservation` lookup fails (no agent execution), resolves org from `WorkflowExecution.metadata.org`.

### Also in this session: T08 LLM Provider Integration Tests

- Created 3 `llm_call` integration tests (Anthropic structured output, simple prompt, OpenAI)
- Created 2 `agent_call` integration tests (full pipeline through Python agent-runner)
- Built `harness/agent_runner.go` for managing Python agent-runner as a child process
- Added manual-only CI workflow for provider-backed tests

## Benefits

- **Unified runner pattern**: All three runners (agent, cursor, workflow) now follow the same proxy routing pattern
- **Cloud-ready**: Workflow-runner in cloud needs only `STIGMER_TOKEN` + `STIGMER_PROXY_ENDPOINT` — no provider keys
- **Usage tracking**: Workflow-runner LLM calls are now metered per workflow execution
- **Backward compatible**: OSS direct-key mode unchanged; proxy mode is opt-in via `STIGMER_PROXY_ENDPOINT`
- **FGA authorized**: Workflow-runner LLM calls subject to same fine-grained access control as agent-runner

## Impact

- **Workflow-runner**: Gains proxy support for cloud deployments
- **Billing pipeline**: Can now track and bill LLM usage per workflow execution
- **Cloud operations**: Eliminates need to distribute provider API keys to workflow-runner pods
- **Security**: Provider API keys stay server-side in the proxy; runners only see Stigmer tokens

## Related Work

- Agent-runner proxy integration (Python, `LLMConfig.build_llm_kwargs`)
- Cursor-runner proxy integration (TypeScript, `fetch-interceptor.ts`)
- E2E workflow testing infrastructure (project `20260514.01`)

---

**Status**: ✅ Production Ready (Go side) / ✅ Production Ready (Java side, pending deployment)
**Timeline**: ~3 hours implementation
