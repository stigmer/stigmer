# Local Sandbox Setup

Guide for running sandbox Docker containers locally for development and testing.

## Overview

This guide covers running Stigmer sandboxes locally without Daytona:
- Building sandbox images locally
- Running sandboxes with docker-compose
- Development workflow
- Testing and debugging

## Prerequisites

- Docker installed and running
- Docker Compose (usually included with Docker Desktop)
- Stigmer agent-runner source code

## Quick Start

### 1. Build Basic Sandbox

```bash
cd backend/services/agent-runner/sandbox

# Build lightweight basic sandbox (~300MB)
docker build -f Dockerfile.sandbox.basic -t stigmer-sandbox-basic:local .

# Verify build
docker run --rm stigmer-sandbox-basic:local bash -c "
  python --version && \
  node --version && \
  git --version
"
```

### 2. Run Stigmer with Local Sandbox

```bash
# Use local sandbox image
export STIGMER_SANDBOX_IMAGE=stigmer-sandbox-basic:local
export STIGMER_EXECUTION_MODE=sandbox

# Start agent-runner
cd ../../..  # Back to repo root
stigmer server start
```

### 3. Test Execution

```bash
# In another terminal
stigmer run "python --version"
# Output: Python 3.11.x

stigmer run "npm --version"
# Output: 10.x.x
```

## Building Sandbox Images

### Basic Sandbox (Recommended)

```bash
cd backend/services/agent-runner/sandbox

# Build
docker build -f Dockerfile.sandbox.basic -t stigmer-sandbox-basic:local .

# Test
docker run --rm -it stigmer-sandbox-basic:local bash
```

**What's included:**
- Python 3.11 + pip
- Node.js 20 + npm
- Git, curl, jq, bash
- Build tools for Python packages

**Size:** ~300MB

### Full Sandbox (All Tools)

```bash
cd backend/services/agent-runner/sandbox

# Build (takes 10-15 minutes)
docker build -f Dockerfile.sandbox.full -t stigmer-sandbox-full:local .

# Test
docker run --rm -it stigmer-sandbox-full:local bash

# Inside container, verify tools
aws --version
gcloud version
kubectl version --client
terraform version
```

**What's included:**
- Everything from basic +
- AWS CLI, gcloud, Azure CLI
- kubectl, helm, k9s
- terraform, pulumi
- Docker CLI, and more

**Size:** ~1-2GB

## Development Workflow

### Iterative Development

```bash
# 1. Make changes to code
vim backend/services/agent-runner/worker/sandbox_manager.py

# 2. Rebuild sandbox if Dockerfile changed
cd backend/services/agent-runner/sandbox
docker build -f Dockerfile.sandbox.basic -t stigmer-sandbox-basic:local .

# 3. Test with local sandbox
export STIGMER_SANDBOX_IMAGE=stigmer-sandbox-basic:local
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start

# 4. Run test commands
stigmer run "python -c 'print(\"Hello from sandbox!\")'"
```

### Using Makefile Targets

```bash
# From repo root

# Build basic sandbox
make sandbox-build-basic

# Build full sandbox
make sandbox-build-full

# Test sandbox
make sandbox-test

# Full dev setup (CLI + agent-runner + sandbox)
make dev-full
```

## Docker Compose Setup

### Basic Configuration

Create `docker-compose.sandbox.yml`:

```yaml
version: '3.8'

services:
  sandbox:
    image: stigmer-sandbox-basic:local
    container_name: stigmer-sandbox
    volumes:
      - ./workspace:/workspace
      - ./logs:/logs
    working_dir: /workspace
    command: tail -f /dev/null  # Keep container running
    restart: unless-stopped
```

### Usage

```bash
cd backend/services/agent-runner/sandbox

# Start sandbox
docker-compose -f docker-compose.sandbox.yml up -d

# Execute commands in sandbox
docker-compose -f docker-compose.sandbox.yml exec sandbox bash
docker-compose -f docker-compose.sandbox.yml exec sandbox python --version

# Stop sandbox
docker-compose -f docker-compose.sandbox.yml down
```

### Advanced Configuration

