---
name: LLM Provider Detection UX
overview: Redesign the server startup and LLM provider detection to auto-detect providers from environment variables, validate before announcing, and eliminate contradictory messages -- creating a seamless first-run and restart experience.
todos:
  - id: config-autodetect
    content: Add DetectProviderFromAPIKeys() and ResolveLLMProviderSource() to config.go, update ResolveLLMProvider() fallback chain
    status: completed
  - id: config-tests
    content: Add tests for auto-detection logic in config_test.go
    status: completed
  - id: wizard-redesign
    content: Redesign wizard.go RunWizard() to auto-detect environment API keys before showing interactive menu
    status: completed
  - id: server-messaging
    content: "Restructure server.go to validate-then-announce: remove premature Using X, move messaging after daemon start"
    status: completed
  - id: secrets-dedup
    content: Remove duplicate warning messages from secrets.go GatherRequiredSecrets()
    status: completed
  - id: postinstall-msg
    content: Update Makefile and Homebrew caveats to mention auto-detection
    status: completed
  - id: integration-test
    content: "Manual end-to-end test: fresh install with ANTHROPIC_API_KEY set, verify auto-detection works"
    status: completed
isProject: false
---

# LLM Provider Auto-Detection and Startup UX Overhaul

## Problem Summary

The current flow produces contradictory messages ("Using Ollama" then "Ollama not installed") and ignores readily available API keys in the environment. A user with `ANTHROPIC_API_KEY` already set had to manually run `stigmer server setup` and select Anthropic -- the system should have detected and used it automatically.

## Design Principles

1. **Detect, then validate, then announce** -- never say "Using X" until X is confirmed working
2. **Environment awareness** -- respect standard API key env vars as implicit provider selection
3. **Anthropic > OpenAI > Ollama** -- quality-ordered priority when auto-detecting
4. **Explicit config is sacred** -- auto-detection is a fallback, never overrides explicit user choice
5. **Single source of truth** -- each message has one owner; no duplicate warnings

## Architecture Decision: Where Auto-Detection Lives

Auto-detection goes into `ResolveLLMProvider()` as the **final fallback** in the resolution chain:

```
Priority 1: STIGMER_LLM_PROVIDER env var (explicit override)
Priority 2: Config file llm.provider (explicit choice)
Priority 3: ANTHROPIC_API_KEY env var -> "anthropic" (auto-detect)
Priority 4: OPENAI_API_KEY env var -> "openai" (auto-detect)
Priority 5: "" (no provider)
```

Ollama is intentionally excluded from auto-detection. It requires explicit opt-in because: (a) it's the lowest quality option, (b) binary/server detection involves I/O, and (c) it should not be the silent default.

This means ALL callers of `ResolveLLMProvider()` benefit from auto-detection transparently. No code changes needed in daemon.go or other consumers.

## Changes by File

### 1. `[config.go](client-apps/cli/internal/cli/config/config.go)` -- Add auto-detection fallback

**Add** `DetectProviderFromAPIKeys()` as a package-level function:

- Checks `ANTHROPIC_API_KEY` -> returns "anthropic"
- Checks `OPENAI_API_KEY` -> returns "openai"  
- Returns "" if neither found
- Pure env var check, no I/O, cheap to call

**Modify** `ResolveLLMProvider()` to call `DetectProviderFromAPIKeys()` as the final fallback before returning "".

**Add** `ResolveLLMProviderSource()` method on `LocalBackendConfig` that returns a human-readable string describing WHERE the provider came from:

- `"STIGMER_LLM_PROVIDER environment variable"`
- `"configuration file"`
- `"ANTHROPIC_API_KEY detected in environment"` 
- `"OPENAI_API_KEY detected in environment"`
- `""` (no provider)

This enables server.go to show clear provenance in messages.

### 2. `[wizard.go](client-apps/cli/internal/cli/setup/wizard.go)` -- Auto-detect before asking

**Redesign** `RunWizard()` to scan environment FIRST:

```
Scanning environment for LLM providers...

If ANTHROPIC_API_KEY found:
  ✓ Detected ANTHROPIC_API_KEY in your environment
  ✓ Configured Anthropic (model: claude-sonnet-4.5)
  
  To use a different provider, run: stigmer server setup

If OPENAI_API_KEY found (no ANTHROPIC):
  ✓ Detected OPENAI_API_KEY in your environment
  ✓ Configured OpenAI (model: gpt-4)

If neither found:
  No LLM API keys found in environment.

  Choose your LLM provider (required for agent execution):
    [1] Anthropic  — Cloud API, best quality (requires API key)
    [2] OpenAI     — Cloud API (requires API key)
    [3] Ollama     — Free, local, offline (lower quality output)
    [4] Skip       — Configure later (agents won't execute)

  Select [1-4]:
```

