# Tasks

## Task 1: Analyze Current Agent Runner Implementation
**Status**: ✅ COMPLETE

**Objective**: Understand how the agent runner currently initializes the LLM client and where the model is hardcoded.

**Steps**:
1. ✅ Find the agent runner initialization code (Python)
2. ✅ Locate where `ChatAnthropic` is instantiated
3. ✅ Identify where `claude-3-5-sonnet-20240620` is hardcoded
4. ✅ Document current configuration flow (if any)
5. ✅ Identify where environment variables are read

**Acceptance**:
- ✅ Clear understanding of current LLM initialization
- ✅ List of files that need changes
- ✅ Document current limitations

**Deliverable**: [task-1-analysis.md](task-1-analysis.md)

---

## Task 2: Design Configuration Schema
**Status**: ✅ COMPLETE

**Objective**: Define the configuration structure that will be passed from daemon to agent runner.

**Steps**:
1. ✅ Define configuration fields needed:
   - `llm_provider`: "anthropic" | "ollama" | "openai"
   - `llm_model`: model name string
   - `llm_base_url`: URL for Ollama (required for Ollama)
   - `llm_api_key`: API key (required for Anthropic/OpenAI)
   - `max_tokens`, `temperature`: Optional overrides
2. ✅ Decide on config passing mechanism:
   - Environment variables (STIGMER_LLM_*)
   - Mode-aware defaults (local → Ollama, cloud → Anthropic)
3. ✅ Define environment variable names
4. ✅ Document precedence rules (env vars > mode-aware defaults)

**Acceptance**:
- ✅ Configuration schema documented
- ✅ Environment variable names defined
- ✅ Passing mechanism decided
- ✅ Mode-aware defaults specified
- ✅ Validation rules defined

**Deliverable**: [task-2-configuration-design.md](task-2-configuration-design.md)

---

## Task 3: Implement Go Configuration Resolver
**Status**: ⏸️ TODO

**Objective**: Implement the `ResolveConfig()` function in Go that handles the cascading configuration logic.

**Steps**:
1. Create `internal/daemon/config/llm.go`
2. Define `LLMConfig` struct
3. Implement `ResolveConfig(cmd *cobra.Command)` function
4. Handle precedence: CLI flag > Env var > Default
5. Add logic to detect if Anthropic key is available
6. Return both the config and a "should start Ollama" flag

**Example Code Structure**:
```go
type LLMConfig struct {
    Provider     string // "anthropic" or "ollama"
    Model        string
    BaseURL      string // For Ollama
    APIKey       string // For Anthropic
    ShouldManageOllama bool
}

func ResolveConfig(cmd *cobra.Command) LLMConfig {
    // 1. Try CLI flag
    // 2. Try env var
    // 3. Fall back to default
}
```

**Acceptance**:
- `ResolveConfig()` function implemented
- Unit tests passing (if applicable)
- Proper precedence handling verified

---

## Task 4: Update CLI Flags
**Status**: ⏸️ TODO

**Objective**: Add new CLI flags to `stigmer local start` command.

**Steps**:
1. Locate the `start` command definition
2. Add persistent flags:
   - `--llm-provider` (string, default: auto-detect)
   - `--llm-model` (string, default: varies by provider)
   - `--anthropic-key` (string, default: from env)
3. Update command help text
4. Wire flags to `ResolveConfig()` call

**Acceptance**:
- Flags registered and parseable
- Help text updated
- Flags accessible in start handler

---

## Task 5: Implement Python LLM Abstraction
**Status**: ⏸️ TODO

**Objective**: Refactor the Python agent runner to support pluggable LLM backends.

**Steps**:
1. Create or update `agent_runner/llm.py`
2. Implement `get_llm(config)` function:
   ```python
   def get_llm(config: dict):
       provider = config.get("LLM_PROVIDER", "anthropic")
       
       if provider == "ollama":
           return ChatOpenAI(
               base_url=config.get("LLM_BASE_URL", "http://localhost:11434/v1"),
               api_key="ollama",  # Required but ignored
               model=config.get("LLM_MODEL", "llama3"),
               temperature=0
           )
       elif provider == "anthropic":
           return ChatAnthropic(
               api_key=config["ANTHROPIC_API_KEY"],
               model=config.get("LLM_MODEL", "claude-3-5-sonnet-20240620")
           )
       else:
           raise ValueError(f"Unknown provider: {provider}")
   ```
3. Update agent runner initialization to call `get_llm()`
4. Remove hardcoded `ChatAnthropic` instantiation
5. Ensure config is read from environment variables

**Acceptance**:
- `get_llm()` function implemented
- Both Anthropic and Ollama supported
- No hardcoded client or model names
- Config read from environment

---

## Task 6: Wire Daemon to Agent Runner
**Status**: ⏸️ TODO

**Objective**: Pass the resolved configuration from the Go daemon to the Python agent runner.

**Steps**:
1. Locate where daemon spawns the agent runner process
2. Set environment variables before spawning:
   - `LLM_PROVIDER`
   - `LLM_MODEL`
   - `LLM_BASE_URL` (if Ollama)
   - `ANTHROPIC_API_KEY` (if Anthropic)
3. Ensure variables are passed to the subprocess
4. Add logging to show which config is being used

**Acceptance**:
- Environment variables set correctly
- Agent runner receives configuration
- Logs show active LLM provider and model

---

## Task 7: Add Startup Logging
**Status**: ⏸️ TODO

**Objective**: Make the daemon startup output clearly show which LLM configuration is active.

**Steps**:
1. Update daemon startup sequence
2. Add log messages:
   - "✓ Using Anthropic (claude-3-5-sonnet-20240620)"
   - "✓ Using Ollama (llama3) at http://localhost:11434"
3. Show configuration source:
   - "From CLI flag: --llm-provider=ollama"
   - "From environment: LLM_PROVIDER=anthropic"
   - "Default: Ollama (no API key found)"

**Acceptance**:
- Startup logs clearly show LLM config
- Easy to debug which config source was used
- Users can verify their configuration is correct

---

## Task 8: Test with Both Providers
**Status**: ⏸️ TODO

**Objective**: Manually test that both Anthropic and Ollama work correctly.

**Test Cases**:
1. **Default (no config)**: Should fall back to Ollama
2. **With ANTHROPIC_API_KEY env var**: Should use Anthropic
3. **With --llm-provider=ollama flag**: Should use Ollama (even if API key present)
4. **With --llm-model flag**: Should use specified model
5. **Mixed config**: Temporal from cloud, Ollama for LLM (or vice versa)

**Acceptance**:
- All test cases pass
- No errors in agent runner logs
- Workflows execute successfully with both providers

---

## Task 9: Update Documentation
**Status**: ⏸️ TODO

**Objective**: Document the new configuration options for users.

**Steps**:
1. Update CLI help text
2. Add examples to README or docs:
   - Using Anthropic with API key
   - Using Ollama locally
   - Mixing providers
3. Document environment variables
4. Add troubleshooting section

**Acceptance**:
- Documentation complete
- Examples work as written
- Users can understand configuration options

---

## Summary

**Total Tasks**: 9  
**Status**: ⏸️ Not Started

**Critical Path**:
1. Analyze current implementation (T1)
2. Design config schema (T2)
3. Implement Go resolver (T3) + Python abstraction (T5) in parallel
4. Wire everything together (T6)
5. Test (T8)
6. Document (T9)

**Estimated Duration**: 1-2 sessions (3-4 hours)
