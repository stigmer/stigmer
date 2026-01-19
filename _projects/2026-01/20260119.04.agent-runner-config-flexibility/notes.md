# Implementation Notes

## ADR References

### ADR 019: Local Inference Strategy (Managed Ollama)

Key points from the ADR conversation:
- Current state: Agent runner hardcodes Anthropic client
- Problem: Users need paid API key, can't run offline/free
- Solution: Support Ollama for local LLMs

**Configuration Variables Proposed**:
- `LLM_PROVIDER`: "anthropic" | "ollama"
- `LLM_MODEL`: Model name (provider-specific)
- `LLM_BASE_URL`: "http://localhost:11434/v1" (for Ollama)

**Python Code Pattern**:
```python
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI

def get_llm(config):
    provider = config.get("LLM_PROVIDER", "anthropic")
    
    if provider == "ollama":
        return ChatOpenAI(
            base_url="http://localhost:11434/v1",
            api_key="ollama",  # Required but ignored
            model=config.get("LLM_MODEL", "llama3"),
            temperature=0
        )
    elif provider == "anthropic":
        return ChatAnthropic(
            api_key=config["ANTHROPIC_API_KEY"],
            model=config.get("LLM_MODEL", "claude-3-5-sonnet-20240620")
        )
```

### ADR 020: Hybrid Configuration & Smart Defaults

**Cascading Configuration Strategy**:

1. **CLI Flag** (highest priority)
   - `--llm-provider=ollama`
   - `--anthropic-key=sk-...`
   - `--llm-model=llama3`

2. **Environment Variable** (medium priority)
   - `LLM_PROVIDER=anthropic`
   - `ANTHROPIC_API_KEY=sk-...`
   - `LLM_MODEL=claude-3-5-sonnet-20240620`

3. **Smart Default** (fallback)
   - If API key exists: Use Anthropic
   - If no API key: Use Ollama (if available)

**Go Code Pattern**:
```go
type LLMConfig struct {
    Provider     string
    Model        string
    BaseURL      string
    APIKey       string
    ShouldManageOllama bool
}

func ResolveConfig(cmd *cobra.Command) LLMConfig {
    // 1. Check flag
    flagProvider, _ := cmd.Flags().GetString("llm-provider")
    flagKey, _ := cmd.Flags().GetString("anthropic-key")
    
    // 2. Check env
    envProvider := os.Getenv("LLM_PROVIDER")
    envKey := os.Getenv("ANTHROPIC_API_KEY")
    
    // 3. Apply precedence and return config
}
```

## Design Decisions

### Decision: Use Environment Variables for Config Passing

**Why**: 
- Simple and standard way to pass config to subprocess
- Works across languages (Go → Python)
- Easy to override in different environments (dev, test, prod)
- No need for config file management

**Alternative Considered**: Config file (rejected for simplicity)

### Decision: Keep Temporal and LLM Config Separate

**Why**:
- Users might want local Temporal but cloud Anthropic
- Users might want cloud Temporal but local Ollama
- Independent configuration gives maximum flexibility

## Learnings

### Task 4 Implementation (2026-01-19)

**What Worked Well**:
- Mode-aware defaults pattern is clean and intuitive
- Validation at load-time catches errors early
- Environment variable naming with `STIGMER_LLM_*` prefix is clear
- Backward compatibility with `ANTHROPIC_API_KEY` preserves existing setups

**Implementation Insights**:
- Moving worker config loading earlier in `execute_graphton.py` simplified access to both sandbox and LLM config
- Using `Optional[str]` for provider-specific fields (base_url, api_key) makes validation explicit
- Dataclass with validation method is cleaner than validation in `__post_init__`

**Code Organization**:
- LLMConfig before Config in same file works well (no circular dependencies)
- Configuration cascade logic isolated in `load_from_env()` keeps it testable
- Provider validation in separate `validate()` method allows future extension

**Configuration Cascade Success**:
- Three-level priority (execution > env vars > defaults) handles all use cases
- Mode-aware defaults (local → Ollama, cloud → Anthropic) make zero-config possible
- Explicit env vars allow power users to override anything

## Gotchas

### Implementation Gotchas

1. **Import Order Matters**: Must import `Optional` from `typing` before using it in dataclass
   - Fixed: Added `from typing import Optional` to imports

2. **Config Loading Timing**: Worker config needs to be loaded before both sandbox and model config
   - Fixed: Moved `Config.load_from_env()` earlier in `execute_graphton.py`

