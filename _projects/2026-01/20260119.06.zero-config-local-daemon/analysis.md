# Zero-Config Local Daemon - Analysis

**Date**: 2026-01-19  
**Status**: ✅ Complete

## Combined Scope

This combines two related projects:
1. **LLM Configuration Flexibility** - Support Ollama (zero API keys)
2. **Managed Temporal Runtime** - Auto-manage Temporal binary (zero Docker)

Both serve the same goal: **Zero-dependency local development experience**

## Current State Analysis

### Architecture Overview

```
stigmer CLI (client-apps/cli)
  ├─> stigmer-server (backend/services/stigmer-server)
  │    └─> gRPC server + BadgerDB
  │    └─> NO Temporal connection
  │
  ├─> agent-runner (backend/services/agent-runner) 
  │    └─> Needs Temporal connection
  │    └─> Needs LLM provider (currently hardcoded to Anthropic)
  │
  └─> [MISSING] Temporal binary
       └─> User must manually run Docker/Temporal
```

### 1. LLM Configuration Flow

**File**: `client-apps/cli/internal/cli/daemon/daemon.go`

**Current behavior** (lines 51-126):
```go
// 1. GatherRequiredSecrets() - ALWAYS prompts for ANTHROPIC_API_KEY
secrets, err := GatherRequiredSecrets()

// 2. startAgentRunner() - Hardcoded env vars, no LLM config
env = append(env,
    "MODE=local",
    "SANDBOX_TYPE=filesystem",
    // ... NO LLM provider/model configuration
)

// 3. Inject secrets (Anthropic-only)
for key, value := range secrets {
    env = append(env, fmt.Sprintf("%s=%s", key, value))
}
```

**Problems**:
- ❌ Always prompts for `ANTHROPIC_API_KEY` (no Ollama option)
- ❌ No way to configure LLM provider
- ❌ No way to pass model, base URL, etc.
- ❌ Agent-runner expects `STIGMER_LLM_PROVIDER` but CLI doesn't set it

**Agent-runner expectations** (already implemented):
```python
# backend/services/agent-runner/worker/config.py
@dataclass
class LLMConfig:
    provider: str  # "anthropic" | "ollama" | "openai"
    model: str
    base_url: Optional[str]
    api_key: Optional[str]

# Mode-aware defaults:
# - local → Ollama (qwen2.5-coder:7b)
# - cloud → Anthropic (claude-sonnet-4.5)
```

### 2. Temporal Connection

**File**: `client-apps/cli/internal/cli/daemon/daemon.go`

**Current behavior** (line 148):
```go
env = append(env,
    "TEMPORAL_SERVICE_ADDRESS=localhost:7233",  // Hardcoded
    "TEMPORAL_NAMESPACE=default",
    // ...
)
```

**File**: `backend/services/workflow-runner/worker/config/config.go`

**Config loading** (line 71):
```go
TemporalServiceAddress: getEnvOrDefault("TEMPORAL_SERVICE_ADDRESS", "localhost:7233"),
```

**Problems**:
- ❌ Assumes Temporal is already running on localhost:7233
- ❌ No automatic Temporal binary management
- ❌ User must manually run Docker or Temporal dev server
- ❌ No validation that Temporal is actually running

**stigmer-server** (main daemon):
- Does NOT connect to Temporal directly
- Only agent-runner and workflow-runner need Temporal

### 3. CLI Configuration

**File**: `client-apps/cli/internal/cli/config/config.go`

**Current config struct**:
```go
type Config struct {
    Backend BackendConfig  // local vs cloud
    Context ContextConfig  // org/env (cloud only)
}

type LocalBackendConfig struct {
    Endpoint string  // Daemon endpoint
    DataDir  string  // Data directory
}
```

**Problems**:
- ❌ No LLM configuration
- ❌ No Temporal configuration
- ❌ No way to specify Ollama vs Anthropic
- ❌ No managed vs external Temporal setting

### 4. Secrets Management

**File**: `client-apps/cli/internal/cli/daemon/secrets.go`

**Current implementation**:
```go
func GatherRequiredSecrets() (map[string]string, error) {
    secrets := make(map[string]string)
    
    // ALWAYS prompts for Anthropic API key
    apiKey, prompted, err := GetOrPromptSecret(
        "ANTHROPIC_API_KEY", 
        "Enter Anthropic API key"
    )
    // ...
}
```

