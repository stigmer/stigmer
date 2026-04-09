# Execution Modes

Stigmer supports three execution modes for running agent commands: **Local**, **Sandbox**, and **Auto**.

## Overview

| Mode | Where Commands Run | When to Use | Speed | Isolation |
|------|-------------------|-------------|-------|-----------|
| **local** | Host machine | Default, most users | Fast | None |
| **sandbox** | Docker container | CI/CD, clean env | Slight overhead | Complete |
| **auto** | Smart detection | Convenience | Varies | Varies |

---

## Local Mode (Default)

**How it works:** Commands execute directly on your machine using your installed tools.

### Configuration

```bash
# Default - no configuration needed
stigmer server start

# Or explicitly
export STIGMER_EXECUTION_MODE=local
stigmer server start
```

### What Happens

1. Agent-runner receives command
2. Executes using `subprocess` directly on host
3. Streams output back in real-time
4. Returns exit code and results

### Example

```bash
# Command: python --version
# Execution: subprocess.run(["python", "--version"])
# Output: Python 3.11.5 (your local Python)
```

### Pros

- ✅ Fast (no container overhead)
- ✅ Uses your existing environment
- ✅ Access to all your tools and configs
- ✅ Familiar file paths and permissions
- ✅ No additional downloads

### Cons

- ❌ No isolation (modifies host system)
- ❌ Requires tools to be installed locally
- ❌ Environment differences across machines

### Best For

- Open-source development
- Quick prototyping
- Using familiar tools
- Fast iteration
- Most everyday use cases

---

## Sandbox Mode (Isolated)

**How it works:** Commands execute in an isolated Docker container.

### Configuration

```bash
# Use basic sandbox (~300MB)
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start

# Use custom sandbox image
export STIGMER_SANDBOX_IMAGE=my-custom-sandbox:latest
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start
```

### What Happens

1. Agent-runner receives command
2. Ensures sandbox image is available (pulls if needed)
3. Creates/reuses sandbox container
4. Executes command in container
5. Streams output back
6. Cleans up container (configurable)

### Example

```bash
# Command: python --version
# Execution: docker exec sandbox-abc123 python --version
# Output: Python 3.11 (from sandbox image)
```

### Sandbox Tiers

**Basic Sandbox** (default for sandbox mode):
- Image: `ghcr.io/stigmer/agent-sandbox-basic:latest`
- Size: ~300MB
- Tools: Python, Node, Git, curl, jq

**Custom Sandbox** (power users):
- Build from `Dockerfile.sandbox.full`
- Size: ~1-2GB
- Tools: Everything (AWS, GCP, kubectl, terraform, etc.)

### Pros

- ✅ Complete isolation
- ✅ Reproducible environment
- ✅ Clean testing
- ✅ Good for CI/CD

### Cons

- ❌ Slight performance overhead
- ❌ Additional image download
- ❌ Container management complexity

### Best For

- CI/CD pipelines
- Clean environment testing
- Package installation (pip, npm)
- Teams sharing exact environment
- Security-sensitive operations

---

## Auto Mode (Smart Detection)

**How it works:** Automatically chooses local or sandbox based on command characteristics.

### Configuration

```bash
export STIGMER_EXECUTION_MODE=auto
stigmer server start
```

### Detection Logic

**Triggers sandbox mode:**
- Command uses package managers (`pip`, `npm`, `apt`, `yum`)
- Custom `requirements.txt` provided
- Command modifies system state
- Potentially risky operations

**Uses local mode:**
- Simple shell commands (`echo`, `ls`, `cd`, `pwd`)
- Read-only operations
- Standard utilities

### Examples

```bash
# Auto → Local (safe, read-only)
ls -la
git status
python script.py

# Auto → Sandbox (modifies system)
pip install requests
npm install -g typescript
apt update && apt install curl
```

### Pros

- ✅ Balances speed and safety
- ✅ Transparent to user
- ✅ No configuration needed

### Cons

- ❌ Less predictable
- ❌ May sandbox when not needed

### Best For

- Users who don't want to think about it
- Mixed workloads (read + write)
- Learning Stigmer

---

## Configuration Reference

### Environment Variables

```bash
# Execution mode
STIGMER_EXECUTION_MODE=local|sandbox|auto  # Default: local

# Sandbox image (for sandbox/auto modes)
STIGMER_SANDBOX_IMAGE=ghcr.io/stigmer/agent-sandbox-basic:latest

# Auto-pull sandbox image if missing
STIGMER_SANDBOX_AUTO_PULL=true  # Default: true

# Cleanup containers after execution
STIGMER_SANDBOX_CLEANUP=true  # Default: true

# Sandbox container lifetime (for reuse)
STIGMER_SANDBOX_TTL=3600  # Seconds, default: 1 hour
```

### CLI Flags (Future)