3. **Type Annotations**: Python 3.10+ supports `str | None` but older versions need `Optional[str]`
   - Decision: Used `Optional[str]` for broader compatibility

4. **Validation Errors**: Should be raised at config load time, not during execution
   - Implemented: `validate()` called at end of `load_from_env()`

5. **Default Values**: Dataclass fields with defaults must come after fields without defaults
   - Structure: `provider`, `model_name` (required) before `base_url`, `api_key` (optional)

### Future Gotchas to Watch

1. **Ollama Not Running**: No health check on startup - will fail during first execution
   - TODO: Consider adding ping to Ollama endpoint in validation

2. **API Key Security**: Environment variables visible in process lists
   - Mitigation: Document secure practices, consider future secret management

3. **Model Names**: Different providers use different naming conventions
   - Ollama: `model-name:tag` (e.g., `qwen2.5-coder:7b`)
   - Anthropic: `claude-*` (e.g., `claude-sonnet-4.5`)
   - OpenAI: `gpt-*` or `o1-*` (e.g., `gpt-4`)

4. **Base URL Format**: Ollama expects `http://host:port` not `http://host:port/v1`
   - Note: Graphton's `parse_model_string()` handles URL formatting

## Questions/Blockers

- [x] ~~Where exactly is the agent runner spawned in the daemon code?~~ (Not needed for Task 4)
- [x] ~~Does the agent runner already read any environment variables?~~ (Yes, via `Config.load_from_env()`)
- [x] ~~Are there existing patterns for config in the codebase we should follow?~~ (Yes, `Config` dataclass pattern)
- [ ] Should we validate that Ollama is running before using it? (Deferred - can add health check later)

### Open Questions for Future Tasks

- Should we add startup logging to show active LLM config?
- Should we ping Ollama endpoint during validation?
- Should we support model aliases (fast/balanced/powerful)?
- Should we add `.stigmer/config.yaml` support?
- How should we handle Ollama not being available in local mode?

## Testing Strategy

### Manual Testing Required:

1. **Test Case: Default (No Config)**
   - Remove ANTHROPIC_API_KEY
   - Run `stigmer local start`
   - Should: Fall back to Ollama

2. **Test Case: Anthropic via Env Var**
   - Set ANTHROPIC_API_KEY
   - Run `stigmer local start`
   - Should: Use Anthropic with default model

3. **Test Case: Anthropic via CLI Flag**
   - Run `stigmer local start --anthropic-key=sk-...`
   - Should: Use Anthropic (overrides absence of env var)

4. **Test Case: Force Ollama with Flag**
   - Set ANTHROPIC_API_KEY (to test precedence)
   - Run `stigmer local start --llm-provider=ollama`
   - Should: Use Ollama (flag overrides env)

5. **Test Case: Custom Model**
   - Run `stigmer local start --llm-model=llama3:70b`
   - Should: Use specified model

### Verification:
- Check daemon startup logs
- Check agent runner logs
- Actually execute a simple workflow
- Verify correct model is being called (check API logs or Ollama logs)

## Related Work

- Managing Ollama installation: Out of scope (separate project/ADR 019 implementation)
- Managing Temporal binary: Out of scope (separate project/ADR 018 implementation)
- This project: **Only configuration passing and abstraction**

## Timeline

**Session 1** (Expected):
- T1: Analyze current implementation
- T2: Design config schema
- T3: Implement Go resolver
- T4: Update CLI flags
- T5: Implement Python abstraction

**Session 2** (Expected):
- T6: Wire daemon to runner
- T7: Add startup logging
- T8: Test with both providers
- T9: Update documentation

---

## Scratchpad

### Task 4 Completion Summary (2026-01-19)

**Implementation Time**: ~1 hour  
**Lines Changed**: ~170 lines added, 5 lines modified

**Files Created**:
- `task-4-completion.md` - Detailed completion documentation
- `checkpoints/2026-01-19-task-4-llm-config-complete.md` - Checkpoint snapshot
- `_changelog/2026-01/2026-01-19-070459-implement-llm-config-worker.md` - Changelog entry

**Files Modified**:
- `backend/services/agent-runner/worker/config.py` - Added LLMConfig dataclass
- `backend/services/agent-runner/worker/activities/execute_graphton.py` - Updated model selection
- `next-task.md` - Updated progress and status

**Linter Status**: ✅ No errors

**Next Steps**:
1. Integration testing with both Ollama and Anthropic
2. Add startup logging to show active config
3. Update user-facing documentation
4. Consider CLI integration (daemon → worker config passing)
