# Local LLM Automation Architecture

## Overview

Stigmer's local LLM automation provides a **zero-config experience** for running AI agents locally. When users choose local mode, the CLI automatically downloads, configures, and manages the LLM infrastructure—no manual setup required.

**Key Innovation:** Users interact with "local LLM" as a concept, never seeing implementation details like "Ollama". The technology choice is abstracted away, making it easy to swap providers in the future.

## The Problem

Traditional LLM setup requires multiple manual steps:

1. Download and install LLM runtime (e.g., Ollama)
2. Start the LLM server process
3. Pull large model files (4-7 GB)
4. Configure the application to use the LLM
5. Manage server lifecycle (start/stop/restart)

This creates **friction for new users** and **maintenance burden** for all users.

## The Solution

**Zero-Config Automation:** `stigmer server` does everything automatically.

### First Run Experience

```bash
$ stigmer server

✓ First-time setup: Initializing Stigmer...
  Starting Stigmer server...
   ⣷ Initializing: Setting up local LLM
   ⣷ Installing: Downloading local LLM: 50% (75 MB / 150 MB)
   ⣷ Starting: Starting local LLM server
   ⣷ Installing: Downloading model qwen2.5-coder:7b (3-10 minutes)
   ... automatic setup continues ...
✓ Ready! Stigmer server is running

LLM Configuration:
  Provider: Local ✓ Running
  PID:      12346
  Model:    qwen2.5-coder:7b
```

**Time:** ~5-10 minutes on first run (downloading binary + model)

### Subsequent Runs

```bash
$ stigmer server

✓ Using local LLM (no API key required)
  Starting Stigmer server...
   ... quick startup, no downloads ...
✓ Ready! Stigmer server is running
```

**Time:** < 30 seconds (everything already installed)

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Stigmer CLI                               │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  stigmer server                                       │  │
│  │                                                        │  │
│  │  1. Load config → provider: ollama                   │  │
│  │  2. Call llm.Setup()                                 │  │
│  │  3. Start other services (Temporal, agent-runner)   │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                  │
│                            ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  llm.Setup() - Orchestrator                          │  │
│  │                                                        │  │
│  │  ✓ IsRunning() → Already running? Skip setup        │  │
│  │  ✓ EnsureBinary() → Download if missing             │  │
│  │  ✓ StartServer() → Start in background             │  │
│  │  ✓ WaitForServer() → Poll until healthy            │  │
│  │  ✓ EnsureModel() → Pull if missing                 │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  ~/.stigmer/                                                 │
│  ├── bin/ollama              (~150 MB, auto-downloaded)     │
│  ├── logs/llm.log           (server output)                 │
│  └── llm.pid                (process ID)                     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Local LLM Server (Ollama)                                   │
│  - Runs on localhost:11434                                   │
│  - Serves model: qwen2.5-coder:7b (~4.7 GB)                 │
│  - Managed by CLI (auto-start, health checks)               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Agent Runner                                                │
│  - Connects to localhost:11434                               │
│  - Executes AI agents using local models                     │
└─────────────────────────────────────────────────────────────┘
```

### Package Structure

```
client-apps/cli/internal/cli/llm/
├── setup.go           # Orchestrator and main functions
├── download.go        # Binary acquisition with progress
├── process_unix.go    # Unix process management
└── process_windows.go # Windows process management
```

### Key Functions

**`llm.Setup(ctx, cfg, opts)`** - Main orchestrator:
1. Checks if LLM server is already running
2. If not, downloads binary to `~/.stigmer/bin/`
3. Starts server in background
4. Polls health endpoint until ready
5. Ensures model is available (pulls if missing)
6. Returns error if any step fails

**`llm.IsRunning()`** - Health check:
- HTTP GET to `localhost:11434/api/tags`
- Returns `true` if server responds with 200 OK
- Fast check (2s timeout)

**`llm.GetStatus()`** - Full status:
- Returns: `(running bool, pid int, models []string, err error)`
- Used by `stigmer server status` command

**`llm.ListModels()`** - Available models:
- Runs `ollama list`
- Parses output for model names
- Returns string slice

**`llm.PullModel(model)`** - Download model:
- Runs `ollama pull <model>`
- Streams progress to user
- Large download (~4-7 GB)

## Implementation Details

### Binary Download

**Source:** `https://github.com/ollama/ollama/releases/latest/download`

**Platform Detection:**

| Platform | Binary Name |
|---|---|
| macOS (universal) | `ollama-darwin` (~150 MB) |
| Linux (amd64) | `ollama-linux-amd64` |
| Linux (arm64) | `ollama-linux-arm64` |
| Windows (amd64) | `ollama-windows-amd64.exe` |

**Installation:**
1. Download to temp file
2. Show progress (updated every 10%)
3. Move to `~/.stigmer/bin/ollama`
4. Make executable (`chmod 0755`)

### Server Lifecycle

**Starting:**
```bash
~/.stigmer/bin/ollama serve &
```

- Logs to `~/.stigmer/logs/llm.log`
- PID saved to `~/.stigmer/llm.pid`
- Runs in background (detached from parent)

