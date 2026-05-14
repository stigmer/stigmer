# Next Task: 20260508.01.bring-workflows-to-foreground

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Bring Workflows to the Foreground

**Description**: Complete the missing AI orchestration layer on top of the existing Temporal + CNCF Serverless Workflow foundation, then surface workflows as a first-class product in Stigmer's UI, CLI, and APIs.

**Goal**: Make workflows a first-class, visible, user-facing product surface — from invisible backend plumbing to durable, observable, deployable agent applications with structured AI outputs, typed task schemas, execution traces, human approval gates, budget controls, and a hybrid editor experience.

**Research Report**: `_projects/2026-05/research.workflow-domain-foreground-strategy/04.report.gpt.md`

**Tech Stack**: Protobuf, Go (workflow-runner/Temporal), Java (stigmer-service), TypeScript/React (Web UI), Python (agent-runner/LangGraph), Temporal, CNCF Serverless Workflow

**Components**: Proto APIs (workflow/workflowexecution/workflowinstance/tasks), workflow-runner, stigmer-service, Web UI, CLI, agent-runner, model registry, artifact store

## Current Status

**Created**: 2026-05-08
**Last Session**: 2026-05-14 — T16 Batch 1 COMPLETE (prompt-to-workflow generation infrastructure)
**Current Task**: T16 Batch 1 COMPLETE
**Phase**: Phase 3 — AI-Assisted Creation — Batch 1 complete
**Next Task**: T16 Batch 2 (Generation Dialog — SDK components + console integration)

## Session Progress (2026-05-14, T16 Batch 1)

### T16 Batch 1: Prompt-to-Workflow Generation Infrastructure — COMPLETE

Built the full backend generation pipeline end-to-end: proto contract, Go + Java
handlers, prompt construction, LLM client, YAML validation-in-the-loop, and SDK
client method. After this batch, `generateWorkflowFromPrompt` RPC is callable
from the SDK — no UI yet.

#### Proto Contract
- Added `GenerateWorkflowFromPromptInput` (prompt, org, model, task_kind_hints) and
  `GenerateWorkflowFromPromptOutput` (yaml, explanation, warnings, model_used) to `io.proto`
- Added `generateWorkflowFromPrompt` RPC to `command.proto` with
  `can_create_workflow` permission on org
- Codegen across Go, Java, TS, Python stubs (both repos)

#### Go Backend (OSS — stigmer-server)
- **`pkg/llmclient/client.go`** — Standalone HTTP LLM client (OpenAI + Anthropic),
  environment-based API key resolution, non-streaming JSON parsing
- **`pkg/llmclient/prompt.go`** — Prompt template builder: workflow structure rules,
  task kind reference from embedded registry, org resource context (agents, MCP servers,
  skills, workflows queried from store), 2 canonical example workflows, generation rules
- **`pkg/domain/workflow/controller/generate_workflow.go`** — Handler: model resolution,
  org context query, prompt construction, LLM call, YAML/explanation splitting,
  structural YAML validation (parse + task kind checks), retry with error feedback
  (max 2 retries), response assembly
- **`workflow_controller.go`** — Extended with `llmClient` + `taskKindRegistry` deps + setters
- **`task_kind_registry.go`** — Added `ReadEmbeddedRegistry()` for reuse
- **`server.go`** — Wired LLM client + registry into controller at startup

#### Java Backend (Cloud — stigmer-service)
- **`WorkflowPromptBuilder.java`** — Mirrors Go prompt.go; classpath task-kind-registry,
  MongoDB org queries (AgentRepo, McpServerRepo, SkillRepo, WorkflowRepo findByOrg),
  identical prompt structure
- **`WorkflowYamlValidator.java`** — SnakeYAML structural validation + task kind checks;
  splitYamlAndExplanation, extractYaml, formatValidationErrorsForRetry utilities
- **`WorkflowGenerateFromPromptHandler.java`** — CustomOperationHandlerV2 pipeline;
  validates input, resolves model via LlmProxyConfig, calls LlmCallService.chatCompletion(),
  validates + retries, returns result
- **`BUILD.bazel`** — Added `@maven//:org_yaml_snakeyaml` dependency

#### SDK TypeScript
- Added `generateFromPrompt()` method to `WorkflowClient` with `GenerateFromPromptInput`
  and `GenerateFromPromptResult` types, exported from barrel

