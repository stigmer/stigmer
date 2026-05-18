# Design Decision 001: T01a — Graphton Module Audit

**Date**: 2026-05-18
**Status**: PROPOSED
**Context**: T01 Research Spike (Phase 0 Hard Gate)
**Decision**: Classify all 37 graphton Python modules for the DeepAgents JS migration

## Background

The `graphton` library (`backend/libs/python/graphton/`) contains 37 Python
modules totaling 15,017 lines. It is the middleware layer between the Python
`agent-runner` Temporal worker and the `deepagents` Python SDK + LangGraph
Python runtime.

The migration target is **Option A: DeepAgents JS + graphton-ts compatibility
layer** — use `createDeepAgent` from the `deepagents` npm package, wrapped in
a `createStigmerAgentRunner()` harness with custom TypeScript middleware for
production controls.

## Evidence Sources

- Internal codebase exploration of all 37 modules (full file reads)
- ChatGPT Deep Research report (`research.deepagents-js-langgraph-js-feasibility/04.report.gpt.md`)
- DeepAgents JS docs: `createDeepAgent` API, middleware, subagents, backends
- LangGraph JS docs: checkpointers, interrupt/resume, streaming
- `@langchain/mcp-adapters` docs: `MultiServerMCPClient`, stdio/HTTP/SSE
- cursor-runner codebase analysis (41K lines TS, existing shared infrastructure)

## Classification Legend

- **NATIVE**: Directly available in DeepAgents JS / LangGraph JS / `@langchain/mcp-adapters`. Use as-is or with minimal wiring.
- **CURSOR-RUNNER**: Already implemented in `backend/services/cursor-runner/` TypeScript. Can be extracted into the unified runner's shared infrastructure.
- **REBUILD**: No JS equivalent. Must be implemented as TypeScript middleware in the unified runner. This is the net-new engineering work.
- **NOT NEEDED**: Python-specific artifact, replaced by a different JS pattern, or handled by DeepAgents JS internals. No TS equivalent required.

## Module Classification

### Tier 1: Agent Orchestration & Configuration (3 modules, 1,829 lines)

| # | Module | Lines | Classification | JS Replacement | Notes |
|---|--------|------:|----------------|----------------|-------|
| 1 | `agent.py` | 1,154 | NATIVE | `createDeepAgent` from `deepagents` npm | Core factory. JS API accepts `middleware`, `tools`, `model`, `systemPrompt`, `subagents`, `backend`, `checkpointer`, `store`, `interruptOn`, `streamTransformers`. Our wrapper is `createStigmerAgentRunner()`. |
| 2 | `config.py` | 541 | REBUILD | Zod schema or TypeScript types | `AgentConfig` Pydantic model validates MCP pairing, sandbox config, subagents, thresholds. Port as a Zod schema with the same validation rules. Moderate effort. |
| 3 | `sandbox_factory.py` | 134 | NOT NEEDED | DeepAgents JS backend system | JS has `StateBackend`, `FilesystemBackend`, sandbox backend with `execute` tool. Factory pattern replaced by DeepAgents JS config. |

### Tier 2: Models & Prompting (4 modules, 2,357 lines)

| # | Module | Lines | Classification | JS Replacement | Notes |
|---|--------|------:|----------------|----------------|-------|
| 4 | `model_registry.py` | 870 | CURSOR-RUNNER | `adapter/model-pricing.ts` + `model-pricing-data.ts` | cursor-runner already has model pricing resolution. The registry JSON loading pattern needs extraction to shared infra. |
| 5 | `models.py` | 500 | NOT NEEDED | DeepAgents JS model construction | JS handles `ChatAnthropic` / `ChatOpenAI` construction internally via the `model` option. No need for `parse_model_string`. |
| 6 | `prompt_enhancement.py` | 487 | CURSOR-RUNNER | `adapter/prompt-builder.ts` + `continuation-prompt.ts` | cursor-runner already has enhanced prompt building, HITL continuation prompts, and session memory injection. Extract to shared infra. |
| 7 | `template.py` | 245 | CURSOR-RUNNER | `adapter/placeholder-resolver.ts` | cursor-runner already has `{{VAR}}` placeholder resolution with strict validation. Direct reuse. |

