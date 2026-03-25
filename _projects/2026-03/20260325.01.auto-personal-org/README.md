# 20260325.01.auto-personal-org

## Overview
Auto-create personal organizations during user signup (like GitHub personal accounts), eliminating the manual org creation step from onboarding. New users land directly in their workspace.

**Created**: 2026-03-25  
**Estimated Time**: 4-5 days  
**Status**: 🚧 In Progress

## Goal
New users land directly in their workspace after signup — no org creation form. A personal org is auto-provisioned server-side during identity account creation, with slug derived from email/name.

## Technology Stack
Proto/Buf, Go/gRPC (server), TypeScript/React (web console, SDK)

## Affected Components
Organization protos, IdentityAccount provisioning handler (stigmer-cloud), web console OrgGate/OrgSwitcher, SDK react org components

## Success Criteria
- New user signs up → personal org auto-created → user lands directly in workspace (no org creation form)
- Existing users get personal org on next login (lazy backfill)
- Personal orgs visually distinguished in OrgSwitcher (user icon vs building icon)
- Personal orgs cannot be deleted or have `is_personal` flipped
- CLI auto-selects personal org context for new users (existing behavior, no code change)
- All existing resource scoping (`metadata.org`) works unchanged
- Tests passing for slug generation, conflict handling, deletion guard, immutability

## Quick Links
- [Tasks](tasks.md) - Task breakdown and progress
- [Notes](notes.md) - Quick notes and learnings
- [Resume](next-task.md) - **Drag this into chat to resume!**

## Repos Involved
- **stigmer** (this repo) — Proto definitions, web console, SDK, CLI
- **stigmer-cloud** — Server-side identity provisioning handler, org creation logic

## Project Type
⚡ **Quick Project** - Designed to complete in 1-2 sessions with minimal overhead.

## Status Summary

Check [tasks.md](tasks.md) for detailed progress tracking.

Update this section as you make progress:
- Current phase: Analysis complete, ready for implementation
- Blockers: None
- Next up: Task 1 — Add `is_personal` to OrganizationSpec proto

## Notes Summary

Key learnings and decisions are captured in [notes.md](notes.md).

---

*This project follows the Next Quick Project Framework for fast, focused development.*

## Sub-Projects

| Sub-Project | Path | Status | Description |
|-------------|------|--------|-------------|
| on-behalf-of-grpc-channel | [20260325.02.sp.on-behalf-of-grpc-channel](../20260325.02.sp.on-behalf-of-grpc-channel/) | Active | Build gRPC on-behalf-of infrastructure for in-process calls, enabling the system (machine account) to create resources attributed to a specific user identity. Solves the FGA ownership problem when system-created resources (personal orgs, execution contexts, default agent instances) get incorrectly owned by the machine account instead of the actual user. |
