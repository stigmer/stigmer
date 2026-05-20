# Task T05: Tier 6 Feature-Gap Modules (Phase 5 continued)

**Created**: 2026-05-20
**Status**: READY FOR EXECUTION
**Type**: Implementation (4 workstreams)
**Phase**: 5 (Tier 6)
**Depends on**: Phases 1–5 Tier 0–5 (COMPLETE, 723 tests passing)

## Objective

Build the remaining feature modules that exist in Python but have no TypeScript
equivalent, achieving full feature parity for ExecuteDeepAgent before the
deployment phase.

## Critical Evaluation — Do These Modules Deserve to Exist?

Before blindly porting Python code, each module was evaluated against the
question: "Is this genuinely needed in a state-of-the-art TypeScript runner, or
was this a patch over a limitation that no longer applies?"

### Verdict: YES — Subagent Transformer (CRITICAL)

Sub-agents are a core platform feature. The agent spec proto has `sub_agents`
as a first-class field. The `deepagents` JS library exports `AnySubAgent`,
`AsyncSubAgent`, `CompiledSubAgent`, and accepts a `subagents` parameter on
`createDeepAgent()`. Currently `setup.ts` calls `createDeepAgent()` **without**
any subagents — meaning every deep agent execution runs without delegation
capability. This is a significant feature gap, not a nice-to-have.

The module handles:
- Built-in explore/shell subagents (Cursor has `Task` for this; deep agents need it)
- MCP access restriction per subagent (security boundary — subagents should NOT
  inherit all parent MCP tools indiscriminately)
- Per-subagent skill injection
- Model override validation

All of this is genuine domain logic that cannot be replaced by "just pass
everything through."

### Verdict: YES — Attachment Injector (REQUIRED)

The `Attachment` proto is a well-defined, documented message on
`AgentExecutionSpec`. The CLI supports `--attach` for file uploads. The
execution flow is: client uploads → storage_key → execution created →
runner downloads → injects into workspace.

Without this module, any execution with attachments silently drops the files.
The ZIP validation (path traversal, zip bombs) is a **security requirement**,
not a Python band-aid.

However: the `auto_publish_written_files` function in the same Python file
already has a TS equivalent at `auto-publish.ts`. We port ONLY the injection +
ZIP validation, not the auto-publish logic. That is not a blind port — it is
recognizing that the TS codebase already solved that piece.

### Verdict: YES — Platform Mount (ARCHITECTURAL)

The `.stigmer/` virtual namespace is not a Python hack — it is a deliberate
architectural decision (AD-01 v3 in the Python project). It solves real
problems:
- Skills and attachments need a standard location (`.stigmer/skills/`,
  `.stigmer/inputs/`) that is separate from the user's workspace
- Shell commands need `$STIGMER_PLATFORM_DIR` for execution
- Display paths need humanization (no raw `/home/daytona/workspace/...` leaked
  to users through status updates)
- Git writeback must exclude `.stigmer/` (platform files are not user changes)

The Cursor harness already has ad-hoc versions of this (`getPlatformDir()` +
symlink in `skill-resolver.ts` and `attachment-resolver.ts`), which validates
the need. The deep agent harness has NO equivalent.

However: we will evaluate whether a SIMPLER approach works in TS — a real
`.stigmer/` directory with gitignore exclusion instead of the full virtual
overlay. The Python implementation was designed for Daytona sandboxes with
separate `platform_dir` and `root_dir`. If the TS runner can use a single
root with a `.stigmer/` subdirectory, the path classification + command
rewriting is still needed but the workspace backend does not need dual-root
routing.

### Verdict: DEFER — Task-Aware Relevance (LOW VALUE)

This module extracts file path candidates from user messages using regex
heuristics and resolves them against the workspace filesystem to produce a
"Potentially Relevant Files" prompt section.

**Why this was valuable in early Python days:**
- Older LLMs were worse at tool use and needed hints
- The system prompt file tree was less sophisticated

**Why this has diminishing value now:**
- Modern models (Claude Sonnet 4, GPT-4.1) are excellent at extracting file
  references from user messages and using tools to find them
- The agent already receives a full file tree in the system prompt
- The agent has `read`, `glob`, `grep`, `search` tools — finding files the
  user mentioned takes 1-2 tool calls
- The heuristic approach (regex tokenization, extension matching) will have
  false positives and false negatives
- ~300 LOC of string processing for marginal value

**Decision**: Defer to post-deployment. If users report that agents are slow
to find referenced files, we can add this as an optimization. But for a
state-of-the-art system, the agent should be smart enough to find files
on its own.

