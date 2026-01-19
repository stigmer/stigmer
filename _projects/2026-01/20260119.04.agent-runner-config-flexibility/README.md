# Agent Runner Configuration Flexibility

**Created**: 2026-01-19  
**Status**: 🚧 In Progress  
**Tech Stack**: Go, Python (LangChain), Temporal SDK  
**Components**: Daemon, Agent Runner, Configuration Layer

## Overview

Make the agent runner configuration flexible to support zero-dependency local mode while maintaining cloud compatibility. Currently, the agent runner hardcodes the Anthropic client and model. This project implements a cascading configuration strategy (CLI flags > Environment variables > Smart defaults) to enable both Anthropic (cloud) and Ollama (local) LLM providers.

## Goal

Enable users to run Stigmer with:
1. **Zero config** (beginners): Auto-start Ollama with local models
2. **Custom config** (power users): Use Anthropic with API keys
3. **Hybrid config**: Mix local Temporal with cloud Anthropic, or vice versa

## Background

From ADR 019 and ADR 020 in the conversation with Gemini, we identified that:
- Agent runner currently hardcodes `ChatAnthropic` client
- Model name is hardcoded to `claude-3-5-sonnet-20240620`
- No way to switch between Anthropic (cloud) and Ollama (local)
- Configuration doesn't cascade from daemon → agent runner

## Primary Changes

### 1. Configuration Layer (Go)
- Implement `ResolveConfig()` function with precedence: Flag > Env > Default
- Add CLI flags: `--llm-provider`, `--llm-model`, `--anthropic-key`
- Add environment variable support: `LLM_PROVIDER`, `LLM_MODEL`, `ANTHROPIC_API_KEY`

### 2. Agent Runner (Python)
- Refactor `llm.py` to support pluggable LLM backends
- Implement `get_llm(config)` function
- Support both `ChatAnthropic` and `ChatOpenAI` (Ollama-compatible)
- Accept configuration from daemon via environment or config file

### 3. Daemon Integration
- Pass resolved config to agent runner process
- Set environment variables before spawning runner
- Add startup logging to show which mode is active

## Affected Components

- `backend/stigmer-daemon/` - Configuration resolution and daemon logic
- `backend/agent-runner/` - LLM client abstraction
- CLI commands in `client-apps/stigmer-cli/` - New flags

## Success Criteria

- ✅ Agent runner can use Anthropic when API key provided
- ✅ Agent runner can use Ollama when no API key provided
- ✅ Configuration cascades: CLI flag > Env var > Default
- ✅ Daemon logs clearly show which LLM provider is active
- ✅ Same workflow code works with both providers
- ✅ No breaking changes to existing cloud deployments

## Technical Approach

### Configuration Precedence Flow

```
CLI Flag (--llm-provider=ollama)
    ↓ (if not set)
Environment Variable (LLM_PROVIDER=anthropic)
    ↓ (if not set)
Smart Default (ollama for local, anthropic if API key exists)
```

### File Changes

1. **Go**: `internal/daemon/config/llm.go` - Config resolver
2. **Go**: `cmd/local/start.go` - Parse flags and resolve config
3. **Python**: `agent_runner/llm.py` - Pluggable LLM client
4. **Python**: `agent_runner/config.py` - Read config from env

## Non-Goals (Out of Scope)

- Managing Ollama installation/download (separate project)
- Managing Temporal binary (separate project, ADR 018)
- UI changes or web console integration
- Multi-model orchestration or fallback strategies

## Related ADRs

- **ADR 019**: Local Inference Strategy (Managed Ollama)
- **ADR 020**: Hybrid Configuration & Smart Defaults

## Progress

**Overall**: 3 of 9 tasks complete (33%)

### Completed Tasks

- ✅ **Task 1**: Analyze Current Implementation → [Analysis](task-1-analysis.md)
- ✅ **Task 2**: Design Configuration Schema → [Design](task-2-configuration-design.md)
- ✅ **Task 3**: Implement Ollama Support in Graphton → [Completion](task-3-completion.md)
  - Added langchain-ollama dependency
  - Created friendly model names (qwen2.5-coder, llama3.2, etc.)
  - Implemented auto-detection from model names
  - Added parameter translation (max_tokens → num_predict)
  - All tests passing
  - **Checkpoint**: [2026-01-19](checkpoints/2026-01-19-task-3-ollama-support-complete.md)

### Current Task

- 🚧 **Task 4**: Implement LLMConfig in Worker Config → See [next-task.md](next-task.md)

### Upcoming Tasks

- ⏸️ **Task 5**: Wire Daemon to Agent Runner
- ⏸️ **Task 6**: Add Startup Logging
- ⏸️ **Task 7**: Test with Both Providers
- ⏸️ **Task 8**: Update Documentation
- ⏸️ **Task 9**: Final Integration Testing

## Task Breakdown

See `tasks.md` for detailed task list.

## Notes

See `notes.md` for implementation notes and learnings.

## Quick Resume

Drag `next-task.md` into chat to resume where you left off!
