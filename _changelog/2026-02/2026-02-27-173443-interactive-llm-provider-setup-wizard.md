# Interactive LLM Provider Setup Wizard

**Date**: February 27, 2026

## Summary

Redesigned the first-run server experience to replace the hardcoded Ollama default with an interactive LLM provider setup wizard. Users now choose between Anthropic, OpenAI, Ollama, or skipping LLM configuration on first run. The server starts in degraded mode when no LLM is configured rather than crashing, and a new `stigmer server setup` subcommand enables reconfiguration at any time.

## Problem Statement

New users running `stigmer server` for the first time encountered a hard crash when Ollama was not installed, because the default config assumed Ollama and the auto-download mechanism was broken (returning 404 from GitHub releases). Cloud LLM providers (Anthropic, OpenAI) were buried deep in the README, making the simplest onboarding path — setting an API key — invisible to new users.

### Pain Points

- Default config hardcoded `provider: ollama`, crashing the server for users without Ollama
- Ollama auto-download from GitHub releases returned 404 (broken URL for `ollama-darwin`)
- README said the server listens on port `50051` when the actual port is `7234`
- No interactive provider selection — silent config creation with no user choice
- Anthropic and OpenAI were mentioned only in a buried "LLM Configuration" section
- No clear path to reconfigure LLM provider after initial setup

## Solution

Introduced an interactive first-run wizard, removed the Ollama default assumption, made LLM setup failure non-fatal, and added a dedicated `stigmer server setup` subcommand for reconfiguration. The README was rewritten to surface all three LLM providers equally in the Quick Start section.

## Implementation Details

### New: Interactive Setup Wizard (`setup/wizard.go`)

- Presents four choices: Anthropic (first), OpenAI, Ollama, Skip
- For cloud providers: checks env var first, then prompts for API key with masked input
- For Ollama: checks if installed/running, offers alternatives if not found
- For Skip: shows exact commands for later configuration including `stigmer server setup`
- Saves provider, model, and API key to `~/.stigmer/config.yaml`

### New: `stigmer server setup` Subcommand

- Re-runs the same wizard for reconfiguration
- Loads existing config and replaces only the LLM section
- If server is running, advises user to restart

### Changed: Default Config Has No LLM Provider

- `GetDefault()` no longer includes an LLM block
- `ResolveLLMProvider()` returns `""` instead of `"ollama"` as fallback
- `ResolveLLMModel()` and `ResolveLLMBaseURL()` return `""` for unknown providers

### Changed: LLM Setup Failure is Non-Fatal

- Ollama setup failure produces a warning, not a fatal error
- Server continues in degraded mode — agent execution fails at runtime with clear messaging
- Empty provider case skips LLM setup entirely with a warning

### Changed: Secret Gathering Checks Config File

- `GatherRequiredSecrets` now accepts `*config.LocalBackendConfig`
- Checks env var first, then config file `api_key` field, before prompting
- Handles empty provider with clear warning pointing to `stigmer server setup`

### Removed: Ollama Auto-Download

- Deleted `download.go` entirely (broken 404 URL, security concern)
- Removed `EnsureBinary()` function from `setup.go`
- If Ollama binary not found, returns clear error with install instructions

### Updated: README

- Fixed port `50051` to `7234` in text and architecture diagram
- Rewrote Quick Start step 2 to show Anthropic/OpenAI/Ollama equally
- Added `stigmer server setup` to server management commands
- Added provider comparison table and "Changing Your LLM Provider" section
- Updated Local vs Cloud table to show "user's choice" instead of "Ollama (default)"

## Benefits

- New users are no longer blocked by a hard crash on first run
- The simplest path (set an API key) is now the most visible path
- Users who want Ollama can still choose it — it's just not forced
- Reconfiguration is discoverable via `stigmer server setup`
- The server always starts, even without LLM, enabling workflow/CRUD exploration

## Impact

- **New users**: First-run experience guides them through provider choice instead of crashing
- **Existing users**: No breaking change — existing `config.yaml` with `provider: ollama` still works
- **Documentation**: README Quick Start now accurately reflects the interactive setup flow
- **Architecture**: Port reference corrected from 50051 to 7234

## Files Changed

| File | Change |
|------|--------|
| `client-apps/cli/internal/cli/setup/wizard.go` | **New** — interactive LLM provider wizard |
| `client-apps/cli/cmd/stigmer/root/server.go` | Wizard integration + `setup` subcommand |
| `client-apps/cli/cmd/stigmer/root/server_llm.go` | Handle empty provider in status display |
| `client-apps/cli/internal/cli/config/config.go` | Remove Ollama default, return empty for unset |
| `client-apps/cli/internal/cli/daemon/daemon.go` | Non-fatal LLM setup, handle empty provider |
| `client-apps/cli/internal/cli/daemon/secrets.go` | Config-aware API key resolution, empty provider |
| `client-apps/cli/internal/cli/daemon/health_integration.go` | Updated GatherRequiredSecrets call |
| `client-apps/cli/internal/cli/llm/setup.go` | Remove auto-download, clear error if missing |
| `client-apps/cli/internal/cli/llm/download.go` | **Deleted** — removed broken auto-download |
| `README.md` | Port fix, Quick Start rewrite, LLM provider docs |

## Related Work

- Follows from the initial onboarding experience design
- Prepares the foundation for future provider additions (Google Gemini, local models, etc.)

---

**Status**: Production Ready
