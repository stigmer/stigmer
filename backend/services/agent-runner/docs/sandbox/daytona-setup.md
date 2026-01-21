# Daytona Sandbox Setup

Guide for using Stigmer's full sandbox image with Daytona workspaces.

## Overview

Daytona provides persistent, cloud-hosted development environments. This guide shows how to:
1. Build the full sandbox image with all tools
2. Push to Daytona
3. Create a snapshot
4. Use the snapshot in Stigmer workflows

## Prerequisites

- Daytona account and API key
- Docker installed locally
- Stigmer agent-runner source code

## Step 1: Build Full Sandbox Image

The full sandbox includes ALL development tools (~1-2GB):
- Python, Node, Go
- AWS CLI, gcloud, Azure CLI
- kubectl, helm, terraform, pulumi
- Docker CLI, GitHub CLI, and more

```bash
cd backend/services/agent-runner/sandbox

# Build the full sandbox
docker build -f Dockerfile.sandbox.full -t stigmer-sandbox-full:latest .

# Verify it built successfully
docker run --rm stigmer-sandbox-full:latest bash -c "
  python3 --version && \
  node --version && \
  aws --version && \
  gcloud version && \
  kubectl version --client && \
  terraform version
"
```

**Expected build time:** 10-15 minutes (depending on connection)

## Step 2: Push Image to Daytona

### Option A: Use Daytona Registry (Recommended)

```bash
# Tag for Daytona
docker tag stigmer-sandbox-full:latest daytona.io/mycompany/stigmer-sandbox:v1

# Log in to Daytona
daytona login

# Push to Daytona registry
docker push daytona.io/mycompany/stigmer-sandbox:v1
```

### Option B: Use GitHub Container Registry

```bash
# Tag for GHCR
docker tag stigmer-sandbox-full:latest ghcr.io/mycompany/stigmer-sandbox:v1

# Log in to GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Push to GHCR
docker push ghcr.io/mycompany/stigmer-sandbox:v1

# Configure Daytona to use GHCR image
# (See Daytona documentation)
```

## Step 3: Create Daytona Snapshot

### Using Daytona CLI

```bash
# Create a new workspace from the image
daytona workspace create \
  --name stigmer-sandbox \
  --image daytona.io/mycompany/stigmer-sandbox:v1

# Wait for workspace to be ready
daytona workspace status stigmer-sandbox

# Create a snapshot
daytona snapshot create stigmer-sandbox \
  --name stigmer-tools-v1 \
  --description "Stigmer sandbox with all development tools"

# Get snapshot ID (save this!)
daytona snapshot list
# Output: snapshot-abc123def456
```

### Using Daytona Web Console

1. Go to Daytona dashboard
2. Create new workspace
3. Select custom image: `daytona.io/mycompany/stigmer-sandbox:v1`
4. Wait for workspace to start
5. Click "Create Snapshot"
6. Name: `stigmer-tools-v1`
7. Copy the snapshot ID

## Step 4: Configure Stigmer to Use Snapshot

### Method 1: Environment Variable

```bash
# Set the snapshot ID
export DAYTONA_DEV_TOOLS_SNAPSHOT_ID=snapshot-abc123def456

# Run in cloud mode with Daytona
MODE=cloud DAYTONA_API_KEY=your-api-key stigmer server start
```

### Method 2: Configuration File

Create `~/.stigmer/config.yaml`:

```yaml
mode: cloud
sandbox:
  type: daytona
  snapshot_id: snapshot-abc123def456

daytona:
  api_key: your-api-key
```

Then start server:

```bash
stigmer server start --config ~/.stigmer/config.yaml
```

## Step 5: Verify Setup

Test that Stigmer can use the Daytona snapshot:

```bash
# Start agent-runner in cloud mode
MODE=cloud \
DAYTONA_DEV_TOOLS_SNAPSHOT_ID=snapshot-abc123def456 \
DAYTONA_API_KEY=your-api-key \
stigmer server start

# In another terminal, trigger an agent execution
stigmer run "aws --version"
# Should output: aws-cli/2.x.x ...

stigmer run "terraform version"
# Should output: Terraform v1.x.x

stigmer run "kubectl version --client"
# Should output: Client Version: v1.x.x
```

## Snapshot Updates

### When to Update

Update your snapshot when:
- Tool versions need updating
- New tools are required
- Security patches are released
- Team requirements change

### How to Update

```bash
# 1. Rebuild the image locally
cd backend/services/agent-runner/sandbox
docker build -f Dockerfile.sandbox.full -t stigmer-sandbox-full:v2 .

# 2. Push to registry
docker tag stigmer-sandbox-full:v2 daytona.io/mycompany/stigmer-sandbox:v2
docker push daytona.io/mycompany/stigmer-sandbox:v2

# 3. Create new snapshot
daytona workspace create \
  --name stigmer-sandbox-v2 \
  --image daytona.io/mycompany/stigmer-sandbox:v2

daytona snapshot create stigmer-sandbox-v2 \
  --name stigmer-tools-v2

# 4. Update Stigmer config
export DAYTONA_DEV_TOOLS_SNAPSHOT_ID=snapshot-new-id-here
```

