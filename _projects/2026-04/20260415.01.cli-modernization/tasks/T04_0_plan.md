# Task T04: `@stigmer/ink` Package and `run`/`resume` Rewrite

**Created**: 2026-04-15
**Status**: PENDING (depends on T03)
**Type**: Feature Development

## Objective

Create a new `@stigmer/ink` package that provides Ink-based (React for terminals) components for rendering agent sessions, message threads, tool calls, and approvals in the terminal. Then wire it into the Go CLI for `run` and `resume` commands.

## Background

The current `run`/`resume` rendering uses Go + Bubble Tea + Lip Gloss + Glamour. This works but means maintaining two completely separate UI codebases for the same concepts (message threads, tool calls, approvals).

Ink is a React renderer for CLIs. Since `@stigmer/react` hooks (like `useSessionConversation`, `useExecutionStream`) use standard React primitives (`useState`, `useEffect`) without DOM APIs, they work directly in an Ink context. Only the visual components need terminal-specific implementations.

## Part 1: Create `sdk/ink/` Package

### Workspace setup
1. Create `sdk/ink/` directory
2. Add `"sdk/ink"` to root `package.json` workspaces array
3. Add to `scripts/publish-libs.mjs` PACKAGES array
4. Add to `build:libs` script ordering (after `@stigmer/react`)

### Package configuration
- `package.json` with name `@stigmer/ink`, version `0.0.0-dev`
- Peer deps: `react`, `ink`, `@stigmer/sdk`, `@stigmer/protos`, `@bufbuild/protobuf`
- Deps: `@stigmer/react` (for hooks), `ink-markdown` or custom terminal markdown renderer
- `tsconfig.json` targeting Node (no `dom` in lib), `jsx: react-jsx`
- `tsconfig.build.json` with `outDir: dist`, `rootDir: src`
- `publishConfig` with dist paths (same pattern as `@stigmer/react`)

## Part 2: Build Ink Terminal Components

### Core components (importing hooks from `@stigmer/react`)

| Component | React DOM equivalent | What it renders |
|-----------|---------------------|-----------------|
| `InkMessageThread` | `MessageThread` | Scrollable message list with AI/human/system messages |
| `InkMessageEntry` | `MessageEntry` | Single message with terminal markdown rendering |
| `InkToolCallGroup` | `ToolCallGroup` | Compact/expanded tool call display |
| `InkToolCallItem` | `ToolCallItem` | Single tool call with args preview |
| `InkApprovalPrompt` | `ApprovalCard` | Human-in-the-loop approval with keyboard input |
| `InkExecutionProgress` | `ExecutionProgress` | Spinner + phase badge |
| `InkFollowUpInput` | `FollowUpInput` | Text input for follow-up messages |
| `InkUsageWidget` | `UsageWidget` | Token/cost summary |

### App entry point
`InkSessionApp` — top-level Ink component that:
1. Takes session ID, org, auth token as props
2. Uses `useSessionConversation` from `@stigmer/react`
3. Renders `InkMessageThread` + `InkFollowUpInput`
4. Handles approval callbacks
5. Manages terminal lifecycle (cleanup on exit)

### CLI entry script
`bin/stigmer-render.tsx` — Node entry point that:
1. Reads session context from CLI args or stdin (JSON)
2. Sets up `StigmerProvider` with transport config
3. Renders `InkSessionApp` via Ink's `render()`
4. Handles process signals (SIGINT, SIGTERM)

## Part 3: Bundle for Go CLI

### Build as standalone executable
Options (evaluate in order of preference):
1. **`bun compile`** — produces a single binary, fast startup, good Ink support
2. **`pkg` / `nexe`** — Node.js single binary (larger, but proven)
3. **esbuild bundle + system Node** — smallest, but requires Node.js on user machine

### Go CLI integration
Modify `cmd/stigmer/root/run_stream.go` and `resume_session.go`:

```
stigmer run my-agent
  -> Go: parse args, resolve org, authenticate, create session + execution
  -> Go: exec "stigmer-render" with JSON payload on stdin:
     { sessionId, org, token, backendUrl, executionId }
  -> Node/Ink: renders thread, handles follow-ups, sends approval responses
  -> On exit: Go CLI resumes control
```

### Graceful fallback
If the Ink renderer binary is not available (e.g., minimal install), fall back to the existing Bubble Tea rendering. This ensures backward compatibility.

## Part 4: Testing

- Unit tests for each Ink component (Ink provides `ink-testing-library`)
- Integration test: render a mock session with fixtures from `@stigmer/react/demo`
- E2E: manual testing of `stigmer run` -> Ink renderer -> follow-up -> approval cycle

## Files Created/Changed

### New (`sdk/ink/`)
- `sdk/ink/package.json`
- `sdk/ink/tsconfig.json`
- `sdk/ink/tsconfig.build.json`
- `sdk/ink/src/index.ts`
- `sdk/ink/src/components/InkMessageThread.tsx`
- `sdk/ink/src/components/InkMessageEntry.tsx`
- `sdk/ink/src/components/InkToolCallGroup.tsx`
- `sdk/ink/src/components/InkApprovalPrompt.tsx`
- `sdk/ink/src/components/InkExecutionProgress.tsx`
- `sdk/ink/src/components/InkFollowUpInput.tsx`
- `sdk/ink/src/components/InkUsageWidget.tsx`
- `sdk/ink/src/app/InkSessionApp.tsx`
- `sdk/ink/bin/stigmer-render.tsx`

### Modified
- `package.json` (root — workspaces)
- `scripts/publish-libs.mjs` (PACKAGES array)
- `client-apps/cli/cmd/stigmer/root/run_stream.go` (exec Ink renderer)
- `client-apps/cli/cmd/stigmer/root/resume_session.go` (exec Ink renderer)
- `.github/workflows/release.npm-libs.yaml` (if build step changes needed)
- `.github/workflows/release.cli.yaml` (bundle Ink binary alongside Go binary)

## Success Criteria

- [ ] `@stigmer/ink` package builds and passes tests
- [ ] `@stigmer/ink` is published alongside other SDK packages via existing CI
- [ ] `InkSessionApp` renders a session thread correctly in terminal
- [ ] `stigmer run my-agent` uses Ink renderer for thread display
- [ ] `stigmer resume ses-xxx` uses Ink renderer
- [ ] Follow-up messages work via `InkFollowUpInput`
- [ ] Approval prompts work via `InkApprovalPrompt`
- [ ] Graceful fallback to Bubble Tea when Ink binary not available
- [ ] Terminal markdown renders cleanly (headings, code blocks, lists, bold/italic)

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Ink/Go shell-out adds startup latency | Pre-warm with background process; bundle as compiled binary |
| `@stigmer/react` hooks assume browser transport | Verify ConnectRPC transport works in Node; SDK already supports it |
| Terminal markdown fidelity | Use `ink-markdown` or build on top of `marked-terminal`; accept minor differences |
| Binary size for bundled Node executable | Evaluate bun compile vs pkg; target <30MB |
