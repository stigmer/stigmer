# Add Workflows to Stigmer Seedpack

**Date**: May 17, 2026

## Summary

Added workflows as a new resource type in the Stigmer seedpack, making them part of the bootstrap content that ships with every Stigmer installation. Three curated workflow YAML files demonstrate core orchestration patterns using only self-contained task kinds (llm_call, human_input, switch_case, fork, transform) that work with just an LLM provider configured.

## Problem Statement

The seedpack previously included agents, skills, and MCP servers but no workflows. Users had no out-of-the-box examples of what workflows look like or how to build them, despite workflows being a first-class product surface after the "bring workflows to foreground" project.

### Pain Points

- New users had no reference workflows to learn from
- The seedpack did not reflect that workflows are now a core Stigmer capability
- No practical examples demonstrating task kinds like llm_call, human_input, switch_case, fork, or transform

## Solution

Added a `workflows/` directory to the seedpack with three hand-authored workflow YAML files, wired into the embed/build/test infrastructure following the same pattern as agents and MCP servers.

Each workflow was designed to be genuinely runnable with a base Stigmer installation (LLM provider only), deliberately avoiding task kinds that require external service configuration (notification with Slack, agent_call to agents with unconfigured MCP servers).

## Implementation Details

### New Files

- `seedpack/workflows/content-review-pipeline.yaml` -- llm_call + human_input with revision loops + transform
- `seedpack/workflows/support-ticket-triage.yaml` -- llm_call with structured output + switch_case branching + human_input approval gate + transform
- `seedpack/workflows/research-and-summarize.yaml` -- llm_call + fork with parallel branches + transform with JQ + human_input

### Modified Files

- `seedpack/embed.go` -- Added `//go:embed workflows` directive
- `seedpack/BUILD.bazel` -- Added `workflows/**` to filegroup glob and workflow files to embedsrcs
- `seedpack/stigmer.yaml` -- Updated project description to mention workflows
- `seedpack/seedpack_test.go` -- Added workflow files to expected files list

### Task Kinds Demonstrated Across All Three Workflows

- `llm_call` with structured output (response_schema), temperature/token tuning
- `human_input` with custom outcomes, form schemas, revision loops, timeout policies
- `switch_case` with expression-based conditional routing
- `fork` with parallel branches and compete=false
- `transform` with JQ engine for data merging
- Variable passing via `export.as` and `${ $context.* }` expressions
- Workflow-level `budget` (max_cost_micros, max_total_tokens, max_duration_seconds)
- Environment variable declarations with `spec.env`

### Gap Documentation

Created `T17_0_plan.md` in the bring-workflows-to-foreground project documenting the notification provider gap (only `webhook` channel implemented, no `slack`/`email`) and the emit_event cross-workflow delivery gap, for follow-up work.

## Benefits

- Users see real workflow examples immediately after installing Stigmer
- The seedpack now represents all four resource types: agents, skills, workflows, MCP servers
- Workflows are genuinely executable, not aspirational templates

## Impact

- Every new Stigmer installation bootstraps with 3 workflow templates
- The seedpack project manifest now accurately describes its contents
- Content hash changes trigger re-apply on existing installations (automatic upgrade)

## Related Work

- Project: `20260508.01.bring-workflows-to-foreground` (workflows as first-class product)
- Follow-up: T17 (notification providers + seedpack integration workflows)
- Project: `20260514.01.e2e-workflow-testing-infrastructure` (workflow testing)

---

**Status**: Production Ready
**Timeline**: 1 session
