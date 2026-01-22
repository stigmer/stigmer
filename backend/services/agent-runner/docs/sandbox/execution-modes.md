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

## Philosophy

**Make the common case fast, the uncommon case possible.**

- 90% of users: Local mode (default) - fast, no friction
- 5% of users: Basic sandbox - lightweight isolation
- <1% of users: Custom sandbox - full control

Don't force heavy downloads on everyone. Let users choose their level of isolation.
