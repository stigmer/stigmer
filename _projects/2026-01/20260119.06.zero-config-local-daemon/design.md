# Zero-Config Local Daemon - Design

**Date**: 2026-01-19  
**Status**: ✅ Complete

## Design Goals

1. **Zero-config for beginners**: `stigmer init && stigmer local start` just works
2. **Flexible for power users**: Config file + env vars for customization
3. **No external dependencies**: Ollama (local) + managed Temporal
4. **Graceful degradation**: Works with external services if configured

## Configuration Schema

### Config File Structure

**Location**: `~/.stigmer/config.yaml`

```yaml
backend:
  type: local  # or "cloud"
  local:
    endpoint: localhost:50051
    data_dir: ~/.stigmer/data
    
    # LLM Configuration
    llm:
      provider: ollama  # "ollama", "anthropic", "openai"
      model: qwen2.5-coder:7b
      base_url: http://localhost:11434
    
    # Temporal Configuration
    temporal:
      managed: true  # Auto-manage Temporal binary
      version: 1.25.1
      port: 7233
      # For external Temporal (when managed: false):
      # address: temporal.example.com:7233
```

### Go Structs

```go
// config/config.go

type LocalBackendConfig struct {
    Endpoint string          `yaml:"endpoint"`
    DataDir  string          `yaml:"data_dir"`
    LLM      *LLMConfig      `yaml:"llm,omitempty"`
    Temporal *TemporalConfig `yaml:"temporal,omitempty"`
}

type LLMConfig struct {
    Provider string `yaml:"provider"` // "ollama", "anthropic", "openai"
    Model    string `yaml:"model,omitempty"`
    BaseURL  string `yaml:"base_url,omitempty"`
}

type TemporalConfig struct {
    Managed bool   `yaml:"managed"`           // true = auto-download/start
    Version string `yaml:"version,omitempty"` // For managed binary
    Port    int    `yaml:"port,omitempty"`    // For managed binary
    Address string `yaml:"address,omitempty"` // For external Temporal
}
```

### Default Values

```go
func GetDefault() *Config {
    return &Config{
        Backend: BackendConfig{
            Type: BackendTypeLocal,
            Local: &LocalBackendConfig{
                Endpoint: "localhost:50051",
                DataDir:  "~/.stigmer/data",
                LLM: &LLMConfig{
                    Provider: "ollama",
                    Model:    "qwen2.5-coder:7b",
                    BaseURL:  "http://localhost:11434",
                },
                Temporal: &TemporalConfig{
                    Managed: true,
                    Version: "1.25.1",
                    Port:    7233,
                },
            },
        },
    }
}
```

## Configuration Cascade

**Priority** (highest to lowest):

1. **Execution config** (passed in gRPC request) - Not applicable for daemon config
2. **Environment variables** (explicit user override)
3. **Config file** (`~/.stigmer/config.yaml`)
4. **Defaults** (mode-aware: local → Ollama/managed, cloud → Anthropic/cloud)

### Environment Variable Overrides

| Env Var | Overrides Config | Example |
|---------|------------------|---------|
| `STIGMER_LLM_PROVIDER` | `llm.provider` | `ollama`, `anthropic`, `openai` |
| `STIGMER_LLM_MODEL` | `llm.model` | `qwen2.5-coder:7b` |
| `STIGMER_LLM_BASE_URL` | `llm.base_url` | `http://localhost:11434` |
| `ANTHROPIC_API_KEY` | API key for Anthropic | `sk-ant-...` |
| `OPENAI_API_KEY` | API key for OpenAI | `sk-...` |
| `TEMPORAL_SERVICE_ADDRESS` | Temporal address (disables managed) | `localhost:7233` |

### Config Resolution Logic

