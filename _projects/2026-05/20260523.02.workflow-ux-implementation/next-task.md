# Next Task: 20260523.02.workflow-ux-implementation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260523.02.workflow-ux-implementation

**Description**: Implement state-of-the-art workflow UX based on deep research findings: graph-native execution visualization, semantic node shapes, ELK layout engine, contextual task insertion, inspector panel refactor, and comprehensive E2E test coverage.
**Goal**: Rewrite the workflow UX layer to achieve parity with or exceed AWS Step Functions, n8n, and Retool Workflows — covering execution visualization, visual editor, overview page, and monitoring — with integrated E2E tests for every feature.
**Tech Stack**: React, TypeScript, @xyflow/react v12, elkjs, Next.js, Tailwind CSS, Playwright (E2E tests)
**Components**: sdk/react/src/workflow/ (all workflow components), client-apps/web workflow pages, client-apps/desktop workflow pages, test/e2e/tests/ (E2E test suite)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260523.02.workflow-ux-implementation/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-05-23 14:12
**Last Session**: 2026-05-24 — Workflow Instance Management UX (full-stack: Go backend, SDK hooks, React components, E2E tests)
**Current Task**: Instance management UX complete. Next: T14 (AI-Assisted Workflow Creation) or deferred follow-ups
**Status**: In Progress — T01-T13 + backend enrichment + data accuracy hardening + instance management UX all done, T14+ remaining

## Session Progress (2026-05-23)

### T02: NodeShell Component — COMPLETED
- Replaced `CanvasTaskNode.tsx` (374 lines) with decomposed `WorkflowNode` architecture
- Created `node-shell/` sub-module: `NodeShell`, `NodeContent`, `NodeHandles`, `NodeActions`, `shape-paths`
- `NodeShell` dispatches hybrid rendering: CSS for rectangular shapes, SVG `<path>` for diamond/octagon/circle/bar
- `NodeContent` adapts layout per visual class (compact centered for SVG shapes, flex-column for cards)
- `NodeHandles` generalizes port rendering from the visual registry's `PortPattern`
- `NodeActions` extracts design-mode interaction affordances (toolbar, picker, hover buttons)
- Fixed `toReactFlowElements()` dimension gap: now uses `visualSpec.defaultWidth/Height` instead of hardcoded constants
- 30 new unit tests (shape path validity, content insets, SVG class set)
- 6 new E2E tests (SVG presence for non-rectangular, absence for cards, selection ring, dimensions)
- All 183 workflow unit tests pass, zero regressions
- Committed as `e9f2a1ef3`

### T03: ELK Layout Pipeline — COMPLETED (parallel session)
- Created full layout module at `sdk/react/src/workflow/layout/` (8 source files + 4 test files)
- `LayoutEngine` interface: pure TypeScript, no React dependency (AD-T03-004)
- `dagre-layout-engine.ts`: extracted existing dagre code into `LayoutEngine` adapter
- `port-assignment.ts`: deterministic port IDs for switch_case, human_input, fork
- `workflow-preprocessor.ts`: `WorkflowGraphModel` → ELK JSON with port-aware edges
- `layout-postprocessor.ts`: scope filtering (whole-graph, selected, downstream) via BFS
- `elk-layout-engine.ts`: dynamic `import()` of elkjs with optional Web Worker factory
- `use-workflow-layout.ts`: React behavior hook with generation counter, error fallback
- Refactored `useWorkflowCanvas.ts`: auto-layout now dispatches `MoveNodesCommand` (undoable)
- Removed 3 `rAF→dagre→history.reset()` calls that cleared undo stack
- Added elkjs as optional peer dependency (EPL-2.0, per AD-T03-001)
- 30 new unit tests + 4 E2E test specs
- All 183 workflow tests pass (30 new + 153 existing), zero regressions

### T01: Task Type Visual Registry — COMPLETED
- Created `kind-metadata.ts` — canonical `categorizeKind()` and `kindToDisplayName()`, aligned with proto sidecar values
- Created `task-type-visual-registry.ts` — 8 visual classes, port patterns, dimensions, ARIA shape labels for all 20 task kinds + sentinels
- Consolidated 3 duplicated `categorizeKind()` implementations into one module
- Fixed category drift: `validate` → `data` (was governance), `wait` → `control_flow` (was event)
- Wired `visualClass`, `displayName`, `ariaShapeLabel` into `CanvasTaskNodeData`
- Added `data-visual-class` and `data-task-kind` attributes to `CanvasTaskNode`
- Replaced `formatKindLabel()` (underscore-to-space) with proper registry display names
- Added 26 unit tests (kind-metadata + visual registry), multi-kind E2E fixture, canvas navigation helper, 9 E2E tests
- All 153 workflow unit tests pass, zero regressions
- Committed as `60ef67bd9`