**Platform-Specific Process Management:**

**Unix (macOS, Linux):**
```go
cmd.SysProcAttr = &syscall.SysProcAttr{
    Setpgid: true, // New process group
    Pgid:    0,
}
```
- Process survives parent exit
- Can be managed independently

**Windows:**
```go
cmd.SysProcAttr = &syscall.SysProcAttr{
    CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | 0x00000008,
}
```
- `DETACHED_PROCESS` flag
- Runs independently of console

**Health Check:**
- Poll `localhost:11434/api/tags` every 500ms
- Timeout after 30 seconds
- Return error if server doesn't start

### Model Management

**Default Model:** `qwen2.5-coder:7b` (~4.7 GB)

**Storage:** Ollama manages model cache (typically `~/.ollama/models/`)

**Checking Availability:**
```bash
~/.stigmer/bin/ollama list
```

**Downloading:**
```bash
~/.stigmer/bin/ollama pull qwen2.5-coder:7b
```

- Shows progress from ollama CLI
- Takes 3-10 minutes depending on connection
- Resumable if interrupted

### Progress Display

Uses existing `ProgressDisplay` infrastructure:

**Phases:**
- `PhaseInitializing` → "Setting up local LLM"
- `PhaseInstalling` → "Downloading local LLM" or "Downloading model"
- `PhaseStarting` → "Starting local LLM server"

**Updates:**
```go
progress.SetPhase(cliprint.PhaseInstalling, "Downloading local LLM: 50% (75 MB / 150 MB)")
```

No new UI methods needed—integrates seamlessly.

### Configuration Integration

**Config File (`~/.stigmer/config.yaml`):**
```yaml
backend:
  type: local
  local:
    llm:
      provider: ollama          # Implementation detail
      model: qwen2.5-coder:7b
      base_url: http://localhost:11434
```

**Daemon Startup Sequence:**
1. Load config
2. Resolve LLM provider (`cfg.Backend.Local.ResolveLLMProvider()`)
3. If `ollama`: Call `llm.Setup()`
4. Continue with Temporal initialization
5. Start agent-runner (connects to LLM)

## User-Facing Commands

### Server Management

**Start (automatic LLM setup):**
```bash
stigmer server
```

**Status (shows LLM info):**
```bash
stigmer server status

# Output:
Stigmer Server Status:
─────────────────────────────────────
  Status: ✓ Running
  PID:    12345
  Port:   7234
  Data:   ~/.stigmer/data

LLM Configuration:
  Provider: Local ✓ Running
  PID:      12346
  Model:    qwen2.5-coder:7b
  Available: qwen2.5-coder:7b

Web UI:
  Temporal:  http://localhost:8233
```

### LLM Model Management

**List available models:**
```bash
stigmer server llm list

# Output:
Available Models:
─────────────────────────────────────
  qwen2.5-coder:7b (current)
  codellama:7b

To pull a new model:
  stigmer server llm pull <model-name>
```

**Pull a new model:**
```bash
stigmer server llm pull deepseek-coder:6.7b

# Output:
Pulling model deepseek-coder:6.7b...
This may take several minutes depending on model size

   ⣷ Installing: Downloading model deepseek-coder:6.7b...
   ... progress from ollama ...
✓ Model deepseek-coder:6.7b is ready

To use this model, update your configuration:
  stigmer config set llm.model deepseek-coder:6.7b
```

**Check LLM status:**
```bash
stigmer server llm status

# Output:
LLM Configuration:
  Provider: Local ✓ Running
  PID:      12346
  Model:    qwen2.5-coder:7b
  Available: qwen2.5-coder:7b, deepseek-coder:6.7b
```

## Error Handling

### Common Scenarios

| Scenario | Detection | Handling |
|---|---|---|
| **Binary download fails** | HTTP error | Return error with details, suggest manual install |
| **Server won't start** | Timeout after 30s | Return error with log file location |
| **Model pull interrupted** | Ollama handles | Automatically resumes on next attempt |
| **Port 11434 in use** | IsRunning() returns true | Reuse existing server (no-op) |
| **Server crashes** | Health check fails | Auto-restart on next `stigmer server` |
| **Insufficient disk space** | OS error | Return error, show disk usage |

### Example Error Message

**Download Failure:**
```
❌ Failed to download local LLM: connection refused

Unable to reach github.com. This could be due to:
• No internet connection
• GitHub releases unavailable
• Firewall blocking downloads

You can:
1. Check your internet connection and try again
2. Install Ollama manually: https://ollama.ai/download
   (Place binary at ~/.stigmer/bin/ollama)
3. Use Cloud mode instead: stigmer config set backend.type cloud
```

## Design Decisions

### Why Abstract "Ollama" as "Local LLM"?

**Rationale:**
- Ollama is an implementation detail users don't need to know
- Easier to swap providers in the future (e.g., llama.cpp, vLLM)
- Simpler mental model: "local" vs "cloud"

**Impact:**
- All user-facing text says "Local LLM"
- Config still uses "ollama" internally (can change transparently)
- Commands are `stigmer server llm`, not `stigmer ollama`