**Problems**:
- ❌ Hardcoded to Anthropic only
- ❌ No conditional prompting based on provider
- ❌ Ollama doesn't need API keys but still prompted

## What Needs to Change

### 1. Add Unified Config Structure

**File**: `client-apps/cli/internal/cli/config/config.go`

Add LLM and Temporal config to `LocalBackendConfig`:

```go
type LocalBackendConfig struct {
    Endpoint string
    DataDir  string
    
    // NEW: LLM Configuration
    LLM *LLMConfig `yaml:"llm,omitempty"`
    
    // NEW: Temporal Configuration  
    Temporal *TemporalConfig `yaml:"temporal,omitempty"`
}

type LLMConfig struct {
    Provider string `yaml:"provider"`  // "ollama", "anthropic", "openai"
    Model    string `yaml:"model,omitempty"`
    BaseURL  string `yaml:"base_url,omitempty"`
}

type TemporalConfig struct {
    Managed  bool   `yaml:"managed"`   // true = auto-download/start, false = external
    Address  string `yaml:"address,omitempty"`  // For external Temporal
    Version  string `yaml:"version,omitempty"`  // For managed binary
}
```

### 2. Smart Defaults

**Zero-config defaults for local mode**:

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
```

**Cloud mode defaults**:
```yaml
backend:
  type: cloud
  cloud:
    endpoint: api.stigmer.ai:443
    # LLM/Temporal handled by cloud
```

### 3. Provider-Aware Secrets

**File**: `client-apps/cli/internal/cli/daemon/secrets.go`

```go
func GatherRequiredSecrets(llmProvider string) (map[string]string, error) {
    secrets := make(map[string]string)
    
    switch llmProvider {
    case "ollama":
        // No secrets needed!
        fmt.Fprintf(os.Stderr, "✓ Using Ollama (no API key required)\n")
        
    case "anthropic":
        apiKey, prompted, err := GetOrPromptSecret(
            "ANTHROPIC_API_KEY",
            "Enter Anthropic API key"
        )
        if prompted {
            secrets["ANTHROPIC_API_KEY"] = apiKey
        }
        
    case "openai":
        apiKey, prompted, err := GetOrPromptSecret(
            "OPENAI_API_KEY",
            "Enter OpenAI API key"
        )
        if prompted {
            secrets["OPENAI_API_KEY"] = apiKey
        }
    }
    
    return secrets, nil
}
```

### 4. Temporal Binary Management

**New file**: `client-apps/cli/internal/cli/temporal/manager.go`

```go
type Manager struct {
    binPath    string  // ~/.stigmer/bin/temporal
    dataDir    string  // ~/.stigmer/temporal-data
    version    string
    port       int     // Default: 7233
}

// EnsureInstalled downloads Temporal CLI if not present
func (m *Manager) EnsureInstalled() error

// Start starts Temporal dev server as subprocess
func (m *Manager) Start() error

// Stop stops the Temporal dev server
func (m *Manager) Stop() error

// IsRunning checks if Temporal is running
func (m *Manager) IsRunning() bool