### Key Design Decisions
- DD-1: Client-side visual registry (not proto extension) — avoids cross-cutting backend changes
- DD-2: 8 visual classes (not 10) — Hick's Law: category color already differentiates AI/service/data cards
- DD-3: Consolidate categorizeKind, don't add a third system
- DD-4: Category values align with proto sidecar, not client drift
- DD-5: Port patterns are type-level descriptions, not handle renderers

### Discoveries
- `eval` (kind #20) is missing from the embedded `task-kind-registry.json` — codegen `kindOrder()` stops at 19. Separate fix needed.
- `--stgm-chart-amber` token doesn't exist in `tokens.css` but is referenced by `BranchConditionBuilder.tsx`
- Canvas is completely untested surface area — T01 added the first data attributes and E2E infrastructure

### T04: Read-Only Execution Canvas — COMPLETED
- Introduced `WorkflowGraphModeContext` providing `"design" | "overview" | "execution"` mode
- Extracted `applyDagreLayout` from private function into shared `layout/apply-dagre-layout.ts` with visual-registry-aware per-node dimensions
- Extended `CanvasTaskNodeData` with `executionState?: NodeExecutionState` (7 statuses + "not_reached")
- Extended `NodeShell` with `executionStatus` prop: status-driven border/opacity/stroke for both CSS and SVG shells
- Created `ExecutionBadge` — WCAG-compliant status badge (text/icon, never color-only)
- Modified `WorkflowNode` for mode awareness: hides `NodeActions` in execution mode, shows `ExecutionBadge`
- Built `useWorkflowExecutionGraph` hook: full pipeline from execution → workflow fetch → serialize → yamlToGraph → layout → merge DerivedTaskState
- Created `WorkflowExecutionGraph` — read-only React Flow canvas with auto-fit, follow-execution, minimap, zoom controls
- Restructured `WorkflowExecutionViewer`: graph primary, inspector stub right, collapsible timeline bottom
- Modified `CanvasTransitionEdge` for mode awareness: hides insert button in non-design modes
- 7 new files, 8 modified files
- Unit tests for layout utility and state merging
- 6 E2E tests for execution graph rendering

### T05: Runtime Inspector Panel — COMPLETED
- Replaced `ExecutionInspectorStub` with tabbed `ExecutionInspector` (Summary, Input, Output, Error, Retries, Agent Call, Events)
- Created `execution-inspector/` module: `deriveTaskDetail`, `useExecutionTaskDetail`, 6 tab components
- Extracted `format-utils.ts` — canonical duration/cost/token/byte/timestamp formatters (deduplicated 5 files)
- Lifted event store to `WorkflowExecutionViewer` — eliminated duplicate gRPC subscriptions
- Fixed auto-select propagation: graph failed-task select → viewer `selectedTaskName` via `onAutoSelectTask`
- 44 + 21 unit tests; 6 E2E inspector tests; graceful I/O empty states (runner gap documented)
- Checkpoints: `t03-deferred-wiring.md`, `t05-runner-io-followup.md`, `2026-05-23-session-t05-inspector.md`
- Changelog: `_changelog/2026-05/2026-05-23-171719-feat-workflow-runtime-execution-inspector-t05.md`

### Runner Task Status Enrichment — COMPLETED (T05 backend prerequisite)
- Extended `TaskStatusAccumulator` with input/output/metadata/cost/token fields + `truncatePayload` (64KB cap)
- Wired `do-executor.ts` to capture pipeline input at task start and output+cost at completion
- Enriched `call-agent.ts` to inject `__stigmer_cost_micros` and token keys from `usage_summary`
- Fixed `call-eval.ts` to surface LLM tokens (previously stripped from output)
- Rewrote `workflow-event-activities.ts` task mapping: full proto with `task_type`, I/O Structs, cost/tokens
- Fixed `engine-core.ts`: real aggregated totals in `execution_completed`, `failedTaskName` in `execution_failed`
- Fixed Go server `update_status.go`: merge `total_cost_micros/total_input_tokens/total_output_tokens` in gRPC path
- 19 new unit tests, 1 new integration test, 0 regressions (540 engine + 190 activity tests pass)
- Checkpoint: `checkpoints/runner-task-io-followups.md` (8 deferred items)
- Changelog: `_changelog/2026-05/2026-05-23-180610-feat-workflow-runner-task-status-enrichment.md`

### T06: Branch and Parallel Execution Highlighting — COMPLETED
- Created `sdk/react/src/workflow/execution/` module with pure derivation functions
- `deriveEdgeExecutionStates()`: maps edges to `taken | not_taken | active | not_reached` from graph topology + task statuses
- `deriveForkProgress()`: reads fork config `branches[].do[]` and counts completed branches
- Extended `CanvasTransitionEdge` with per-state visual treatment (stroke color, opacity, dash, marching-ants animation)
- Extended `ExecutionBadge` with fork progress display (N/M with compete-mode indicator)
- Wired derivation into `useWorkflowExecutionGraph` hook alongside existing node merge pipeline
- Key discovery: switch-bypassed tasks are absent (not skipped) from status map; fork inner tasks aren't graph nodes
- DD-T06-003: Fallthrough handling — multiple completed switch targets all marked `taken` (graceful degradation)
- 21 new unit tests, 3 E2E specs, all 84 workflow tests pass, zero regressions
- Changelog: `_changelog/2026-05/2026-05-23-182929-feat-workflow-branch-parallel-execution-highlighting-t06.md`

### T03-wire-1: Wire getNodeDimensions from Visual Registry — COMPLETED
- Extracted `registryNodeDimensions` adapter in `layout/registry-dimensions.ts`
- Module-scope function (referentially stable per DD-010, no `useCallback` needed)
- Wired into `useWorkflowLayout()` via `useWorkflowCanvas.ts`
- Refactored `applyDagreLayout` to use same adapter (DRY: single source of truth)
- Exported from layout barrel and workflow barrel (SDK public surface)
- 18 new unit tests covering all visual classes and sentinel nodes
- All 48 layout tests pass, zero regressions
- Committed as `267870523`
- Changelog: `_changelog/2026-05/2026-05-23-190046-feat-wire-visual-registry-dimensions-into-layout-pipeline.md`

### T07: Execution Waterfall Timeline — COMPLETED
- Created `sdk/react/src/workflow/execution/derive-waterfall-entries.ts` — pure derivation: events → `WaterfallEntry[]` with timing, attempts, child spans, approval wait
- Created `sdk/react/src/workflow/execution/useWaterfallEntries.ts` — behavior hook with rAF-driven live bar growth, referentially stable returns (DD-010)
- Created `sdk/react/src/workflow/waterfall/` module — 5 styled components: `WaterfallTimeline`, `WaterfallRow`, `WaterfallBar`, `WaterfallScaleComponent`, `WaterfallTooltip`
- Replaced inline `TimelinePanel` in `WorkflowExecutionViewer` with tabbed `ExecutionBottomPanel` (Waterfall default + Events tabs)
- Bidirectional selection sync: clicking a bar selects the task in graph + inspector; external selection scrolls waterfall
- 38 new unit tests (derivation + scale), 5 new E2E specs (tabs, selection, collapse)
- All theme-compliant (DD-005), reduced-motion safe (DD-015), memo'd for streaming perf (DD-010)
- Backend follow-ups documented in `checkpoints/t07-waterfall-backend-followups.md`
- No client-app changes needed (DD-016 verified)

### T08: Contextual Task Picker — COMPLETED
- **Phase 1 — Picker Intelligence Layer**: Created `sdk/react/src/workflow/picker/` module with pure logic: `InsertionContext` types + `buildInsertionHeader`, `getSuggestedKinds` (static compatibility map from research report), `getDisabledKinds` + `getHiddenKinds` (structural DSL constraints), `recents.ts` (localStorage-backed recently-used store)
- **Phase 2 — Enhanced Picker UI**: `usePickerData` hook bridges intelligence layer and UI; `TaskPickerPopover` upgraded with contextual header, "Suggested" section, "Recent" section, disabled items with aria-disabled + reason tooltip; search filtering across all sections
- **Phase 3 — Branch-Specific Insertion**: `BranchAddPopover` (inline form for adding case/branch/handler); 3 new `GraphCommand` classes (`AddSwitchCaseCommand`, `AddParallelBranchCommand`, `AddCatchHandlerCommand`) with full undo; `NodeActions` renders branch-mode `+` button on switch_case/fork/try_catch nodes
- **Phase 4 — Append-After Rewiring**: `addSuccessorTask` detects existing edge to `__end__` and splices new node before it (insert-before-end semantics)
- **Phase 5 — Tests**: 38 new unit tests (suggestions, compatibility, recents, insertion-context, branch-commands); E2E spec `test/e2e/tests/interactive/workflow-task-insertion.spec.ts` (9 test cases covering edge +, suggested, recent, disabled, branch buttons, append-after, keyboard N, search)
- All unit tests pass; E2E blocked only by Auth0 login redirect in local env (not logic failure)
- Modified files: `graph-commands.ts`, `CanvasActionsContext.ts`, `useWorkflowCanvas.ts`, `WorkflowCanvasEditor.tsx`, `TaskPickerPopover.tsx`, `NodeActions.tsx`, `WorkflowNode.tsx`, `CanvasTransitionEdge.tsx`
- Fixed pre-existing E2E fixture schema drift: wait task `taskConfig.seconds` → `taskConfig.duration.seconds`

### T10: Inspector Panel Refactor — COMPLETED
- Created `sdk/react/src/workflow/inspector/` module (18 new files)
- Refactored `WorkflowInspectorPanel` from 568-line monolith to 115-line thin wrapper delegating to `InspectorShell`
- Implemented tabbed inspector with 5 design-mode tabs: Configure, Data, Runtime, Advanced, Docs
- Built `WorkflowSummaryPanel` for workflow-level empty state (identity, env vars, budget, validation, task stats)
- Built `AgentCallForm` (specialized agent_call editor: agent, harness, message, model, structured output)
- Built `HttpCallForm` (specialized http_call editor: method+URL, headers, conditional body, timeout)
- Added `InspectorHeader` with overflow actions menu (Rename, Duplicate, Disable, Delete, Wrap in TryCatch)
- Added `ToggleNodeDisabledCommand` and `WrapInTryCatchCommand` (fully reversible graph commands)
- Added `toggleNodeDisabled` and `wrapInTryCatch` to `useWorkflowCanvas`
- Created `ExecutionInspectorAdapter` for future execution-mode visual unification
- Created `taskToYaml` utility for single-task YAML serialization
- 38 unit tests across 4 test files; 6 E2E test cases; 16 new barrel exports
- Zero client-app changes (DD-016); zero lint errors; zero regressions
- Checkpoint: `checkpoints/2026-05-23-session-t10-inspector-refactor.md`
- Changelog: `_changelog/2026-05/2026-05-23-211146-feat-workflow-inspector-panel-refactor-t10.md`

### Agent Call Strategy Implementation — COMPLETED (separate session)
- Implemented 6-part agent call architecture strategy from plan `agent_call_strategy_0d3e60ec.plan.md`
- **Workflow YAMLs**: Added `harness: cursor` and `config.model: "claude-sonnet-4"` to all 9 agent_call tasks across 3 Tiny Tactics workflows
- **Proxy headers**: Added `workflowExecutionId` to `buildProxyHeaders` for correct workflow LLM billing via `X-Stigmer-Workflow-Execution-Id`
- **LLM via LangChain**: Rewrote `call-llm.ts` from raw `fetch()` to LangChain `ChatModel` with streaming + `withStructuredOutput()`
- **Proto change**: Added `google.protobuf.Struct structured_output_schema = 7` to `ExecutionConfig`
- **Native structured output**: Wired `responseFormat` through `call-agent.ts` → `execute-deep-agent/setup.ts` (Zod schema from JSON Schema → `createDeepAgent({ responseFormat })`) → `execute-deep-agent/index.ts` (extracts `structuredResponse` from graph state)
- **Cursor structured output**: 3-tier extraction in `execute-cursor/index.ts` (prompt injection → JSON parse → extraction LLM fallback) + `call-agent.ts` task builder pre-retry extraction
- **Go result transform**: Changed activity stubs to `RunnerActivityResult` (`map[string]interface{}`), added `buildCallbackResult()` with `structured`, `final_text`, `usage_summary` pass-through
- **Post-commit required**: `make protos && make codegen` to regenerate TS/Go/Java stubs from proto change

### T11: Context Menus and Keyboard Shortcuts — COMPLETED
- Created `shortcut-registry.ts` — canonical shortcut definition table (pure TS, platform-aware hints)
- Created `clipboard.ts` — internal clipboard serialize/paste with ID regen, edge remapping, position offset
- Created `ViewYamlDialog.tsx` — read-only YAML modal with copy-to-clipboard (native `<dialog>`)
- Enriched `CanvasContextMenu` — node menu: +Rename, +Copy, +Disable/Bypass, +Wrap in Try/Catch, +View YAML; pane menu: +Paste, +Zoom to Fit
- Added multi-selection context menu via `onSelectionContextMenu` — batch Delete/Duplicate/Disable/Copy N tasks
- Added Cmd+C (copy), Cmd+V (paste), Cmd+X (cut) keyboard shortcuts to `useCanvasKeyboardShortcuts`
- Added batch operations to `useWorkflowCanvas`: `copySelection`, `pasteAtCenter`, `cutSelection`, `duplicateSelection`, `disableSelection`, `deleteSelection`
- Threaded View YAML through inspector → `InspectorHeader` overflow menu
- 53 new unit tests (shortcut-registry: 27, clipboard: 15, context-menu-logic: 11) + 10 E2E test specs
- Zero regressions on 158 existing tests
- Checkpoint: `checkpoints/2026-05-23-session-t11-context-menus.md`
- Changelog: `_changelog/2026-05/2026-05-23-220756-feat-workflow-context-menus-keyboard-shortcuts-t11.md`

### Fix: Stale Serverless Workflow YAML on Update — COMPLETED (stigmer-cloud)
- Diagnosed why workflow execution events showed old task names (`run_analyst`) despite updated YAML having new names (`analyze_player_data`)
- Root cause: `WorkflowUpdateHandler` was missing `PopulateServerlessValidation` pipeline step — `spec.tasks` updated but `status.serverless_workflow_validation.yaml` stayed stale from original create
- Extracted `PopulateServerlessValidation` inner class from `WorkflowCreateHandler` into shared `PopulateServerlessValidationStep` (typed with `ContextBase<Workflow, Workflow>`)
- Added step to `WorkflowUpdateHandler` pipeline between `normalizeReferences` and `persist`
- Updated `WorkflowCreateHandler` to use the shared step (deduplicated ~60 lines)
- Committed as `51cbdcd5` on `feat/workflow-ux-overhaul` branch in stigmer-cloud
- Changelog: `_changelog/2026-05/2026-05-23-221106-fix-workflow-update-stale-serverless-yaml.md`

### T09: Branch Management UX — COMPLETED
- 12 new reversible graph commands: RemoveSwitchCase, ReorderSwitchCases, RemoveForkBranch, ReorderForkBranches, RenameForkBranch, SetForkCompete, UpdateCatchConfig, RemoveCatchBlock, UpdateForEachConfig, AddNestedTask, RemoveNestedTask, ReorderNestedTasks
- 3 new inspector tabs: BranchesTab (switch_case + fork), CatchTab (try_catch), IterationTab (for_each)
- Canvas BranchBadge: fork branch chips, try_catch catch indicator, for_each iteration badge
- Enhanced NodeHandles: default-case italic+⊘ styling, condensed "+N more" for >5 cases
- Enhanced ARIA: branch names, counts, join policies in node labels
- Wired existingNames duplicate detection into BranchAddPopover
- Shared NestedTaskList component + useNestedTaskEditor hook
- 62 new unit tests (all passing), E2E spec created
- Design decisions: DD-T09-001 through DD-T09-005 (flat graph preserved, proto-honest UI)
- Checkpoint: `checkpoints/2026-05-23-session-t09-branch-management.md`
- Changelog: `_changelog/2026-05/2026-05-23-223959-feat-workflow-branch-management-ux-t09.md`

### T12: Overview Page Redesign — COMPLETED
- Extended `GetExecutionSummary` proto with `workflow_id` filter + `total_count` + `success_rate` fields
- Implemented workflow_id filtering in Go (`get_execution_summary.go`) and Java (`WorkflowExecutionGetExecutionSummaryHandler.java`)
- Extended `useWorkflowDashboardSummary` hook with optional `workflowId` parameter
- Created `useWorkflowOverviewGraph` behavior hook — Workflow → YAML → graph model → dagre layout → React Flow elements
- Created `WorkflowOverviewGraph` — React Flow in `"overview"` mode with MiniMap, Controls, Background, node click → popover
- Created `WorkflowNodePopover` — positioned popover on node click with task summary + "Open in editor" action
- Created `WorkflowOverviewSummary` — 4 stat cards (Total Executions, Success Rate, Avg Duration, Total Cost)
- Redesigned `OverviewTab` in `WorkflowDetailView`: summary cards → interactive graph → quick actions → detail sections
- Added `onOpenInEditor` and `onViewLatestRun` callback props; controlled tabs in both client apps (DD-016)
- Deleted `WorkflowTopologyPreview.tsx` (no remaining consumers); kept `WorkflowTopologyGraph` (still used by editor code-mode)
- 30 unit tests (3 files), 5 E2E test cases; all passing
- Committed as `1b512e84c`
- Changelog: `_changelog/2026-05/2026-05-23-231806-feat-workflow-overview-page-redesign-t12.md`

### Runner Backend Enrichment Follow-ups — COMPLETED
- **P1: Agent call event emission** — `executeAgentCall()` on `CallAgentTaskBuilder` brackets each `ctx.callAgent()` with `agent_call_started`/`agent_call_completed` events; handles success, failure, and output-validation retries; 6 new tests
- **P2: Task retrying event emission** — Added `TaskRetryingEvent` descriptor + `task_retrying` → `TaskRetryingPayloadSchema` proto mapping + emission from retry loop in `try.ts`; 4 new tests
- **P3: task_id generation** — Added `taskId` field to `TaskStatusEntry` with attempt counting; format `{taskName}:{attempt}`; wired to `WorkflowTask.task_id`; 7 new tests
- **P4: LLM cost attribution** — Added `computeLlmCostMicros()` to existing `model-pricing.ts` using cloud pricing registry; wired into `call-llm.ts` to inject `__stigmer_cost_micros`; 7 new tests
- **Deferred items** (documented in plan): pending_approvals race condition (proto change), resolved config capture (design decision), agent call live status (Temporal complexity), budget enforcement (UX design), artifact reference model (infrastructure), queue delay/streaming phases/push delivery (future)
- Committed as `d024b3b0e`
- Changelog: `_changelog/2026-05/2026-05-23-235048-feat-runner-backend-enrichment-followups.md`

### T13: Execution History and Operations Dashboard — COMPLETED (2026-05-24)
- Built full execution history module: 9 new SDK files, proto filter/sort contract, Go + Java backend filtering
- **Proto**: `ExecutionFilterCriteria` (9 filter fields), `ExecutionSortField` enum, filter/sort on both list requests
- **Go backend**: `execution_filter.go` with `applyFilterCriteria()` + `applySortField()`, 11 unit tests
- **Java backend**: `ExecutionFilterHelper.java` mirroring Go logic, wired into both list handlers
- **SDK derivation**: `deriveExecutionRow()` computes duration, failed task, retry count, tokens from raw proto
- **SDK components**: `ExecutionHistoryTable` (8 columns, sortable), `ExecutionFilterBar` (phase chips + presets), `HealthMetricsStrip` (6 metrics), `FailureAnalysisPanel` (grouped failures)
- **Composed view**: `WorkflowExecutionHistory` assembles all pieces, replaced old 3-column `ExecutionsTab`
- Extended `useWorkflowExecutionList` with `filter`, `sortField`, `sortAscending` options
- 36 TypeScript unit tests, 11 Go unit tests, 6 Playwright E2E tests
- Deferred: run comparison (separate task), p50/p95 percentiles, trigger type/version columns
- Checkpoint: `checkpoints/2026-05-24-session-t13-execution-history.md`
- Changelog: `_changelog/2026-05/2026-05-24-105730-feat-workflow-execution-history-dashboard-t13.md`

### Runner Data Accuracy Hardening — COMPLETED (2026-05-24)
- Fixed 8 data accuracy bugs in the execution data pipeline that corrupted inspector/waterfall/overview UX
- **Attempt number propagation**: Exposed `getAttempt()` on accumulator; replaced hardcoded `attemptNumber: 1` with tracked values
- **willRetry signaling**: Added `RetryContextInfo` + `retryContext` on `TaskExecutionContext`; try.ts sets it for retry-capable blocks
- **Failed task durationMs**: Added `durationMs` param to `taskFailed()` — waterfall bars now have proper width for failures
- **Cursor kind mapping**: Added `call:function:cursor` to `TASK_KIND_MAP` → `agent_call`
- **Agent token attribution**: Added `token_attribution: "total_only"` metadata so frontend avoids misleading split display
- **LLM structured output tokens**: Used `{ includeRaw: true }` on `withStructuredOutput()` to capture `usage_metadata`
- **Cost fallback**: `computeLlmCostMicros` now falls back to `DEFAULT_PRICING` instead of returning $0 for unknown models
- 23 new unit tests, enhanced Go integration tests with cost/token assertions
- 14 files changed, 630 insertions, 0 regressions (1810 total tests, 1783 passing)
- Checkpoint: `checkpoints/2026-05-24-session-runner-data-accuracy.md`
- Changelog: `_changelog/2026-05/2026-05-24-101938-fix-runner-execution-data-accuracy-hardening.md`

### ELK Layout Engine Wiring — COMPLETED
- Threaded `layoutEngine` optional prop through `useWorkflowCanvas` → `WorkflowCanvasEditor` → `WorkflowEditorView`
- Created `useElkLayoutEngine` behavior hook in `sdk/react/src/workflow/layout/useElkLayoutEngine.ts` — async engine creation, Web Worker cleanup, graceful fallback when elkjs unavailable
- Added `elkjs` dependency to both `client-apps/web` and `client-apps/desktop`
- Wired `useElkLayoutEngine({ workerFactory })` with Web Worker offloading in all 4 workflow pages (web: Detail+New, desktop: Detail+New) per DD-016
- Initial YAML parse still uses sync dagre for instant rendering; ELK activates on "Auto Layout" button
- 7 new unit tests (creation, cleanup, race condition, disabled, missing elkjs); all 55 layout tests pass
- Exported `useElkLayoutEngine`, `UseElkLayoutEngineOptions`, `UseWorkflowCanvasOptions` from SDK public surface

## Next Steps

1. ~~**T06: Branch and Parallel Execution Highlighting** — Taken/untaken branch dimming, fork N/M progress~~ DONE
2. ~~Wire `getNodeDimensions` from T01 registry (see `checkpoints/t03-deferred-wiring.md`)~~ DONE
3. ~~**T07: Execution Waterfall Timeline** — Bottom panel redesign with waterfall bars~~ DONE
4. ~~**T08: Contextual Task Picker** — Intelligence layer, branch-specific insertion, append-rewiring~~ DONE
5. ~~**Run `make protos && make codegen`** — Regenerate TS/Go/Java stubs from `structured_output_schema` proto change~~ DONE
6. ~~**Backend follow-up: Waterfall enrichment** — Agent call events, task retrying, data accuracy hardening~~ DONE (queue delay, streaming phases, push delivery deferred)
7. ~~**Backend follow-up: Runner I/O population** — task_id, LLM cost, attempt tracking, willRetry, failed durationMs, structured output tokens~~ DONE (pending_approvals fix, resolved config, agent live status, budget wiring, artifact refs deferred)
8. ~~Enable ELK in client-apps via `workerFactory` (see `checkpoints/t03-deferred-wiring.md`)~~ DONE
9. ~~**T10: Inspector Panel Refactor** — Tabbed inspector, per-kind forms, empty state, node actions~~ DONE
10. ~~**T09: Branch Management UX** — Branch handles, reorder, join policy, catch handler listing~~ DONE
11. ~~**T11: Context Menu and Keyboard Shortcuts** — Right-click menus, Delete/Duplicate/N key shortcuts~~ DONE
12. ~~**T12: Overview Page Redesign** — React Flow overview graph, summary stats, node popover, quick actions~~ DONE
13. ~~**T13: Execution History and Operations Dashboard** — Execution table with filters, health metrics, failure analysis~~ DONE (run comparison deferred)

## Context for Resume

- T08 picker: `sdk/react/src/workflow/picker/` is the new intelligence layer — pure TypeScript (no React deps) for suggestions, compatibility, recents
- T08 suggestions map: `SUGGESTIONS_AFTER_KIND` encodes domain knowledge from competitive research (n8n, Retool, Step Functions patterns)
- T08 `usePickerData` hook: bridges intelligence layer → UI; produces stable memoized `PickerData` driving sections/items/disabled state
- T08 branch commands: `AddSwitchCaseCommand`, `AddParallelBranchCommand`, `AddCatchHandlerCommand` — all reversible (undo support)
- T08 `BranchAddPopover`: inline form for mode-driven fields (case name + condition, branch name, handler name + error type)
- T08 append-after: `addSuccessorTask` now detects edge-to-`__end__` and splices (compound command: delete old edge, add node, create two new edges)
- T08 E2E: tests depend on `testMultiKindWorkflow` fixture which now uses `taskConfig.duration.seconds` format
- T08 E2E limitation: interactive tests require Auth0 session; local runs hit login redirect (fixture creation succeeds, page navigation fails without auth tokens)
- T07 waterfall: `deriveWaterfallEntries` is the canonical derivation for the waterfall timeline — walks events once, produces `WaterfallEntry[]` with `startMs`/`endMs` relative to execution start
- T07 architecture: data model supports agent sub-spans (`WaterfallSpan.children`) and retry segments (`WaterfallAttempt[]`) — these will populate automatically when the runner emits the corresponding events
- T07 bottom panel: `ExecutionBottomPanel` in `WorkflowExecutionViewer` renders Waterfall (default) + Events tabs; default open (not collapsed)
- T07 backend follow-ups: 5 items in `checkpoints/t07-waterfall-backend-followups.md` — agent call events (#1), task retrying (#2), queue delay (#3), streaming phases (#4), push delivery (#5)
- `registryNodeDimensions` is the canonical adapter for node dimensions — used by both `applyDagreLayout` (sync) and `useWorkflowLayout` (async) paths
- T03 deferred wiring: both tasks resolved — Task 1 (registry dimensions) and Task 2 (ELK activation) are complete
- ELK wiring: `useElkLayoutEngine` hook in `sdk/react/src/workflow/layout/useElkLayoutEngine.ts` — async creation with Web Worker, cleanup on unmount, returns `null` while loading (safe to pass as `layoutEngine` prop)
- ELK prop chain: `WorkflowEditorView.layoutEngine` → `WorkflowCanvasEditor.layoutEngine` → `useWorkflowCanvas(yaml, ref, { layoutEngine })` → `useWorkflowLayout({ engine })`
- ELK initial render: sync `applyDagreLayout` on YAML parse for instant rendering; ELK only activates on "Auto Layout" button click
- ELK worker factory: `() => new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url))` — works in both Vite and Next.js/Turbopack
- ELK fallback: three layers — worker fails → bundled WASM, ELK fails → dagre fallback, both fail → null result + error state
- T05 inspector reads `WorkflowTask` snapshots for I/O — runner only populates 5 fields today; tabs show graceful empty states
- `ExecutionInspector` exported from `sdk/react/src/workflow/index.ts` with `deriveTaskDetail`, `useExecutionTaskDetail`
- `WorkflowExecutionViewer` owns execution fetch + event stream; passes `execution`, `taskStates`, `onAutoSelectTask` to graph
- Inspector sidebar: `w-80 lg:w-96` (was `w-64` stub)
- E2E: `workflow-execution-inspector.spec.ts` + helpers in `test/e2e/helpers/workflow-execution.ts`
- T04 introduced `WorkflowGraphModeContext` — defaults to `"design"` for backward compatibility
- `WorkflowNode` reads mode from context: design → NodeActions; execution → ExecutionBadge
- `NodeShellProps` now includes optional `executionStatus` — applies border/opacity per status
- `CanvasTaskNodeData.executionState` is optional — absent means design mode, present means execution
- `applyDagreLayout` is now exported from `layout/` barrel — used by both editor and execution graph
- `WorkflowExecutionGraph` is a standalone SDK component (`executionId` prop only)
- `WorkflowExecutionViewer` layout: graph (flex-1) | inspector (w-80 lg:w-96) on top; collapsible timeline below
- `CanvasTransitionEdge` hides insert button unless `mode === "design"`
- Data path: `execution.spec.workflowId` → `stigmer.workflow.get()` → `serializeWorkflowYaml` → `yamlToGraph` → `applyDagreLayout` → `toReactFlowElements`
- Version mismatch detection compares `status.tasks[]` task names vs graph nodes
- E2E tests in `interactive` tier: `workflow-execution-graph.spec.ts`
- All exports added to `sdk/react/src/workflow/index.ts`
- T11 shortcut registry: `shortcut-registry.ts` — `ShortcutDefinition` with `id`, `label`, `keys`, `hint`, `scope`, `requiresDesignMode`. `getShortcutHint(id)` for menu hint labels.
- T11 clipboard: `clipboard.ts` — `serializeSelection(model, selectedIds)` deep-clones nodes + internal edges. `pasteClipboard(entry, model)` returns `CompoundCommand` with new IDs and offset positions.
- T11 clipboard buffer: lives as `useRef<ClipboardEntry | null>` in `useWorkflowCanvas` — in-memory only, no browser clipboard API
- T11 multi-select context menu: `CanvasContextMenuTarget` now has `type: "selection"` variant with `count`. Wired via `onSelectionContextMenu` on React Flow.
- T11 batch operations: `duplicateSelection()`, `disableSelection()`, `deleteSelection()` in `useWorkflowCanvas` — all use `CompoundCommand` for single-undo
- T11 ViewYamlDialog: native `<dialog>` with `showModal()`, `taskToYaml()` from T10, copy-to-clipboard button. State managed as `viewYamlNodeId` in `WorkflowCanvasEditor`.
- T11 keyboard shortcuts: Cmd+C/V/X added to `useCanvasKeyboardShortcuts` (optional props, backward compatible). Focus-gated, text-input-safe.
- T11 design decisions: DD-T11-001 (shortcut registry SSOT), DD-T11-002 (internal clipboard only), DD-T11-003 (CompoundCommand for batch), DD-T11-004 (focus-gated, no shortcutMap prop)
- T12 overview graph: `WorkflowOverviewGraph` in `sdk/react/src/workflow/WorkflowOverviewGraph.tsx` — React Flow in `"overview"` mode, mirrors `WorkflowExecutionGraph` pattern
- T12 behavior hook: `useWorkflowOverviewGraph` — pipeline: `Workflow` → `serializeWorkflowYaml` → `yamlToGraph` → `applyDagreLayout` → `toReactFlowElements`
- T12 popover: `WorkflowNodePopover` — positioned at click coordinates, shows task name/kind/config + "Open in editor" action
- T12 summary: `WorkflowOverviewSummary` — 4 stat cards from `useWorkflowDashboardSummary({ workflowId })`, graceful empty state
- T12 proto: `GetExecutionSummaryRequest.workflow_id` (field 3) — scopes summary to single workflow; `ExecutionSummary.total_count` (7) + `success_rate` (8)
- T12 cleanup: `WorkflowTopologyPreview` deleted; `WorkflowTopologyGraph` kept (still used by `WorkflowEditorView` code-mode preview)
- T12 client wiring: both apps use controlled tabs (`activeTab`/`onTabChange`) + `onOpenInEditor` → `setActiveTab("editor")` + `onViewLatestRun` → navigate to execution
- Runner enrichment: agent call events emitted from `CallAgentTaskBuilder.executeAgentCall()` — private method wrapping `ctx.callAgent()` with event bracketing
- Runner enrichment: `TaskRetryingEvent` added to `WorkflowEventDescriptor` union; emitted from `executeRetryLoop()` in `try.ts` before the backoff sleep
- Runner enrichment: `TaskStatusEntry.taskId` format is `{taskName}:{attempt}` — attempt counter lives on `TaskStatusAccumulator.attemptCounts` Map
- Runner enrichment: `computeLlmCostMicros()` added to existing `shared/model-pricing.ts` — uses cloud-fetched pricing registry via `ensureLoaded()`; returns 0 if registry not loaded or model unknown
- Runner enrichment: `call-llm.ts` calls `ensurePricingLoaded()` (best-effort, catch ignored) then injects `__stigmer_cost_micros` into result; `extractCostFromOutput` picks it up automatically
- Runner enrichment: deferred items documented in plan file `runner_backend_enrichment_84048628.plan.md`

## Quick Commands

After loading context:
- "Start T06" - Begin branch and parallel execution highlighting
- "Start T07" - Begin waterfall timeline
- "Start T08" - Begin contextual task picker fix
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
