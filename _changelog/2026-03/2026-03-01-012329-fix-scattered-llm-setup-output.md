# Fix Scattered LLM Setup Failure Output During Server Startup

**Date**: March 1, 2026

## Summary

Fixed a terminal rendering issue where the "Configure an LLM provider" help text was garbled during `stigmer server` startup. The root cause was raw `fmt.Fprintln` calls writing to stderr while the BubbleTea progress display still owned the terminal. Also cleaned up the failure messaging to guide users to `stigmer server setup` instead of dumping all three provider options inline.

## Problem Statement

When running `stigmer server` with Ollama configured but not installed, the server startup displayed scattered, misaligned text in the terminal.

### Pain Points

- The "Configure an LLM provider" options block (Anthropic, OpenAI, Ollama) was rendered with broken alignment, making it unreadable
- Raw `fmt.Fprintln(os.Stderr)` calls in `daemon.go` conflicted with the active BubbleTea progress display that controls cursor positioning
- The failure message dumped all three provider options inline rather than directing users to the interactive setup wizard

## Solution

Deferred LLM setup failure messaging from the daemon layer to the CLI command layer, ensuring messages are only displayed after the progress display has stopped and released the terminal.

## Implementation Details

- Added `OnLLMSetupFailed` callback field to `StartOptions` in `daemon.go`
- Replaced 15 lines of inline `fmt.Fprintln` and `climsg.Warning` calls in `daemon.go` with a single callback invocation
- In `server.go`, the callback captures the error, and messages are displayed after `progress.Stop()` completes
- Simplified the failure message to three concise lines directing users to `stigmer server setup`

## Benefits

- Clean, properly aligned terminal output when LLM setup fails
- No more conflict between stderr writes and BubbleTea progress display
- Users get a clear, actionable message instead of a wall of scattered option text

## Impact

Affects the `stigmer server` command startup flow when the configured LLM provider (currently Ollama) fails to initialize. No changes to the actual LLM setup logic or provider resolution.

## Related Work

- `stigmer server setup` interactive wizard for LLM provider configuration
- BubbleTea progress display in `cliprint` package

---

**Status**: ✅ Production Ready