### Tier 3: MCP & Resources (3 modules, 753 lines)

| # | Module | Lines | Classification | JS Replacement | Notes |
|---|--------|------:|----------------|----------------|-------|
| 8 | `mcp_manager.py` | 413 | NATIVE + CURSOR-RUNNER | `MultiServerMCPClient` from `@langchain/mcp-adapters` + cursor-runner's `mcp-resolver.ts` | JS has `MultiServerMCPClient` with stdio/HTTP/SSE. cursor-runner already resolves MCP configs from proto resources. **Risk**: persistent connection semantics need spike validation. |
| 9 | `middleware.py` | 214 | NATIVE | DeepAgents JS middleware system | `McpToolsLoader` replaced by DeepAgents JS built-in MCP integration. The middleware lifecycle (keep client alive) may need a custom wrapper around `MultiServerMCPClient`. |
| 10 | `resource_tools.py` | 126 | NATIVE | `loadMcpTools` includes resource access | MCP resource list/read tools composable via adapters. |

### Tier 4: Tools, Workspace, Git, GitHub (5 modules, 3,209 lines)

| # | Module | Lines | Classification | JS Replacement | Notes |
|---|--------|------:|----------------|----------------|-------|
| 11 | `tool_wrappers.py` | 1,878 | REBUILD (partial) + CURSOR-RUNNER | Split: HITL approval from cursor-runner `hitl/`, platform tools from DeepAgents JS backends | Largest module. Approval-aware wrappers partially exist in cursor-runner's `hitl/approval-policy.ts` and `approval-state.ts`. Platform tools (read/write/edit/execute/ls/glob/grep/search) are provided by DeepAgents JS filesystem/sandbox backends. Output truncation is REBUILD. |
| 12 | `workspace_index.py` | 862 | NOT NEEDED | DeepAgents JS filesystem backend | Regex-based symbol index. DeepAgents JS has built-in search/grep tools via its filesystem backend. If workspace indexing is still needed, it's a separate concern. |
| 13 | `git_tools.py` | 286 | NOT NEEDED | DeepAgents JS git tooling | PR creation tool. DeepAgents JS has built-in git capabilities. |
| 14 | `github_api.py` | 113 | NOT NEEDED | DeepAgents JS or standalone utility | Stateless REST helpers. Either DeepAgents handles it or it's a trivial standalone module. |
| 15 | `think_tool.py` | 71 | REBUILD | Simple LangChain tool | Trivial: 71-line no-op reasoning tool. Port is <30 minutes. |

### Tier 5: Guardrails & Observability (7 modules, 1,976 lines)

| # | Module | Lines | Classification | JS Replacement | Notes |
|---|--------|------:|----------------|----------------|-------|
| 16 | `loop_detection.py` | 385 | REBUILD | Custom TypeScript middleware | Tracks repeated tool calls/args/observations. Uses `aafter_model` + `awrap_tool_call` hooks. Map to JS middleware `wrapToolCall` + model hooks. |
| 17 | `tool_truncation.py` | 203 | REBUILD | Custom TypeScript middleware | Max chars per tool result. Straightforward `wrapToolCall` middleware. |
| 18 | `execution_budget.py` | 351 | REBUILD | Custom TypeScript middleware | Step threshold tracking + "wrap up" system message injection. Uses middleware step counter + periodic nudges. |
| 19 | `cost_cap.py` | 451 | REBUILD | Custom TypeScript middleware | USD budget from `usage_metadata` on model responses. Includes sub-agent cost view (`_CostCapSubAgentView`). |
| 20 | `graceful_stop.py` | 138 | REBUILD | Custom TypeScript middleware + AbortController | Platform STOP signal → tool block + summary message. Node.js equivalent uses `AbortController` + process signal handlers. cursor-runner already has signal handling in `main.ts`. |
| 21 | `error_hints.py` | 137 | REBUILD | Pattern-based error enrichment | Small module. Pattern → recovery hint mapping. Straightforward port. |
| 22 | `otel_callback.py` | 301 | CURSOR-RUNNER + REBUILD | `otel.ts` foundation exists | cursor-runner has OTel initialization and baggage. LLM/MCP span emission needs to be added. `@opentelemetry/api` already in cursor-runner's deps. |