## Customizing the Snapshot

### Adding Tools

Edit `Dockerfile.sandbox.full`:

```dockerfile
# Add at the end, before verification
RUN apt-get update && apt-get install -y \
    your-custom-tool \
    && rm -rf /var/lib/apt/lists/*

# Or install from source
RUN curl -LO https://example.com/tool && \
    install -o root -g root -m 0755 tool /usr/local/bin/tool
```

Rebuild and create new snapshot (see Step 2-3).

### Adding Python Packages

Edit `Dockerfile.sandbox.full`:

```dockerfile
# Before the verification step
RUN pip3 install --no-cache-dir \
    your-package==1.2.3 \
    another-package==4.5.6 \
    --break-system-packages
```

### Adding Node Packages

```dockerfile
# Install global npm packages
RUN npm install -g \
    typescript \
    @angular/cli \
    your-package
```

## Troubleshooting

### Image Build Fails

**Problem:** Docker build fails on tool installation.

**Solutions:**
1. Check internet connection
2. Verify Dockerfile syntax
3. Try building with `--no-cache`:
   ```bash
   docker build --no-cache -f Dockerfile.sandbox.full -t stigmer-sandbox-full .
   ```
4. Check specific tool installation logs

### Push to Daytona Fails

**Problem:** `docker push` fails with authentication error.

**Solutions:**
1. Verify Daytona login:
   ```bash
   daytona login
   daytona auth status
   ```
2. Check registry permissions
3. Ensure image name follows Daytona naming convention

### Snapshot Creation Slow

**Problem:** Snapshot takes 10+ minutes to create.

**Explanation:** Normal for large images (~1-2GB). Daytona is:
- Pulling the full image
- Starting the workspace
- Capturing filesystem state
- Compressing and storing

**Tips:**
- Be patient (first time is slowest)
- Subsequent snapshots are faster
- Consider smaller base image if speed critical

### Stigmer Can't Find Tools in Snapshot

**Problem:** Commands fail with "command not found".

**Solutions:**
1. Verify tool in snapshot:
   ```bash
   daytona workspace exec stigmer-sandbox -- which aws
   daytona workspace exec stigmer-sandbox -- aws --version
   ```
2. Check PATH in snapshot
3. Rebuild image with explicit tool installation
4. Verify snapshot ID is correct in config

## Cost Optimization

### Snapshot Storage

Daytona charges for snapshot storage. To minimize:
- Delete old snapshots when no longer needed
- Use incremental snapshots when possible
- Share snapshots across team (don't duplicate)

### Workspace Usage

- Set workspace timeout (auto-shutdown)
- Use snapshot for consistent environment (start from snapshot, not image)
- Monitor workspace usage in Daytona dashboard

## Team Collaboration

### Sharing Snapshots

```bash
# Share snapshot with team
daytona snapshot share snapshot-abc123 --team engineering

# Team members use same snapshot ID
export DAYTONA_DEV_TOOLS_SNAPSHOT_ID=snapshot-abc123
```

### Version Control

Keep track of snapshot versions:

```bash
# Create SNAPSHOT_VERSIONS.md in your repo
## Stigmer Sandbox Snapshots

### v1 (2026-01-22)
- Snapshot ID: `snapshot-abc123`
- Tools: Python 3.11, Node 20, AWS CLI, kubectl, terraform
- Base image: stigmer-sandbox-full:v1

### v2 (2026-02-15)
- Snapshot ID: `snapshot-def456`
- Tools: + Azure CLI, + Pulumi
- Base image: stigmer-sandbox-full:v2
```

## Best Practices

1. **Version your snapshots** - Use semantic versioning (v1, v2, etc.)
2. **Document changes** - Keep CHANGELOG for snapshot updates
3. **Test before deploying** - Verify new snapshot locally first
4. **Pin versions** - Use specific tool versions in Dockerfile
5. **Clean up old snapshots** - Delete unused snapshots to save costs
6. **Share within team** - One snapshot per team, not per developer
7. **Automate updates** - CI/CD pipeline to rebuild and publish snapshots

## Alternative: Local Testing Without Daytona

If you want to test the full sandbox locally before Daytona:

```bash
# Build locally
docker build -f Dockerfile.sandbox.full -t stigmer-sandbox-full:local .

# Use with Stigmer in sandbox mode (not cloud mode)
export STIGMER_SANDBOX_IMAGE=stigmer-sandbox-full:local
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start

# Test commands
stigmer run "aws --version"
stigmer run "terraform version"
```

This uses Docker locally instead of Daytona, useful for development and testing.

## Resources

- [Daytona Documentation](https://www.daytona.io/docs)
- [Daytona CLI Reference](https://www.daytona.io/docs/cli)
- [Stigmer Execution Modes](./execution-modes.md)
- [Local Sandbox Setup](./local-setup.md)

## Support

For issues with:
- **Daytona**: Contact Daytona support or check their docs
- **Stigmer integration**: Open issue at github.com/stigmer/stigmer
- **Custom tools**: Check tool's documentation and installation guides
