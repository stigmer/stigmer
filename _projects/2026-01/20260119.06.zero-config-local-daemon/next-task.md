# Zero-Config Local Daemon - Implementation Status

**Project**: Zero-Config Local Daemon (Combined LLM + Temporal)  
**Location**: `_projects/2026-01/20260119.06.zero-config-local-daemon/`  
**Status**: 🚀 Implementation Complete, Ready for Testing

## Quick Context

Combined project to achieve zero-config local development:
1. **LLM Configuration** - Support Ollama (no API keys) as default
2. **Managed Temporal** - Auto-download and manage Temporal binary (no Docker)

## Implementation Summary

### ✅ Completed Tasks

1. **✅ Task 1**: Analyzed current state
   - Mapped LLM config flow in CLI
   - Identified Temporal connection points
   - Documented current limitations
   
2. **✅ Task 2**: Designed unified configuration system
   - Config schema with LLM + Temporal settings
   - Cascading config: env vars > config file > defaults
   - Provider-aware secret management
   
3. **✅ Task 3**: Implemented LLM configuration
   - Added `LLMConfig` and `TemporalConfig` to `config.go`
   - Updated `secrets.go` to be provider-aware
   - Pass LLM config to agent-runner via env vars
   
4. **✅ Task 4**: Implemented Temporal binary management
   - Created `temporal/manager.go` - Process management
   - Created `temporal/download.go` - Binary download from GitHub
   - Auto-download on first run
   
5. **✅ Task 5**: Updated daemon orchestration
   - Integrated Temporal manager into daemon startup
   - Start managed Temporal before agent-runner
   - Graceful shutdown stops all processes

### Files Created

**New Files**:
- `client-apps/cli/internal/cli/temporal/manager.go` - Temporal process manager
- `client-apps/cli/internal/cli/temporal/download.go` - Binary download logic

**Modified Files**:
- `client-apps/cli/internal/cli/config/config.go` - Added LLM + Temporal config
- `client-apps/cli/internal/cli/daemon/secrets.go` - Provider-aware secrets
- `client-apps/cli/internal/cli/daemon/daemon.go` - Orchestration logic

### Configuration Schema

**Default Config** (`~/.stigmer/config.yaml`):
```yaml
backend:
  type: local
  local:
    endpoint: localhost:50051
    data_dir: ~/.stigmer/data
    llm:
      provider: ollama
      model: qwen2.5-coder:7b
      base_url: http://localhost:11434
    temporal:
      managed: true
      version: 1.25.1
      port: 7233
```

### Environment Variable Overrides

| Env Var | Overrides | Example |
|---------|-----------|---------|
| `STIGMER_LLM_PROVIDER` | `llm.provider` | `ollama`, `anthropic`, `openai` |
| `STIGMER_LLM_MODEL` | `llm.model` | `qwen2.5-coder:7b` |
| `STIGMER_LLM_BASE_URL` | `llm.base_url` | `http://localhost:11434` |
| `ANTHROPIC_API_KEY` | Anthropic API key | `sk-ant-...` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-...` |
| `TEMPORAL_SERVICE_ADDRESS` | Temporal address (disables managed) | `localhost:7233` |

### Expected User Flow

**Zero-Config Mode** (Default):
```bash
# First time (assuming config exists or using defaults)
$ stigmer local start
✓ Using Ollama (no API key required)
✓ Starting managed Temporal server...
✓ Temporal started on localhost:7233
✓ Starting stigmer-server...
✓ Starting agent-runner with ollama
✓ Daemon started successfully
```

**Anthropic Mode** (Edit config or env var):
```bash
# Via config file edit:
$ cat ~/.stigmer/config.yaml
backend:
  local:
    llm:
      provider: anthropic

$ stigmer local start
Enter Anthropic API key: [user enters key]
✓ Anthropic API key configured
✓ Starting managed Temporal server...
✓ Daemon started with anthropic
```

**External Temporal Mode**:
```bash
$ export TEMPORAL_SERVICE_ADDRESS=my-temporal:7233
$ stigmer local start
✓ Using external Temporal at my-temporal:7233
✓ Daemon started successfully
```

## Remaining Tasks

### Task 6: Testing (Manual)

Since this is a CLI application with subprocess management, automated testing is complex. Manual testing checklist:

**Zero-Config Flow**:
- [ ] Fresh start with defaults
- [ ] Temporal binary downloads automatically
- [ ] Temporal starts on port 7233
- [ ] Agent-runner receives correct env vars
- [ ] No API key prompts for Ollama

**Anthropic Flow**:
- [ ] Edit config to use anthropic
- [ ] Prompts for API key if not in env
- [ ] Uses env var if `ANTHROPIC_API_KEY` is set
- [ ] Agent-runner receives API key

**External Temporal Flow**:
- [ ] Set `TEMPORAL_SERVICE_ADDRESS` env var
- [ ] Skips managed Temporal startup
- [ ] Connects to external Temporal

**Graceful Shutdown**:
- [ ] `stigmer local stop` stops all processes
- [ ] Managed Temporal stops cleanly
- [ ] Agent-runner stops cleanly
- [ ] stigmer-server stops cleanly

**Status Command**:
- [ ] Shows LLM provider and model
- [ ] Shows Temporal status (managed vs external)
- [ ] Shows correct port information

### Task 7: Documentation

Need to update:
- [ ] `backend/services/agent-runner/_kustomize/LOCAL-LLM-SETUP.md` - Add CLI config section
- [ ] `client-apps/cli/README.md` - Document new configuration
- [ ] Create migration guide for existing users

## Implementation Highlights

### Smart Defaults

**Local Mode**:
- LLM: Ollama (qwen2.5-coder:7b)
- Temporal: Managed (auto-download, port 7233)
- No API keys required

**Provider-Aware Secrets**:
- Ollama: No prompts
- Anthropic: Prompts only if not in env
- OpenAI: Prompts only if not in env

### Cascading Configuration

1. **Environment variables** (highest priority)
2. **Config file** (`~/.stigmer/config.yaml`)
3. **Smart defaults** (provider-specific)

### Temporal Binary Management

**Download Strategy**:
- Detects OS and architecture
- Downloads from GitHub releases
- Extracts to `~/.stigmer/bin/temporal`
- Auto-download on first `stigmer local start`

**Process Management**:
- Starts as background process
- Logs to `~/.stigmer/logs/temporal.log`
- PID file for tracking
- Graceful shutdown on stop
- Health check before declaring ready

## Testing Strategy

Since we can't easily run the full stack in CI, testing should focus on:

1. **Manual Testing**: Follow the checklist above
2. **Code Review**: Verify logic and error handling
3. **Integration Test**: Run locally with all combinations
4. **Documentation**: Clear setup instructions

## Next Steps

1. **Manual Testing**: Run through all test scenarios
2. **Documentation**: Update guides and READMEs
3. **Feedback**: Get user feedback on UX
4. **Iteration**: Fix any issues discovered

## Known Limitations

- **No migration for existing users**: Users with old configs will get defaults added on next load
- **No config validation**: Invalid provider names fail at runtime
- **No version management**: Always downloads specified version, doesn't check for updates
- **No cleanup**: Old Temporal data files accumulate

## Future Enhancements

1. **Config validation**: Validate provider names, ports, etc.
2. **Temporal version management**: Check for updates, allow upgrades
3. **Data cleanup**: Add command to clean old Temporal data
4. **Enhanced status**: Show more detailed process info
5. **Config wizard**: Interactive `stigmer init` with prompts
6. **Healthchecks**: Verify Ollama/Anthropic connectivity on start

---

**Status**: ✅ Implementation complete, ready for manual testing and documentation