```go
func (c *LocalBackendConfig) ResolveLLMProvider() string {
    // 1. Check environment variable
    if provider := os.Getenv("STIGMER_LLM_PROVIDER"); provider != "" {
        return provider
    }
    
    // 2. Check config file
    if c.LLM != nil && c.LLM.Provider != "" {
        return c.LLM.Provider
    }
    
    // 3. Default
    return "ollama"
}

func (c *LocalBackendConfig) ResolveTemporalAddress() (string, bool) {
    // 1. Check environment variable (external Temporal)
    if addr := os.Getenv("TEMPORAL_SERVICE_ADDRESS"); addr != "" {
        return addr, false // external
    }
    
    // 2. Check config: managed vs external
    if c.Temporal != nil {
        if c.Temporal.Managed {
            port := c.Temporal.Port
            if port == 0 {
                port = 7233
            }
            return fmt.Sprintf("localhost:%d", port), true // managed
        } else {
            return c.Temporal.Address, false // external
        }
    }
    
    // 3. Default: managed Temporal
    return "localhost:7233", true
}
```

## Temporal Binary Management

### Directory Structure

```
~/.stigmer/
  ├── config.yaml
  ├── data/              # stigmer-server data (BadgerDB)
  ├── bin/
  │   └── temporal       # Downloaded Temporal CLI binary
  ├── temporal-data/     # Temporal dev server data
  └── logs/
      ├── daemon.log
      ├── agent-runner.log
      └── temporal.log
```

### Temporal Manager

**File**: `client-apps/cli/internal/cli/temporal/manager.go`

```go
package temporal

type Manager struct {
    binPath     string // ~/.stigmer/bin/temporal
    dataDir     string // ~/.stigmer/temporal-data
    version     string // e.g. "1.25.1"
    port        int    // Default: 7233
    logFile     string // ~/.stigmer/logs/temporal.log
    pidFile     string // ~/.stigmer/temporal.pid
}

// NewManager creates a new Temporal manager
func NewManager(stigmerDataDir string, version string, port int) *Manager

// EnsureInstalled checks if Temporal CLI is installed, downloads if not
func (m *Manager) EnsureInstalled() error

// Start starts Temporal dev server as a background process
func (m *Manager) Start() error

// Stop stops the Temporal dev server
func (m *Manager) Stop() error

// IsRunning checks if Temporal is running
func (m *Manager) IsRunning() bool

// GetAddress returns the Temporal service address
func (m *Manager) GetAddress() string {
    return fmt.Sprintf("localhost:%d", m.port)
}
```

### Binary Download Strategy

**File**: `client-apps/cli/internal/cli/temporal/download.go`

```go
// DownloadBinary downloads Temporal CLI from GitHub releases
func (m *Manager) downloadBinary() error {
    // 1. Detect OS and architecture
    goos := runtime.GOOS     // darwin, linux, windows
    goarch := runtime.GOARCH // amd64, arm64
    
    // 2. Construct download URL
    // https://github.com/temporalio/cli/releases/download/v1.25.1/temporal_cli_1.25.1_darwin_arm64.tar.gz
    url := fmt.Sprintf(
        "https://github.com/temporalio/cli/releases/download/v%s/temporal_cli_%s_%s_%s.tar.gz",
        m.version, m.version, goos, goarch,
    )
    
    // 3. Download to temp file
    resp, err := http.Get(url)
    // ...
    
    // 4. Extract binary
    // tar.gz → extract "temporal" binary → move to ~/.stigmer/bin/temporal
    
    // 5. Make executable
    os.Chmod(m.binPath, 0755)
    
    return nil
}
```

### Temporal Process Management

