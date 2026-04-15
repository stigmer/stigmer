# @stigmer/ink — Terminal SDK Package for Ink (React for CLIs)

**Date**: April 15, 2026

## Summary

Created `@stigmer/ink`, a new SDK package that provides Ink (React for terminals) components for rendering Stigmer agent sessions, message threads, tool calls, and HITL approvals in the terminal. This package reuses the headless hooks from `@stigmer/react` and renders terminal-native UI via Ink primitives, enabling platform builders to embed Stigmer agent experiences in their own Node.js CLIs.

## Problem Statement

Stigmer's SDK hierarchy (`@stigmer/sdk` → `@stigmer/react`) only supported browser-based rendering. Platform builders who wanted to integrate Stigmer agent sessions into Node.js CLI tools had no SDK path — they would need to build terminal rendering from scratch.

### Pain Points

- No terminal SDK: platform builders with Node.js CLIs could not drop in Stigmer components
- `@stigmer/sdk` transport was hardcoded to `@connectrpc/connect-web` (browser-only); Node.js consumers had no way to use native HTTP/2
- `@stigmer/react` hooks (useSessionConversation, useExecutionStream) worked in Ink environments, but there were no terminal components to pair with them
- The Go CLI's 37K-line Bubble Tea rendering layer was the only terminal rendering path, tightly coupled to the Go binary

## Solution

Built `@stigmer/ink` as a peer to `@stigmer/react` in the SDK hierarchy. Both consume the same data/behavior hooks; the difference is the rendering target (terminal vs DOM). Added `customTransport` support to `@stigmer/sdk` so Node.js consumers can inject `@connectrpc/connect-node`.

## Implementation Details

### @stigmer/sdk changes (backward-compatible)

- Added `customTransport?: Transport` to `StigmerConfig` — when provided, the `Stigmer` constructor uses it directly instead of creating a browser transport
- Auth validation relaxed when custom transport is provided (caller handles auth interceptors)
- Added `DeploymentModeContext` export to `@stigmer/react` barrel (needed by InkStigmerProvider)

### @stigmer/ink package (sdk/ink/)

**Infrastructure:**
- Package scaffolding mirroring `@stigmer/react` patterns (package.json, tsconfig, vitest)
- Registered in root workspaces, build:libs, clean:libs, test scripts, and publish-libs.mjs PACKAGES array
- Type declaration for marked-terminal (no @types package exists)

**Core modules:**
- `transport.ts` — `createNodeClient()` + `createNodeTransport()` with auth interceptor over native HTTP/2
- `provider.tsx` — `InkStigmerProvider` providing same React contexts as StigmerProvider without the DOM `<div>` wrapper
- `markdown.ts` — `renderMarkdown()` using marked + marked-terminal for ANSI-styled terminal markdown

**8 terminal components:**
- `MessageEntry` — human/AI/system messages with terminal markdown
- `MessageThread` — full thread from execution snapshots using Ink `<Static>` for history
- `ToolCallItem` — single tool call with status indicator and expandable args/result
- `ToolCallGroup` — collapsible group with aggregate status and keyboard toggle
- `ApprovalPrompt` — HITL approval with arrow-key navigation and y/n/s shortcuts
- `ExecutionProgress` — phase badge with ink-spinner for active phases
- `FollowUpInput` — text input via ink-text-input for follow-up messages
- `UsageWidget` — compact token/cost summary using useSessionUsage hook

**Composed views:**
- `SessionView` — full conversation view composing hooks + components
- `SessionApp` — self-contained top-level app (creates client, wraps provider)

**Standalone CLI:**
- `bin/stigmer-ink.tsx` — entry point supporting `--session`, `--org`, `--base-url`, `--api-key` flags and stdin JSON

### CI/CD

Publishing is fully automated. Adding `sdk/ink` to the PACKAGES array in `publish-libs.mjs` and to the root workspace/build scripts is all that's needed — the existing `release.npm-libs.yaml` workflow picks it up automatically.

## Benefits

- **Platform builders get terminal rendering**: Drop-in components for embedding Stigmer sessions in Node.js CLIs
- **Hook reuse**: All `@stigmer/react` hooks work identically in Ink — zero reimplementation
- **Node.js transport**: `customTransport` on `@stigmer/sdk` unlocks server-side and CLI usage beyond Ink
- **Standalone CLI**: `npx @stigmer/ink` provides an immediate way to view sessions from the terminal
- **Small package**: 36.6 kB published size, 15 source files

## Impact

- **SDK consumers**: New integration surface for Node.js CLI builders
- **@stigmer/sdk**: Non-breaking addition of `customTransport` benefits all Node.js consumers
- **@stigmer/react**: Non-breaking addition of `DeploymentModeContext` export
- **CI/CD**: No workflow changes — existing pipeline automatically publishes the new package

## Related Work

- T01–T03 of the CLI modernization project (apply gaps, connect rename, MCP OAuth)
- Future Phase 2: evaluating Go CLI integration via shell-out to Ink renderer

---

**Status**: ✅ Production Ready
**Timeline**: T04 of CLI Modernization project (20260415.01)
