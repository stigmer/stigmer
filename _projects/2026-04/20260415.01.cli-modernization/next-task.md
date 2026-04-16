# Next Task: 20260415.01.cli-modernization

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: CLI Modernization

**Description**: Comprehensive modernization of the Stigmer CLI: close all apply gaps across every resource kind, add CI guards so gaps never recur, replace discover with connect, fix slug-vs-name help text, and rewrite run/resume rendering with @stigmer/ink (React-in-CLI via Ink).

**Goal**: Make the CLI a first-class citizen: every apply-able resource works, CI prevents regressions, connect replaces discover with proper OAuth, and run/resume uses shared React SDK components via Ink for terminal rendering.

**Tech Stack**: Go/Cobra (CLI), TypeScript/React/Ink (SDK), Protobuf (APIs), Bubble Tea/Lip Gloss (current TUI)
**Components**: client-apps/cli, sdk/go, sdk/ink (new), sdk/react, sdk/typescript
**Timeline**: 1 month (4 tasks/phases)

## Task Overview

| Task | Description | Status |
|------|-------------|--------|
| T01 | Generic ApplyHandler framework + CI guards | COMPLETE |
| T02 | Close all apply gaps (6 new resource kinds) | COMPLETE |
| T03 | Replace discover with connect, slug audit, MCP OAuth | COMPLETE |
| T04 | @stigmer/ink package and run/resume rewrite | COMPLETE (Phase 1: SDK + Phase 2: Go integration) |
| T05 | CLI Go SDK refactor — SDK-first architecture | COMPLETE |
| T06 | SDK sub-client migration — eliminate raw gRPC stubs | COMPLETE |

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260415.01.cli-modernization/checkpoints/
```

### 2. Task Plans
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260415.01.cli-modernization/tasks/T01_0_plan.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260415.01.cli-modernization/tasks/T02_0_plan.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260415.01.cli-modernization/tasks/T03_0_plan.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260415.01.cli-modernization/tasks/T04_0_plan.md
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260415.01.cli-modernization/README.md`
- **Brainstorm Plan**: `/Users/suresh/.cursor/plans/cli_modernization_brainstorm_0595422c.plan.md`

### 4. Related GitHub Issue
- Issue #122: https://github.com/stigmer/stigmer/issues/122

## Key Codebase Paths

### CLI (Go)
- Commands: `client-apps/cli/cmd/stigmer/root/`
- Domain packages: `client-apps/cli/internal/cli/`
- Type registry: `client-apps/cli/internal/cli/types/registry.go`
- Verb support: `client-apps/cli/internal/cli/types/verb_support.go`
- Apply dispatch: `client-apps/cli/cmd/stigmer/root/apply_file.go`
- Apply handlers: `client-apps/cli/cmd/stigmer/root/apply_file_handlers.go`
- Reference parser: `client-apps/cli/pkg/reference/reference.go`
- MCP OAuth: `client-apps/cli/internal/cli/mcpserver/oauth.go`

### SDK (TypeScript/React)
- React hooks: `sdk/react/src/session/useSessionConversation.ts`
- Message components: `sdk/react/src/execution/MessageThread.tsx`
- SDK clients: `sdk/typescript/src/`
- Theme: `sdk/theme/`

### Proto (APIs)
- Resource kinds: `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto`
- Identity provider: `apis/ai/stigmer/iam/identityprovider/v1/`
- MCP server: `apis/ai/stigmer/agentic/mcpserver/v1/`

### CLI Coding Rules
- Engineering standards: `.cursor/rules/client-apps/cli/coding-guidelines.mdc`
- Implementation guide: `.cursor/rules/client-apps/cli/implement-stigmer-cli-features.mdc`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260415.01.cli-modernization/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260415.01.cli-modernization/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260415.01.cli-modernization/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260415.01.cli-modernization/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review any design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Session Progress (2026-04-15, Session 4)