```bash
# Override mode per command
stigmer run --mode=sandbox "pip install requests"
stigmer run --mode=local "git status"

# Use custom image
stigmer run --sandbox-image=my-custom:latest "terraform apply"
```

---

## Comparison with Cursor

Stigmer's execution modes follow **Cursor's proven philosophy**:

| Aspect | Cursor | Stigmer |
|--------|--------|---------|
| **Default** | Local execution | Local execution ✅ |
| **Sandbox option** | Available | Available ✅ |
| **Heavy images** | Not forced | Not forced ✅ |
| **User control** | Simple toggle | Simple toggle ✅ |
| **Philosophy** | Fast by default | Fast by default ✅ |

---

## Migration Guide

### From PyInstaller (Old)

**Before:**
```bash
# Used bundled Python binary
stigmer-agent-runner execute "command"
```

**After:**
```bash
# Default: Uses host Python (local mode)
export STIGMER_EXECUTION_MODE=local
stigmer server start

# Optional: Use sandbox
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start
```

### From Daytona Only (Old)

**Before:**
```bash
# Always used Daytona sandbox
DAYTONA_API_KEY=xxx stigmer-agent-runner
```

**After:**
```bash
# Default: Local mode (no Daytona needed)
stigmer server start

# Optional: Use Docker sandbox
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start

# Or: Still use Daytona (cloud mode)
MODE=cloud DAYTONA_API_KEY=xxx stigmer server start
```

---

## Troubleshooting

### "Command not found" in Sandbox Mode

**Problem:** Command works locally but fails in sandbox.

**Solution:**
1. Install tool locally and use local mode
2. Or build custom sandbox with required tools:
   ```bash
   # Edit Dockerfile.sandbox.full
   # Add: RUN apt-get install -y your-tool
   docker build -f Dockerfile.sandbox.full -t my-sandbox .
   export STIGMER_SANDBOX_IMAGE=my-sandbox
   ```

### Slow Execution in Sandbox Mode

**Problem:** Commands take longer in sandbox.

**Solution:**
1. Use local mode if isolation not required
2. Enable container reuse (default):
   ```bash
   export STIGMER_SANDBOX_TTL=7200  # 2 hours
   ```
3. Pre-pull sandbox image:
   ```bash
   docker pull ghcr.io/stigmer/agent-sandbox-basic:latest
   ```

### Auto Mode Not Working as Expected

**Problem:** Auto mode sandboxes simple commands.

**Solution:**
1. Override with explicit local mode:
   ```bash
   export STIGMER_EXECUTION_MODE=local
   ```
2. Or adjust detection logic (contribute to stigmer!)

---

## Best Practices

### For Open Source Users

```bash
# Recommended: Local mode (default)
stigmer server start

# Fast, uses your tools, familiar environment
```

### For CI/CD

```bash
# Recommended: Sandbox mode with basic image
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start

# Clean, reproducible, isolated
```

### For Enterprise Teams

```bash
# Recommended: Custom sandbox image
docker build -f Dockerfile.sandbox.full -t company/sandbox:v1 .
docker push company/sandbox:v1

export STIGMER_SANDBOX_IMAGE=company/sandbox:v1
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start

# Shared environment, reproducible, customizable
```

### For Daytona Users

```bash
# Recommended: Cloud mode with Daytona
MODE=cloud DAYTONA_API_KEY=xxx stigmer server start

# Full Daytona integration, persistent workspaces
```

---

## Persistent Session Workspace

Agent executions run within sessions. Each session gets an isolated, persistent workspace that survives sandbox lifecycle events (stop, archive, destroy, recreate). This ensures the agent can resume after approval without losing files.

### How It Works

**The Problem:** Agent workspaces live on the sandbox filesystem. When a sandbox dies between the pause (waiting for approval) and resume, all files are lost -- skills, attachments, and agent work products.

**The Solution:** Decouple workspace storage from sandbox compute. Workspace files live on persistent storage; sandboxes are ephemeral compute.

```
Session (persistent)
├── thread_id    → LangGraph checkpoint (conversation state)
├── sandbox_id   → Sandbox ID (ephemeral compute, runtime packages)
└── Persistent workspace (files survive sandbox lifecycle)
    ├── bin/skills/          → Agent skill files
    ├── bin/attachments/     → User-uploaded files
    └── ...                  → Agent work products
```

### Local Mode

Each session gets its own directory under `{SANDBOX_ROOT_DIR}/sessions/{session_id}/`. Files persist as long as the directory exists.

```
workspace/
└── sessions/
    ├── abc-123-def/    → Session 1 workspace
    │   ├── bin/skills/
    │   └── ...
    └── xyz-789-ghi/    → Session 2 workspace
        ├── bin/skills/
        └── ...
```

**Configuration:** Automatic when `session_id` is provided. No additional setup needed.

