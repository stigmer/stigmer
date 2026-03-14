# 20260314.02.org-portability-seedpack-apply

## Overview
Replace the default org with stigmer in the seedpack, implement org inheritance from project manifests in the apply flow, and update agent-fleet to use planton org. Enables resource portability across OSS and Cloud without org-level YAML edits.

**Created**: 2026-03-14  
**Estimated Time**: 1-4 hours  
**Status**: 🚧 In Progress

## Goal
Make seedpack and agent-fleet resources portable across OSS and Cloud by using consistent org names (stigmer for seedpack, planton for agent-fleet) and implementing org inheritance so individual resources never hardcode org.

## Technology Stack
Go, YAML, Proto/Buf

## Affected Components
seedpack, CLI apply flow, agent-fleet, proto resource schemas, server bootstrap

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