```yaml
version: '3.8'

services:
  sandbox:
    image: stigmer-sandbox-basic:local
    container_name: stigmer-sandbox
    
    # Volume mounts
    volumes:
      - ./workspace:/workspace
      - ./logs:/logs
      - ~/.aws:/home/sandbox/.aws:ro  # AWS credentials (read-only)
      - ~/.kube:/home/sandbox/.kube:ro  # Kubernetes config (read-only)
    
    # Environment variables
    environment:
      - PYTHONUNBUFFERED=1
      - NODE_ENV=development
    
    # Networking
    network_mode: bridge
    ports:
      - "3000:3000"  # Example app port
    
    # Resource limits
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
    
    # Working directory
    working_dir: /workspace
    
    # Keep running
    command: tail -f /dev/null
    
    # Restart policy
    restart: unless-stopped
```

## Testing

### Manual Testing

```bash
# Build sandbox
docker build -f Dockerfile.sandbox.basic -t stigmer-sandbox-basic:local .

# Run interactive shell
docker run --rm -it stigmer-sandbox-basic:local bash

# Inside container, test commands
python --version
node --version
pip list
npm list -g

# Test Python packages
python -c "import yaml; print(yaml.__version__)"

# Test Node packages
node -e "console.log('Hello from Node')"

# Exit container
exit
```

### Automated Testing

Create `test-sandbox.sh`:

```bash
#!/bin/bash
set -e

IMAGE=${1:-stigmer-sandbox-basic:local}

echo "Testing sandbox image: $IMAGE"

# Test Python
echo "✓ Testing Python..."
docker run --rm $IMAGE python --version

# Test Node
echo "✓ Testing Node..."
docker run --rm $IMAGE node --version

# Test Git
echo "✓ Testing Git..."
docker run --rm $IMAGE git --version

# Test Python packages
echo "✓ Testing Python packages..."
docker run --rm $IMAGE python -c "import yaml, requests, click"

# Test file operations
echo "✓ Testing file operations..."
docker run --rm $IMAGE bash -c "echo 'test' > /tmp/test.txt && cat /tmp/test.txt"

echo "✅ All tests passed!"
```

Run tests:

```bash
chmod +x test-sandbox.sh
./test-sandbox.sh stigmer-sandbox-basic:local
```

## Debugging

### Check Container Logs

```bash
# List running containers
docker ps

# View logs
docker logs stigmer-sandbox

# Follow logs
docker logs -f stigmer-sandbox
```

### Inspect Container

```bash
# Get container details
docker inspect stigmer-sandbox

# Check environment variables
docker exec stigmer-sandbox env

# Check installed packages
docker exec stigmer-sandbox pip list
docker exec stigmer-sandbox npm list -g --depth=0
```

### Debug Build Issues

```bash
# Build with no cache
docker build --no-cache -f Dockerfile.sandbox.basic -t stigmer-sandbox-basic:local .

# Build with progress output
docker build --progress=plain -f Dockerfile.sandbox.basic -t stigmer-sandbox-basic:local .

# Build specific stage (for multi-stage builds)
docker build --target base -f Dockerfile.sandbox.basic -t stigmer-sandbox-base:local .
```

### Interactive Debugging

```bash
# Start sandbox with shell
docker run --rm -it stigmer-sandbox-basic:local bash

# Or attach to running container
docker exec -it stigmer-sandbox bash

# Inside container
whoami
pwd
ls -la
env
python --version
which python
```

## Customization

### Adding Python Packages

Edit `requirements.txt`:

```txt
# Add your packages
pyyaml==6.0.1
requests==2.31.0
pandas==2.2.0  # New package
numpy==1.26.4  # New package
```

Rebuild:

```bash
docker build -f Dockerfile.sandbox.basic -t stigmer-sandbox-basic:local .
```

### Adding System Tools

Edit `Dockerfile.sandbox.basic`:

```dockerfile
# Add after existing RUN apt-get install
RUN apt-get update && apt-get install -y \
    vim \
    htop \
    net-tools \
    && rm -rf /var/lib/apt/lists/*
```

Rebuild:

```bash
docker build -f Dockerfile.sandbox.basic -t stigmer-sandbox-basic:local .
```

### Adding Node Packages

Edit `Dockerfile.sandbox.basic`:

