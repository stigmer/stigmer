# Stigmer Agent Sandbox Images

Three-tier sandbox strategy for flexible execution environments.

## Overview

Stigmer supports **three execution tiers**, following the same philosophy as Cursor:

1. **LOCAL MODE** (Default) - Execute directly on your machine
2. **BASIC SANDBOX** (Optional) - Lightweight isolation (~300MB)
3. **FULL SANDBOX** (Power Users) - Complete toolset (~1-2GB, build yourself)

## Tier 1: LOCAL MODE (Default - Recommended)

**What it is:** Commands execute directly on your machine using your installed tools.

**When to use:**
- ✅ Open-source development
- ✅ Quick prototyping
- ✅ Familiar environment
- ✅ Fast execution (no container overhead)

**Getting started:**
```bash
# This is the default - just start the server!
stigmer server start
```

**What you get:**
- Uses tools you already have (Python, Node, AWS CLI, etc.)
- Fast (no Docker overhead)
- Minimal download (~200MB agent-runner only)
- Familiar environment and configs

**Trade-off:** Less isolation (but same as Cursor)

---

## Tier 2: BASIC SANDBOX (Optional Isolation)

**What it is:** Lightweight Docker container with Python, Node, and Git only.

**Size:** ~300MB

**What's included:**
- Python 3.11 + pip
- Node.js 20 + npm
- Git, curl, jq, bash
- Build tools for Python packages
- NO cloud CLIs (keep it lightweight)

**When to use:**
- ✅ Basic isolation without bloat
- ✅ CI/CD pipelines
- ✅ Clean testing environment
- ✅ Users without local tools

**Getting started:**
```bash
# Enable sandbox mode
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start

# On first run with sandbox mode:
# → agent-runner pulls ghcr.io/stigmer/agent-sandbox-basic:latest (~300MB)
```

**Building locally:**
```bash
cd backend/services/agent-runner/sandbox
docker build -f Dockerfile.sandbox.basic -t stigmer-sandbox-basic:latest .
```

**Trade-off:** Small container overhead, no cloud CLIs included

---

## Tier 3: FULL SANDBOX (Power Users / Enterprise)

**What it is:** Reference Dockerfile with ALL development tools pre-installed.

**Size:** ~1-2GB

**What's included:**
- Everything from Basic Sandbox +
- AWS CLI, Google Cloud SDK, Azure CLI
- kubectl, helm, k9s
- terraform, pulumi
- Docker CLI, Tekton CLI
- GitHub CLI, yq, yamllint
- And much more...

**When to use:**
- ✅ Daytona workspaces
- ✅ Enterprise teams
- ✅ Complete tool reproducibility
- ✅ Custom team requirements

**Building yourself:**
```bash
cd backend/services/agent-runner/sandbox
docker build -f Dockerfile.sandbox.full -t my-custom-sandbox:latest .

# Use locally
export STIGMER_SANDBOX_IMAGE=my-custom-sandbox:latest
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start

# Or push to your registry
docker tag my-custom-sandbox:latest ghcr.io/mycompany/sandbox:v1
docker push ghcr.io/mycompany/sandbox:v1
```

**Trade-off:** Large image size, longer build time

---

## Comparison

| Aspect | Local | Basic Sandbox | Full Sandbox |
|--------|-------|---------------|--------------|
| **Download Size** | ~200MB (agent-runner only) | ~300MB | ~1-2GB |
| **Tools** | Your installed tools | Python + Node + Git | Everything |
| **Speed** | Fast (no overhead) | Slight overhead | Slight overhead |
| **Isolation** | None | Basic | Complete |
| **Best For** | Most users (90%) | CI/CD, clean env | Daytona, enterprise |
| **Default** | ✅ Yes | No | No |

---

## Quick Decision Guide

**I want to...**
- "Just get started quickly" → **LOCAL MODE** (default)
- "Test in clean environment" → **BASIC SANDBOX**
- "Use with Daytona" → **FULL SANDBOX** (build yourself)
- "Need AWS/GCP/Azure CLIs" → **Install locally** OR **FULL SANDBOX**
- "Share exact environment with team" → **FULL SANDBOX** (push to your registry)

---

## Configuration

### Environment Variables

```bash
# Execution mode
STIGMER_EXECUTION_MODE=local     # Default: local, sandbox, auto

# Custom sandbox image (for Tier 3)
STIGMER_SANDBOX_IMAGE=ghcr.io/mycompany/sandbox:v1

# Auto-pull behavior
STIGMER_SANDBOX_AUTO_PULL=true   # Default: true
```

### Mode Selection

**Local mode** (default):
```bash
stigmer server start
```

**Basic sandbox mode**:
```bash
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start
```

**Custom sandbox image**:
```bash
export STIGMER_SANDBOX_IMAGE=my-custom-sandbox:latest
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start
```

---

## Documentation

- **[Execution Modes](../docs/sandbox/execution-modes.md)** - Deep dive into local vs sandbox
- **[Daytona Setup](../docs/sandbox/daytona-setup.md)** - Using full sandbox with Daytona
- **[Local Setup](../docs/sandbox/local-setup.md)** - Running sandboxes locally

---

## Philosophy

We follow **Cursor's proven approach**:

1. **Default to local** - Most users don't need isolation
2. **Provide lightweight option** - For those who want basic isolation
3. **Enable power users** - Reference for full customization
4. **Don't force heavy downloads** - Respect user bandwidth and time

**Make the common case fast, the uncommon case possible.**
