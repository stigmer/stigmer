# Next Task: Agent Runner Configuration Flexibility

**Project**: Agent Runner Config Flexibility  
**Location**: `_projects/2026-01/20260119.04.agent-runner-config-flexibility/`  
**Status**: 🚧 In Progress - Task 4

## Quick Context

Making the agent runner configuration flexible to support zero-dependency local mode. Currently:
- ❌ Agent runner hardcodes `ChatAnthropic` client
- ❌ Model hardcoded to `claude-sonnet-4.5`
- ❌ No way to switch between Anthropic (cloud) and Ollama (local)
- ❌ No configuration cascade from daemon to runner

Goal:
- ✅ Support both Anthropic and Ollama
- ✅ Configuration cascade: CLI flag > Env var > Default
- ✅ Zero config for beginners (auto Ollama)
- ✅ Power user config (explicit Anthropic)

## Progress

- ✅ **Task 1**: Analyze Current Implementation → [See task-1-analysis.md](task-1-analysis.md)
- ✅ **Task 2**: Design Configuration Schema → [See task-2-configuration-design.md](task-2-configuration-design.md)
- ✅ **Task 3**: Implement Ollama Support in Graphton → [See task-3-completion.md](task-3-completion.md)
- 🚧 **Task 4**: Implement LLMConfig in Worker Config (current)

## Current Task

**Task 4: Implement LLMConfig in Worker Config**

Add LLM configuration support to the agent runner worker configuration so it can read config from environment variables and pass it to Graphton.

**Objective**: Update `backend/services/agent-runner/worker/config.py` to support LLM configuration.

**Steps**:

1. **Define LLMConfig in config.py**
   - Add `LLMConfig` dataclass with fields for provider, model, base_url, etc.
   - Read from environment variables with sensible defaults
   - Support configuration cascade

2. **Update WorkerConfig to include LLMConfig**
   - Add `llm_config` field to `WorkerConfig`
   - Initialize it during worker startup

3. **Update execute_graphton.py to use LLMConfig**
   - Replace hardcoded "claude-sonnet-4.5" with config value
   - Use worker config for model selection

**Implementation Pattern**:

```python
@dataclass
class LLMConfig:
    """LLM configuration for the agent runner."""
    
    provider: str = "ollama"  # Default to Ollama for zero-config
    model: str = "qwen2.5-coder"  # Default Ollama model
    base_url: str = "http://localhost:11434"  # Ollama default
    api_key: Optional[str] = None
    temperature: float = 0.0
    max_tokens: Optional[int] = None
    
    @classmethod
    def from_env(cls) -> "LLMConfig":
        """Load LLM config from environment variables."""
        # Read STIGMER_LLM_* environment variables
        # Apply cascade: env var > default
        # Return populated config
```

**Files to Modify**:
- `backend/services/agent-runner/worker/config.py` - Add LLMConfig
- `backend/services/agent-runner/worker/activities/execute_graphton.py` - Use config

**Validation**:
- Environment variables are read correctly
- Defaults work when no env vars are set
- Model name is passed to graphton correctly

## Key Findings from Task 1

**Configuration Flow**:
```
execution.spec.execution_config.model_name (gRPC)
    ↓ (if empty)
"claude-sonnet-4.5" (hardcoded fallback)
    ↓
create_deep_agent(model=model_name)
    ↓
parse_model_string() in graphton
    ↓
ChatAnthropic() or ChatOpenAI()
```

**Files to Modify**:
1. `backend/libs/python/graphton/src/graphton/core/models.py` - Add Ollama support
2. `backend/services/agent-runner/worker/config.py` - Add LLM config
3. `backend/services/agent-runner/worker/activities/execute_graphton.py` - Use worker config

**Current Limitations**:
- Only Anthropic and OpenAI supported
- No Ollama support
- No environment variable cascade
- Hardcoded default model

## Related Files

- ADR Doc: `_cursor/adr-doc` (ADR 019 & 020)
- Task 1 Analysis: `task-1-analysis.md`
- Task 2 Configuration Design: `task-2-configuration-design.md`
- Task 3 Completion: `task-3-completion.md`
- Latest Checkpoint: `checkpoints/2026-01-19-task-3-ollama-support-complete.md`
- Changelog: `_changelog/2026-01/2026-01-19-065351-implement-ollama-support-graphton.md`
- Tasks: `tasks.md`
- Notes: `notes.md`

## After This Task

Move to **Task 4: Implement LLMConfig in Worker Config**

---

**Drag this file into chat to resume!**