```dockerfile
# Add before USER sandbox
RUN npm install -g \
    typescript \
    @angular/cli \
    prettier
```

Rebuild:

```bash
docker build -f Dockerfile.sandbox.basic -t stigmer-sandbox-basic:local .
```

## Volume Mounting

### Workspace Persistence

```bash
# Create workspace directory
mkdir -p ~/stigmer-workspace

# Run with mounted workspace
docker run --rm -it \
  -v ~/stigmer-workspace:/workspace \
  stigmer-sandbox-basic:local bash

# Files created in /workspace persist to ~/stigmer-workspace
```

### Mounting Credentials

```bash
# Mount AWS credentials (read-only)
docker run --rm -it \
  -v ~/.aws:/home/sandbox/.aws:ro \
  stigmer-sandbox-basic:local bash

# Inside container
aws s3 ls  # Uses your credentials
```

### Mounting Source Code

```bash
# Mount your project for testing
docker run --rm -it \
  -v $(pwd):/workspace \
  stigmer-sandbox-basic:local bash

# Inside container
cd /workspace
python your_script.py
```

## Performance Optimization

### Layer Caching

Order Dockerfile commands from least to most frequently changed:

```dockerfile
# ✅ Good: OS packages change rarely
RUN apt-get update && apt-get install -y git curl

# ✅ Good: Python version changes rarely
COPY requirements.txt .
RUN pip install -r requirements.txt

# ✅ Good: Application code changes often (last)
COPY . .
```

### Multi-Stage Builds

Use multi-stage builds to reduce final image size:

```dockerfile
# Build stage
FROM python:3.11 AS builder
COPY requirements.txt .
RUN pip install --prefix=/install -r requirements.txt

# Runtime stage
FROM python:3.11-slim
COPY --from=builder /install /usr/local
COPY . .
```

### Cleanup

```bash
# Remove dangling images
docker image prune

# Remove unused containers
docker container prune

# Remove all (be careful!)
docker system prune -a
```

## Networking

### Accessing Host Services

```bash
# Use host.docker.internal (Docker Desktop)
docker run --rm -it stigmer-sandbox-basic:local bash
curl http://host.docker.internal:8080

# Or use --network=host (Linux only)
docker run --rm -it --network=host stigmer-sandbox-basic:local bash
```

### Container-to-Container

```yaml
# docker-compose.yml
services:
  sandbox:
    image: stigmer-sandbox-basic:local
    networks:
      - stigmer-network
  
  database:
    image: postgres:15
    networks:
      - stigmer-network

networks:
  stigmer-network:
```

## Troubleshooting

### "Permission denied" errors

```bash
# Issue: Container user can't write to mounted volume

# Solution 1: Run as root (not recommended)
docker run --rm -it --user root stigmer-sandbox-basic:local bash

# Solution 2: Fix permissions
sudo chown -R 1000:1000 ~/stigmer-workspace

# Solution 3: Use correct UID/GID
docker run --rm -it --user $(id -u):$(id -g) stigmer-sandbox-basic:local bash
```

### "No space left on device"

```bash
# Clean up Docker
docker system prune -a

# Check disk usage
docker system df

# Remove old images
docker images | grep stigmer-sandbox | awk '{print $3}' | xargs docker rmi
```

### Build fails with network errors

```bash
# Use different DNS
docker build --network=host --dns 8.8.8.8 -f Dockerfile.sandbox.basic -t stigmer-sandbox-basic:local .

# Or configure Docker daemon DNS
# Edit /etc/docker/daemon.json
{
  "dns": ["8.8.8.8", "8.8.4.4"]
}
```

## Best Practices

1. **Tag images with version** - `stigmer-sandbox-basic:v1.0.0`
2. **Use .dockerignore** - Exclude unnecessary files from build context
3. **Pin versions** - Specify exact versions in requirements.txt
4. **Test before deploying** - Run automated tests
5. **Document changes** - Keep CHANGELOG for image updates
6. **Minimize layers** - Combine RUN commands where possible
7. **Clean up** - Remove unused images regularly

## Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Reference](https://docs.docker.com/compose/)
- [Stigmer Execution Modes](./execution-modes.md)
- [Daytona Setup](./daytona-setup.md)