### Cloud Mode (Daytona)

A single global Daytona Volume (`stigmer-workspaces`) is created at worker startup and shared across all sessions. Each session mounts a unique subpath.

```
Daytona Volume: stigmer-workspaces
└── sessions/
    ├── abc-123-def/    → Mounted at /home/daytona/workspace in sandbox A
    └── xyz-789-ghi/    → Mounted at /home/daytona/workspace in sandbox B
```

**Key properties:**
- Volume auto-created at worker startup via `daytona.volume.get("stigmer-workspaces", create=True)` (idempotent)
- Volume ID cached in worker memory; re-fetched on restart
- Mount path: `/home/daytona/workspace`
- Subpath isolation via `sessions/{session_id}` (UUID-based, no collision risk)
- Volume name configurable via `DAYTONA_VOLUME_NAME` env var (default: `stigmer-workspaces`)

### Sandbox Recovery Chain

Before creating a new sandbox, the system attempts to recover the existing one. This preserves runtime state (installed packages, compiled tools) in addition to workspace files.

| Sandbox State | Action | Timeout | Files | Packages |
|---|---|---|---|---|
| **STARTED** | Health check, reuse | 5s | Intact | Intact |
| **STOPPED** | `sandbox.start()` | 60s | Intact | Intact |
| **ARCHIVED** | `sandbox.start()` (restore) | 120s | Intact | Intact |
| **ERROR** (recoverable) | `sandbox.recover()` | 60s | Intact | Intact |
| **DESTROYED / Gone** | Create new + mount volume | ~30s | Intact (volume) | Lost |
| **Transitional** | Create new + mount volume | ~30s | Intact (volume) | Lost |

Sandbox `auto_delete_interval` is set to `-1` (disabled) so Daytona does not delete sandboxes behind our back.

### Resume Integrity Check

On the resume-after-approval path, a sentinel file check verifies that workspace files are intact before trusting the fast-path:

1. The first skill's `SKILL.md` is used as the sentinel (deterministic, always written first)
2. Local mode: `Path.exists()` on the local filesystem
3. Cloud mode: `test -f <path>` via `sandbox.process.exec()`
4. If the check passes: fast-path is used (skills and attachments are not re-written)
5. If the check fails: graceful fallback to full setup with `[RESUME-FALLBACK]` warning logged

This provides defense-in-depth: if a volume mount fails silently or data is corrupted, the agent still gets served correctly (just with a re-write penalty), and ops gets alerted via the warning log.

### Configuration Reference

```bash
# Volume name for persistent workspace (cloud mode)
DAYTONA_VOLUME_NAME=stigmer-workspaces  # Default: stigmer-workspaces

# Workspace root directory (local mode)
SANDBOX_ROOT_DIR=./workspace  # Default: ./workspace
```

---

## MCP Server Execution in Cloud Mode

In cloud mode (`MODE=cloud`), stdio MCP servers are started inside the Daytona sandbox rather than the agent-runner pod. This is a security boundary: untrusted MCP server code (downloaded via `npx`, `uvx`, or `go run`) never executes in the agent-runner container.

### How It Works

| Transport | Where It Runs | Notes |
|-----------|--------------|-------|
| **stdio** (cloud mode) | Daytona sandbox | Process started via Daytona session API; stdio relayed over the network |
| **stdio** (local mode) | Host subprocess | Standard subprocess, same as before |
| **HTTP / streamable_http** | Remote endpoint | Unaffected by this change; connects to a URL |

### Agent Execution Path

During agent execution, the workspace sandbox is already warm (created during workspace initialization). Stdio MCP servers start inside this existing sandbox with zero additional cold start. The `DaytonaMCPClient` wrapper routes stdio servers through `daytona_stdio_client` and delegates HTTP servers to `MultiServerMCPClient`.

### Connect/Discover Workflow

When a user connects a new MCP server, the `DiscoverMcpServerCapabilities` activity creates an **ephemeral** Daytona sandbox to run the stdio MCP server for tool discovery. The sandbox is deleted immediately after discovery completes. This preserves the immediate-discovery UX (tools and approval policies are visible at connect time) while maintaining the security boundary.

### Agent-Runner Dockerfile

The agent-runner Docker image no longer contains MCP runtimes (Node.js, Go, uvx). These runtimes live in the sandbox image. This reduces the agent-runner image size and attack surface.

### Local/OSS Mode

Local mode is unaffected. Stdio MCP servers continue to run as local subprocesses using whatever runtimes are installed on the host machine.

---

## Philosophy

**Make the common case fast, the uncommon case possible.**

- 90% of users: Local mode (default) - fast, no friction
- 5% of users: Basic sandbox - lightweight isolation
- <1% of users: Custom sandbox - full control

Don't force heavy downloads on everyone. Let users choose their level of isolation.
