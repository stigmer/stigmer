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

_(Will be populated during implementation)_

## Gotchas

_(Will be populated during implementation)_

## Questions/Blockers

- [ ] Where exactly is the agent runner spawned in the daemon code?
- [ ] Does the agent runner already read any environment variables?
- [ ] Are there existing patterns for config in the codebase we should follow?
- [ ] Should we validate that Ollama is running before using it? (probably yes, but could defer)

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

_(Use this space for quick notes during implementation)_