```go
// Start launches Temporal dev server
func (m *Manager) Start() error {
    // Check if already running
    if m.IsRunning() {
        return errors.New("Temporal is already running")
    }
    
    // Ensure binary is installed
    if err := m.EnsureInstalled(); err != nil {
        return err
    }
    
    // Prepare command
    cmd := exec.Command(m.binPath, "server", "start-dev",
        "--port", strconv.Itoa(m.port),
        "--db-filename", filepath.Join(m.dataDir, "temporal.db"),
    )
    
    // Redirect output to log file
    logFile, err := os.OpenFile(m.logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
    if err != nil {
        return err
    }
    defer logFile.Close()
    
    cmd.Stdout = logFile
    cmd.Stderr = logFile
    
    // Start process
    if err := cmd.Start(); err != nil {
        return err
    }
    
    // Write PID file
    pidContent := fmt.Sprintf("%d", cmd.Process.Pid)
    if err := os.WriteFile(m.pidFile, []byte(pidContent), 0644); err != nil {
        cmd.Process.Kill()
        return err
    }
    
    // Wait for Temporal to be ready
    if err := m.waitForReady(5 * time.Second); err != nil {
        cmd.Process.Kill()
        return err
    }
    
    return nil
}

// waitForReady polls Temporal until it's accepting connections
func (m *Manager) waitForReady(timeout time.Duration) error {
    deadline := time.Now().Add(timeout)
    
    for time.Now().Before(deadline) {
        conn, err := net.DialTimeout("tcp", m.GetAddress(), 100*time.Millisecond)
        if err == nil {
            conn.Close()
            return nil // Temporal is ready
        }
        time.Sleep(100 * time.Millisecond)
    }
    
    return errors.New("Temporal failed to start within timeout")
}
```

## Provider-Aware Secret Management

### Updated Secrets Flow

**File**: `client-apps/cli/internal/cli/daemon/secrets.go`

```go
// GatherRequiredSecrets prompts for provider-specific secrets
func GatherRequiredSecrets(llmProvider string) (map[string]string, error) {
    secrets := make(map[string]string)
    
    switch llmProvider {
    case "ollama":
        // No secrets needed for Ollama!
        fmt.Fprintf(os.Stderr, "✓ Using Ollama (no API key required)\n")
        return secrets, nil
        
    case "anthropic":
        // Check if already in environment
        if apiKey := os.Getenv("ANTHROPIC_API_KEY"); apiKey != "" {
            fmt.Fprintf(os.Stderr, "✓ Using ANTHROPIC_API_KEY from environment\n")
            return secrets, nil
        }
        
        // Prompt for API key
        apiKey, err := PromptForSecret("Enter Anthropic API key")
        if err != nil {
            return nil, err
        }
        secrets["ANTHROPIC_API_KEY"] = apiKey
        fmt.Fprintf(os.Stderr, "✓ Anthropic API key configured\n")
        
    case "openai":
        // Check if already in environment
        if apiKey := os.Getenv("OPENAI_API_KEY"); apiKey != "" {
            fmt.Fprintf(os.Stderr, "✓ Using OPENAI_API_KEY from environment\n")
            return secrets, nil
        }
        
        // Prompt for API key
        apiKey, err := PromptForSecret("Enter OpenAI API key")
        if err != nil {
            return nil, err
        }
        secrets["OPENAI_API_KEY"] = apiKey
        fmt.Fprintf(os.Stderr, "✓ OpenAI API key configured\n")
        
    default:
        return nil, fmt.Errorf("unsupported LLM provider: %s", llmProvider)
    }
    
    return secrets, nil
}
```

## Daemon Startup Orchestration

### Updated Daemon Start Flow

**File**: `client-apps/cli/internal/cli/daemon/daemon.go`

