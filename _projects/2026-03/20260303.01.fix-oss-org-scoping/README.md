# 20260303.01.fix-oss-org-scoping

## Overview
Fix missing org scoping in OSS server pipeline steps. Slug lookups in LoadForApply, LoadExisting, CheckDuplicate, and FindResourceBySlug match globally across orgs instead of being org-scoped. This causes the seedpack bootstrap to silently update agents under the wrong org (local instead of default) and breaks multi-org resource isolation.

**Created**: 2026-03-03  
**Estimated Time**: 1-4 hours  
**Status**: 🚧 In Progress

## Goal
Add org filtering to all shared pipeline steps (findBySlug, FindResourceBySlug, duplicate check) and ID-based lookups to enforce org-scoped resource isolation in the OSS backend. Directly unblocks the seedpack bootstrap under org default.

## Technology Stack
Go/gRPC

## Affected Components
backend/libs/go/grpc/request/pipeline/steps/, backend/libs/go/store/, backend/services/stigmer-server/pkg/domain/skill/controller/push.go

## Success Criteria
- Goal achieved
- Tests passing
- Changes validated

## Quick Links
- [Tasks](tasks.md) - Task breakdown and progress
- [Notes](notes.md) - Quick notes and learnings
- [Resume](next-task.md) - **Drag this into chat to resume!**

## Project Type
⚡ **Quick Project** - Designed to complete in 1-2 sessions with minimal overhead.

## Status Summary

Check [tasks.md](tasks.md) for detailed progress tracking.

Update this section as you make progress:
- Current phase: [Analysis/Implementation/Testing/Complete]
- Blockers: [None/List any blockers]
- Next up: [What's next after current task]

## Notes Summary

Key learnings and decisions are captured in [notes.md](notes.md).

---

*This project follows the Next Quick Project Framework for fast, focused development.*

