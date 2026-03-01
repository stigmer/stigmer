---
name: Simplify CLI Config Guide
overview: Rewrite docs/cli/configuration.md to be simpler, eliminate redundancy, and reprioritize LLM providers as Anthropic → OpenAI → Ollama.
todos:
  - id: rewrite-doc
    content: "Rewrite docs/cli/configuration.md following the new structure: reprioritize providers (Anthropic → OpenAI → Ollama), collapse Temporal section, remove duplicate YAML blocks, cut redundant sections, fix contradictory Ollama troubleshooting, consolidate Security + Best Practices"
    status: completed
isProject: false
---

# Simplify CLI Configuration Guide

## Target file

`[docs/cli/configuration.md](docs/cli/configuration.md)`

## New structure (section order)

1. **Quick Start** - keep as-is (already good and concise)
2. **Configuration File** - one-liner on location + a minimal full-config example (Anthropic as the default shown)
3. **LLM Provider** - the main user choice, three options in new priority order:
  - Option 1: Anthropic Claude (recommended - best quality)
  - Option 2: OpenAI
  - Option 3: Ollama (local, no API key required)
4. **Temporal Workflow Engine** - collapsed to one section; managed is the default (3 lines of YAML), external is a brief sub-section
5. **Configuration Precedence** - keep the table, remove the prose above it
6. **Troubleshooting** - keep, but fix the Ollama entry (remove manual `brew install` since CLI auto-manages it)
7. **Security** - consolidate the two security sections (currently "Security Considerations" + "Configuration Best Practices") into one tight section

## What gets cut

- Duplicate YAML blocks within each LLM provider section ("Configuration" + "Configuration Options" showing the same thing)
- The broken floating model bullets at lines 113-116 (`codestral:latest`, `llama3.1:8b`)
- "Complete Configuration Examples" section entirely (pure repetition of earlier sections)
- "Switching LLM Providers" section entirely (obvious from reading provider sections)
- "Configuration Best Practices" section (merged into Security)
- "Advanced Configuration" section - Custom Ollama instance folds into the Ollama option section as a one-liner note; Custom Temporal Port folds into the External Temporal sub-section
- Model lists trimmed to 3 key options per provider (remove sizes)
- The ✅ emoji bullets and decorative elements (per role: no fluff)

## Key corrections

- Ollama Troubleshooting entry: change from "Install Ollama manually" → "The daemon auto-manages Ollama; check that `stigmer server` is running"
- Quick Start config example: change from Ollama to Anthropic as the shown default

## Result

Estimated reduction: ~610 lines → ~250-280 lines, with no information loss for the primary audience.