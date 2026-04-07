# Next Task: 20260407.01.sp.sso-login-flow

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: 20260405.02.identity-provider-flow
- **Overall Objective**: [1-2 sentences]
- **What's Been Completed**: [Key milestones]
- **What's Pending**: [Remaining work]
- **Agreed Focus for This Session**: [From previous session]
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: 20260405.02.identity-provider-flow
**Parent Next Task**: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/next-task.md`
**Spawned From Task**: N/A

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/design-decisions/`
- Parent Coding Guidelines: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/coding-guidelines/`
- Parent Wrong Assumptions: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/wrong-assumptions/`
- Parent Don't Dos: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/dont-dos/`

---

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this sub-project.

## Sub-Project: 20260407.01.sp.sso-login-flow

**Description**: Implement org-aware SSO login flow in the web app, add updateFederatedAccount and deprovisionFederatedAccount lifecycle RPCs, add SSO auto-provisioning for self-managed orgs, and surface a copyable SSO login URL in the IdP management screen.
**Goal**: Enable org-specific SSO authentication in the Stigmer web app: org discovery on the login page, dynamic OIDC flow with the org's SSO provider, auto-provisioning for self-managed SSO orgs, federated account lifecycle RPCs (update and deprovision), and a visible SSO login URL on the IdP detail panel for admins to copy and share.
**Tech Stack**: Protobuf, Java (backend services, MongoDB migrations, FGA), TypeScript/React (SDK react, web app), MongoDB
**Components**: stigmer-cloud/backend/ (MongoDB migration for email index, FederatedIdentityProvisionerImpl removal, new authorized identity account creation RPC, FGA permissions), apis/ (org spec for self-managed SSO, identity account command proto for new RPC, new FGA permissions), sdk/react/ (new identity-provider and iam-policy feature folders), client-apps/web/ (IdP management pages in settings), docs/ (federation flow documentation)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.02.identity-provider-flow/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260407.01.sp.sso-login-flow/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-07 11:49
**Current Task**: T01 (Initial Setup)
**Status**: Planning

## Session Progress (2026-04-07)

### Session 1 — Multi-tenancy documentation

**Focus**: Multi-tenancy documentation (side task, not part of SSO login flow)

- Reordered docs sidebar to match Diataxis (Guides and SDK Reference before Concepts)
- Fixed factual error in `concepts/organizations.mdx` (`platform_managed` description)
- Added Management Modes and Multi-Tenant Platforms sections to Organizations concept page
- Created `docs/guides/federation/multi-tenant-setup.mdx` — new how-to guide with SDK examples in all 4 languages
- Updated federation overview with multi-tenant card link
- Added Identity Provider, Identity Account, and identity federation entries to `docs/vocabulary.md`
- Committed: `37c49f25 docs: add multi-tenant platform documentation and reorder sidebar`

### Session 2 — Multi-tenant visual demo scenario

**Focus**: Added interactive demo to the multi-tenant setup page (completing visual parity with other federation guides)

- Created `multi-tenant-setup-playback` scenario (7 steps, two-phase story: tenant onboarding + user onboarding within tenant)
- Two new files: `steps.ts` (step types, code fixtures, terminal fixtures, narration) and `index.tsx` (ScenarioPlayer component with BrowserView, CodeEditorView, TerminalView, Cursor)
- Inline components: `TenantAdminPage` (platform admin panel with tenant list) and `TenantSignupPage` (tenant-branded signup form)
- Registered in `registry.ts`, exported from `docs/index.ts`, wired into `mdx.tsx`
- Embedded `<DemoMultiTenantSetupPlayback />` in `multi-tenant-setup.mdx` after intro paragraph
- TypeScript check and Next.js build both pass (exit code 0)

**Note**: The SSO login flow implementation (T01 plan) has not started yet. Both sessions were about enriching the identity federation documentation.

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
