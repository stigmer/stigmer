# Task T01: Implement Think Tool & Suppress Echo

**Created**: 2026-02-23
**Status**: PENDING REVIEW
**Type**: Feature Development

⚠️ **This plan requires your review before execution**

## Objective

Two complementary changes to the agent runner and CLI:
1. **Suppress LLM echo** — Stop agents from reprinting file contents after reading them
2. **Add a think tool** — Give agents a structured place to reason without producing user-visible output
3. **CLI UX for think tool** — Render think tool usage distinctly in the CLI (collapsed/spinner)

## Problem Statement

When agents receive attached files (via `--attach`), the system prompt lists all files and instructs the agent to read them via the `read` tool. After reading, the LLM echoes all file contents in its assistant text (e.g., "Here are the complete contents of all 20 files:"). This:
- Wastes output tokens (cost + latency)
- Creates a terrible UX (wall of proto definitions the user didn't ask for)
- Provides zero benefit (contents are already in context from tool results)

Cursor doesn't do this — it reads silently and moves to the task. We should match that behavior.

## Root Cause Analysis (completed)

The echo behavior is caused by the LLM's default tendency to "acknowledge" what it read. The relevant code path:

1. **Attachment extraction** — `execute_graphton.py` lines ~503-536: zips extracted to `inputs/{dirname}/`
2. **System prompt injection** — `execute_graphton.py` lines 1890-1907: enhances system prompt with file list + "Use the `read` tool to access them"
3. **LLM behavior** — After reading files via tool calls, the LLM generates text echoing all contents. Nothing in the instructions tells it NOT to.

Key files:
- `backend/services/agent-runner/worker/activities/execute_graphton.py` (agent execution engine)
- `backend/services/stigmer-server/pkg/seedpack/agents/skill-creator-agent.yaml` (affected agent)
- `client-apps/cli/cmd/stigmer/root/draft_skill_handler.go` (CLI draft skill command)
- `client-apps/cli/cmd/stigmer/root/run_stream*.go` (CLI streaming renderer — needs think tool UX)

## Implementation Plan

### Phase 1: Suppress Echo (quick win, zero risk)

**File**: `backend/services/agent-runner/worker/activities/execute_graphton.py`

Modify the input files system prompt section (~line 1900) to add explicit anti-echo instructions:

```python
input_files_section += (
    "\nThese files are available in your workspace. "
    "Read them using the `read` tool with the paths shown above. "
    "After reading files, do NOT reprint, echo, or summarize their contents. "
    "The tool results are already in your context — proceed directly to the task."
)
```

- [ ] Update the input files prompt text in `execute_graphton.py`
- [ ] Test with `stigmer draft skill --attach` to verify echo is suppressed

### Phase 2: Add Think Tool to Agent Runner

**Reference**: [Anthropic's think tool pattern](https://www.anthropic.com/engineering/claude-think-tool)

Add a `think` tool to the agent runner's tool set. The tool is a no-op — it accepts a `thought` string and returns success. The LLM uses it to reason without producing user-visible text.

Tool definition:
```json
{
  "name": "think",
  "description": "Use this tool to think about something. It will not obtain new information or make any changes, but just log the thought. Use it when complex reasoning or brainstorming is needed — for example, after reading input files, analyzing tool outputs, or before making important decisions.",
  "input_schema": {
    "type": "object",
    "properties": {
      "thought": {
        "type": "string",
        "description": "Your thoughts."
      }
    },
    "required": ["thought"]
  }
}
```

- [ ] Identify where built-in tools are defined in the agent runner (search for `read`, `write`, `execute` tool definitions in `execute_graphton.py` or related modules)
- [ ] Add the `think` tool definition alongside existing built-in tools
- [ ] The tool handler should be a no-op: receive the thought, log it internally, return `{"status": "ok"}`
- [ ] Think tool should NOT require approval (it's read-only, no side effects)
- [ ] Add system prompt guidance on when to use the think tool (after reading files, before complex decisions)

### Phase 3: CLI UX for Think Tool

**Files**: `client-apps/cli/cmd/stigmer/root/run_stream*.go` (streaming renderer)

When the CLI stream encounters a `think` tool call, it should render it differently from regular tool calls:

Options to evaluate:
- **Option A**: Collapsed — show "Thinking..." with the thought content hidden by default
- **Option B**: Spinner — show "Agent is reasoning..." while the think tool is in progress
- **Option C**: Brief summary — show first N characters of thought with "..." truncation
- **Option D**: Completely hidden — skip rendering entirely

- [ ] Identify how tool calls are currently rendered in the CLI stream
- [ ] Implement distinct rendering for `think` tool calls
- [ ] Test the UX with a real agent execution

### Phase 4: Validation

- [ ] Run `stigmer draft skill --attach` end-to-end and verify:
  - No file content echoing after reads
  - Agent uses think tool for reasoning
  - CLI renders think tool with chosen UX treatment
- [ ] Verify no regression in normal agent execution (agents without attachments)
- [ ] Check token usage before/after to quantify savings

## Design Decisions to Make

1. **Think tool UX style** — Which rendering option (A/B/C/D) for the CLI? My recommendation: Option A (collapsed, expandable) since it lets curious users inspect reasoning while keeping the default view clean.

2. **Think tool scope** — Should the think tool be available to ALL agents, or only when input files are attached? Recommendation: ALL agents — it's universally useful for complex reasoning.

3. **System prompt guidance** — How much guidance to give the LLM about when to think? Anthropic found that domain-specific examples significantly improve think tool usage. We could add examples in the system prompt.

## Success Criteria

- [ ] Agents no longer echo file contents after reading
- [ ] Think tool available and agents use it for reasoning
- [ ] CLI renders think tool calls with distinct UX (collapsed/spinner)
- [ ] Measurable reduction in output tokens for file-heavy executions

## Next Task Preview

**T02: Testing & Iteration** — Run real agent executions across different scenarios (draft skill, draft agent, general runs) and iterate on think tool prompting and CLI UX.

## Review Process

**What happens next**:
1. **You review this plan** — Consider the phased approach and design decisions
2. **Provide feedback** — Especially on CLI UX choice (Option A/B/C/D) and think tool scope
3. **I'll revise** — Incorporate your feedback into a revised plan
4. **You approve** — Execution begins

**Please consider**:
- Does the phased approach (echo fix first, then think tool, then CLI UX) make sense?
- Which CLI rendering option do you prefer for the think tool?
- Should think tool be available to all agents or only file-heavy ones?
- Any concerns about the system prompt changes?