This removes 60 tests and ~200 LOC from the Tier 6 scope.

## Final Scope

| # | Module | Effort | Tests |
|---|--------|--------|-------|
| W1 | Platform mount | 1 session | ~44 |
| W2 | Attachment injector | 1 session | ~30 |
| W3 | Subagent transformer | 2 sessions | ~58 + integration |
| — | ~~Task-aware relevance~~ | DEFERRED | ~~60~~ |

**Total**: 4 sessions, ~200 new tests, ~950 LOC.

---

## W1: Platform Mount (Session 1)

**Goal**: Build the `.stigmer/` virtual namespace routing, display path
humanization, and shell command rewriting.

**Estimated effort**: 1 session

### Deliverables

| File | Responsibility |
|------|---------------|
| `src/shared/workspace/platform-mount.ts` | Path classification, command rewriting, display humanization |
| `src/shared/workspace/__tests__/platform-mount.test.ts` | ~44 tests covering all functions + edge cases |

### API Surface

```typescript
// Constants
export const PLATFORM_PREFIX = ".stigmer/";
export const PLATFORM_DIR_NAME = ".stigmer";
export const STIGMER_PLATFORM_DIR_ENV = "STIGMER_PLATFORM_DIR";

// Core router — pure string logic
export function classifyPlatformPath(relPath: string): { isPlatform: boolean; remainder: string };

// Display: $STIGMER_PLATFORM_DIR → .stigmer (for status messages, approval previews)
export function humanizePlatformRefs(text: string): string;

// Execute: .stigmer → $STIGMER_PLATFORM_DIR (for shell commands)
export function resolvePlatformCommand(command: string): string;

// Display: /home/daytona/workspace/foo → foo (for streamed tool call args)
export function humanizeSandboxPaths(text: string, workspaceRoot: string): string;

// Display: $OUTPUT_DIR → actual value (for approval previews, non-secret only)
export function resolveDisplayEnvVars(text: string, envVars: Record<string, string>, secretKeys?: ReadonlySet<string>): string;
```

### Design Question (Resolve Before Starting)

**Virtual overlay vs real directory**: The Python code uses a separate
`platform_dir` with virtual routing in the workspace backend. The TS runner
can likely use a simpler approach: create `.stigmer/` as a real directory
under `workspace.rootDir`. This avoids dual-root complexity in
`LocalWorkspaceBackend`.

If we go with the simpler real-directory approach:
- `classifyPlatformPath()` is still needed for display humanization
- `humanizePlatformRefs/resolvePlatformCommand` are still needed for command
  rewriting
- `humanizeSandboxPaths` is still needed for status display
- But `LocalWorkspaceBackend` does NOT need dual-root `resolve()` logic

Recommend: Start with real-directory approach. Escalate if it proves
insufficient.

### Wiring

After building the module:
- Wire `humanizeSandboxPaths` into StatusBuilder (tool call args/results display)
- Wire `resolvePlatformCommand` into workspace backend `execute()` calls
- Add `STIGMER_PLATFORM_DIR` to the environment passed to `execute()` calls
- Add `.stigmer` to git excludes in writeback-coordinator

### Key References

- Python canonical: `graphton/core/backends/platform_mount.py` (272 LOC)
- Python re-export: `agent-runner/worker/workspace/platform_mount.py`
- Python tests: `graphton/tests/core/test_platform_mount.py` (23 tests)
- Python integration: `agent-runner/tests/workspace/test_platform_mount_integration.py` (21 tests)
- TS Cursor ad-hoc: `execute-cursor/skill-resolver.ts`, `execute-cursor/attachment-resolver.ts`

---

## W2: Attachment Injector (Session 2)

**Goal**: Download attachments from artifact storage, validate ZIP archives
with security guards, and inject files into the workspace before execution.

**Estimated effort**: 1 session
**Depends on**: W1 (attachments go under `.stigmer/inputs/`)

### Deliverables

| File | Responsibility |
|------|---------------|
| `src/activities/execute-deep-agent/attachment-injector.ts` | ZIP validation + workspace injection |
| `src/activities/execute-deep-agent/__tests__/attachment-injector.test.ts` | ~30 tests (security validation, injection flow, error handling) |

### API Surface