// GetAddress returns the Temporal service address
func (m *Manager) GetAddress() string
```

### 5. Updated Daemon Start Flow

**File**: `client-apps/cli/internal/cli/daemon/daemon.go`

```go
func Start(dataDir string) error {
    cfg, _ := config.Load()
    
    // 1. Handle Temporal
    var temporalAddr string
    if cfg.Backend.Local.Temporal.Managed {
        // Start managed Temporal
        tm := temporal.NewManager(dataDir, cfg.Backend.Local.Temporal.Version)
        if err := tm.EnsureInstalled(); err != nil {
            return err
        }
        if err := tm.Start(); err != nil {
            return err
        }
        temporalAddr = tm.GetAddress()
    } else {
        // Use external Temporal
        temporalAddr = cfg.Backend.Local.Temporal.Address
    }
    
    // 2. Gather LLM-specific secrets
    llmProvider := cfg.Backend.Local.LLM.Provider
    secrets, err := GatherRequiredSecrets(llmProvider)
    if err != nil {
        return err
    }
    
    // 3. Start stigmer-server
    if err := startServer(dataDir); err != nil {
        return err
    }
    
    // 4. Start agent-runner with LLM + Temporal config
    if err := startAgentRunner(dataDir, cfg, temporalAddr, secrets); err != nil {
        return err
    }
    
    return nil
}
```

### 6. Pass Config to Agent Runner

**File**: `client-apps/cli/internal/cli/daemon/daemon.go`

```go
func startAgentRunner(dataDir string, cfg *config.Config, temporalAddr string, secrets map[string]string) error {
    // Base environment
    env := os.Environ()
    env = append(env,
        "MODE=local",
        fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=localhost:%d", DaemonPort),
        
        // Temporal configuration
        fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", temporalAddr),
        "TEMPORAL_NAMESPACE=default",
        
        // LLM configuration
        fmt.Sprintf("STIGMER_LLM_PROVIDER=%s", cfg.Backend.Local.LLM.Provider),
        fmt.Sprintf("STIGMER_LLM_MODEL=%s", cfg.Backend.Local.LLM.Model),
        fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", cfg.Backend.Local.LLM.BaseURL),
    )
    
    // Add provider-specific secrets
    for key, value := range secrets {
        env = append(env, fmt.Sprintf("%s=%s", key, value))
    }
    
    // Start agent-runner
    cmd := exec.Command(runnerScript)
    cmd.Env = env
    // ... rest of startup logic
}
```

## Configuration Cascade

**Priority order** (highest to lowest):

1. **Execution-specific config** (passed in gRPC request)
2. **Environment variables** (explicit user override)
3. **CLI config file** (`~/.stigmer/config.yaml`)
4. **Mode-aware defaults** (local → Ollama/managed, cloud → Anthropic/cloud)

## Zero-Config User Flow

```bash
# First time setup
$ stigmer init
✓ Created config directory: ~/.stigmer
✓ Downloaded Temporal CLI v1.25.1
✓ Created default config with Ollama
✓ Configured for zero-dependency local mode

# Start daemon (zero config!)
$ stigmer local start
✓ Starting managed Temporal server
✓ Temporal ready on localhost:7233
✓ Starting stigmer-server
✓ Starting agent-runner with Ollama
✓ Using Ollama (no API key required)
✓ Daemon started successfully

# Run agent (just works!)
$ stigmer agent run my-agent
[Uses local Ollama automatically]
```

## Power User Flow

```bash
# Custom config in ~/.stigmer/config.yaml
backend:
  type: local
  local:
    llm:
      provider: anthropic
      model: claude-sonnet-4.5
    temporal:
      managed: false
      address: my-temporal.example.com:7233

# Or via environment variables
$ export STIGMER_LLM_PROVIDER=anthropic
$ export ANTHROPIC_API_KEY=sk-ant-...
$ export TEMPORAL_SERVICE_ADDRESS=my-temporal:7233
$ stigmer local start
Enter Anthropic API key: [prompted]
✓ Using external Temporal at my-temporal:7233
✓ Daemon started with Anthropic
```

## Files to Create/Modify

### Create New Files

1. `client-apps/cli/internal/cli/temporal/manager.go` - Temporal binary management
2. `client-apps/cli/internal/cli/temporal/download.go` - Binary download logic
3. `client-apps/cli/cmd/stigmer/root/init.go` - Enhanced init command

### Modify Existing Files

1. `client-apps/cli/internal/cli/config/config.go` - Add LLM + Temporal config
2. `client-apps/cli/internal/cli/daemon/daemon.go` - Orchestrate Temporal + LLM config
3. `client-apps/cli/internal/cli/daemon/secrets.go` - Provider-aware secret gathering
4. `client-apps/cli/cmd/stigmer/root/local.go` - Enhanced status output

## Success Criteria

- ✅ `stigmer init` sets up everything without user intervention
- ✅ `stigmer local start` works with zero config (Ollama + managed Temporal)
- ✅ Users can switch to Anthropic by editing config file
- ✅ Users can use external Temporal by setting `managed: false`
- ✅ No API key prompts when using Ollama
- ✅ Temporal binary auto-downloaded on first run
- ✅ Clean shutdown stops both Temporal and agent-runner
- ✅ `stigmer local status` shows Temporal + LLM provider status

## Next Steps

See `design.md` for detailed implementation design.