- Completed T04 Phase 1: `@stigmer/ink` SDK package
- Added `customTransport` support to `@stigmer/sdk` (non-breaking)
- Built 8 Ink terminal components (MessageEntry, MessageThread, ToolCallGroup, ToolCallItem, ApprovalPrompt, ExecutionProgress, FollowUpInput, UsageWidget)
- Built InkStigmerProvider, Node transport factory, terminal markdown renderer
- Built SessionView, SessionApp composition components
- Built standalone CLI entry point (`cli/stigmer-ink.tsx`)
- Registered in workspace, build pipeline, and publish pipeline (fully automated via existing CI)
- 28 tests passing, build clean, dry-run publish verified (36.6 kB package)
- Decision: Go CLI integration (run/resume/draft) deferred to Phase 2 after validating SDK package

## Session Progress (2026-04-15, Session 5)

- **E2E validated**: Ran `@stigmer/ink` against live Stigmer API with real session data — full conversation rendered
- Fixed 3 bugs discovered during E2E:
  1. **Transport protocol**: Switched `createConnectTransport` → `createGrpcWebTransport` (server expects gRPC-web, not Connect protocol — HTTP 415 fix)
  2. **Non-TTY crash**: Added synthetic stdin for non-TTY environments, `FollowUpInput` checks `isRawModeSupported`
  3. **Missing entry point**: Renamed `src/bin/` → `src/cli/` to avoid root `.gitignore` `bin/` collision (file was never committed)
- All 28 unit tests still pass after fixes

## Session Progress (2026-04-15, Session 6)

- **CLI Go SDK refactor COMPLETE**: CLI now consumes `sdk/go` for connection/auth/transport
- **Go SDK enhanced**: `NewClient(...opts)` with `WithAPIKey`, `WithToken`, `WithInsecure`, `WithKeepaliveParams`, `Connect(ctx)`, `Conn()`
- **Proto imports migrated**: All ~170 CLI files switched from `apis/stubs/go` to `sdk/go/proto`
- **Backend decoupled**: Removed CLI's Go-level dependency on `stigmer-server` and `workflow-runner` (BusyBox pattern removed)
- **Protobuf conflict resolved**: Dual proto registration panic fixed by eliminating `apis/stubs/go` from CLI's dependency tree
- **New CLI packages**: `internal/cli/kindmeta` (proto metadata), `internal/cli/mcpdiscovery` (MCP discovery using SDK types)
- **Daemon updated**: Now launches standalone `stigmer-server` / `stigmer-workflow-runner` binaries instead of self-executing
- All tests pass, binary runs clean

## Session Progress (2026-04-15, Session 7)

- **Release pipeline COMPLETE**: `release.cli.yaml` now builds and ships `stigmer-server` and `stigmer-workflow-runner` alongside the CLI for all 3 platforms
- **OAuth ldflags fixed**: Removed stale flags from CLI build, moved to `stigmer-server` build where they belong
- **Tarballs include all 3 binaries**: `stigmer`, `stigmer-server`, `stigmer-workflow-runner`
- **Homebrew formula updated**: Installs all 3 binaries
- **Makefile updated**: `build` and `local` targets produce all 3 binaries
- **Release docs updated**: Stage 2 description, tarball contents table, checklists
- **Decision**: Use `backend/services/workflow-runner/main.go` (lean Stigmer-specific entry point) not `cmd/zigflow` (full Cobra CLI)

## Session Progress (2026-04-15, Session 8)

- **SDK sub-client migration COMPLETE**: All 83 raw gRPC stub constructions replaced with SDK sub-client methods across 129 files (2,048 insertions / 1,656 deletions)
- **FromProto codegen**: Extended code generator to produce `XxxInputFromProto` converters for all 19 resources
- **ApplyHandler interface migrated**: `conn grpc.ClientConnInterface` → `client *stigmer.Client` across all 10 apply handlers
- **All 14 domain packages migrated**: session, agent, organization, workflow, mcpserver, environment, project, skill, agentinstance, workflowinstance, apikey, execution, identityprovider, oauthapp
- **Streaming + create migrated**: Subscribe, Create, SubmitApproval, UploadAttachment all use SDK methods
- **Error handling updated**: `clierr.go` recognizes SDK `*stigmer.Error` alongside raw gRPC status errors
- **Zero `.Conn()` calls remain** in CLI (was 27)
- **Decision**: Keep single `Apply(*Input)` method — CLI uses `FromProto` converters like any other SDK consumer