```typescript
interface InjectedFile {
  filename: string;
  path: string;
  sizeBytes: number | null;
}

// Security validation — must reject:
//   1. Invalid zip format
//   2. Absolute paths (/ or \)
//   3. Path traversal (.. components)
//   4. Empty archives
//   5. > 1000 files (zip bomb)
//   6. > 100 MB uncompressed (zip bomb)
export function validateZipForExtraction(
  zipData: Buffer,
  attachmentFilename: string,
): Array<{ relativePath: string; uncompressedSize: number }>;

// Download from storage, validate ZIPs, extract/write to workspace
export async function injectAttachments(opts: {
  backend: WorkspaceBackend;
  attachments: readonly Attachment[];
  storage: ArtifactStorage;
  allowLocalPath?: boolean;
}): Promise<InjectedFile[]>;
```

### What We Are NOT Porting

- `auto_publish_written_files` — already exists as `auto-publish.ts`
- `_is_already_published` helper — used only by auto-publish

### ZIP Library Decision

The existing `skill-writer.ts` already implements a custom ZIP parser using
Node.js `node:zlib` `createInflateRaw`. For consistency and to avoid adding
a new dependency, we should reuse or extend that pattern for attachment ZIP
extraction. If it proves insufficient (skill ZIPs are simpler than arbitrary
user uploads), we add `yauzl` (MIT license, pure JS, streaming extraction).

**Decision point**: evaluate during implementation. Start with `node:zlib`,
escalate to `yauzl` only if needed.

### Wiring

After building the module, wire into `setup.ts`:
- After workspace provisioning (Step 7)
- Before prompt building (Step 8)
- Pass `injectedFiles` to `buildEnhancedSystemPrompt()` (the parameter already
  exists but is hardcoded to `[]`)

### Key References

- Python source: `agent-runner/activities/graphton/attachments.py` (injection + validation only, ~250 LOC)
- Python tests: `agent-runner/tests/test_inject_attachments.py` (30 tests)
- Proto: `agentexecution/v1/spec.proto` → `Attachment` message
- TS auto-publish (DO NOT DUPLICATE): `execute-deep-agent/auto-publish.ts`
- TS artifact storage: `shared/artifact-storage.ts`
- TS skill ZIP parser (reuse candidate): `shared/skill-writer.ts`

---

## W3: Subagent Transformer (Sessions 3–4)

**Goal**: Transform proto SubAgent definitions into `deepagents` JS runtime
format, enabling sub-agent delegation for ExecuteDeepAgent.

**Estimated effort**: 2 sessions (split at natural boundary: session 3 = built-in
subagents + core transform; session 4 = MCP filtering + skill injection + integration)

**Depends on**: W1 (platform mount for platform tool routing)

### Deliverables

| File | Responsibility |
|------|---------------|
| `src/activities/execute-deep-agent/subagent-transformer.ts` | Proto SubAgent → deepagents format |
| `src/activities/execute-deep-agent/__tests__/subagent-transformer.test.ts` | ~58 tests (built-in types, MCP filtering, skill injection, model validation) |

### API Surface

```typescript
// Built-in explore/shell subagents
export function createBuiltinSubagents(
  backend: WorkspaceBackend,
  approvalPolicies?: ReadonlyMap<string, MergedToolPolicy>,
): AnySubAgent[];

// Main orchestrator: proto SubAgent[] → deepagents AnySubAgent[]
export async function transformSubAgents(opts: {
  subAgents: readonly SubAgent[];
  parentMcpConnection: McpConnectionResult;
  parentMcpUsages: readonly McpServerUsage[];
  skillClient: StigmerClient;
  workspaceBackend: WorkspaceBackend;
  approvalPolicies: ReadonlyMap<string, MergedToolPolicy>;
  autoApproveAll: boolean;
  parentHasNativeThinking?: boolean;
}): Promise<AnySubAgent[] | null>;
```

### Key Complexity

The `deepagents` JS library has its own `AnySubAgent` type which likely
differs from the Python dict format. The transformer must produce output
compatible with `createDeepAgent({ subagents: [...] })`. This is the primary
adaptation challenge — it is NOT a 1:1 port from Python dicts.

**Critical validation needed before implementation**: Read the `deepagents` JS
`AnySubAgent` / `AsyncSubAgent` type definitions to understand the expected
shape. The Python code produces `{"name", "description", "system_prompt",
"tools", "middleware", "model"}` dicts — the JS API may use different field
names or a different composition model.

### Session 3 Scope (Core Transform)

- Built-in subagent creation (explore + shell types)
- Single subagent transformation (name, description, system prompt, tools)
- Model override validation against ModelRegistry
- Think tool injection for non-thinking models
- Basic tests (~25)

