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

### From Daytona SDK Runner (Old)

**Before:**
```bash
# Runner managed Daytona sandboxes directly via the SDK
DAYTONA_API_KEY=xxx stigmer-agent-runner
# Runner called SandboxManager, DaytonaWorkspaceBackend, DaytonaMCPClient
# Runner resolved MCP snapshots via SnapshotResolver
```

**After:**
```bash
# Default: Local mode (no Daytona needed)
stigmer server start

# Cloud mode: Runner runs INSIDE a Daytona sandbox (provisioned by stigmer-service)
# No DAYTONA_API_KEY needed — the runner is just a process in a container
MODE=cloud stigmer server start
```

Key differences:
- The runner no longer creates or manages Daytona sandboxes
- `stigmer-service` (Java) provisions sandboxes via `DaytonaSandboxRunnerLauncher`
- The runner always uses `LocalWorkspaceBackend` — whether on a laptop or inside a sandbox
- `MODE=cloud` means "running inside a sandbox provisioned by stigmer-service", not "use the Daytona SDK"
- `DAYTONA_API_KEY` is no longer needed by the runner
- `SandboxManager`, `DaytonaWorkspaceBackend`, `DaytonaMCPClient`, and `SnapshotResolver` are all deleted

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

### For Cloud Deployments

```bash
# stigmer-service provisions a Daytona sandbox and launches the runner inside it.
# The runner receives MODE=cloud and WORKSPACE_ROOT_DIR=/workspace from the launcher.
# No Daytona API key or SDK usage on the runner side.
MODE=cloud stigmer server start

# The runner behaves identically to local mode from a workspace perspective —
# LocalWorkspaceBackend reads/writes the local filesystem at /workspace.
```

---

## Persistent Session Workspace

Agent executions run within sessions. Each session gets an isolated, persistent workspace that survives across activity invocations. This ensures the agent can resume after approval without losing files.

### How It Works

**The Problem:** Agent workspaces must survive across Temporal activity invocations. When a HITL (human-in-the-loop) approval pauses execution, the workspace files (skills, attachments, work products) must be intact when execution resumes.

**The Solution:** Workspace files are stored on persistent storage scoped to the session. In local mode, this is a directory on the host. In cloud mode, this is a directory inside the Daytona sandbox's persistent volume.

```
Session (persistent)
├── thread_id    → LangGraph checkpoint (conversation state)
└── Persistent workspace (files survive across activity invocations)
    ├── bin/skills/          → Agent skill files
    ├── bin/attachments/     → User-uploaded files
    └── ...                  → Agent work products
```

### Local Mode

Each session gets its own directory under `{WORKSPACE_ROOT_DIR}/sessions/{session_id}/`. Files persist as long as the directory exists.

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

### Cloud Mode

In cloud mode the runner runs inside a Daytona sandbox provisioned by `stigmer-service`. The workspace is a local directory inside the sandbox (typically `/workspace`). From the runner's perspective, this is identical to local mode — it uses `LocalWorkspaceBackend` and reads/writes the local filesystem.

```
/workspace/                          → WORKSPACE_ROOT_DIR (inside the sandbox)
└── sessions/
    ├── abc-123-def/    → Session 1 workspace
    │   ├── bin/skills/
    │   └── ...
    └── xyz-789-ghi/    → Session 2 workspace
        ├── bin/skills/
        └── ...
```

**Key properties:**
- The runner does not manage sandbox lifecycle — `stigmer-service` handles creation, recovery, and cleanup
- Workspace persistence is handled by the sandbox's volume mount (configured by the launcher)
- The runner uses `LocalWorkspaceBackend` in both modes — the sandbox environment is transparent

### Resume Integrity Check

On the resume-after-approval path, a sentinel file check verifies that workspace files are intact before trusting the fast-path:

1. The first skill's `SKILL.md` is used as the sentinel (deterministic, always written first)
2. `Path.exists()` on the local filesystem (both local and cloud mode use `LocalWorkspaceBackend`)
3. If the check passes: fast-path is used (skills and attachments are not re-written)
4. If the check fails: graceful fallback to full setup with `[RESUME-FALLBACK]` warning logged

This provides defense-in-depth: if workspace data is lost or corrupted, the agent still gets served correctly (just with a re-write penalty), and ops gets alerted via the warning log.