#### Architectural Decisions
- AD-T16-001: Server-side generation (prompt templates on server, not in client)
- AD-T16-002: Server-side prompt templates (iterate without frontend changes)
- AD-T16-003: Generate YAML (not proto) — natural authoring format
- AD-T16-004: Separate LLM client for stigmer-server (not workflow-runner's pkg/llm/)
- AD-T16-005: Validation-in-the-loop (server validates, feeds errors back to LLM, max 2 retries)

#### Verification
- `buf lint` — clean
- `go build ./... && go vet ./...` — clean (stigmer-server)
- `bazelw build //backend/services/stigmer-service/...` — clean (85 targets)
- `tsc --noEmit` — clean (sdk/typescript)

## Session Progress (2026-05-14, Unified Platform Dashboard)

### Unified Platform Dashboard — COMPLETE

Transformed the workflow-only dashboard into a unified platform dashboard that
shows operational metrics from both agent and workflow execution domains.
Full vertical slice: proto API, Go+Java backends, React SDK module, console
integration with DD-016 parity.

#### Architectural Decisions
- **AD-DASH-001**: No platform-wide summary RPC — client-side composition preserves bounded contexts
- **AD-DASH-002**: Parallel `getExecutionSummary` on agent execution domain (mirrors workflow pattern)
- **AD-DASH-003**: Execution counts safe to add (agent and workflow executions are distinct resources)
- **AD-DASH-004**: SDK-first, headless-first for new dashboard module
- **AD-DASH-005**: Cost from billing source of truth (`getOrgUsageReport`), not agent+workflow sum — prevents double-counting when workflows delegate to agents

#### Phase 1: Proto + Backend
- Added `AgentExecutionSummary`, `GetAgentExecutionSummaryRequest`, `AgentFailureRank`, `AgentExecutionSummaryTimeWindow` to `agentexecution/v1/io.proto`
- Added `getExecutionSummary` RPC to `AgentExecutionQueryController`
- Codegen across Go, Java, TS, Python stubs
- **Go handler**: `get_execution_summary.go` — SQLite aggregation (active count, phase counts, avg duration, top failing agents)
- **Java handler**: `AgentExecutionGetExecutionSummaryHandler.java` — MongoDB aggregation (same metrics, IAM-scoped)

#### Phase 2: SDK Dashboard Module (`sdk/react/src/dashboard/`)
- `types.ts` — `DashboardSummary`, `DashboardFailedRun` interfaces
- `useAgentExecutionSummary.ts` — data hook calling agent `getExecutionSummary`
- `useDashboardSummary.ts` — composition hook merging agent + workflow + org usage
- `useDashboardFailedRuns.ts` — composition hook merging failed executions from both domains
- `DashboardKPICards.tsx` — unified KPI cards (Active, Completed, Failed, Total Cost) with breakdown tooltips
- `DashboardFailedRuns.tsx` — merged failed runs list with type badges
- `OperationalDashboard.tsx` — composed top-level widget (KPIs + approvals + failures)
- `index.ts` — barrel exports; `sdk/react/src/index.ts` updated
- Manual patch: `sdk/typescript/src/gen/agentexecution.ts` — added `getExecutionSummary` method (codegen gap workaround)

#### Phase 3: Console Integration (DD-016 parity)
- **Web**: `DashboardPage.tsx` — replaced `WorkflowDashboard` with `OperationalDashboard`, uses `useOrg()` for both slug+id
- **Desktop**: `DashboardPage.tsx` — identical changes with `useNavigate`
- Updated description: "Operational overview across your organization"
- Workflow-specific charts (`CostByWorkflowChart`, `ExecutionTrendChart`) retained below dashboard

#### Known Gaps
- `proto2schema` codegen does not auto-pick up new `getExecutionSummary` RPC — temporary manual patch on generated SDK client
- Usage page unification (showing workflow data alongside agent data) deferred — separate task

#### Verification
- Zero linter errors on all modified files
- DD-016 parity confirmed: web and desktop dashboard pages are structurally identical

## Session Progress (2026-05-14, Cost Data Pipeline)

### Cost Data Pipeline — COMPLETE

Wired real cost and token data from the Go workflow-runner through both backend
control planes (Go OSS + Java Cloud) into the SDK dashboard components. Dashboard
charts now show actual execution cost and token usage instead of empty/zero values.
Proto changes + codegen across 6 languages, 3 Go service changes, 2 Java handler
changes, 1 SDK component update.

#### Proto Changes
- `WorkflowExecutionStatus`: added `total_cost_micros` (10), `total_input_tokens` (11), `total_output_tokens` (12)
- `WorkflowTask`: added `cost_micros` (12), `input_tokens` (13), `output_tokens` (14)
- Codegen regenerated across Go, Java, TS, Python, Dart stubs in both repos

#### Go Workflow Runner
- `budget.Tracker`: split `TotalTokens` into `InputTokens` + `OutputTokens`, `TotalTokens()` method for combined total
- `extractCostFromOutput`: reads `__stigmer_input_tokens` / `__stigmer_output_tokens` separately
- `buildLlmOutput`: emits split token counts from OpenAI/Anthropic responses
- `temporal_workflow.go`: updated `TotalTokens` field access to method call

#### Backend Persistence (Both Editions)
- Go OSS `update_status_impl.go`: merges `TotalCostMicros`, `TotalInputTokens`, `TotalOutputTokens`
- Java Cloud `WorkflowExecutionUpdateStatusHandler.java`: same three-field merge

#### Aggregation Handlers (Both Editions)
- Go OSS `get_execution_summary.go`: accumulates cost/tokens from executions, populates `WorkflowCostSummary` and `WorkflowCostBreakdown.TotalCostUsd`
- Java Cloud `GetExecutionSummaryHandler.java`: identical logic, sorts `costByWorkflow` by cost descending

#### SDK/UI
- `CostByWorkflowChart.tsx`: sorts by `totalCostUsd`, shows formatted dollar amounts, title "Cost by Workflow"
- `ExecutionSummaryWidget`: already shows `totalCost.totalCostUsd` — no change needed

#### Verification
- `tsc --noEmit` — clean: sdk/react, sdk/typescript, client-apps/web, client-apps/desktop
- `go build` + `go vet` — clean: stigmer-server, workflow-runner
- Zero linter errors on all modified files

## Session Progress (2026-05-14, Dashboard Separation)

### Workflow Dashboard Separation — COMPLETE

Separated operational metrics from the Workflow List Page into a dedicated
top-level Dashboard page. The Workflow List Page now matches the AgentListPage
pattern (blueprint management only). Dashboard page includes execution KPIs,
pending approvals, failed runs, and two new chart widgets. 5 new files, 8 modified.

#### New Dashboard Page (/dashboard)
- **Web**: `client-apps/web/src/app/dashboard/page.tsx` + `client-apps/web/src/domain/dashboard/DashboardPage.tsx`
- **Desktop**: `client-apps/desktop/src/pages/dashboard/DashboardPage.tsx` + route in `routes.tsx`
- Composes existing `WorkflowDashboard` (execution stats, pending approvals, failed runs)
  with two new chart components in a responsive grid layout

#### New SDK Chart Components (2)
- **`CostByWorkflowChart`** — Horizontal bar chart showing execution counts by workflow,
  pure CSS rendering with `--stgm-*` token theming, sorted by count
- **`ExecutionTrendChart`** — Phase distribution chart with stacked horizontal bar
  and legend from `ExecutionSummary.phaseCounts`
- Both use `--stgm-*` CSS custom properties, no hardcoded colors

#### Sidebar Updates (DD-016 parity)
- Added "Dashboard" nav item with `LayoutDashboard` icon in both web and desktop sidebars
- Positioned between "New Session" and "Library"

#### Workflow List Page Cleanup
- Removed `WorkflowDashboard` from both web and desktop `WorkflowListPage`
- Now matches `AgentListPage` pattern: header + `ResourceWorkbench` only
- Removed unused `useRouter`/`handleExecutionNav` from web version

#### SDK Package Changes
- Added `recharts` as optional peer dep (same pattern as `@xyflow/react`)
- Exported `CostByWorkflowChart`, `ExecutionTrendChart` + types from barrel files

#### Tech Debt Findings
- `useExportResource` already supports Workflow — JSDoc was stale, no code change needed
- `CheckBudgetWarnings()` does not exist in the codebase — planned but unimplemented
- Cost data pipeline requires changes in both OSS + Cloud backends — deferred to dedicated task

#### Verification
- `tsc --noEmit` — clean: sdk/react, client-apps/web, client-apps/desktop
- Zero linter errors on all new/modified files

## Session Progress (2026-05-14, Routing Fix)

### Workflow Execution → Session Navigation Fix — COMPLETE

Fixed broken "View execution" drill-down from WorkflowExecutionViewer to
the agent's parent session page. Created SDK resolution hook, wired into
both web and desktop consoles. 1 new file, 5 modified.

#### Root Cause
- `onNavigateToAgentExecution` received `aex_*` (agent execution ID) but session
  page requires `ses_*` (session ID). No code resolved the mapping.
- Web navigated to `/sessions?execution=aex_...` (query param never consumed)
- Desktop navigated to `/sessions/aex_...` (wrong ID type for `useSessionPageFlow`)

#### Fix
- **New SDK hook**: `useResolveAgentExecutionSession` — fetches AgentExecution,
  extracts `spec.sessionId` (follows `useFetch` + `useStigmer` patterns)
- **Web**: `navigateToSession(sessionId)` via `SessionNavigationProvider`
- **Desktop**: `navigate(/sessions/${sessionId})` with resolved session ID
- **Unified route** (`/executions/[id]`): resolves `aex_*` before navigating
- **Loading UX**: floating pill indicator during ~200ms resolution

#### Verification
- `tsc --noEmit` — clean: sdk/react, sdk/typescript, client-apps/web, client-apps/desktop
- `npm run lint` — 0 errors on all modified files (pre-existing warnings only)
- DD-016 parity confirmed: identical resolution pattern in both client apps

#### Commit
- `4ad46f029` — `fix(sdk/react,web,desktop): resolve agent execution to session before navigation`

## Session Progress (2026-05-13, T15 Batch 5)

### T15 Batch 5: Integration + Polish — COMPLETE

Final integration batch for the Visual Canvas Editor. Wired canvas into both
web and desktop consoles, exported full T15 public API surface, fixed five
pre-implementation research findings, added drag-handle reordering (deferred
from Batch 4), and completed accessibility pass. 0 new files, 12 modified.

#### Console Integration (DD-016)
- Added `@xyflow/react: ^12.10.2` to web and desktop `package.json`
- Added `import "@xyflow/react/dist/style.css"` at lazy-load boundary

#### Bug Fixes
- `onDirtyChange` callback prop on `WorkflowCanvasEditor` — canvasDirty wiring gap
- `nodeErrors` threaded through to `CanvasTaskNode` — red error badges on nodes
- Escalation task `<select>` wired to `onUpdateConfig("escalation_task", ...)`

#### Barrel Exports
- 58 lines added to `sdk/react/src/workflow/index.ts`
- 27 lines added to `sdk/react/src/index.ts`
- Types, hooks, components, functions, and constants all exported

#### Drag-Handle Reordering (Deferred from Batch 4)
- 6-dot grip handles on case rows (`BranchConditionBuilder`) and outcome rows (`ApprovalFormBuilder`)
- HTML5 DnD with drop-target highlighting, coexists with up/down arrow buttons

#### Accessibility
- Palette: `role="listbox"` parent for `role="option"` items
- Canvas: `aria-live="polite"` selection announcement region
- Node: `aria-label` with task name, kind, and error count

#### Cleanup
- Removed unused `DeleteEdgeCommand` and `graphToYaml` imports

#### Verification
- `tsc --noEmit` — clean: sdk/react, sdk/typescript, client-apps/web, client-apps/desktop
- Zero linter errors on all modified files
- DD-016 parity confirmed

## Session Progress (2026-05-13, T15 Batch 4)

### T15 Batch 4: Specialized Task Editors — COMPLETE

Built specialized visual editors for switch_case (BranchConditionBuilder) and
human_input (ApprovalFormBuilder), replacing the generic TaskConfigForm with
purpose-built UIs. Refactored handle IDs from index-based to name-based,
added edge-config sync methods, and fixed human_input outcome serialization gap.
2 new files, 6 modified.

#### New Files (2)
- `BranchConditionBuilder.tsx` — switch_case: ordered case list with name/when/then,
  up/down reorder, add/remove, default case indicator, edge-driven routing
- `ApprovalFormBuilder.tsx` — human_input: 6 collapsible sections (Prompt, Outcomes,
  Form Fields with JSON Schema builder, Timeout with policy, Approvers, Notification
  Channels)

#### Modified Files (6)
- `CanvasTaskNode.tsx` — Name-based handle IDs + handle label pills
- `workflow-graph-conversions.ts` — Name-based handles in yamlToGraph/graphToYaml,
  new reconstructHumanInputOutcomeThen (gap fix)
- `graph-commands.ts` — New MigrateBranchHandleCommand for handle rename
- `useWorkflowCanvas.ts` — 3 new methods: updateBranchRouting, migrateBranchHandle,
  removeBranchEdges
- `WorkflowInspectorPanel.tsx` — Task-kind dispatch + new branch routing props
- `WorkflowCanvasEditor.tsx` — Wires branch routing props to inspector

#### Architectural Decisions
- AD-T15-B4-001: Name-based handle IDs (case_{name}, outcome_{name})
- AD-T15-B4-002: Edges as routing source of truth (then derived at serialization)
- AD-T15-B4-003: Gap fix — reconstructHumanInputOutcomeThen mirrors switch_case

#### Verification
- `tsc --noEmit` — clean: sdk/react, sdk/typescript, client-apps/web, client-apps/desktop
- Zero linter errors on all new/modified files

## Session Progress (2026-05-13, T15 Batch 3)

### T15 Batch 3: Inspector + Edit Loop — COMPLETE

Completed the full visual editing loop: schema-driven inspector panel, YAML/Canvas
mode toggle with round-trip, canvas save, and validation error mapping. 2 new files,
4 modified.

#### New Files (2)
- `TaskConfigForm.tsx` — Schema-driven form from TaskKindDescriptor fields/fieldGroups. 8 field types: string, int32, float, bool, enum, struct, repeated, map. Collapsible groups, required indicators, expression highlighting.
- `WorkflowInspectorPanel.tsx` — Right sidebar: Identity (editable name w/ validation), Configuration (TaskConfigForm), Export, Flow (transition dropdown). Edge/sentinel inspectors. Controlled component pattern.

#### Modified Files (4)
- `graph-commands.ts` — 3 new commands: UpdateNodeFieldCommand (dot-path config edits), RenameNodeCommand (atomic name+edge+flow.then cascading), UpdateNodeMetaCommand (export/flow mutations)
- `useWorkflowCanvas.ts` — 6 new methods: updateNodeField, renameNode, updateNodeExport, updateNodeFlow, getNodeDescriptor, serializeToYaml
- `WorkflowEditorView.tsx` — Mode state (code/visual), segmented control, mode switch with warning/dirty dialogs, canvas save via YAML pipeline, validation error mapping
- `WorkflowCanvasEditor.tsx` — Inspector panel sidebar, onSave/isSaving/nodeErrors props, save button in toolbar, edge deletion via inspector

#### Architectural Decisions
- AD-T15-B3-001: Granular update commands (field-level undo/redo)
- AD-T15-B3-002: Save via YAML (both modes see identical persisted content)
- AD-T15-B3-003: Mode state lives in WorkflowEditorView (shared YAML sync medium)
- AD-T15-B3-004: Inspector as controlled sidebar (no graph state ownership)

#### Verification
- `tsc --noEmit` — clean: sdk/react, sdk/typescript, client-apps/web, client-apps/desktop
- Zero linter errors on all new/modified files

## Session Progress (2026-05-13, T15 Batch 2)

### T15 Batch 2: Node Authoring — COMPLETE

Turned the Batch 1 read-only canvas into a full authoring tool: task palette with
drag-to-create, connection drawing with validation, deletion with cascade,
multi-selection with lasso, and undo/redo for all operations. 3 new files,
4 modified (+1 minor). Batch 1 bugs fixed (human_input handles, isDirty reactivity).

#### New Files (3)
- `graph-commands.ts` — GraphCommand interface, 6 concrete commands (AddNode, DeleteNode, AddEdge, DeleteEdge, MoveNodes, Compound), GraphHistory class with 50-entry bounded stack
- `useGraphHistory.ts` — React wrapper with keyboard shortcuts (Ctrl/Cmd+Z, Shift+Z), focus-scoped
- `WorkflowTaskPalette.tsx` — Standalone SDK component: categorized task kinds, search, drag-to-create via HTML5 DnD

#### Modified Files (4+1)
- `useWorkflowCanvas.ts` — Major rewrite: graph history as source of truth, mutation methods, connection validation, drop handlers, model-based dirty tracking
- `WorkflowCanvasInner.tsx` — Wired onConnect, isValidConnection, onDrop, onDragOver, onNodesDelete, onEdgesDelete, selectionMode, deleteKeyCode
- `WorkflowCanvasEditor.tsx` — Palette sidebar, undo/redo toolbar, containerRef for shortcuts, empty state prompt
- `CanvasTaskNode.tsx` — human_input multi-port handles, typo fix
- `workflow-graph-conversions.ts` — Exported categorizeKind/stringToTaskKind/taskKindToString, added deletable:false for sentinels

#### Architectural Decisions
- AD-T15-B2-001: Immutable model + command pattern (commands, not snapshots)
- AD-T15-B2-002: Auto-generated task names ({kind}_{N})
- AD-T15-B2-003: Sentinel node lifecycle (__start__ always present)
- AD-T15-B2-004: Connection validation (no self-loops, no duplicates, single-output replacement)
- AD-T15-B2-005: Palette as standalone SDK component

#### Verification
- `tsc --noEmit` — clean: sdk/react, sdk/typescript, client-apps/web, client-apps/desktop
- Zero linter errors on all new/modified files

## Session Progress (2026-05-13, T15 Batch 1)

### T15 Batch 1: Canvas Foundation — COMPLETE

Delivered the core infrastructure for the visual canvas editor: graph data model,
full YAML round-trip conversion pipeline, React Flow integration with custom
styled nodes/edges, dagre auto-layout, and an orchestrator hook. 8 new files,
2 modified. Phase 2 officially underway.

#### New Files (8)
- `workflow-graph-model.ts` — Pure types: WorkflowGraphModel, WorkflowGraphNode, WorkflowGraphEdge, sentinel IDs
- `canvas-constants.ts` — Shared CATEGORY_COLORS, dagre config, node/sentinel dimensions, handle positions
- `workflow-graph-conversions.ts` — yamlToGraph, graphToYaml, graphToWorkflowInput, toReactFlowElements + topological sort
- `CanvasTaskNode.tsx` — Custom React Flow node: category border, name, kind badge, multi-port handles (switch_case)
- `CanvasTransitionEdge.tsx` — Custom React Flow edge: smoothstep path, label pill, selection state
- `useWorkflowCanvas.ts` — Orchestrator hook: graph state, dagre auto-layout, RF callbacks, selection, dirty tracking
- `WorkflowCanvasEditor.tsx` — Public component: React.lazy wrapper, toolbar, error/empty states
- `WorkflowCanvasInner.tsx` — Code-split inner React Flow canvas (DD-013 lazy loading)

#### Modified Files (2)
- `sdk/react/package.json` — @xyflow/react added as optional peer dep + dev dep
- `WorkflowTopologyGraph.tsx` — CATEGORY_COLORS + dagre config extracted to shared canvas-constants.ts

#### Architectural Decisions
- AD-T15-B1-001: Data types extend `Record<string, unknown>` for React Flow v12 generic constraints
- AD-T15-B1-002: `WorkflowBudgetInput` not exported from @stigmer/sdk public API — use `NonNullable<WorkflowInput["budget"]>` instead
- AD-T15-B1-003: Undo/redo deferred to Batch 2 (premature without mutation operations)
- AD-T15-B1-004: Separate `WorkflowCanvasInner.tsx` for React.lazy code-splitting boundary

#### Verification
- `tsc --noEmit` — zero errors
- No linter errors on any new/modified file
- Existing WorkflowTopologyGraph behavior preserved (pure extraction)

## Session Progress (2026-05-13, T14)

### T14: Dashboard Integration + Desktop Workflow Parity — COMPLETE

Four-phase delivery completing Phase 1. Brought all workflow UI to desktop (7 new
pages/layout/breadcrumb), designed new aggregation proto APIs (getExecutionSummary +
listPendingApprovals), implemented Go + Java backends, built SDK dashboard components
(2 hooks, 4 styled components), and integrated dashboard into both web and desktop.

#### Phase A: Desktop Workflow Parity
- Sidebar "Workflows" nav item, 4-route tree, 4 thin page shells
- `WorkflowLayout` + `WorkflowBreadcrumb` following `LibraryLayout` pattern
- DD-016 verified: identical SDK component prop wiring across web/desktop

#### Phase B: Proto APIs + Backend
- `SummaryTimeWindow` enum, `ExecutionSummary`, `WorkflowCostSummary`, `WorkflowFailureRank`, `WorkflowCostBreakdown`, `PendingApproval`, `PendingApprovalsList`
- Go: in-memory aggregation over SQLite store
- Java: IAM-scoped aggregation with `IamPolicyGrpcRepo` + `WorkflowExecutionRepo`

#### Phase C: SDK Dashboard Components
- `useWorkflowDashboardSummary` + `usePendingApprovals` data hooks
- `ExecutionSummaryWidget` (stat cards + phase bar), `PendingApprovalsWidget`, `FailedRunsWidget`, `WorkflowDashboard` (composed container)

#### Phase D: Integration
- `WorkflowDashboard` rendered at top of `/workflows` page in both web and desktop

#### Verification
- `tsc --noEmit` clean: sdk/react, sdk/typescript, client-apps/web, client-apps/desktop
- `go build` + `go vet` clean: stigmer-server
- `bazelw build` clean: stigmer-service (85 targets)

## Previous Session Progress (2026-05-13, Go Event/Budget Wiring)

### Go Event Emission + Budget Enforcement Wiring — COMPLETE

Wired the existing event emitter (T13) and budget tracker (T13) into the
task execution loop, completing the event-to-persistence pipeline. 2 new
files, 9 modified. The entire event pipeline (Go emitter -> gRPC events
field -> Java MongoDB/Redis persistence -> getEventLog/subscribeEvents)
is now connected end-to-end.

#### Event Emission
- TaskStarted/Completed/Failed/Skipped events emitted in `iterateTasks`
- ExecutionStarted/Completed/Failed lifecycle events in executor
- New `FlushEventsActivity` — Temporal activity for gRPC event delivery
- New `UpdateStatusWithEvents` gRPC method populates events field (T06 contract)
- New `ResolveTaskKind` mapping (CNCF model -> WorkflowTaskKind enum)

#### Budget Enforcement
- `WorkflowBudget` carried on `TemporalWorkflowInput` (survives YAML round-trip)
- Cost/tokens recorded after each task via `__stigmer_cost_micros` convention
- Budget checked at task boundaries with three policies:
  - `terminate` (default): non-retryable error stops workflow
  - `human_review`: signal-based approval gate (`budget_review_{id}`)
  - `warn`: log warning + budget_checkpoint event, continue
- `BudgetCheckpoint` events emitted with consumed vs. remaining capacity

#### Files (11 total: 2 new, 9 modified)
- `pkg/types/progress.go` — Added Budget, WorkflowID, WorkflowInstanceID fields
- `worker/activities/execute_workflow_activity.go` — Populates budget from proto spec
- `pkg/grpc_client/workflow_execution_client.go` — Added UpdateStatusWithEvents
- `pkg/zigflow/tasks/task_builder_do.go` — Core wiring: emitter + tracker + event buffer + flush + budget check
- `pkg/zigflow/tasks/task_kind_mapping.go` (new) — CNCF model -> WorkflowTaskKind
- `pkg/zigflow/tasks/flush_events_activity.go` (new) — Temporal activity for event delivery
- `pkg/zigflow/tasks/task_builder_call_llm_activities.go` — Added cost/token output
- `pkg/executor/temporal_workflow.go` — Creates emitter/tracker, emits lifecycle events
- 3 BUILD.bazel files updated with new deps

#### Verification
- `go build ./...` — clean
- `go vet ./...` — clean
- `go test ./pkg/...` — all pass, zero regressions

## Previous Session Progress (2026-05-13, T12)

### T12: CLI Parity — Unified Execution Commands + Developer Workflow Tools — COMPLETE

Added `stigmer execution` command group (7 subcommands) for unified lifecycle
management and observability of both agent and workflow executions, plus
`stigmer diff` for pre-apply change preview. 20 new files, 3 modified.

#### DD-T12-001: Execution type auto-detection from ID prefix
- Agent (`aex_`) and workflow (`wex_`) execution IDs auto-route to correct API
- Uses existing `reference.IsAgentExecutionID` / `IsWorkflowExecutionID`
- No `--type` flag needed for ID-based commands

#### DD-T12-002: `stigmer execution` as noun-group (hybrid CLI pattern)
- Verb-first CRUD preserved (`stigmer list/get/delete`)
- Noun-group for specialized lifecycle/observability operations
- Follows kubectl precedent: `kubectl get pods` + `kubectl logs`

#### T12.1: Execution Infrastructure
- `internal/cli/execution/resolve.go` — `ExecutionType` enum + `ResolveType(id)`
- Enhanced `get execution` to support both `aex_` and `wex_` IDs
- Enhanced `list executions` with `--type agent|workflow` filter
- Workflow execution display (table + list formatters)

#### T12.2: `stigmer execution` Command Group + Lifecycle
- `stigmer execution cancel <id> [--reason]`
- `stigmer execution terminate <id> [--reason]`
- `stigmer execution pause <id> [--reason]`
- `stigmer execution resume <id>`
- All auto-detect execution type and route to correct API

#### T12.3: `stigmer execution logs <id>`
- Workflow: `getEventLog` (paginated) + `subscribeEvents` (`--follow`)
- Agent: message rendering + `subscribe` stream (`--follow`)
- `--task` filter for workflow events
- Colored, timestamped event rendering

#### T12.4: `stigmer execution trace <id>`
- Workflow: task tree with status icons, timing, error details
- Agent: tool call timeline extracted from messages
- `--output yaml|json` for structured data

#### T12.5: `stigmer execution approve <id>`
- Workflow: `submitWorkflowTaskApproval` with `--task`, `--outcome`, `--data-file`
- Agent: `submitApproval` with `--tool-call`, `--action`
- Type-specific flag validation

#### T12.6: `stigmer validate -f` — Already existed
- Discovered during implementation — fully functional validate command was already in place

#### T12.7: `stigmer diff -f <file>`
- Generic resource diff (auto-detects kind from YAML)
- Fetches remote by org/slug, renders colored unified diff
- Supports directories and `--context` lines
- Uses existing `go-difflib` dependency

#### Verification
- `go build ./client-apps/cli/...` — clean
- `go vet ./client-apps/cli/...` — clean
- `stigmer execution --help` — 7 subcommands registered
- `stigmer diff --help` — functional
- Pre-existing test failure in `pkg/display` (unrelated)

## Previous Session Progress (2026-05-13, T11)

### T11: Run Workflow from UI — COMPLETE

Built the complete "Run Workflow" experience following SDK-first architecture
(DD-001): behavior hook, form component, dialog component, and console
integration. 3 new files, 4 modified. Closes the create-run-observe loop —
users can now edit workflows (T10), run them, and watch executions (T09).

#### T11.1: useRunWorkflowFlow — SDK Behavior Hook
- Orchestrator hook following `useNewSessionFlow` pattern
- Manages trigger message, runtime env overrides, instance selection
- Validates required env vars before submission
- Calls `WorkflowExecutionClient.create()` via `useStigmer()`
- Framework-agnostic: consumer provides `onSuccess`/`onError` callbacks

#### T11.2: WorkflowRunForm — SDK Styled Component
- Auto-generated form from `WorkflowSpec.env` declarations
- Trigger message textarea with template reference hint
- Env var inputs: labeled, required indicators, secret field masking, inline errors
- Instance selector (hidden when only 0-1 instances)
- All visuals via `--stgm-*` tokens, zero Console dependencies

#### T11.3: WorkflowRunDialog — SDK Styled Component
- Native `<dialog>` + `showModal()` (same pattern as `ConfirmDialog`)
- Composes `useRunWorkflowFlow` + `WorkflowRunForm`
- Header, scrollable body with error banner, Cancel/Run footer with spinner
- Resets form state on open, closes on success

#### T11.4: Console Integration
- "Run" as `primaryAction` on `WorkflowDetailView`
- `WorkflowRunDialog` wired into `WorkflowDetailPage`
- `onSuccess`: navigates to `/workflows/executions/[id]` + toast
- Fetches workflow + instances via existing SDK hooks

#### T11.5: Execution Row Navigation
- Added `onExecutionClick` callback prop to `WorkflowDetailViewProps`
- Execution rows in Executions tab now clickable with keyboard a11y
- Console wires `(id) => router.push(/workflows/executions/${id})`

#### T11.6: Barrel Exports
- All new hooks/components exported from `sdk/react/src/workflow/index.ts`
- Top-level exports added to `sdk/react/src/index.ts`

#### Verification
- `tsc --noEmit` — clean (sdk/react, sdk/typescript, client-apps/web)
- `eslint` — clean (zero linter errors on all new/modified files)

## Previous Session Progress (2026-05-13, T13b)

### T13b: Java/Cloud Backend Parity — COMPLETE

Implemented Java control plane support for the 6 new P0 task types. The polyglot
architecture means Go (workflow-runner) handles execution; Java (stigmer-service) handles
orchestration, persistence, and API serving. T13b completes the control plane so new
task types are fully observable, queryable, and interactable through the Java service.

#### Proto Changes (OSS repo)
- Added `SubmitWorkflowTaskApprovalInput` message to `io.proto`
- Added `submitWorkflowTaskApproval` RPC to `command.proto`
- Ran `make codegen` (OSS) + `make protos` (Cloud) — stubs in Go, Java, TS, Python, Dart
- `repeated WorkflowExecutionEvent events` field on `UpdateStatusInput` already existed (T06)

#### Java Implementation (Cloud repo — 5 new files)
- `WorkflowExecutionEventRepo.java` — MongoDB event log with separate collection, compound unique index, TTL, cursor pagination
- `WorkflowExecutionEventRedisWriter.java` — per-execution Redis event stream (`wfx_events:{id}`)
- `WorkflowExecutionGetEventLogHandler.java` — `getEventLog` RPC handler with cursor pagination
- `WorkflowExecutionSubscribeEventsHandler.java` — `subscribeEvents` server-streaming with replay + live tail
- `WorkflowExecutionSubmitWorkflowTaskApprovalHandler.java` — typed approval for human_input tasks

#### Modified Files
- `WorkflowExecutionUpdateStatusHandler.java` — added PersistEventsStep + PublishEventsToRedisStep
- `BUILD.bazel` — registered 2 new test targets

#### Tests (2 new, both pass)
- `WorkflowExecutionGetEventLogHandlerTest.java`
- `WorkflowExecutionSubmitWorkflowTaskApprovalHandlerTest.java`

#### Verification
- `bazelw build //backend/services/stigmer-service/...` — 85 targets, all pass
- `bazelw test` — 2/2 new tests pass
- `go build ./backend/services/workflow-runner/...` — clean

#### Key Design Decisions
- DD-T13b-001: Event repo uses separate MongoDB collection (not embedded in WorkflowExecution) to support unbounded event growth and efficient cursor pagination
- DD-T13b-002: Task approval validates task existence by name only (not kind) — the signal naming convention (`human_input_{task_name}`) is the real discriminator
- DD-T13b-003: Event ingestion is backward-compatible — empty events list in status updates is a no-op for older runners that don't emit events yet

#### Open Items for Future Sessions
- Go-side event emission wiring — `pkg/events/emitter.go` is built but not wired into the updateStatus call path
- Budget enforcement integration at task boundaries
- Event TTL configuration (hardcoded at 90 days, could be configurable)

## Previous Session Progress (2026-05-13, T10)

### T10: YAML Editor with Graph Preview — COMPLETE

Built the full workflow YAML editor with live topology graph preview following
SDK-first architecture (DD-001). 9 new files, 6 modified. First full-document
editor in the platform — CodeMirror 6 for editing, dagre for graph layout.

#### T10.1: Workflow YAML Serializer
- `serializeWorkflowYaml` (proto → YAML) + `parseWorkflowYaml` (YAML → WorkflowInput)
- Full enum mapping for 19 task kinds and budget policies
- Extended `useExportResource` with `kind: "Workflow"` support
- `useWorkflowYaml(org, slug)` data hook

#### T10.2: CodeMirror 6 Base Component
- `WorkflowYamlEditor` — CodeMirror 6 in React with `--stgm-*` theme bridge
- Optional peer deps (DD-013), Compartment-based readOnly, external diagnostics

#### T10.3: Validation Pipeline
- `useWorkflowValidation` — 150ms debounced, 5-layer pipeline
- Source-mapped diagnostics via YAML CST ranges
- Syntax → structural → task kinds → config presence → flow references

#### T10.4: Topology Graph
- `useWorkflowTopology` — YAML → `{ nodes, edges }` DAG with category classification
- `WorkflowTopologyGraph` — SVG + dagre layout, category-colored nodes, zoom/pan

#### T10.5: Composed Editor View
- `useWorkflowEditor` — orchestrator (validation + topology + save + dirty tracking)
- `WorkflowEditorView` — side-by-side (60/40), toolbar, full-page toggle

#### T10.6: Console Integration
- Editor tab on `WorkflowDetailPage` via `additionalTabs`
- Toast feedback on save success/error

#### Design Decisions
- DD-T10-001: CodeMirror 6 over Monaco (MIT, ~80KB, embeddable, no Workers)
- DD-T10-002: Dagre over React Flow (read-only needs ~40KB, not ~200KB)
- DD-T10-003: Editor as tab on WorkflowDetailView
- DD-T10-004: Client-side validation via TaskKindRegistry JSON schemas

#### Verification
- `tsc --noEmit` — clean (sdk/react, sdk/typescript, client-apps/web)
- `eslint` — clean (2 pre-existing warnings in T09 file)

## Previous Session Progress (2026-05-13, T13)

### T13: P0 Task Types — Backend Implementation (Go) — COMPLETE

Implemented runtime execution for 6 new P0 task types in the Go workflow-runner,
plus shared infrastructure (budget tracker, event emitter, LLM provider abstraction,
notification provider interface). 20 new files, 5 modified. All existing tests pass.

#### T13.1: Foundation — Converter Pipeline + Shared Infrastructure
- 6 new call function constants in `constants.go`
- `NewTaskBuilder` factory dispatches to 6 new builders
- 6 new converter methods in `task_converters.go` + dispatch entries in `proto_to_yaml.go`
- `pkg/budget/tracker.go` — budget accumulator (cost, tokens, duration)
- `pkg/events/emitter.go` — typed event builder with auto-incrementing sequences
- Added deps: `santhosh-tekuri/jsonschema/v6`, `sashabaranov/go-openai`, `liushuangls/go-anthropic/v2`

#### T13.2: transform Task
- `task_builder_transform.go` + `task_builder_transform_activities.go`
- JQ engine via `gojq`, Go `text/template` engine, JSONata returns UNIMPLEMENTED

#### T13.3: validate Task
- `task_builder_validate.go` + `task_builder_validate_activities.go`
- JSON Schema validation via `jsonschema/v6`, business rules via JQ boolean expressions
- on_fail policies: RAISE (fail), BRANCH (fallback_task via `__stigmer_branch_override`), WARN (continue)

#### T13.4: emit_event Task
- `task_builder_emit_event.go` + `task_builder_emit_event_activities.go`
- Constructs full CloudEvents envelope (id, specversion, type, source, time, data)
- Cross-workflow delivery deferred to Phase 2

#### T13.5: notification Task
- `task_builder_notification.go` + `task_builder_notification_activities.go`
- `pkg/notification/provider.go` — NotificationProvider interface
- `pkg/notification/webhook.go` — Webhook provider (POST to recipient URLs)
- Other channels (Slack, email) return descriptive UNIMPLEMENTED error

#### T13.6: llm_call Task
- `task_builder_call_llm.go` + `task_builder_call_llm_activities.go`
- `pkg/llm/provider.go` — LLMProvider interface
- `pkg/llm/openai.go` — OpenAI provider (ChatCompletion, structured output via json_object)
- `pkg/llm/anthropic.go` — Anthropic provider (Messages API)
- `pkg/llm/registry.go` — Prefix-based model resolution (gpt-*/o1*/o3* → OpenAI, claude-* → Anthropic)
- Structured output validation + on_invalid retry logic (re-prompt with errors)
- JIT API key resolution from runtime environment (OPENAI_API_KEY, ANTHROPIC_API_KEY)

#### T13.7: human_input Task
- `task_builder_human_input.go` — Temporal signal-based approval gate
- Signal channel: `human_input_{task_name}`, payload: outcome + form_data + reviewer
- Timeout handling via Temporal timer + `workflow.NewSelector`
- 4 timeout policies: FAIL, AUTO_APPROVE, AUTO_DENY, ESCALATE
- Custom outcomes with `then` routing via `__stigmer_branch_override`
- Binary approve/deny when no custom outcomes defined

#### T13.8: Branch Override + Budget Wiring
- Modified `DoTaskBuilder.runTask` to return optional branch override from task output
- Modified `DoTaskBuilder.iterateTasks` to apply `__stigmer_branch_override` before static flow directives
- Budget tracker + event emitter infrastructure ready for integration

#### Verification
- `go build ./...` — clean
- `go vet ./...` — clean
- `go test ./pkg/...` — all existing tests pass (zero regressions)

#### Open Items for Future Sessions
- Event emission integration — emitter built, wiring into updateStatus RPC deferred
- Budget enforcement at task boundaries — tracker built, integration into iterateTasks deferred
- stigmer-server signal routing for human_input submitWorkflowApproval
- Java/Cloud parity (T13b)

## Previous Session Progress (2026-05-13, T09)

### T09: Workflow Execution Viewer — COMPLETE

Built the full Execution Viewer following SDK-first architecture (DD-001): event store, data hooks, behavior hooks, styled components (timeline, task panel, cost panel, artifact panel, approval card), and console page shells. 17 new files, 4 modified.

#### Layer 0: Event Store — WorkflowExecutionEventStore
- Append-only external store for `useSyncExternalStore`
- Derived selectors: `getTaskStates()`, `getCostSummary()`, stream state FSM
- Simpler than ConversationStore — no structural sharing needed (events are immutable)

#### Layer 1: SDK Data Hooks (3 new files)
- `useWorkflowExecution` — single execution by ID
- `useWorkflowExecutionEventLog` — paginated event log with cursor, type, and task filters
- `useWorkflowExecutionArtifacts` — artifacts via `listByExecution()`

#### Layer 2: SDK Behavior Hooks (2 new files)
- `useWorkflowExecutionEventStream` — live `subscribeEvents` + batch `getEventLog` fallback + UNIMPLEMENTED graceful handling
- `useWorkflowExecutionActions` — cancel/terminate/pause/resume/recover/submitApproval

#### Layer 3: SDK Styled Components (8 new files)
- `WorkflowExecutionViewer` (composed top-level), `WorkflowExecutionHeader`, `WorkflowExecutionTimeline` (auto-scroll via IntersectionObserver), `WorkflowExecutionTimelineEvent` (18 event type renderers), `WorkflowExecutionApprovalCard`, `WorkflowExecutionTaskPanel`, `WorkflowExecutionCostPanel`, `WorkflowExecutionArtifactPanel`

#### Layer 4: Console Pages
- Route: `/workflows/executions/[id]`
- Execution list rows now clickable

#### Decisions
- DD-T09-001: Two-region layout (timeline + sidebar), not three-pane
- DD-T09-002: No rAF coalescing (low-frequency events)
- DD-T09-003: Agent drill-down via navigation callback
- DD-T09-004: Append-only event store with memoized derived selectors
- BigInt compatibility: `BigInt(0)` instead of `0n` for ES target compat

## Previous Sessions

### T12 (COMPLETE — 2026-05-13)
CLI Parity — Unified `stigmer execution` command group (cancel, terminate, pause, resume, logs, trace, approve) + `stigmer diff -f`. 20 new files, 3 modified. Auto-detects agent vs workflow from ID prefix.

### T08 (COMPLETE — 2026-05-12)
Workflow List and Detail Pages — codegen fix, React SDK data hooks, styled components (WorkflowDetailView, PhaseBadge, TaskList), web console pages, sidebar navigation, barrel exports

### T07 (COMPLETE — 2026-05-12)
Artifact Store Proto Contract — content-addressable blob storage, ArtifactQueryController/CommandController, ArtifactStorageState, retention policies

### T06 (COMPLETE — 2026-05-12)
Execution Event Stream Model — append-only event log with 17 typed event types, paginated query, server-streaming subscription

### T05 (COMPLETE — 2026-05-12)
Workflow Budget Primitives — WorkflowBudget, BudgetExceededPolicy, per-task budgets, CheckBudgetWarnings()

### T04 (COMPLETE — 2026-05-12)
Task Schema Registry — 19 task kind descriptors, registry generator, HTTP endpoints, cross-task reference validation, SDK hook

### T03 (COMPLETE — 2026-05-12)
New Task Types — llm_call, transform, human_input, validate, emit_event, notification (3 batches)

### T02 (COMPLETE)
Structured Agent Output Model

## Next Steps
1. **T16 Batch 2: Generation Dialog** — SDK `useGenerateWorkflow` hook + `WorkflowGenerateDialog` component + console integration
2. **T16 Batch 3: Refine Workflow** — `refineWorkflowFromFeedback` RPC + chat-style iteration loop
3. **T16 Batch 4: Diagnose Workflow** — `diagnoseWorkflow` RPC + error analysis + repair suggestions

## Context for Resume
- Phase 0 (Harden the Workflow Core) COMPLETE — T02-T07
- Phase 1 (Foreground MVP) COMPLETE — T08, T09, T10, T11, T12, T13, T13b, Go wiring, T14 all complete
- Phase 2 (Visual Builder) COMPLETE — T15 all 5 batches complete
- **Phase 3 Batch 1 COMPLETE** — `generateWorkflowFromPrompt` RPC end-to-end (proto + Go + Java + SDK)
  - Go: `pkg/llmclient/` (client.go, prompt.go) + `generate_workflow.go` handler
  - Java: `generation/WorkflowPromptBuilder.java`, `WorkflowYamlValidator.java`, `WorkflowGenerateFromPromptHandler.java`
  - SDK: `WorkflowClient.generateFromPrompt()` method callable
  - Prompt templates are server-side (iterate without deploying frontend)
  - Validation-in-the-loop: YAML parse + task kind check + max 2 LLM retries
  - Org context injected: agents, MCP servers, skills, existing workflows
  - Task kind registry embedded in both editions
- Workflow execution → session navigation fix COMPLETE (2026-05-14)
- Unified Platform Dashboard COMPLETE (2026-05-14)
- Cost data pipeline COMPLETE
- **Open tech debt:**
  - `proto2schema` codegen gap — `getExecutionSummary` on agent execution manually patched in generated SDK client
  - Usage page unification (show workflow data alongside agent data) — deferred
  - Search indexing for workflows in backend unverified — `list()` may return empty
  - `CheckBudgetWarnings()` (T05) still standalone — NOT wired into `ValidateWorkflow()` yet
  - `getDownloadUrl` still UNIMPLEMENTED (artifact store)
  - OSS stigmer-server updateStatus handler does NOT yet persist events (separate task from Java/Cloud parity)

## Essential Files — T15 Batch 2 (Canvas Node Authoring)
- **Graph commands (new)**: `sdk/react/src/workflow/graph-commands.ts`
- **Graph history hook (new)**: `sdk/react/src/workflow/useGraphHistory.ts`
- **Task palette (new)**: `sdk/react/src/workflow/WorkflowTaskPalette.tsx`
- **Canvas hook (rewritten)**: `sdk/react/src/workflow/useWorkflowCanvas.ts`
- **Canvas inner (updated)**: `sdk/react/src/workflow/WorkflowCanvasInner.tsx`
- **Canvas editor (updated)**: `sdk/react/src/workflow/WorkflowCanvasEditor.tsx`
- **Task node (updated)**: `sdk/react/src/workflow/CanvasTaskNode.tsx`

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-05/20260508.01.bring-workflows-to-foreground/checkpoints/2026-05-13-t14-dashboard-desktop-parity.md
```

### 2. Task Directory
```
_projects/2026-05/20260508.01.bring-workflows-to-foreground/tasks/
```

### 3. T09 Key Files Created/Modified
- **Event store (new)**: `sdk/react/src/internal/store/workflow-execution-event-store.ts`
- **SDK data hooks (new)**: `sdk/react/src/workflow/useWorkflowExecution.ts`, `useWorkflowExecutionEventLog.ts`, `useWorkflowExecutionArtifacts.ts`
- **SDK behavior hooks (new)**: `sdk/react/src/workflow/useWorkflowExecutionEventStream.ts`, `useWorkflowExecutionActions.ts`
- **SDK components (new)**: `sdk/react/src/workflow/WorkflowExecutionViewer.tsx`, `WorkflowExecutionHeader.tsx`, `WorkflowExecutionTimeline.tsx`, `WorkflowExecutionTimelineEvent.tsx`, `WorkflowExecutionApprovalCard.tsx`, `WorkflowExecutionTaskPanel.tsx`, `WorkflowExecutionCostPanel.tsx`, `WorkflowExecutionArtifactPanel.tsx`
- **Console route (new)**: `client-apps/web/src/app/workflows/executions/[id]/page.tsx`
- **Console page (new)**: `client-apps/web/src/domain/workflow/WorkflowExecutionDetailPage.tsx`
- **Modified**: `WorkflowExecutionListPage.tsx` (clickable rows), `sdk/react/src/workflow/index.ts`, `sdk/react/src/index.ts`, `sdk/react/src/internal/store/index.ts`

### 4. Existing Workflow Protos (the domain being enhanced)
- **Workflow spec**: `apis/ai/stigmer/agentic/workflow/v1/spec.proto`
- **Workflow execution**: `apis/ai/stigmer/agentic/workflowexecution/v1/`
- **Workflow tasks**: `apis/ai/stigmer/agentic/workflow/v1/tasks/`
- **Artifact store**: `apis/ai/stigmer/agentic/artifact/v1/`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Review the task plan in `tasks/T01_0_plan.md`
3. [ ] Review any design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons in `wrong-assumptions/` and `dont-dos/`
6. [ ] Execute the next task

## Project Phases

- **Phase 0**: Harden Workflow Core (T02-T07) — COMPLETE
- **Phase 1**: Foreground MVP (T08-T14) — COMPLETE
- **Phase 2**: Visual Builder (T15) — COMPLETE — canvas editor, drag-and-drop, YAML round-trip
- **Phase 3**: AI-Assisted Creation (T16) — NL-to-workflow, chat-to-workflow, repair assistant
- **Phase 4**: Advanced Agentic Orchestration (T17) — plan_and_execute, handoff, eval, batch, cache, code_execution, memory

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Plan T10" - Design YAML editor
- "Plan T13" - Design backend implementation
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