### Tier 6: Summarization & Tokens (5 modules, 2,196 lines)

| # | Module | Lines | Classification | JS Replacement | Notes |
|---|--------|------:|----------------|----------------|-------|
| 23 | `summarization_middleware.py` | 880 | NATIVE (verify) | DeepAgents JS built-in `SummarizationMiddleware` | DeepAgents JS ships `createSummarizationMiddleware`. **Risk**: verify exact policy parity (graph-start compaction, overflow brake, token thresholds). If our policies differ from defaults, may need config overrides or custom wrapper. |
| 24 | `summarization_config.py` | 299 | NATIVE (verify) | DeepAgents JS summarization config | Frozen config with `for_model` / `disabled`. Check if JS middleware accepts equivalent parameters. |
| 25 | `summarization_callback.py` | 169 | REBUILD | Event protocol for summarization telemetry | Callback protocol + event dataclass. Needed if we want summarization telemetry in the unified runner. |
| 26 | `message_utils.py` | 403 | REBUILD | Message ID/summary serialization | LangMem-oriented helpers. JS may have equivalents in `langmem` JS if it exists; otherwise rebuild. |
| 27 | `token_counter.py` | 445 | REBUILD | JS tokenizer library | tiktoken / Anthropic heuristic / approximate counting. JS options: `js-tiktoken`, `@anthropic-ai/tokenizer`, or provider-specific methods. |

### Tier 7: Sub-agents (2 modules, 364 lines)

| # | Module | Lines | Classification | JS Replacement | Notes |
|---|--------|------:|----------------|----------------|-------|
| 28 | `subagent.py` | 218 | NATIVE | `subagents` array in `createDeepAgent` | JS natively supports `SubAgent` with name, description, systemPrompt, tools, model. Built-in `task` tool for delegation. |
| 29 | `subagent_limiter.py` | 146 | REBUILD | Async concurrency gate | `SubAgentGate` with `MAX_CONCURRENT_SUBAGENTS`. Implemented via `asyncio.Semaphore`; JS equivalent is a simple `Promise`-based semaphore. |

### Tier 8: Backends (7 modules, 2,554 lines)

| # | Module | Lines | Classification | JS Replacement | Notes |
|---|--------|------:|----------------|----------------|-------|
| 30 | `backends/__init__.py` | 31 | NOT NEEDED | Package re-exports | |
| 31 | `backends/types.py` | 160 | NOT NEEDED | TypeScript interfaces | `ExecutionResult` and normalizers. Replaced by DeepAgents JS backend protocol types. |
| 32 | `backends/gitignore_filter.py` | 97 | NOT NEEDED | DeepAgents JS handles internally | Python `pathspec` usage. DeepAgents JS filesystem backend has its own filtering. |
| 33 | `backends/platform_mount.py` | 272 | NOT NEEDED | Different architecture in TS | `.stigmer/` virtual mount path classification. The unified runner may need a simpler equivalent, but the Python implementation is tightly coupled to Python backend patterns. |
| 34 | `backends/filesystem.py` | 772 | NATIVE | DeepAgents JS `FilesystemBackend` | Chroot-like paths, gitignore, execute + streaming. JS has native filesystem backend. |
| 35 | `backends/deepagents_adapter.py` | 552 | NOT NEEDED | No adapter needed in JS | Python-to-Python adapter (`SandboxBackendProtocol`). JS uses DeepAgents JS backend protocol directly. |
| 36 | `backends/daytona.py` | 670 | NOT NEEDED (separate concern) | Daytona integration is independent of agent runtime | Workspace creation, SSH tunneling, snapshot lifecycle. This is infrastructure-level, not middleware. Will be handled as a separate Phase 6 concern. |

