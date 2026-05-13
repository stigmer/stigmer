# Next Task: 20260513.01.cursor-experience-parity

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260513.01.cursor-experience-parity

**Description**: Implement usage tracking, context window visibility, chat summarization, and Cursor-like UX features based on deep research findings from three ChatGPT Deep Research reports.
**Goal**: Close the UX gap between Stigmer and Cursor IDE for early adopters: fix $0.00 usage for Cursor sessions, add context window telemetry, implement active chat summarization, and add Plan/Ask mode.
**Tech Stack**: TypeScript (cursor-runner), Java (stigmer-service), Python (agent-runner), Protobuf (protos), React (SDK)
**Components**: cursor-runner, agent-runner, stigmer-service, React SDK, protos (session/execution/billing), Planton usage dashboard

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current State

- **Status**: In Progress
- **Last Session**: May 13, 2026 — Server-Reported Deployment Mode + Feature Parity
- **Active Task**: T01 plan reviewed; parity + server-info complete, main plan (Phase 1-5) pending review
- **Branch**: `feat/bring-workflows-to-foreground`

## Session Progress (May 13, 2026 — Session 2)

### Server-Reported Deployment Mode

Replaced URL-based deployment mode guessing with server-reported `getServerInfo` RPC.

**Committed** (`e090a92b7`):
- New proto: `PlatformQueryController.getServerInfo` with `ServerEdition` enum (oss/cloud)
- OSS Go handler returns `edition=oss`, Cloud Java handler returns `edition=cloud`
- SDK TypeScript `PlatformClient.getServerInfo()` maps edition to `DeploymentMode`
- Desktop `App.tsx`: new `useServerDeploymentMode(client)` hook replaces `isLocalMode()`
- Web `useDeploymentMode(client?)`: queries server when client provided, falls back to URL
- Full codegen: Go, Java, Python, TypeScript stubs generated
- Cloud stubs regenerated via `make protos` in stigmer-cloud

### Session 1: Web-Desktop Feature Parity Audit

**Committed** (`2ba7abaf9`):
- Removed incorrect local-mode gate from `UsageSection` — OSS server already implements `getOrgUsageReport`
- Improved billing `CloudFeatureNotice` messaging to frame local mode positively
- Added `lastSessionZonePath` tracking to desktop `ManagementSidebar` for session-return parity

**Findings deferred**:
- Workflows missing from desktop sidebar/routes — deferred to `20260508.01.bring-workflows-to-foreground` project
- All other cloud-only settings gates (API Keys, Members, Invitations, Identity Providers, Platform Clients, OAuth Apps) are correctly gated — no OSS backend for those

## Next Steps

1. Review and provide feedback on the main T01 plan (Phase 1-5: usage tracking, context window, summarization, Plan/Ask mode, reconciliation)
2. Begin Phase 1: Diagnose the $0.00 usage root cause for Cursor harness sessions
3. Continue with context window visibility (Phase 2) based on plan approval

## Context for Resume

- The T01 plan at `tasks/T01_0_plan.md` covers 5 phases over 4-6 weeks
- Phase 1 is CRITICAL: fix $0.00 usage for Cursor sessions (user trust issue)
- Three deep research reports in `research.*` folders provide detailed technical context
- The parity audit revealed the OSS Go server has more capability than the frontend exposes
- Server-reported deployment mode is now the authoritative source — URL fallback is backward compat only
- Cloud Java handler in stigmer-cloud needs to be committed separately (different repo)

## Quick Commands

After loading context:
- "Review T01 plan" — Revisit the 5-phase implementation plan
- "Start Phase 1" — Begin diagnosing the $0.00 usage root cause
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
