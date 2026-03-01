# Fix Ollama Error Display and LLM Provider Guidance

**Date**: February 28, 2026

## Summary

Fixed garbled terminal output when Ollama is not installed during `stigmer server` startup, and added consistent LLM provider prerequisite messaging across all installation paths (CLI runtime, `make release-local`, and Homebrew). Anthropic and OpenAI are now presented as primary alternatives alongside Ollama, matching the README's provider ordering.

## Problem Statement

When a user ran `stigmer server` without Ollama installed, the terminal displayed garbled, unreadable installation instructions. Additionally, the error recovery messaging only suggested reinstalling Ollama, without mentioning Anthropic or OpenAI as alternatives.

### Pain Points

- The Ollama "not installed" error embedded multi-line text with `\n` newlines inside a `fmt.Errorf()` return value. When `daemon.go` printed it via `climsg.Warning("Ollama setup failed: %v", err)`, only the first line received the warning prefix — subsequent lines rendered as raw, unformatted text scattered across the terminal.
- Recovery messaging was Ollama-centric: only "reinstall Ollama" was suggested, with no mention of cloud providers (Anthropic, OpenAI) as alternatives.
- No prerequisite information was shown after `make release-local` or `brew install stigmer`, leaving users unaware they needed to configure an LLM provider before running the server.

## Solution

Three-part fix: clean up the error formatting, rewrite the recovery message to present all three providers, and add post-install guidance at every installation entry point.

## Implementation Details

### 1. Single-line error in `llm/setup.go`

Replaced the multi-line `fmt.Errorf()` (which contained embedded `\n` characters causing garbled output) with a clean single-line error message. The display formatting responsibility moved to the caller in `daemon.go`.

**File**: `client-apps/cli/internal/cli/llm/setup.go`

### 2. Provider-aware recovery in `daemon.go`

Rewrote the Ollama failure handler to show all three LLM providers in priority order (Anthropic recommended, OpenAI, then Ollama) using direct `fmt.Fprintln(os.Stderr, ...)` calls that each render on their own line with proper indentation.

**File**: `client-apps/cli/internal/cli/daemon/daemon.go`

### 3. Post-install prerequisites in Makefile

Added a prerequisite banner after `make release-local` completes, showing all three provider options with setup commands.

**File**: `Makefile`

### 4. Homebrew caveats in release workflow

Added a `def caveats` block to the generated Homebrew formula so that `brew install stigmer/tap/stigmer` displays LLM provider setup instructions post-install.

**File**: `.github/workflows/release.cli.yaml`

## Benefits

- Terminal output is clean and readable when Ollama is missing
- Users immediately see Anthropic and OpenAI as alternatives, reducing friction for users who prefer cloud providers
- Consistent provider ordering (Anthropic → OpenAI → Ollama) across README, setup wizard, error messages, and post-install banners
- Post-install guidance at every entry point reduces "what do I do next?" confusion

## Impact

- **CLI users**: See clear, actionable guidance when Ollama setup fails during `stigmer server`
- **New users**: Get LLM prerequisite info immediately after installing via `make release-local` or `brew install`
- **Cloud-preferred users**: No longer funneled toward Ollama-only recovery paths

## Related Work

- Setup wizard in `client-apps/cli/internal/cli/setup/wizard.go` already presents providers in the correct order (Anthropic → OpenAI → Ollama → Skip)
- README section "2. Configure LLM Provider" already uses the same ordering

---

**Status**: ✅ Production Ready