### Configuration Reference

```bash
# Workspace root directory
# Local mode default: ./workspace
# Cloud mode default: /workspace
WORKSPACE_ROOT_DIR=./workspace
```

---

## MCP Server Execution

Stdio MCP servers always run as local subprocesses via `MultiServerMCPClient`, regardless of mode. In cloud mode the runner is inside a Daytona sandbox, so "local subprocess" means "inside the sandbox" — untrusted MCP server code never executes in the runner's host environment.

### How It Works

| Transport | Where It Runs | Notes |
|-----------|--------------|-------|
| **stdio** (any mode) | Local subprocess via `MultiServerMCPClient` | In cloud mode, "local" = inside the Daytona sandbox |
| **HTTP / streamable_http** | Remote endpoint | Connects to a URL, unaffected by mode |

### Agent Execution Path

During agent execution, stdio MCP servers are started as local subprocesses inside the runner process (or the sandbox container in cloud mode). `MultiServerMCPClient` manages the subprocess lifecycle. There is no network relay or remote process execution — stdio is always local.

### Connect/Discover Workflow

When a user connects a new MCP server, the `DiscoverMcpServerCapabilities` activity runs on the runner and connects to the MCP server using `MultiServerMCPClient`. For stdio servers this starts a local subprocess; for HTTP servers it connects to the remote endpoint. Discovery completes synchronously within the activity.

### MCP Package Installation

MCP runtimes (Node.js, uv/uvx) are included in the sandbox Docker image
(`Dockerfile.sandbox.full`). MCP server **packages** are NOT baked into the
image — they are installed on-demand by the agent-runner during execution
setup.

**How it works:**

1. During execution setup, the agent-runner fetches MCP server specs from
   both the agent blueprint and the session (merged via
   `merge_mcp_server_usages`).
2. The `package_installer` module inspects each stdio server's `command`
   and `args` to extract installable package names:
   - `npx -y <package>` → npm package (`npm install -g`)
   - `uvx <package>` → pip package (`uv tool install`)
   - Custom commands (`node`, `python`, etc.) are skipped.
3. Packages are installed concurrently as async subprocesses.
4. Individual package failures are logged but do not block the runner.
   Failed packages will attempt on-demand install via `npx -y` / `uvx`
   when the MCP server is first invoked.
5. The user sees an "Installing tools..." status during this phase,
   and Temporal heartbeats continue flowing.

**Install latency:** Typically 5-15 seconds for 1-5 packages on first
execution. Packages persist in the sandbox, so subsequent executions
in the same session see near-instant startup.

**Agents with no stdio MCP servers** (HTTP-only or no MCP servers):
the installer is a no-op.

### Local/OSS Mode

Local mode is unaffected. Stdio MCP servers run as local subprocesses using whatever runtimes are installed on the host machine.

---

## Architecture: Runner vs. stigmer-service Responsibilities

The agent-runner is intentionally simple — it is a stateless worker that executes commands on a local filesystem. All infrastructure orchestration is handled by `stigmer-service` (Java).

| Responsibility | Owner | Notes |
|----------------|-------|-------|
| Provisioning Daytona sandboxes | `stigmer-service` | Via `DaytonaSandboxRunnerLauncher` |
| Sandbox lifecycle (start/stop/recover) | `stigmer-service` | Runner is unaware of sandbox management |
| Workspace file I/O | `agent-runner` | Via `LocalWorkspaceBackend` |
| MCP server subprocess management | `agent-runner` | Via `MultiServerMCPClient` |
| LLM calls | `agent-runner` | Direct or via Side-Channel Proxy |
| Temporal activity execution | `agent-runner` | Polls per-runner task queue |
| Runner identity and heartbeat | `agent-runner` | Reports to stigmer-service via gRPC |

The runner does not import or use the Daytona SDK. It does not need `DAYTONA_API_KEY`. It treats its filesystem as local, whether that filesystem is a developer's laptop or a Daytona sandbox's `/workspace` volume.

---

## Philosophy

**Make the common case fast, the uncommon case possible.**

- 90% of users: Local mode (default) - fast, no friction
- 5% of users: Basic sandbox - lightweight isolation
- <1% of users: Custom sandbox - full control

Don't force heavy downloads on everyone. Let users choose their level of isolation.
