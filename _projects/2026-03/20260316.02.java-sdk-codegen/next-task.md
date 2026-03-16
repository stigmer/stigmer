# Next Task: 20260316.02.java-sdk-codegen

## 🎯 Quick Resume Instructions

**Simply drop this file into your conversation to quickly resume work on this project.**

All the context you need is right here with absolute paths to project files.

---

## Project Overview

**Name**: 20260316.02.java-sdk-codegen  
**Description**: Generate a Stripe-style Java SDK for all Stigmer API resources using the same codegen pipeline as the Go and TypeScript SDKs. Publish to Maven Central.  
**Goal**: Java SDK with Stripe-style API surface (StigmerClient → client.agents().create(input)) for all 17 resources, driven by the existing proto2schema + generator codegen pipeline, published as ai.stigmer:stigmer-java to Maven Central  
**Tech Stack**: Java 17+, gRPC-Java, Maven, Go codegen tooling, Buf, GitHub Actions  
**Components**: tools/codegen/generator (new sdk_client_java.go), sdk/java (Maven project), apis (Java proto stubs via buf.gen.java.yaml), .github/workflows (Maven publishing)

**Created**: 2026-03-16  
**Type**: ⚡ Quick Project (1-2 sessions)

---

## Project Location

**Project Root**: 
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.02.java-sdk-codegen
```

---

## Essential Files

### 📋 Tasks (Check current progress here)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.02.java-sdk-codegen/tasks.md
```
All tasks are tracked in this single file. Check status and continue where you left off.

### 📖 Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.02.java-sdk-codegen/README.md
```
Project overview, goals, and success criteria.

### 📝 Quick Notes
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.02.java-sdk-codegen/notes.md
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

**Last Updated**: 2026-03-16 12:39 — Task 1 complete, ready for Task 2
**Current Focus**: Task 2 (Create sdk_client_java.go codegen) is next

---

## Context for Resume

### Codegen Pipeline Architecture

The Java SDK reuses the same two-stage codegen pipeline as Go and TypeScript:

1. **Stage 1 (shared)**: `proto2schema` extracts service schemas from proto definitions → JSON at `tools/codegen/schemas/`
2. **Stage 2 (per-language)**: Generator reads JSON schemas → emits language-specific SDK code
   - Go: `tools/codegen/generator/sdk_client.go` → `sdk/go/internal/gen/`
   - TS: `tools/codegen/generator/sdk_client_ts.go` → `sdk/typescript/src/gen/`
   - Java: `tools/codegen/generator/sdk_client_java.go` → `sdk/java/src/main/java/.../internal/gen/` (NEW)

### Existing Proto Stubs

- Go stubs: `apis/stubs/go/` (via `buf.gen.go.yaml`)
- Python stubs: `apis/stubs/python/` (via `buf.gen.python.yaml`)
- TypeScript stubs: `apis/stubs/ts/` (via `buf.gen.ts.yaml`)
- Java stubs: `apis/stubs/java/src/main/java/` (via `buf.gen.java.yaml`) — 676 files, compiles cleanly

### Resources Covered (17 total)

| Namespace | Resources |
|-----------|-----------|
| Agentic | agent, agentexecution, agentinstance, environment, executioncontext, mcpserver, session, skill, workflow, workflowexecution, workflowinstance |
| IAM | apikey, iampolicy, identityaccount, identityprovider |
| Tenancy | organization, project |

### Predecessor Changelogs

For full context on the Go SDK design decisions:
- `_changelog/2026-03/2026-03-16-112653-go-sdk-stripe-style-restructure.md`
- `_changelog/2026-03/2026-03-16-115418-go-sdk-all-resource-codegen.md`

### Java SDK Target API Surface

```java
StigmerClient client = StigmerClient.builder("sk_live_abc123").build();
Agent agent = client.agents().create(AgentInput.builder()
    .name("my-agent").org("my-org").build());
client.agentExecutions().subscribe(executionId);  // streaming
client.close();
```

---

## Quick Commands

After loading this file into chat, you can say:

- **"Continue with Task 2"** — Start Java SDK codegen (sdk_client_java.go)
- **"Show current status"** — Get overview of all tasks and progress
- **"What's next?"** — Move to next task

---

*Quick Project Framework: Minimal overhead, maximum focus.*

