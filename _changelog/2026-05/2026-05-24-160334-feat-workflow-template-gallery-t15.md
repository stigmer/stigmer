# Workflow Template Gallery (T15)

**Date**: May 24, 2026

## Summary

Implemented a workflow template gallery with 8 curated templates covering every structural workflow pattern — parallel processing, branching, HITL approval, revision loops, batch processing, multi-agent orchestration, error handling, and HTTP integration. The gallery integrates into the "New Workflow" page as a third creation path alongside "Visual Editor" and "Generate with AI".

## Problem Statement

Users creating workflows had only two paths: start from a blank canvas or generate with AI. There was no way to browse pre-built patterns, learn what the platform supports, or get a head start on common automation scenarios.

### Pain Points

- New users had no guidance on workflow structure patterns
- The platform's 20 task kinds and control flow capabilities were not showcased
- No quick path from "I want a webhook-to-callback pipeline" to a working starting point
- Agent and MCP server creation already had template galleries; workflows did not

## Solution

Built a workflow template gallery following the established `resource-creation` template pattern (used by agents and MCP servers), with workflow-specific enhancements: pattern badges, task count chips, graph preview dialog, and metadata derivation from YAML.

## Implementation Details

### Template Data Layer
- `WorkflowTemplateData` type: templates carry full YAML strings (not form fields)
- `deriveTemplateMeta()`: pure function that parses YAML and extracts task count, task kinds, structural patterns, env var count, and budget presence
- Pattern detection: fork→parallel, switch_case→branching, human_input→HITL, for_each→batch, try_catch→error-handling, backward flow.then→loop, multiple AI kinds→ai-pipeline

### 8 Templates (3 existing + 5 new)
1. **Research & Summarize** — fork/parallel + HITL approval (from seedpack)
2. **Support Ticket Triage** — switch_case branching + HITL escalation (from seedpack)
3. **Content Review Pipeline** — revision loop with HITL re-review (from seedpack)
4. **Batch Data Enrichment** — for_each + HTTP integration (new)
5. **Multi-Agent Pipeline** — 3 chained agent_call tasks with structured handoff (new)
6. **Error-Resilient Integration** — try_catch + HTTP + LLM error diagnosis (new)
7. **LLM Evaluation Pipeline** — eval + validate + structured comparison (new)
8. **Webhook Event Processor** — agent analysis + switch routing + HTTP callback (new)

### Gallery Components (SDK)
- `WorkflowTemplateCard` — enhanced card with pattern badges, task count, env var chips, preview button
- `WorkflowTemplatePreview` — native `<dialog>` with graph rendering, metadata, "Use this template"
- `WorkflowTemplateGallery` — composes `useTemplateFilter` headless hook with custom cards

### Client App Integration
- Both web and desktop WorkflowNewPage updated with "Start from template" as first option
- Template selection wires directly to `WorkflowEditorView` via `initialYaml` — same code path as blank starter
- DD-016 parity maintained across both apps

### Files Changed
- 10 new files, 6 modified files
- 54 unit tests (12 derivation + 15 template integrity + 27 per-template metadata)
- 10 E2E test specs
- Zero backend changes, zero proto changes

## Benefits

- Users can browse 8 patterns covering 13 of 20 task kinds without reading docs
- Each template teaches a distinct structural pattern — no redundancy
- Gallery is instant (client-side SDK constants, zero API calls)
- `templates` prop on gallery component enables future server-fetched marketplace templates
- Platform builders can pass custom template arrays for their own workflows

## Impact

- **End users**: Third creation path on New Workflow page — browse, preview, customize
- **Platform builders**: `WORKFLOW_TEMPLATES`, `WorkflowTemplateGallery`, `deriveTemplateMeta` added to SDK public surface
- **SDK consumers**: All types, components, and hooks independently importable (DD-003 headless-first)

## Related Work

- T01-T16 workflow UX implementation project (this is T15)
- Existing agent template gallery (`AGENT_TEMPLATES`, `CreationPicker`, `TemplateGallery`)
- Existing MCP server template gallery (`MCP_SERVER_TEMPLATES`)

---

**Status**: Production Ready
**Timeline**: Single session
