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
| T04 | @stigmer/ink package and run/resume rewrite | PENDING |

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

## Session Progress (2026-04-15, Session 3)

- Completed T03: Replace `discover` with `connect`, slug audit, MCP OAuth
- Removed env_resolver.go and all well-known var auto-injection (~750 lines deleted)
- Renamed `discover` -> `connect` across 4 files, 15 symbols, all callers
- Updated all `<name-or-id>` help text to `<slug-or-id>` in get, delete, run, connect
- Implemented MCP OAuth CLI flow via web-console-assisted approach (new `oauth.go`)
- Key architectural decisions: no proto changes, no frontend changes, web-console-assisted OAuth, two-channel credential model (OAuth + manual)

## Next Steps

1. Begin T04: @stigmer/ink package and run/resume rewrite
2. Read the T04 plan: `tasks/T04_0_plan.md`
3. Validate web console route structure for OAuth flow (`/{org}/mcp-servers/{slug}`)

## Context for Resume

- `discover` command is fully deleted — `connect` is the only entry point
- `env_resolver.go` is gone — no more auto-injection of credentials from external tools
- OAuth flow uses web-console-assisted approach (no proto change, no frontend change)
- Console URL resolved via: `STIGMER_CONSOLE_URL` env > local `localhost:8234` > cloud `app.stigmer.ai`
- `--env` escape hatch: explicit env overrides bypass the OAuth check entirely
- Pre-existing `TestRenderProtoJSON` failure in `pkg/display/proto_test.go` is unrelated to T03
- Future enhancement: Direct-to-auth-URL flow via `OAuthCallbackHandler` standalone mode

## Current Status

**Created**: 2026-04-15
**Current Task**: T04 (@stigmer/ink package and run/resume rewrite)
**Status**: PENDING
**Last Session**: 2026-04-15 — Completed T03 (connect rename, slug audit, env_resolver removal, MCP OAuth)

## Quick Commands

After loading context:
- "Continue with T04" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
