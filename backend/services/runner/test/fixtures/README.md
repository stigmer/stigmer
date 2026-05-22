# Recorded Response Fixtures

This directory contains recorded HTTP request/response pairs used by the
`ReplayFetchInterceptor` for deterministic offline testing of LLM-dependent
code paths.

## Directory Structure

```
recorded-responses/
  agent-mcp-echo.json              # MCP tool choice: echo tool
  agent-mcp-fail.json              # MCP tool choice: fail tool
  agent-mcp-filter.json            # MCP enabled tools filter
  agent-mcp-http.json              # MCP HTTP tool execution
  agent-mcp-env.json               # MCP env var resolution
  agent-hitl-approve.json          # HITL approval flow
  agent-hitl-skip.json             # HITL skip flow
  agent-hitl-reject.json           # HITL reject flow
  agent-hitl-auto-approve.json     # HITL auto-approve
  agent-hitl-details.json          # HITL pending approval details
  agent-hitl-idempotent.json       # HITL idempotent approval
  agent-toolcall-contract.json     # ToolCall proto field contract
  agent-toolcall-error.json        # ToolCall failed status
  workflow-architect-generate.json # Workflow Architect: generate
  workflow-architect-refine.json   # Workflow Architect: multi-turn refine
  workflow-architect-diagnose.json # Workflow Architect: diagnose execution
  workflow-architect-repair.json   # Workflow Architect: diagnose and repair
  workflow-architect-mcp.json      # Workflow Architect: MCP tool access
  workflow-architect-apply.json    # Workflow Architect: generate and apply
  workflow-architect-refine-apply.json # Workflow Architect: refine and apply
  workflow-eval-passfail.json      # Eval: pass/fail judge
  workflow-eval-numeric.json       # Eval: numeric score judge
  workflow-eval-warn.json          # Eval: warn policy
  workflow-llm-structured.json     # LLM call: structured output
  workflow-llm-simple.json         # LLM call: simple prompt
  workflow-llm-openai.json         # LLM call: OpenAI structured output
  agent-lifecycle-stream.json      # Streaming phase progression
  agent-lifecycle-cancel.json      # Cancel/terminate/pause/recover
  seedpack-content-review.json     # Seedpack: content review pipeline
  seedpack-support-triage.json     # Seedpack: support ticket triage
  seedpack-research.json           # Seedpack: research and summarize
```

## Recording New Fixtures

Run with the `RECORD_FIXTURES` environment variable:

```bash
RECORD_FIXTURES=1 npx vitest run src/__tests__/deterministic-agent.test.ts
```

This wraps `globalThis.fetch`, forwards LLM API requests to real endpoints,
captures the request/response pairs, and writes them to JSON files here.

**Auth tokens are automatically redacted** in recorded fixtures.

## Re-recording

When prompts, system instructions, or tool schemas change, re-record the
affected fixtures:

```bash
RECORD_FIXTURES=1 npx vitest run src/__tests__/deterministic-agent.test.ts -t "workflow architect generate"
```

## Fixture Format

Each JSON file contains:

```json
{
  "name": "fixture-name",
  "recordedAt": "2026-05-22T...",
  "entries": [
    {
      "index": 0,
      "timestamp": "...",
      "request": {
        "method": "POST",
        "url": "https://proxy/v1/proxy/llm/anthropic/v1/messages",
        "headers": { "authorization": "[REDACTED]" },
        "body": { "model": "...", "messages": [...] }
      },
      "response": {
        "status": 200,
        "statusText": "OK",
        "headers": {},
        "body": { "content": [...], "usage": {...} }
      },
      "durationMs": 1234
    }
  ]
}
```

Entries are ordered sequentially and replayed in order during tests.