### Session 4 Scope (MCP + Skills + Integration)

- MCP access filtering (intersect subagent grants with parent's MCP servers)
- Per-subagent skill resolution and prompt injection
- Batch skill fetch optimization
- Integration tests (subagent pipeline, skill pipeline)
- Wire into `setup.ts` Step 12: pass `subagents` to `createDeepAgent()`
- Remaining tests (~33 + integration)

### Integration Tests Bundled with W3

These test the full pipeline that subagent-transformer orchestrates:

| Python Test File | Tests | What It Covers |
|-----------------|-------|---------------|
| `test_integration_subagent_pipeline.py` | 9 | End-to-end transform → MCP → skill injection |
| `test_prompt_builder_subagent_rules.py` | 10 | Sub-agent delegation rules in prompts |

The following are OUT OF SCOPE for this task (they test features beyond
subagent-transformer or require full gRPC stack):

| Python Test File | Tests | Why Out of Scope |
|-----------------|-------|-----------------|
| `test_integration_skill_pipeline.py` | 36 | Tests gRPC fetch → artifact → ZIP → prompt (parent skill pipeline, already works) |
| `test_multi_workspace_integration.py` | 21 | Tests provisioner → file tree → prompt (workspace pipeline, already works) |
| `test_skill_client.py` | 7 | Tests dedicated gRPC client (StigmerClient already tested) |

### Key References

- Python source: `agent-runner/activities/graphton/subagent_transformer.py` (795 LOC)
- Python tests: `agent-runner/tests/test_subagent_transformer.py` (39 tests)
- deepagents JS types: `node_modules/deepagents/dist/index.d.ts` → `AnySubAgent`, `AsyncSubAgent`, `CreateDeepAgentParams`
- Proto: `agent/v1/spec.proto` → `SubAgent`, `McpAccess`
- TS shared modules: `mcp-manager.ts`, `skill-writer.ts`, `approval-policy.ts`, `model-registry.ts`, `subagent-gate.ts`, `subagent-wiring.ts`
- TS setup wiring point: `setup.ts` line 307 → `createDeepAgent({ ... })`

---

## How to Use This Plan

Drop this file into a new conversation with:

```
@_projects/2026-05/20260518.01.unified-runner-migration/tasks/T05_tier6_0_plan.md

Continue with W1: Platform Mount
```

Or for later workstreams:
```
Continue with W2: Attachment Injector
```

```
Continue with W3 Session 3: Subagent Transformer (Core)
```

```
Continue with W3 Session 4: Subagent Transformer (MCP + Skills + Wiring)
```

Each workstream can be worked independently (W2 and W3 both depend on W1).
Complete one, checkpoint, then start the next.

## Essential Context Files (for any workstream)

```
@_projects/2026-05/20260518.01.unified-runner-migration/next-task.md
@_projects/2026-05/20260518.01.unified-runner-migration/design-decisions/001-t01a-graphton-module-audit.md
@_projects/2026-05/20260518.01.unified-runner-migration/checkpoints/2026-05-20-session-17-phase5-test-porting.md
```

## Quality Standards (Non-Negotiable)

- Full TypeScript strictness (no `any`, no type assertions without justification)
- Exhaustive unit tests for every module (table-driven where appropriate)
- Each workstream ends with: `tsc --noEmit` clean, `vitest run` pass
- Checkpoint document created after each workstream
- No autonomous architectural decisions — pause and ask on surprises
- Do NOT blindly port Python patterns. Adapt to TypeScript idioms and the
  existing TS runner conventions (see coding patterns in existing modules)
- Security-sensitive code (ZIP validation) gets extra scrutiny and edge-case
  tests

## Full Roadmap Position

| Phase | Name | Status |
|-------|------|--------|
| 0 | Research Spike | COMPLETE |
| 1 | Service Scaffold | COMPLETE |
| 2 | Core Shared Infrastructure | COMPLETE |
| 3a | ExecuteDeepAgent Walking Skeleton | COMPLETE |
| 3b | StatusBuilder + Middleware + Artifacts | COMPLETE |
| 3c | HITL + Approval | COMPLETE |
| 4 | Supporting Activities | COMPLETE |
| 5 (Tiers 0–5) | Test Porting | COMPLETE (723 tests) |
| **5 (Tier 6)** | **Feature-Gap Modules** | **NEXT** |
| — | Workflow Runner TS Rewrite | Separate project |
| 6 | Deployment + Cleanup | After Tier 6 + Workflow Runner |