```go
func Start(dataDir string) error {
    // 1. Load configuration (file + env var overrides)
    cfg, err := config.Load()
    if err != nil {
        return errors.Wrap(err, "failed to load configuration")
    }
    
    // 2. Resolve LLM provider
    llmProvider := cfg.Backend.Local.ResolveLLMProvider()
    llmModel := cfg.Backend.Local.ResolveLLMModel()
    llmBaseURL := cfg.Backend.Local.ResolveLLMBaseURL()
    
    // 3. Resolve Temporal configuration
    temporalAddr, isManaged := cfg.Backend.Local.ResolveTemporalAddress()
    
    // 4. Start Temporal (if managed)
    var temporalManager *temporal.Manager
    if isManaged {
        cliprint.Info("Starting managed Temporal server...")
        
        temporalManager = temporal.NewManager(
            dataDir,
            cfg.Backend.Local.Temporal.Version,
            cfg.Backend.Local.Temporal.Port,
        )
        
        if err := temporalManager.EnsureInstalled(); err != nil {
            return errors.Wrap(err, "failed to ensure Temporal installation")
        }
        
        if err := temporalManager.Start(); err != nil {
            return errors.Wrap(err, "failed to start Temporal")
        }
        
        cliprint.Success("Temporal started on %s", temporalManager.GetAddress())
    } else {
        cliprint.Info("Using external Temporal at %s", temporalAddr)
    }
    
    // 5. Gather LLM-specific secrets
    secrets, err := GatherRequiredSecrets(llmProvider)
    if err != nil {
        // Clean up Temporal if we started it
        if temporalManager != nil {
            temporalManager.Stop()
        }
        return errors.Wrap(err, "failed to gather required secrets")
    }
    
    // 6. Start stigmer-server (main daemon)
    cliprint.Info("Starting stigmer-server...")
    if err := startServer(dataDir); err != nil {
        if temporalManager != nil {
            temporalManager.Stop()
        }
        return errors.Wrap(err, "failed to start stigmer-server")
    }
    
    // 7. Start agent-runner with config
    cliprint.Info("Starting agent-runner...")
    if err := startAgentRunner(dataDir, llmProvider, llmModel, llmBaseURL, temporalAddr, secrets); err != nil {
        // Don't fail if agent-runner fails, but log warning
        log.Error().Err(err).Msg("Failed to start agent-runner")
        cliprint.Warning("Agent-runner failed to start, continuing without it")
    } else {
        cliprint.Success("Agent-runner started with %s", llmProvider)
    }
    
    return nil
}
```

### Agent Runner Startup

```go
func startAgentRunner(
    dataDir string,
    llmProvider string,
    llmModel string,
    llmBaseURL string,
    temporalAddr string,
    secrets map[string]string,
) error {
    // Find agent-runner script
    runnerScript, err := findAgentRunnerScript()
    if err != nil {
        return err
    }
    
    // Prepare environment
    env := os.Environ()
    env = append(env,
        "MODE=local",
        "SANDBOX_TYPE=filesystem",
        "SANDBOX_ROOT_DIR=./workspace",
        fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=localhost:%d", DaemonPort),
        "STIGMER_API_KEY=dummy-local-key",
        
        // Temporal configuration
        fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", temporalAddr),
        "TEMPORAL_NAMESPACE=default",
        "TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=agent_execution_runner",
        
        // LLM configuration
        fmt.Sprintf("STIGMER_LLM_PROVIDER=%s", llmProvider),
        fmt.Sprintf("STIGMER_LLM_MODEL=%s", llmModel),
        fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", llmBaseURL),
        
        "LOG_LEVEL=DEBUG",
    )
    
    // Inject provider-specific secrets
    for key, value := range secrets {
        env = append(env, fmt.Sprintf("%s=%s", key, value))
    }
    
    // Start process
    cmd := exec.Command(runnerScript)
    cmd.Env = env
    
    // ... redirect logs, write PID file, etc.
    
    return nil
}
```

### Graceful Shutdown

```go
func Stop(dataDir string) error {
    // 1. Stop agent-runner
    stopAgentRunner(dataDir)
    
    // 2. Stop stigmer-server
    if err := stopServer(dataDir); err != nil {
        return err
    }
    
    // 3. Stop managed Temporal (if running)
    cfg, _ := config.Load()
    if cfg != nil && cfg.Backend.Local.Temporal.Managed {
        tm := temporal.NewManager(dataDir, cfg.Backend.Local.Temporal.Version, cfg.Backend.Local.Temporal.Port)
        if tm.IsRunning() {
            cliprint.Info("Stopping managed Temporal...")
            if err := tm.Stop(); err != nil {
                log.Error().Err(err).Msg("Failed to stop Temporal")
            } else {
                cliprint.Success("Temporal stopped")
            }
        }
    }
    
    return nil
}
```

