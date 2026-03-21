# Next Task: 20260319.06.secrets-flow-hardening

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260319.06.secrets-flow-hardening

**Description**: Fix implementation flaws in the secrets-providing SDK: fragile ref-based state in Layer 2 hooks, naming inconsistencies across bounded contexts, dual-path session creation API, missing Execution Flow UI in Console, weak error messages across secret flows, and incorrect CLI commands in documentation.
**Goal**: Harden the React SDK Layer 2 orchestration for the Environment Flow, fix documentation inaccuracies, clean up naming/API inconsistencies, surface the Execution Flow in Console UI, and improve error messages — bringing the secrets infrastructure to state-of-the-art quality across all surfaces.
**Tech Stack**: TypeScript/React (SDK hooks and components), Protobuf (naming fixes), Java (backend naming/merge service), Go (CLI command verification)
**Components**: @stigmer/react Layer 2 hooks (useAgentSetup, usePersonalEnvironment, usePersonalAgentInstance, SessionComposer), docs/product/how-to-provide-secrets.md, proto definitions (environment_refs vs env_refs), backend EnvironmentMergeService, CLI environment/agent-instance commands

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-19 20:08
**Current Task**: All tasks complete (T01–T06)
**Status**: Complete — pending final commit

## Session Progress (2026-03-20, Session 6)

- **T06 completed**: Improve error messages across secret flows
  - Phase 1: Changed all 18 React hooks from `error: string | null` to `error: Error | null`, preserving full `StigmerError` metadata. Created `toError.ts` normalizer. Updated all consumers to use `getUserMessage()` at rendering boundary.
  - Phase 2: Moved `ErrorMessage` component from Console to `sdk/react/src/error/ErrorMessage.tsx`, decoupled from Console dependencies (lucide → inline SVGs, Console Button → plain `<button>`). Console re-exports from SDK.
  - Phase 3: Built `SecretFlowErrorGuide` in `sdk/react/src/error/SecretFlowErrorGuide.tsx` — detects `FAILED_PRECONDITION` missing env var errors, extracts server/variable names, renders actionable recovery guidance. Wired into SessionComposer and SessionPage.
  - Phase 4: Surfaced `useRevealSecretValue` errors in `EnvironmentVariableEditor` VariableRow.
  - Phase 5: 0 new TypeScript errors, 85/85 tests passing, 0 linter errors.
  - Files: 4 new, 32 modified across `@stigmer/react` and `client-apps/web`
  - Checkpoint: `checkpoints/2026-03-20-session-6.md`
  - **Not yet committed** — pending wrap-up commit

## Session Progress (2026-03-20, Session 5)

- **T05 completed**: Follow-up message one-time secrets input
  - Created `useOneTimeSecrets` headless behavior hook — manages ephemeral key-value entries with add/remove/update/clear operations and `toRuntimeEnv()` conversion to SDK input shape
  - Created `OneTimeSecretsInput` styled component — freeform key-value editor with monospace key input, password/text value input, secret/plain toggle, duplicate key detection, and "Add variable" button
  - Integrated into `SessionComposer` as a new "Secrets" context popover trigger (lock icon, count badge, "1-time" chips showing key names only)
  - Wired Console `SessionPage` to use `useOneTimeSecrets()`, pass to composer, and pipe `runtimeEnv` through `sendFollowUp` with auto-clear after submission
  - Updated barrel exports in `execution/index.ts` and root `index.ts`
  - Design decisions: placement in `execution/` (runtimeEnv is execution-scoped), controlled-prop pattern (same as workspace/MCP/skills), `isSecret: true` default (safer for credentials), no `onSubmit` signature change
  - Files: 2 new (`useOneTimeSecrets.ts`, `OneTimeSecretsInput.tsx`), 4 modified (SessionComposer, SessionPage, execution/index, react/index)
  - Verified: zero new TS errors, zero lint errors
  - **Not yet committed** — pending wrap-up commit

## Earlier Session Progress (2026-03-20, Session 4)

- **T02 completed**: Hardened useAgentSetup with state machine and save-or-use-once model
  - Committed: `cc467df4` on `feat/add-customize-ui-2`

## Earlier Session Progress (2026-03-20, Session 3)

- **T03 completed**: Renamed `env_refs` to `environment_refs` in WorkflowInstanceSpec
  - Committed: `bd1fca76` on `feat/add-customize-ui-2` (stigmer), `a307f32c` on `main` (stigmer-cloud)

## Earlier Session Progress (2026-03-20, Sessions 1-2)

- **T01 completed**: Fixed incorrect CLI commands in `docs/product/how-to-provide-secrets.md`
  - Committed: `6c941c85` on `feat/add-customize-ui-2`
- **T04 completed**: Enforced mutual-exclusion on `CreateSessionInput` agent fields
  - Committed: `5636cf5a` on `feat/add-customize-ui-2`

## Next Steps

1. **Commit T05 + T06 changes** — both are implemented and verified but not yet committed
2. **Project is complete** — all six tasks (T01–T06) are done. Close the project after committing.

## Context for Resume

- The revised plan (`T01_2_revised_plan.md`) is the authoritative task breakdown
- Execution order: T01 (done) -> T04 (done) -> T03 (done) -> T02 (done) -> T05 (done) -> T06 (done)
- Latest checkpoint: `checkpoints/2026-03-20-session-6.md` — covers T06 full implementation
- Working branch: `feat/add-customize-ui-2` (stigmer)
- Key new module: `sdk/react/src/error/` — ErrorMessage, SecretFlowErrorGuide, isSecretFlowError
- Key pattern change: all hooks expose `error: Error | null` instead of `string | null`
- Key rendering pattern: `getUserMessage(error)` at JSX boundary — sanitizes infra noise

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Commit changes" - Commit the T05 + T06 work
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
