# Sub-Project: 20260515.01.sp.agent-powered-workflow-generation

## Parent Project

- **Parent**: 20260508.01.bring-workflows-to-foreground
- **Parent Path**: [../../20260508.01.bring-workflows-to-foreground/](../../20260508.01.bring-workflows-to-foreground/)
- **Spawned From Task**: T16

---

## Overview
Rewrite all workflow generation, refinement, and diagnosis flows from direct LLM calls to agent-powered sessions using the Cursor harness. The Workflow Architect agent uses MCP server connections and tool use for richer, more sophisticated workflow creation, replacing the current single-shot prompt approach.

**Created**: 2026-05-15
**Status**: Active

## Sub-Project Information

### Goal
Replace the current direct LLM RPCs (generateWorkflowFromPrompt, refineWorkflow, diagnoseWorkflowExecution) with a Workflow Architect agent that leverages the existing Cursor harness infrastructure, MCP server tool introspection, and streaming agent sessions to produce higher-quality workflows with full observability.

### Technology Stack
Protobuf (APIs/schemas), Go (workflow-runner/Temporal workers), Java (stigmer-service), TypeScript/React (Web UI), Python (agent-runner/LangGraph), Temporal (durability), CNCF Serverless Workflow (DSL influence)

### Project Type
Feature Development

### Affected Components
Proto APIs (workflow/workflowexecution/workflowinstance/tasks), workflow-runner (Go/Temporal), stigmer-service (Java), Web UI (React — builder, execution viewer, dashboard), CLI (Go — workflow commands), agent-runner (Python — structured output support), model registry, artifact store

### Additional Context
AD-T16-001 (Server-Side Generation via Direct LLM Call) is being reversed. The existing agent execution infrastructure in both Go OSS (stigmer-server) and Java Cloud (stigmer-service) already supports HARNESS_CURSOR dispatch via Temporal. The current T16 Batches 1-4 code (pkg/llmclient, generate/refine/diagnose handlers, WorkflowPromptBuilder, WorkflowYamlValidator, SDK hooks, React components) will be deleted and rebuilt around agent sessions.

## Project Structure

This sub-project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (ASK before creating)
- **`design-decisions/`** - Significant architectural choices (ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (ASK before creating)

**Note**: Also check the parent project's knowledge folders for inherited context.

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Progress Tracking
- [x] Sub-project initialized
- [ ] Initial analysis complete
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Sub-project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Parent Project](../../20260508.01.bring-workflows-to-foreground/)
- [Checkpoints](checkpoints/)
- [Design Decisions](design-decisions/)