## Enhanced `stigmer init` Command

**File**: `client-apps/cli/cmd/stigmer/root/init.go`

```go
func handleInit() {
    cliprint.Info("Initializing Stigmer...")
    
    // 1. Create config directory
    configDir, err := config.GetConfigDir()
    if err != nil {
        clierr.HandleDefault(err)
        return
    }
    
    if err := os.MkdirAll(configDir, 0755); err != nil {
        cliprint.Error("Failed to create config directory")
        clierr.HandleDefault(err)
        return
    }
    
    cliprint.Success("Created config directory: %s", configDir)
    
    // 2. Create default config with Ollama + managed Temporal
    cfg := config.GetDefault()
    if err := config.Save(cfg); err != nil {
        cliprint.Error("Failed to save default config")
        clierr.HandleDefault(err)
        return
    }
    
    cliprint.Success("Created default config with Ollama")
    
    // 3. Download Temporal CLI
    dataDir, _ := config.GetDataDir()
    tm := temporal.NewManager(dataDir, cfg.Backend.Local.Temporal.Version, cfg.Backend.Local.Temporal.Port)
    
    cliprint.Info("Downloading Temporal CLI v%s...", cfg.Backend.Local.Temporal.Version)
    if err := tm.EnsureInstalled(); err != nil {
        cliprint.Warning("Failed to download Temporal: %v", err)
        cliprint.Info("You can still use Stigmer with external Temporal")
    } else {
        cliprint.Success("Downloaded Temporal CLI v%s", cfg.Backend.Local.Temporal.Version)
    }
    
    // 4. Display next steps
    cliprint.Info("")
    cliprint.Info("✓ Stigmer initialized successfully!")
    cliprint.Info("")
    cliprint.Info("Configuration:")
    cliprint.Info("  LLM:      Ollama (qwen2.5-coder:7b)")
    cliprint.Info("  Temporal: Managed (auto-start)")
    cliprint.Info("  Config:   %s/config.yaml", configDir)
    cliprint.Info("")
    cliprint.Info("Next steps:")
    cliprint.Info("  1. Ensure Ollama is installed: brew install ollama")
    cliprint.Info("  2. Pull the model: ollama pull qwen2.5-coder:7b")
    cliprint.Info("  3. Start daemon: stigmer local start")
    cliprint.Info("")
    cliprint.Info("To use Anthropic instead:")
    cliprint.Info("  Edit %s/config.yaml and set:", configDir)
    cliprint.Info("    backend.local.llm.provider: anthropic")
}
```

## Enhanced Status Command

**File**: `client-apps/cli/cmd/stigmer/root/local.go`