### Package Roots (2 modules, 94 lines)

| # | Module | Lines | Classification | JS Replacement | Notes |
|---|--------|------:|----------------|----------------|-------|
| 37 | `graphton/__init__.py` | 51 | NOT NEEDED | Barrel exports | Package API re-exports. |
| — | `core/__init__.py` | 43 | NOT NEEDED | Barrel exports | |

## Summary by Classification

| Classification | Module Count | Total Lines | % of Codebase |
|---------------|-------------|-------------|---------------|
| **NATIVE** | 9 | 2,665 | 17.7% |
| **CURSOR-RUNNER** (already exists in TS) | 5 | 2,415 | 16.1% |
| **REBUILD** (net-new TypeScript work) | 13 | 4,523 | 30.1% |
| **NOT NEEDED** | 12 | 5,414 | 36.1% |
| **Total** | **37** (+ 2 inits) | **15,017** | 100% |

## REBUILD Modules — Effort Estimate

These 13 modules (4,523 Python lines) represent the net-new engineering work.
TypeScript middleware is typically more concise than Python equivalents
(type inference, functional patterns, less boilerplate). Estimated TS output:
~3,000-3,500 lines.

| Module | Python Lines | Est. TS Lines | Effort | Priority |
|--------|-------------|---------------|--------|----------|
| `config.py` (Zod schema) | 541 | ~350 | Medium | Phase 1 |
| `tool_wrappers.py` (approval + truncation portions) | ~600 of 1,878 | ~400 | Medium | Phase 2 |
| `loop_detection.py` | 385 | ~250 | Medium | Phase 2 |
| `execution_budget.py` | 351 | ~250 | Medium | Phase 2 |
| `cost_cap.py` | 451 | ~300 | Medium | Phase 2 |
| `token_counter.py` | 445 | ~300 | Medium | Phase 2 |
| `message_utils.py` | 403 | ~250 | Medium | Phase 2 |
| `otel_callback.py` (LLM/MCP spans) | 301 | ~200 | Low | Phase 2 |
| `summarization_callback.py` | 169 | ~100 | Low | Phase 2 |
| `graceful_stop.py` | 138 | ~100 | Low | Phase 2 |
| `error_hints.py` | 137 | ~100 | Low | Phase 2 |
| `subagent_limiter.py` | 146 | ~80 | Low | Phase 3 |
| `think_tool.py` | 71 | ~40 | Trivial | Phase 2 |
| **Total** | **4,138** | **~2,720** | | |

Note: `tool_wrappers.py` is 1,878 lines total but ~1,278 lines are platform
tools that are handled by DeepAgents JS backends (NATIVE). Only the approval
wrapper + truncation portions (~600 lines) need rebuilding, and the approval
side already partially exists in cursor-runner's HITL modules.

## Key Risks

1. **Persistent MCP connections**: `MultiServerMCPClient` in JS is "stateless by default" per docs. The Python `McpToolsLoader` keeps stdio sessions alive across tool calls. Needs PoC validation (T01c).

2. **Summarization policy parity**: DeepAgents JS ships `SummarizationMiddleware` but our Python version has custom graph-start compaction, overflow brakes, and model-specific token thresholds. Need to verify if the JS middleware accepts equivalent configuration or if we need a custom implementation.

3. **Streaming event shape**: Python uses `astream_events` v2; JS uses `streamEvents` v3. The event schema may differ in field names, nesting, or tool call representation. The `StatusBuilder` pattern must be validated against JS event shapes (T01c).

4. **Sub-agent cost cap view**: `cost_cap.py` has a `_CostCapSubAgentView` that propagates budget constraints to sub-agents. Need to verify that DeepAgents JS subagent middleware hooks support this propagation pattern.

## Recommendation

The audit confirms that **Option A is viable**. The rebuild surface (13 modules,
~2,720 estimated TS lines) is manageable and well-scoped. The cursor-runner
provides a significant head start (5 modules already in TypeScript).

Proceed to T01b (checkpointer validation) and T01c (PoC) to validate the
three risk areas before committing to the full migration.