Key changes:

- Auto-detection phase runs before any interactive prompts
- If API key detected, auto-configure and return (no menu shown)
- Ollama label changes from "requires separate install" to "lower quality output" -- honest about the tradeoff
- `configureAnthropic()` / `configureOpenAI()` unchanged (still used when user explicitly selects them)

### 3. `[server.go](client-apps/cli/cmd/stigmer/root/server.go)` -- Validate before announce

**Remove** the premature "Using X" block (lines 137-145). This block announces the provider before validation.

**Move** provider messaging to AFTER `daemon.StartWithOptions()` completes, split into two cases:

**Case A: LLM setup succeeded (no llmSetupErr)**

```
✓ Using Anthropic (model: claude-sonnet-4.5) [from ANTHROPIC_API_KEY in environment]
```

**Case B: LLM setup failed (llmSetupErr != nil)**

```
⚠ LLM provider 'ollama' is not available: Ollama is not installed
```

Then check for available alternatives:

```
ℹ Detected ANTHROPIC_API_KEY in your environment.
ℹ Run 'stigmer server setup' to switch to Anthropic.
```

Or if no alternatives:

```
ℹ Run 'stigmer server setup' to configure an LLM provider.
```

**Case C: No provider configured at all**

```
⚠ No LLM provider configured. Agents will not execute.
ℹ Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment, then restart.
ℹ Or run 'stigmer server setup' to configure interactively.
```

Note: With auto-detection in `ResolveLLMProvider()`, Case C should rarely happen (only when no API keys exist and user skipped wizard).

### 4. `[secrets.go](client-apps/cli/internal/cli/daemon/secrets.go)` -- Remove duplicate warnings

**Remove** the duplicate "No LLM provider configured" warnings in `GatherRequiredSecrets()` (lines 91-93). Server.go owns all user-facing messaging. `GatherRequiredSecrets()` should silently return an empty map for the `""` case.

### 5. `[config_test.go](client-apps/cli/internal/cli/config/config_test.go)` -- Test auto-detection

Add tests for:

- `DetectProviderFromAPIKeys()` with ANTHROPIC_API_KEY set
- `DetectProviderFromAPIKeys()` with OPENAI_API_KEY set  
- `DetectProviderFromAPIKeys()` with both set (Anthropic wins)
- `DetectProviderFromAPIKeys()` with neither set
- `ResolveLLMProvider()` fallback chain: explicit > config > auto-detect
- `ResolveLLMProviderSource()` returns correct source strings

### 6. `[Makefile](Makefile)` (lines 114-121) -- Update post-install message

Update to mention auto-detection:

```
stigmer server will auto-detect API keys from your environment.

  Option 1 (recommended):  export ANTHROPIC_API_KEY=sk-ant-...
  Option 2:                 export OPENAI_API_KEY=sk-...
  Option 3 (local, lower quality): brew install ollama && ollama serve

Then run:  stigmer server
```

### 7. `[.github/workflows/release.cli.yaml](.github/workflows/release.cli.yaml)` -- Update Homebrew caveats

Mirror the Makefile message update in the Homebrew `caveats` block (lines 508-518).

## What This Does NOT Change

- **daemon.go** -- No changes needed. It already calls `ResolveLLMProvider()` which will now auto-detect. The `OnLLMSetupFailed` callback mechanism stays as-is.
- **llm/setup.go** -- No changes. Ollama setup logic remains the same; only the announcement timing changes.
- **Config file format** -- No schema changes. Backward compatible.
- **Provider priority when config exists** -- If config says "ollama", that's respected. Auto-detection only kicks in when no provider is explicitly configured.

## Open Question for Discussion

When the configured provider fails (e.g., config says "ollama" but it's not installed) AND an API key is detected in the environment: should the server **auto-switch** to the detected provider, or just **inform** the user and leave the server in a degraded state?

My recommendation: **Inform only, don't auto-switch.** Reason: the user may have deliberately chosen Ollama to avoid API costs. Auto-switching to a paid API would violate that intent. The user can run `stigmer server setup` to switch explicitly.

If you prefer auto-switching, I can adjust the plan -- but I want to flag the tradeoff.