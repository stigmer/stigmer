# LLM Provider Auto-Detection and Startup UX Overhaul

**Date**: March 1, 2026

## Summary

Redesigned the Stigmer CLI server startup flow to auto-detect LLM providers from standard API key environment variables, eliminate contradictory messages during startup, and provide clear, validated status reporting. Users with `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` already set in their environment now get zero-touch configuration on first run.

## Problem Statement

The server startup flow produced contradictory and confusing output. When a user ran `stigmer server`, the CLI would immediately announce "Using Ollama (local LLM, no API key required)" before validating that Ollama was actually installed. Seconds later, it would report "LLM setup failed: Ollama is not installed" -- directly contradicting the earlier message.

### Pain Points

- **Contradictory messages**: "Using Ollama" followed by "Ollama is not installed" in the same startup sequence
- **Ignored environment variables**: Users with `ANTHROPIC_API_KEY` already set had to manually run `stigmer server setup` and select Anthropic -- the system never checked
- **Premature announcements**: Provider was announced before validation, creating a lie-then-correct pattern
- **Duplicate warnings**: "No LLM provider configured" was emitted from both `server.go` and `secrets.go`
- **Wizard ignored environment**: The first-run wizard presented an interactive menu without scanning for API keys that were already available
- **Ollama over-promoted**: Ollama was treated as a first-class default despite being the lowest quality option

## Solution

Introduced a three-layer approach: **detect, validate, announce**.

1. **Config layer auto-detection**: `ResolveLLMProvider()` now falls back to environment variable scanning (Anthropic > OpenAI) when no explicit provider is configured
2. **Wizard auto-detection**: First-run wizard scans for API keys before presenting the interactive menu, auto-configuring when keys are found
3. **Validate-then-announce pattern**: Server startup only reports the LLM provider after daemon startup validates it works

## Implementation Details

### Config Resolution Chain (`config.go`)

Added `DetectProviderFromAPIKeys()` as a pure environment scan (no I/O) and integrated it as the final fallback in `ResolveLLMProvider()`:

```
Priority 1: STIGMER_LLM_PROVIDER env var (explicit override)
Priority 2: Config file llm.provider (explicit user choice)
Priority 3: ANTHROPIC_API_KEY env var → "anthropic" (auto-detect)
Priority 4: OPENAI_API_KEY env var → "openai" (auto-detect)
Priority 5: "" (no provider)
```

Added `ResolveLLMProviderSource()` to provide human-readable provenance for UX messages (e.g., "from ANTHROPIC_API_KEY detected in environment").

Ollama is intentionally excluded from auto-detection -- it requires explicit opt-in because it's the lowest quality option and binary detection involves I/O.

### Wizard Redesign (`wizard.go`)

Split into two entry points:
- `RunWizard()` (first run): auto-detects API keys, auto-configures if found, skips interactive menu
- `RunWizardInteractive()` (`stigmer server setup`): always shows the interactive menu for explicit reconfiguration

Updated Ollama label from "requires separate install" to "lower quality output" for honest positioning.

### Server Startup Messaging (`server.go`)

Removed the premature "Using X" block that announced before validation. Added `displayLLMStatus()` called after daemon startup completes, with three clear cases:
- **Success**: Shows validated provider with source provenance
- **Failure**: Shows what failed and suggests alternatives detected in environment
- **No provider**: Guides user to set API keys or run setup

### Deduplication (`secrets.go`)

Removed duplicate "No LLM provider configured" warnings from `GatherRequiredSecrets()`. `server.go` now owns all user-facing LLM messaging.

### Post-Install Messages (`Makefile`, `release.cli.yaml`)

Updated to mention auto-detection behavior so users know they only need to export their API key.

### Test Coverage (`config_test.go`)

Added 13 new tests covering:
- `DetectProviderFromAPIKeys()` for each key, both keys, neither key
- `ResolveLLMProvider()` full fallback chain: explicit env > config > auto-detect > empty
- `ResolveLLMProviderSource()` for every source type

## Benefits

- **Zero-touch setup**: Users with API keys already in their environment get auto-configured on first run
- **No contradictory messages**: Provider is only announced after validation confirms it works
- **Clear failure guidance**: When a provider fails, the system detects alternatives and suggests them
- **Honest Ollama positioning**: Labeled as "lower quality output" instead of being silently promoted
- **Single messaging owner**: No more duplicate warnings from different code paths
- **Full test coverage**: All auto-detection paths verified with unit tests

## Impact

- **End users**: Dramatically improved first-run experience. Most developers already have `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in their shell profile -- Stigmer now respects that.
- **Existing configs**: Fully backward compatible. Explicit config file settings still take priority over auto-detection.
- **daemon.go / llm/setup.go**: Zero changes needed. They already call `ResolveLLMProvider()` which now auto-detects transparently.

## Related Work

- Builds on the LLM setup failure display fix (`8d751cea`)
- Complements the MCP credential auto-resolution feature (`bf57a093`)

---

**Status**: ✅ Production Ready
**Files Changed**: 7 (config.go, config_test.go, wizard.go, server.go, secrets.go, Makefile, release.cli.yaml)