```go
func handleLocalStatus() {
    dataDir, err := config.GetDataDir()
    if err != nil {
        clierr.HandleDefault(err)
        return
    }
    
    cfg, _ := config.Load()
    if cfg == nil {
        cfg = config.GetDefault()
    }
    
    running, pid := daemon.GetStatus(dataDir)
    
    fmt.Println("Daemon Status:")
    fmt.Println("─────────────────────────────────────")
    
    if running {
        cliprint.Info("  Status:   ✓ Running")
        cliprint.Info("  PID:      %d", pid)
        cliprint.Info("  Port:     %d", daemon.DaemonPort)
        cliprint.Info("  Data:     %s", dataDir)
        cliprint.Info("")
        cliprint.Info("Configuration:")
        cliprint.Info("  LLM:      %s (%s)", cfg.Backend.Local.LLM.Provider, cfg.Backend.Local.LLM.Model)
        cliprint.Info("  Temporal: %s", getTemporalStatus(cfg, dataDir))
    } else {
        cliprint.Warning("  Status:   ✗ Stopped")
        cliprint.Info("")
        cliprint.Info("To start:")
        cliprint.Info("  stigmer local start")
    }
}

func getTemporalStatus(cfg *config.Config, dataDir string) string {
    if cfg.Backend.Local.Temporal.Managed {
        tm := temporal.NewManager(dataDir, cfg.Backend.Local.Temporal.Version, cfg.Backend.Local.Temporal.Port)
        if tm.IsRunning() {
            return fmt.Sprintf("Managed (running on port %d)", cfg.Backend.Local.Temporal.Port)
        }
        return "Managed (not running)"
    }
    return fmt.Sprintf("External (%s)", cfg.Backend.Local.Temporal.Address)
}
```

## Testing Strategy

### Unit Tests

1. **Config resolution** - Test cascade priority
2. **Temporal manager** - Mock download, start/stop
3. **Secret gathering** - Test provider-specific prompts

### Integration Tests

1. **Zero-config flow** - `init` + `start` with defaults
2. **Custom config flow** - Edit config file, start daemon
3. **Env var override flow** - Set env vars, verify they take precedence
4. **Managed Temporal** - Verify binary download and startup
5. **External Temporal** - Verify connection to external server

### Manual Testing Checklist

- [ ] Fresh install: `stigmer init && stigmer local start` works
- [ ] Ollama mode: No API key prompts
- [ ] Anthropic mode: Prompts for API key
- [ ] Managed Temporal: Binary downloads and starts
- [ ] External Temporal: Connects to external server
- [ ] Env var override: `STIGMER_LLM_PROVIDER=anthropic` works
- [ ] Config file edit: Changes persist after restart
- [ ] Graceful shutdown: All processes stop cleanly
- [ ] Status command: Shows correct configuration

## Migration Path

### For Existing Users

Users who already have `~/.stigmer/config.yaml` will see:

1. **Auto-migration**: Add default LLM and Temporal config
2. **Prompt on next start**: "New configuration options available, run `stigmer init` to update"
3. **Backward compatible**: Old configs without LLM/Temporal still work (use defaults)

### Example Migration

```go
func Load() (*Config, error) {
    // ... load existing config ...
    
    // Auto-migrate: add defaults for missing sections
    if cfg.Backend.Local != nil {
        if cfg.Backend.Local.LLM == nil {
            cfg.Backend.Local.LLM = &LLMConfig{
                Provider: "ollama",
                Model:    "qwen2.5-coder:7b",
                BaseURL:  "http://localhost:11434",
            }
        }
        
        if cfg.Backend.Local.Temporal == nil {
            cfg.Backend.Local.Temporal = &TemporalConfig{
                Managed: true,
                Version: "1.25.1",
                Port:    7233,
            }
        }
        
        // Save migrated config
        Save(cfg)
    }
    
    return cfg, nil
}
```

## Implementation Order

1. **Config schema** - Add LLM + Temporal to config structs
2. **Provider-aware secrets** - Update secrets.go
3. **Temporal manager** - Implement download + process management
4. **Daemon orchestration** - Update daemon.go to wire everything
5. **Init command** - Enhanced setup flow
6. **Status command** - Show LLM + Temporal status
7. **Testing** - Unit + integration tests
8. **Documentation** - Update LOCAL-LLM-SETUP.md

## Success Metrics

- ✅ Zero prompts for Ollama users
- ✅ Auto-download Temporal on first `init`
- ✅ Single command start: `stigmer local start`
- ✅ Clean shutdown: `stigmer local stop`
- ✅ Config file changes work without code changes
- ✅ Env var overrides work for all settings
- ✅ Status command shows complete picture

---

**Next**: See `implementation-plan.md` for step-by-step implementation guide.
