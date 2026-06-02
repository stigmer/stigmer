# Session Notes: 2026-05-24 — T15 Workflow Template Gallery

## Accomplishments

- Implemented complete T15 task: workflow template gallery with 8 curated templates
- Followed established resource-creation template pattern (agents + MCP servers already use this)
- Built pure metadata derivation from YAML with pattern detection
- Created enhanced gallery components with workflow-specific UI (pattern badges, graph preview)
- Integrated into both web and desktop WorkflowNewPage (DD-016 parity)
- All 54 unit tests pass, zero regressions on existing tests
- All 3 packages typecheck clean (SDK, web, desktop)

## Decisions Made

- **DD-T15-001**: Client-side template registry (not server API) — follows agent/MCP pattern, works offline, future-extensible via `templates` prop
- **DD-T15-002**: Template data in `resource-creation/templates/`, gallery components in `workflow/templates/` — consistent placement with domain-specific enhancements
- **DD-T15-003**: Templates carry full YAML (not form fields) — no workflow wizard exists, editor IS the customization step
- **DD-T15-004**: Workflow-specific gallery with enhanced cards + preview dialog — pattern badges, task count, graph preview
- **DD-T15-005**: 8 curated templates covering all structural patterns — no redundancy, each teaches a different capability

## Key Code Changes

- `resource-creation/templates/workflow-templates.ts`: WORKFLOW_TEMPLATES array (8 entries with full YAML)
- `workflow/templates/types.ts`: WorkflowTemplateData, WorkflowTemplateMeta, WorkflowPattern types
- `workflow/templates/derive-template-metadata.ts`: Pure YAML → metadata derivation with nested kind collection
- `workflow/templates/WorkflowTemplateCard.tsx`: Enhanced card with pattern badges and metadata chips
- `workflow/templates/WorkflowTemplatePreview.tsx`: Native dialog with simplified graph preview
- `workflow/templates/WorkflowTemplateGallery.tsx`: Composes useTemplateFilter with custom cards
- Both WorkflowNewPage files: "Start from template" as 3rd option, initialYaml state for template selection

## Learnings

- YAML string literals with `${ }` expressions need `\${ }` escaping in TypeScript template literals
- JSON inside YAML description fields can cause parse errors (curly braces) — use single-quoted YAML strings
- The `for_each` and `try_catch` task kinds both use `config.do` for nested tasks — the `collectNestedKinds` function handles both correctly via a shared handler
- The bazel-symlink directory causes test files to be discovered twice by vitest — both copies run and pass

## Open Questions

- None — T15 is complete, all 16 tasks in the project plan are done

## Next Session Plan

All 16 tasks complete. Optional polish items remain:
1. Fix 4 pre-existing inspector test failures (tab auto-selection)
2. Verify caption rendering visually in the running desktop app
3. Full E2E suite run with Auth0 session
