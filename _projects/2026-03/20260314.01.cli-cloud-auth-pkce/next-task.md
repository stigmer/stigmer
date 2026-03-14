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
**Status**: ✅ Complete — All tasks done  

### Session Progress (2026-03-14, Session 4)
- Completed Task 4: Ported API key CRUD to OSS CLI and removed entire cloud CLI
- Created `internal/cli/apikey/` domain package (get, list, delete, create, display)
- Wired into registry system (verb support for get/list/delete)
- Created standalone `stigmer apikey` command group (create + fingerprint subcommands)
- Deleted `stigmer-cloud/client-apps/cli/` entirely (~40 Go files)
- Removed CLI Makefile targets from `stigmer-cloud/Makefile`
- Verified client secret `haPGCQa...` is completely gone from stigmer-cloud repo
- Deleted outdated `FEATURE_COMPARISON.md` from OSS CLI
- Clean `go build ./...` and `go vet ./...`

### All Tasks Complete
- Task 1: ✅ Scaffold auth commands and PKCE config
- Task 2: ✅ Implement PKCE OAuth login flow
- Task 3: ✅ Wire auth into cloud backend connection
- Task 4: ✅ Port API key CRUD and remove cloud CLI entirely

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

