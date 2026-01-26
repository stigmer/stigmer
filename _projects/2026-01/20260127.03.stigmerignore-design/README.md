# 20260127.03.stigmerignore-design

## Overview
Design and implement a .stigmerignore file system for controlling which files are included when pushing skills and other artifacts

**Created**: 2026-01-27  
**Estimated Time**: 1-4 hours  
**Status**: 🚧 In Progress

## Goal
Create a flexible, Git-inspired ignore system that respects .gitignore semantics while providing Stigmer-specific overrides

## Technology Stack
Go/Bazel

## Affected Components
client-apps/cli/pkg/ignore, client-apps/cli/internal/cli/artifact

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

- **Current phase**: Research Complete → Ready for Implementation
- **Blockers**: None
- **Next up**: Task 2 - Implement `pkg/ignore` package

### Architecture Summary

After researching Git, Docker, and Buf implementations:

1. **Client-side filtering** (industry standard)
2. **Shared `pkg/ignore` library** for CLI and backend
3. **Precedence**: Built-in defaults < `.gitignore` < `.stigmerignore`
4. **Git-compatible syntax** via `go-git` library
5. **Security-first defaults** (never distribute .env, credentials, etc.)

## Notes Summary

Key learnings and decisions are captured in [notes.md](notes.md).

---

*This project follows the Next Quick Project Framework for fast, focused development.*