## Session Progress (2026-04-16, Session 9)

- **Go CLI Ink Integration COMPLETE (T04 Phase 2)**: Replaced 37K-line Bubble Tea TUI with `@stigmer/ink` via npx
- **Distribution**: npx with workspace auto-detection (dogfoods npm SDK model, no bun compile)
- **Ink SDK enhanced**: SubAgentBlock, TodoList, task-tool suppression, approval attribution, Ctrl+O expand toggle, session subject, reconnection UX, context compaction
- **Go CLI rewritten**: `resolveInkCommand()` (env → workspace → npx), `streamAgentInk()` (Ink spawn), `streamAgentPlainText()` (non-TTY)
- **36 inline renderer files deleted** (~15,800 lines removed)
- **Release coordination**: `release.cli.yaml` gates GitHub Release on `@stigmer/ink` npm availability
- **Tests**: Go root package tests pass, Ink SDK 28 tests pass, full CLI builds clean
- **Decision**: npx over bun compile (dogfoods SDK, no WASM risks, boring and proven)
- **Decision**: Full TUI replacement, no Bubble Tea fallback (Go TUI was problematic)

## Next Steps

1. E2E test against live Stigmer instance (local daemon + cloud) — validate full run/resume/draft pipeline
2. Clean up remaining Go dependencies: remove Bubble Tea, Lip Gloss, Glamour, Bubbles from `go.mod`
3. Delete unused packages: `pkg/toolrender/`, `pkg/approval/`, `pkg/panel/`, `pkg/mdrender/`
4. Rename `run_stream_inline_header.go` → `run_display_header.go` (no longer inline-specific)
5. Consider moving `createNodeTransport` from `@stigmer/ink` to `@stigmer/sdk`
6. Consider deprecating/removing `Conn()` from `*stigmer.Client`

## Context for Resume

- CLI interactive rendering is now delegated to `@stigmer/ink` via npx (or workspace tsx for development)
- `resolveInkCommand()` in `run_stream_ink.go` handles 3-tier resolution: STIGMER_INK_CMD env → workspace auto-detection → npx
- JSON mode (`--json`) and detach mode (`--detach`) are unchanged, pure Go
- Non-TTY piped output uses `streamAgentPlainText()` — minimal Go renderer, no external process
- `@stigmer/ink` is NOT yet published to npm — first publish needed before production CLI release
- Release pipeline gates CLI release on npm package availability (polling step in `release.cli.yaml`)
- `tsx` is now a root devDependency for workspace Ink development
- Workspace detection: Go binary at `bin/stigmer` looks for `../node_modules/.bin/tsx` + `../sdk/ink/src/cli/stigmer-ink.tsx`
- Some Go TUI utility packages still exist but are now dead code (toolrender, approval, panel, mdrender)
- `run_stream_inline_header.go` is the only surviving inline file — kept for `sessionHeaderInfo` and `renderSessionHeader`

## Current Status

**Created**: 2026-04-15
**Current Task**: Go CLI Ink Integration COMPLETE (T04 Phase 2)
**Status**: All planned tasks COMPLETE — cleanup and E2E validation remaining
**Last Session**: 2026-04-16 (Session 9) — Go CLI Ink Integration

## Quick Commands

After loading context:
- "E2E test ink integration" - Test against live API
- "Clean up Go TUI dependencies" - Remove Bubble Tea et al from go.mod
- "Delete dead TUI packages" - Remove pkg/toolrender, pkg/approval, etc.
- "Move createNodeTransport to SDK" - SDK architecture cleanup
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
