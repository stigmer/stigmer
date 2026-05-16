# Fix Starter Workflow YAML Envelope Format

**Date**: May 16, 2026

## Summary

Fixed the "Failed to parse workflow / Workflow YAML is missing required field: spec" error on the New Workflow page by correcting `STARTER_WORKFLOW_YAML` to use the full Workflow resource envelope format. Added unit tests to prevent regressions.

## Problem Statement

When a user clicked "Visual Editor" on the New Workflow page, the visual canvas immediately showed a red error: **"Failed to parse workflow — Workflow YAML is missing required field: spec."** The workflow could not be created through the visual editor at all.

### Pain Points

- The New Workflow visual editor was completely broken — users saw an error instead of a canvas
- The code editor path would also fail on save because `parseWorkflowYaml()` requires the same envelope structure
- The task config field was named `config:` instead of the expected `task_config:`, which would cause a second validation failure on save
- The workflow module in `@stigmer/react` had zero unit tests, so this structural mismatch was never caught

## Solution

Corrected the `STARTER_WORKFLOW_YAML` constant to use the full Workflow resource envelope format (`apiVersion`/`kind`/`metadata`/`spec`) that both parsers (`yamlToGraph()` for visual mode and `parseWorkflowYaml()` for save) require. Added unit tests covering parse, save-path parse, and round-trip correctness.

## Implementation Details

### Root Cause

The `STARTER_WORKFLOW_YAML` constant used a flat shorthand format (`name`, `description`, `tasks` at the top level) while the two consuming parsers expected the canonical Kubernetes-inspired envelope:

- `yamlToGraph()` in `workflow-graph-conversions.ts` calls `requireObj(parsed.spec, "spec")` — throws when `spec` is absent
- `parseWorkflowYaml()` in `serialize-workflow-yaml.ts` calls `validateWorkflowStructure()` checking for `doc.metadata` and `doc.spec`

### Changes

**`sdk/react/src/workflow/starter-workflow-yaml.ts`** — Replaced the flat YAML with the full envelope:
- Added `apiVersion: agentic.stigmer.ai/v1` and `kind: Workflow`
- Added `metadata.name` (required by the save-path parser)
- Added `spec.document` with `dsl`, `namespace`, `name`, `version` (required by both parsers)
- Changed `config:` to `task_config:` (matching the field name both parsers expect)
- Wrapped `description` and `tasks` under `spec`

The new shape matches the canonical output of `graphToYaml()`, ensuring full round-trip compatibility.

**`sdk/react/src/workflow/__tests__/starter-workflow-yaml.test.ts`** (new) — Three unit tests:
1. `STARTER_WORKFLOW_YAML` parses via `yamlToGraph()` — guards against the exact regression
2. `STARTER_WORKFLOW_YAML` parses via `parseWorkflowYaml()` — guards the save path
3. Round-trip through `graphToYaml()` → `yamlToGraph()` preserves structural equivalence

### Client App Parity (DD-016)

Both client apps consume `STARTER_WORKFLOW_YAML` identically from `@stigmer/react`:
- `client-apps/web/src/domain/workflow/WorkflowNewPage.tsx`
- `client-apps/desktop/src/pages/workflow/WorkflowNewPage.tsx`

Since the fix is entirely in the SDK constant, no client-app changes were needed.

## Benefits

- Visual workflow editor now works correctly on the New Workflow page
- Code editor save path also works correctly
- Round-trip correctness validated by tests
- First unit test coverage for the workflow parsing module in `@stigmer/react`

## Impact

- **Direct users**: New Workflow creation via visual editor is unblocked
- **Platform builders**: `STARTER_WORKFLOW_YAML` export from `@stigmer/react` now provides a valid template
- **Both client apps** (web and desktop) are fixed by this single SDK change

## Related Work

- Follows the Workflow Creation UX Picker (2026-05-16-192529)
- Part of the "Bring Workflows to Foreground" project

---

**Status**: ✅ Production Ready
