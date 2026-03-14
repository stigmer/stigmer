# 20260314.01.cli-cloud-auth-pkce

## Overview
Port Stigmer Cloud auth flow to OSS CLI using PKCE, enabling secure cloud backend authentication without embedded secrets.

**Created**: 2026-03-14  
**Estimated Time**: 1-4 hours  
**Status**: 🚧 In Progress

## Goal
Enable stigmer auth login/logout/whoami in the OSS CLI with PKCE OAuth, wire into existing backend switching, then delete auth from cloud CLI.

## Technology Stack
Go / Cobra CLI

## Affected Components
OSS CLI auth commands, auth/config, backend connection interceptor, cloud CLI auth removal

## Success Criteria
- `stigmer auth login` completes PKCE flow and stores token
- `stigmer auth logout` / `stigmer auth whoami` work correctly
- Cloud backend commands authenticate with stored token
- `STIGMER_API_KEY` env var override works
- Zero secrets (no Auth0 client secret) in the OSS codebase
- Auth code deleted from cloud CLI

## Key Design Decision: PKCE over Authorization Code + Secret
The cloud CLI embeds an Auth0 client secret — unacceptable for open source.
PKCE eliminates the client secret entirely using a one-time code verifier/challenge.
Auth0 domain and client ID are safe to embed (public for Native/PKCE apps).

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

