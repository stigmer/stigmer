# Next Task: 20260412.01.slack-marketplace-submission

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260412.01.slack-marketplace-submission

**Description**: Submit the Stigmer Slack app to the Slack Marketplace to enable multi-workspace MCP access. Covers listing assets, scope justifications, public pages, 5+ workspace installs, and the review process.
**Goal**: Get the Stigmer Slack app (A0AS6B4B97G) approved and published in the Slack Marketplace so that any Slack workspace can install it and use Slack MCP tools through Stigmer agents.
**Tech Stack**: Slack API, OAuth 2.0, MCP Protocol, React SDK, Java/Spring (stigmer-service)
**Components**: Slack app settings (api.slack.com), seedpack MCP server definitions, OAuthApp configuration, stigmer.ai landing/support/privacy pages

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.01.slack-marketplace-submission/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.01.slack-marketplace-submission/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.01.slack-marketplace-submission/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.01.slack-marketplace-submission/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.01.slack-marketplace-submission/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.01.slack-marketplace-submission/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.01.slack-marketplace-submission/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.01.slack-marketplace-submission/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.01.slack-marketplace-submission/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.01.slack-marketplace-submission/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.01.slack-marketplace-submission/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.01.slack-marketplace-submission/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.01.slack-marketplace-submission/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

- **Status**: in-progress
- **Last Session**: 2026-04-12 — Implemented vendor OAuth approval status gating
- **Active Task**: T01 (Slack marketplace submission checklist)

## Session Progress (2026-04-12)
- Designed and implemented full vendor OAuth approval status feature (proto, backend, frontend, docs)
- All three vendor OAuthApps (Slack, Figma, Salesforce) set to PENDING via migration
- Frontend shows "Pending approval" pill with disabled sign-in and docs link
- Manual token override path preserved for users who have their own tokens
- Committed both stigmer and stigmer-cloud repos

## Next Steps
1. Deploy the vendor approval status changes to staging/production
2. Continue with Slack marketplace submission requirements (listing assets, scope justifications)
3. Update vendor_approval_status to APPROVED as each vendor completes review
4. Improve the bring-your-own-oauth documentation with detailed vendor-specific instructions

## Context for Resume
- Vendor approval status is a new proto enum on OAuthAppSpec — UNSPECIFIED is treated as approved for backwards compatibility
- Backend enrichment resolves OAuthApp ref at query time and copies approval fields onto McpServerAuth
- The placeholder docs URL is `https://docs.stigmer.ai/guides/bring-your-own-oauth`
- Migration order is 016 (after the Figma token URL patch at 015)

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
