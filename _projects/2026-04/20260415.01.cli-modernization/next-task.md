# Next Task: 20260415.01.cli-modernization

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: CLI Modernization

**Description**: Comprehensive modernization of the Stigmer CLI: close all apply gaps across every resource kind, add CI guards so gaps never recur, replace discover with connect, fix slug-vs-name help text, and rewrite run/resume rendering with @stigmer/ink (React-in-CLI via Ink).

**Goal**: Make the CLI a first-class citizen: every apply-able resource works, CI prevents regressions, connect replaces discover with proper OAuth, and run/resume uses shared React SDK components via Ink for terminal rendering.

**Tech Stack**: Go/Cobra (CLI), TypeScript/React/Ink (SDK), Protobuf (APIs), Bubble Tea/Lip Gloss (current TUI)
**Components**: client-apps/cli, sdk/ink (new), sdk/react, sdk/typescript, apis/stubs/go
**Timeline**: 1 month (4 tasks/phases)

## Task Overview

| Task | Description | Status |
|------|-------------|--------|
| T01 | Generic ApplyHandler framework + CI guards | COMPLETE |
| T02 | Close all apply gaps (6 new resource kinds) | COMPLETE |
| T03 | Replace discover with connect, slug audit, MCP OAuth | COMPLETE |
| T04 | @stigmer/ink package and run/resume rewrite | COMPLETE (Phase 1: SDK package) |

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

## Next Steps

1. Evaluate Go CLI integration (Phase 2): shell-out from Go to Ink renderer for `run`, `resume`, `draft`
2. Consider moving `createNodeTransport` from `@stigmer/ink` to `@stigmer/sdk`

## Context for Resume

- `@stigmer/ink` is E2E validated — works against live Stigmer API
- CLI entry point is at `sdk/ink/src/cli/stigmer-ink.tsx` (renamed from `src/bin/`)
- Transport uses `createGrpcWebTransport` from `@connectrpc/connect-node` (matches server protocol)
- Non-TTY environments work: synthetic stdin + `isRawModeSupported` check in FollowUpInput
- `customTransport` on `StigmerConfig` allows any Node.js consumer to bypass the browser transport
- Ink 7.0.0 used (requires React >=19.2.0), marked@^15 for marked-terminal compatibility
- Go CLI rendering layer is ~37K lines of well-tested Go code — significant effort to replace
- Phase 2 (Go CLI integration) intentionally deferred: SDK validated, now decide

## Current Status

**Created**: 2026-04-15
**Current Task**: T04 Phase 2 (Go CLI integration — evaluate after SDK validation)
**Status**: Phase 1 COMPLETE + E2E VALIDATED, Phase 2 PENDING
**Last Session**: 2026-04-15 (Session 5) — E2E validation and 3 bugfixes

## Quick Commands

After loading context:
- "Evaluate Go CLI integration" - Phase 2 decision
- "Move createNodeTransport to @stigmer/sdk" - Transport refactor
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