### Why Auto-Download Instead of Requiring Pre-Install?

**Rationale:**
- Reduces onboarding friction from 5+ steps to zero
- Users get "it just works" experience
- No risk of version mismatches

**Trade-offs:**
- First run takes longer (5-10 minutes)
- Downloads ~5 GB of data (binary + model)
- But only happens once—subsequent runs are instant

### Why Integrate with Server Command?

**Rationale:**
- LLM is infrastructure, like Temporal
- Lifecycle should be tied to server
- Natural command structure: `stigmer server llm`

**Alternatives considered:**
- ❌ `stigmer ollama` - Exposes implementation detail
- ❌ `stigmer llm` - Implies standalone tool
- ✅ `stigmer server llm` - Clear it's server infrastructure

## Future Enhancements

### 1. System Requirements Check

Warn users if system doesn't meet minimum requirements:

```go
if RAM < 6 GB {
    return errors.New(`
⚠️  Warning: Your system has 4 GB RAM, but local LLMs require at least 6 GB.
   Performance may be slow or unstable.
   
   We recommend using Cloud mode for this machine:
     stigmer config set backend.type cloud
`)
}
```

### 2. Smart Model Selection

Choose model based on available resources:

```go
if RAM < 8 GB {
    return "deepseek-coder:6.7b" // Smaller, faster
} else if RAM >= 16 GB {
    return "qwen2.5-coder:14b"   // Larger, better quality
} else {
    return "qwen2.5-coder:7b"    // Default
}
```

### 3. Model Auto-Update

Periodically check for model updates:

```bash
# Weekly check
if modelAge > 7days && newVersionAvailable {
    prompt "Model update available. Download now? [y/N]"
}
```

### 4. GPU Acceleration

Detect and use GPU if available:

```go
if hasNvidiaGPU() {
    // Use GPU-accelerated Ollama
    env = append(env, "OLLAMA_GPU=true")
}
```

### 5. Shared Model Cache

Reuse models if Ollama installed elsewhere:

```go
if ollamaInstalled() && modelsExist() {
    symlinkToExistingModels()
}
```

## Performance Characteristics

### First Run (Cold Start)

| Phase | Time | Size |
|---|---|---|
| Download binary | ~30s | ~150 MB |
| Start server | ~5s | - |
| Download model | ~3-10m | ~4.7 GB |
| **Total** | **~4-11m** | **~5 GB** |

*Network-dependent. Fast connection: 4 minutes. Slow connection: 11 minutes.*

### Subsequent Runs (Warm Start)

| Phase | Time |
|---|---|
| Check if running | < 100ms |
| Start server (if stopped) | ~5s |
| Health check | ~500ms |
| **Total** | **< 6s** |

### Steady State

| Operation | Time |
|---|---|
| Health check | < 100ms |
| Model inference | 1-5s per request |
| Model switching | ~30s (load into memory) |

## Troubleshooting

### Server Won't Start

**Symptom:** Timeout waiting for server

**Check:**
```bash
# View logs
tail -f ~/.stigmer/logs/llm.log

# Check if port in use
lsof -i :11434
```

**Fix:**
- Kill process using port 11434
- Or restart Stigmer server

### Model Download Stuck

**Symptom:** Download doesn't progress

**Check:**
```bash
# Test connection
curl -I https://registry.ollama.ai

# Check disk space
df -h ~/.ollama
```

**Fix:**
- Ensure stable internet connection
- Free up disk space
- Download will resume automatically

### Process Cleanup

**Symptom:** Orphaned LLM process after crash

**Check:**
```bash
ps aux | grep ollama
```

**Fix:**
```bash
# Kill orphaned process
kill $(cat ~/.stigmer/llm.pid)

# Clean up stale PID file
rm ~/.stigmer/llm.pid

# Restart
stigmer server
```

## Security Considerations

### Binary Verification

**Current:** Downloads from GitHub releases (HTTPS)

**Future Enhancement:** SHA256 checksum verification
```go
expectedSHA := "abc123..."
actualSHA := sha256sum(downloadedFile)
if actualSHA != expectedSHA {
    return errors.New("binary verification failed")
}
```

### Process Isolation

**Current:** Runs as user process

**Future Enhancement:** Separate user account for multi-user systems
```bash
# Run as dedicated user
sudo -u ollama ~/.stigmer/bin/ollama serve
```

### Log Sanitization

**Current:** Logs written to `~/.stigmer/logs/llm.log`

**Best Practice:** Ensure logs don't contain:
- API keys or tokens
- User prompts (if sensitive)
- Internal system paths

## Related Documentation

- [Getting Started: Local Mode](../getting-started/local-mode.md) - User guide for local mode
- [CLI Configuration](../cli/configuration.md) - Full configuration reference
- [CLI Subprocess Lifecycle](cli-subprocess-lifecycle.md) - Process management architecture
- [Backend Modes](backend-modes.md) - Local vs Cloud comparison

---

**Summary:** LLM automation transforms local setup from 5+ manual steps to zero configuration. Users run `stigmer server` and everything works automatically, with clear progress feedback and robust error handling.
