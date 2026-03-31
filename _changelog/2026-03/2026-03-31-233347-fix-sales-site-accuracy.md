# Fix Sales Site Accuracy — CTA URLs, Approval Snippet, Demo Copy, SDK Code

**Date**: March 31, 2026

## Summary

Four accuracy fixes to the stigmer.ai sales site, all caught during a post-implementation review. Each fix removes misleading content and replaces it with honest representations of the actual platform: real CTA URLs, accurate approval semantics, clearer demo copy, and SDK code that matches the real SDKs.

## Problem Statement

The Phase 2 sales website implementation contained several pieces of content that didn't accurately represent the product. While individually minor, together they could erode developer trust — especially for a platform that positions itself on transparency and open source.

### Pain Points

- **Sign In/Sign Up CTAs** pointed to placeholder `cloud.stigmer.ai` URLs instead of the real app
- **Hero code preview** showed `require: merchant` in the approval config, implying role-based approval routing that doesn't exist — Stigmer approvals are binary per-tool
- **Demo Story headline** ("You called the API. It worked for a demo.") was cryptic and didn't clearly communicate the pain point
- **Final CTA SDK snippets** showed fabricated package names, fake import paths, and invented API methods — none of which matched the actual TypeScript, Go, Python, or Java SDKs
- **Java SDK tab** was missing entirely despite being listed in the IA and stats bar

## Solution

Reviewed each issue against the actual codebase (proto definitions for approvals, SDK source for code snippets) and replaced all misleading content with accurate representations.

## Implementation Details

- **CTA URLs**: Updated `cloudSignupUrl` and `cloudSigninUrl` in `constants.ts` to `https://app.stigmer.ai`
- **Approval snippet**: Simplified from `tool: process-refund / require: merchant` to a plain list item `- process-refund`, matching the actual `requires_approval: bool` per-tool model in `spec.proto`
- **Demo Story headline**: Changed from "You called the API. It worked for a demo." to "You added AI. It doesn't know your business." — immediately understandable without prior context
- **SDK snippets**: Replaced all 3 tabs with real code from the actual SDKs (`sdk/typescript/`, `sdk/go/`, `sdk/python/`, `sdk/java/`), using real package names, real constructors, and real `agentExecution.create()` method signatures
- **Java tab**: Added as 4th SDK tab with real `StigmerClient.builder()` + `AgentExecutionInput.builder()` pattern

## Benefits

- Every code snippet on the sales site now matches what a developer would actually write
- CTAs route to the real application
- No misleading feature claims (role-based approvals)
- Java developers see their SDK represented alongside the other three

## Impact

- Developers who copy SDK code from the site will get working examples
- Trust signal: the website demonstrates the same transparency the platform claims

## Related Work

- Phase 2 sales website implementation (this fixes post-implementation review items)
- `apis/ai/stigmer/agentic/agent/v1/spec.proto` — source of truth for approval model
- `sdk/typescript/`, `sdk/go/`, `sdk/python/`, `sdk/java/` — source of truth for SDK APIs

---

**Status**: Production Ready
**Files Changed**: 2 (`constants.ts`, `FinalCTA.tsx`, `Hero.tsx`, `DemoStory.tsx`)
