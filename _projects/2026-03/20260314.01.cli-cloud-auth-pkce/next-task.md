# Next Task: 20260314.01.cli-cloud-auth-pkce

## 🎯 Quick Resume Instructions

**Simply drop this file into your conversation to quickly resume work on this project.**

All the context you need is right here with absolute paths to project files.

---

## Project Overview

**Name**: 20260314.01.cli-cloud-auth-pkce  
**Description**: Port Stigmer Cloud auth flow to OSS CLI using PKCE, enabling secure cloud backend authentication without embedded secrets.  
**Goal**: Enable stigmer auth login/logout/whoami in the OSS CLI with PKCE OAuth, wire into existing backend switching, then delete auth from cloud CLI.  
**Tech Stack**: Go / Cobra CLI  
**Components**: OSS CLI auth commands, auth/config, backend connection interceptor, cloud CLI auth removal

**Created**: 2026-03-14  
**Type**: ⚡ Quick Project (1-2 sessions)

---

## Key Architectural Context

**Why this project exists**: The cloud CLI (`stigmer-cloud/client-apps/cli`) embeds an Auth0
client secret. We're moving auth to the OSS CLI using **PKCE** (no client secret needed), then
deleting auth from the cloud CLI.

**PKCE flow**: `stigmer auth login` → generate code_verifier/challenge → open browser to Auth0 →
user logs in → Auth0 redirects to localhost:8088 → exchange code + verifier for token (no secret)
→ store token in `backend.cloud.token` → set `backend.type: cloud`.

**Token resolution for gRPC**: `STIGMER_API_KEY` env var > `--api-key` flag > `backend.cloud.token`

**What's safe in OSS code**: Auth0 domain, client ID, audience URL (all public for PKCE/Native apps).  
**What must NOT be in OSS code**: Client secret (eliminated by PKCE).

---

## Project Location

**Project Root**: 
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.01.cli-cloud-auth-pkce
```

---

## Essential Files

### 📋 Tasks (Check current progress here)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.01.cli-cloud-auth-pkce/tasks.md
```
All tasks are tracked in this single file. Check status and continue where you left off.

### 📖 Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.01.cli-cloud-auth-pkce/README.md
```
Project overview, goals, and success criteria.

### 📝 Quick Notes (contains full architectural analysis)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.01.cli-cloud-auth-pkce/notes.md
```
Auth flow diagram, config model mapping, files-to-port reference table, and design decisions.

### 📂 Code to Port From (Cloud CLI)
```
/Users/suresh/scm/github.com/stigmer/stigmer-cloud/client-apps/cli/internal/cli/auth/
/Users/suresh/scm/github.com/stigmer/stigmer-cloud/client-apps/cli/cmd/stigmer/auth.go
```

### 📂 Target Codebase (OSS CLI)
```
/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli/
```

---

## Resume Checklist

When starting a new session, quickly review:

1. [ ] Open `tasks.md` and check current task status
2. [ ] Review any recent notes in `notes.md`
3. [ ] Continue with the current task or move to next

That's it! No complex structure - just focused work.

---

## Current Status

**Last Updated**: 2026-03-14  
**Status**: In-progress — Tasks 1-3 complete, Tasks 4-5 remaining  
**Current Focus**: Task 4 — Delete auth from cloud CLI

### Session Progress (2026-03-14, Session 3)
- Completed Task 3: Cloud backend auth fully wired
- Discovered streaming auth gap: `WithUnaryInterceptor` only covers unary RPCs, but `stigmer run` uses server-streaming (20+ `run_stream_*.go` files). Switched to `grpc.WithPerRPCCredentials` which handles both
- Added `tokenAuth` struct and `resolveCloudToken()` to `backend/client.go`
- Token resolution: `STIGMER_API_KEY` env var > `backend.cloud.token` from config
- Added `--api-key` persistent flag to root command (propagates to `STIGMER_API_KEY` env var)
- Removed dead `authInterceptor` and `addAuthHeader` methods
- All checks pass: `go build ./...`, `go vet ./...`, help output correct

### Key Decisions Made (Session 3)
- `PerRPCCredentials` over unary interceptor — works for all RPC types (unary + streaming)
- No auto-login on missing auth — clear error message instead (safer for CI/CD, no surprising browser launches)
- Eager token resolution at `NewClient` time, not per-RPC (simpler, matches cloud CLI)
- `tokenAuth` duplication accepted between `auth/whoami.go` and `backend/client.go` (avoids circular deps)
- Cloud config auto-initialized to empty struct if nil (supports env-var-only auth where no cloud config exists in YAML)

### Context for Resume
- Tasks 1-3 are committed. The auth pipeline (PKCE login → token storage → gRPC bearer token) is fully functional in the OSS CLI.
- Task 4 involves **deleting** auth code from `stigmer-cloud/client-apps/cli/`. Those files served as reference for porting and are no longer needed.
- Task 5 is integration testing — verify the full flow: `stigmer config backend set cloud` → `stigmer auth login` → any gRPC command works against cloud backend.
- No blockers. The remaining work is cleanup (Task 4) and verification (Task 5).

### Next Steps
1. **Task 4**: Delete auth from cloud CLI — remove `stigmer-cloud/client-apps/cli/internal/cli/auth/` and the auth command wiring in `cmd/stigmer/auth.go`
2. **Task 5**: Integration testing — end-to-end cloud auth verification

---

## Quick Commands

After loading this file into chat, you can say:

- **"Show current status"** - Get overview of all tasks and progress
- **"Continue with current task"** - Resume work on in-progress task
- **"What's next?"** - Move to next task
- **"Update task X to done"** - Mark a task complete
- **"Add a note"** - Capture a quick learning or decision
- **"Complete project"** - Final wrap-up when all tasks done

---

## Framework Benefits

Even with minimal overhead, you still get:
- ✅ Clear goal and structured tasks
- ✅ Progress tracking
- ✅ Context persistence across sessions
- ✅ Learning capture
- ✅ Quick resume (via this file!)

---

*Quick Project Framework: Minimal overhead, maximum focus. When structure helps, not hinders.*

