# Next Task: 20260412.02.mcp-marketplace-oauth-expansion

## 🎯 Quick Resume Instructions

**Simply drop this file into your conversation to quickly resume work on this project.**

All the context you need is right here with absolute paths to project files.

---

## Project Overview

**Name**: 20260412.02.mcp-marketplace-oauth-expansion  
**Description**: Add new MCP server integrations with verified OAuth/DCR support to the Stigmer marketplace, organized by wave priority. Each wave is a category that can be picked up independently.  
**Goal**: Expand the Stigmer MCP marketplace from 36 to 50+ servers by adding verified remote OAuth integrations one category at a time, with proper DCR verification and manual OAuthApp setup where needed.  
**Tech Stack**: YAML seedpack, Proto (reference)  
**Components**: seedpack/mcp-servers/, apis/ai/stigmer/agentic/mcpserver/v1/spec.proto

**Created**: 2026-04-12  
**Type**: ⚡ Quick Project (1-2 sessions)

---

## Project Location

**Project Root**: 
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.02.mcp-marketplace-oauth-expansion
```

---

## Essential Files

### 📋 Tasks (Check current progress here)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.02.mcp-marketplace-oauth-expansion/tasks.md
```
All tasks are tracked in this single file. Check status and continue where you left off.

### 📖 Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.02.mcp-marketplace-oauth-expansion/README.md
```
Project overview, goals, and success criteria.

### 📝 Quick Notes
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.02.mcp-marketplace-oauth-expansion/notes.md
```
Important decisions, learnings, and gotchas captured during development.

---

## Resume Checklist

When starting a new session, quickly review:

1. [ ] Open `tasks.md` and check current task status
2. [ ] Review any recent notes in `notes.md`
3. [ ] Continue with the current task or move to next

That's it! No complex structure - just focused work.

---

## Current Status

**Last Updated**: 2026-04-12  
**Status**: In Progress (T01+T02 complete, 4 tasks remaining)  
**Current Focus**: No task in progress — pick next from T03-T06

## Session Progress (2026-04-12, session 2)

- Completed T02 Wave-1b: upgraded Stripe and Cloudflare from stdio to remote HTTP with DCR-verified OAuth
- Both endpoints live-verified before YAML changes: OAuth metadata, DCR registration (got client_ids), and MCP endpoint connectivity
- Stripe: `https://mcp.stripe.com/` (Streamable HTTP, issuer at `access.stripe.com/mcp`)
- Cloudflare: `https://mcp.cloudflare.com/mcp` (returns 401 with proper WWW-Authenticate, resource_name: "Cloudflare API MCP Server")

### Key Decisions Made (T02)
- Single env var pattern: `STRIPE_ACCESS_TOKEN` replaces `STRIPE_SECRET_KEY`, `CLOUDFLARE_ACCESS_TOKEN` replaces `CLOUDFLARE_API_TOKEN` — no dead env var declarations
- Dropped `CLOUDFLARE_ACCOUNT_ID`: the new remote endpoint handles account context via OAuth
- Cloudflare `repository_url` updated from `cloudflare/mcp-server-cloudflare` to `cloudflare/mcp` (new first-party repo)

### Previous Session (2026-04-12, session 1)
- Completed T01 Wave-1a: added 9 DCR-verified MCP servers (PayPal, Square, Intercom, Attio, monday.com, Contentful, Buildkite, Webflow, Datadog)
- Marketplace expanded from 36 to 45 servers
- Committed: `bc4c754c0` on branch `feat/mcp-oauth-expansion`

## Next Steps
1. **T05 (~30 min)**: Add 4 API-key-only servers (HubSpot, BigQuery, Brevo, PagerDuty)
2. **T06 (~30 min)**: Audit Atlassian and GitLab DCR status
3. **T03 (~2 hrs)**: Verify and add 11 unverified DCR servers
4. **T04 (~3-4 hrs)**: Add 8 no-DCR vendor OAuth servers (manual registration)

## Context for Resume
- Branch: `feat/mcp-oauth-expansion`
- Uncommitted backend changes exist (setup.py, config_transformer.py, create_execution_context_step.go) — these are unrelated to T02 and were not committed with this task

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

