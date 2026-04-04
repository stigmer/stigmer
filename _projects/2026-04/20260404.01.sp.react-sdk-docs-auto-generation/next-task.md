# Next Task: 20260404.01.sp.react-sdk-docs-auto-generation

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: 20260403.03.sdk-docs-auto-generation
- **Overall Objective**: [1-2 sentences]
- **What's Been Completed**: [Key milestones]
- **What's Pending**: [Remaining work]
- **Agreed Focus for This Session**: [From previous session]
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: 20260403.03.sdk-docs-auto-generation
**Parent Next Task**: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/next-task.md`
**Spawned From Task**: T06

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/design-decisions/`
- Parent Coding Guidelines: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/coding-guidelines/`
- Parent Wrong Assumptions: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/wrong-assumptions/`
- Parent Don't Dos: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/dont-dos/`

---

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this sub-project.

## Sub-Project: 20260404.01.sp.react-sdk-docs-auto-generation

**Description**: Build a TypeDoc-based auto-generation pipeline for React SDK (@stigmer/react) reference documentation, producing always-in-sync Fumadocs MDX pages from TSDoc comments in the source code.
**Goal**: Auto-generate per-domain reference pages (hooks, components, props) for the React SDK's 61+ hooks and 55+ components, integrated into make gen-sdk-docs, so every code change automatically updates the docs.
**Tech Stack**: Go (codegen generator), TypeScript (site scripts), MDX (Fumadocs docs), Protobuf (source of truth)
**Components**: tools/codegen/generator/, docs/sdk/, site/scripts/, apis/ (proto comments), Makefile, docs/meta.json

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-04 14:28
**Current Task**: T02 (TSDoc coverage audit + writing guidelines)
**Status**: T01 COMPLETE, T02 next

### T01 Results (TypeDoc setup + proof of concept)
TypeDoc 0.28.18 is configured and producing JSON. Key findings:
- 354 exports captured (159 functions, 159 interfaces, 29 type aliases, 7 variables)
- 57.6% overall TSDoc coverage; functions at 98.7%, interfaces at 20.1%
- Domain grouping via source paths is reliable (18 domains detected)
- @example blocks present on 116 exports
- Re-exported external types excluded (link to proto docs instead)
- See tasks/T01_1_execution.md for full analysis

### Context from Parent T06
The hand-written React SDK overview page (`docs/sdk/react.mdx`) is complete.
This is Layer 1 from the sub-project plan. The page documents 67 hooks and
59 components across 16 domains, with a domain quick-reference table. It
does NOT list individual hook signatures or component props -- that is
Layer 2, which this sub-project will produce via TypeDoc auto-generation.

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
