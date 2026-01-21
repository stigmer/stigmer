# T01: Docker Migration Task Plan

**Status**: PENDING_REVIEW  
**Created**: 2026-01-22  
**Estimated Time**: 4-6 hours

## Overview

Replace PyInstaller-based agent-runner with Docker-based distribution. This plan breaks down the migration into 5 main phases with clear acceptance criteria.

## Phase 1: Create Dockerfile and Docker Compose (1-1.5 hours)

### Goal
Build a working Docker image for agent-runner that matches current functionality.

### Tasks

#### 1.1 Create Production Dockerfile
**Location**: `backend/services/agent-runner/Dockerfile`

```dockerfile
FROM python:3.13-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY pyproject.toml poetry.lock ./

# Install Python dependencies
RUN pip install --no-cache-dir poetry && \
    poetry config virtualenvs.create false && \
    poetry install --no-dev --no-interaction --no-ansi

# Copy application code
COPY . .

# Set environment for local mode
ENV MODE=local

# Expose any necessary ports (if needed)
# EXPOSE 8080

# Run agent-runner
CMD ["python", "main.py"]
```

**Acceptance Criteria**:
- ✅ Dockerfile builds successfully
- ✅ Image size < 500MB
- ✅ All dependencies installed correctly
- ✅ main.py executes without import errors

#### 1.2 Create Docker Compose Configuration
**Location**: `backend/services/agent-runner/docker-compose.yml`

```yaml
version: '3.8'

services:
  agent-runner:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: stigmer-agent-runner
    restart: unless-stopped
    environment:
      - MODE=local
      - STIGMER_BACKEND_URL=http://host.docker.internal:7234
      - TEMPORAL_SERVICE_ADDRESS=host.docker.internal:7233
      - TEMPORAL_NAMESPACE=default
      - TASK_QUEUE=agent_execution_runner
      - SANDBOX_TYPE=filesystem
      - WORKSPACE_ROOT=./workspace
    volumes:
      - ./workspace:/app/workspace
    network_mode: "host"  # Use host networking for localhost access
```

**Acceptance Criteria**:
- ✅ Container starts successfully
- ✅ Can connect to stigmer-server on localhost:7234
- ✅ Can connect to Temporal on localhost:7233
- ✅ Workspace directory accessible

#### 1.3 Test Docker Build Locally
**Commands**:
```bash
cd backend/services/agent-runner
docker build -t stigmer-agent-runner:local .
docker compose up
```

**Acceptance Criteria**:
- ✅ Build completes without errors
- ✅ Container starts and shows startup logs
- ✅ No multipart import errors
- ✅ Worker registers with Temporal

---

## Phase 2: Update stigmer CLI for Docker Support (1.5-2 hours)

### Goal
Modify `stigmer server start/stop/status` commands to manage Docker container lifecycle.

### Tasks

#### 2.1 Add Docker Detection
**File**: `client-apps/cli/internal/cli/daemon/daemon.go`

- Check if Docker is installed and running
- Provide clear error message if Docker is unavailable
- Add `--no-docker` flag for dev mode (run with poetry)

**Acceptance Criteria**:
- ✅ Detects Docker installation
- ✅ Detects Docker daemon status
- ✅ Graceful error if Docker unavailable

#### 2.2 Update Start Command
**File**: `client-apps/cli/internal/cli/daemon/daemon.go` → `startAgentRunner()`

**Current Approach**: Starts `~/.stigmer/bin/agent-runner` binary

**New Approach**: 
1. Check if Docker is available
2. Pull/build stigmer-agent-runner image if needed
3. Start container with `docker run` or `docker compose up`
4. Store container ID in `~/.stigmer/data/agent-runner-container.id`

**Implementation**:
```go
func startAgentRunnerDocker(dataDir string) error {
    // Check Docker availability
    if !dockerAvailable() {
        return errors.New("Docker is not running. Please start Docker or use --dev-mode")
    }
    
    // Start container
    cmd := exec.Command("docker", "run", "-d",
        "--name", "stigmer-agent-runner",
        "--network", "host",
        "-e", "MODE=local",
        "-e", fmt.Sprintf("STIGMER_BACKEND_URL=http://localhost:%d", DaemonPort),
        "-e", "TEMPORAL_SERVICE_ADDRESS=localhost:7233",
        "-v", filepath.Join(dataDir, "workspace") + ":/app/workspace",
        "stigmer-agent-runner:latest",
    )
    
    output, err := cmd.CombinedOutput()
    if err != nil {
        return errors.Wrap(err, "failed to start agent-runner container")
    }
    
    containerID := strings.TrimSpace(string(output))
    
    // Store container ID
    pidFile := filepath.Join(dataDir, "agent-runner-container.id")
    return os.WriteFile(pidFile, []byte(containerID), 0644)
}
```

**Acceptance Criteria**:
- ✅ Starts Docker container instead of binary
- ✅ Passes correct environment variables
- ✅ Mounts workspace directory
- ✅ Stores container ID for management

#### 2.3 Update Stop Command
**File**: `client-apps/cli/internal/cli/daemon/daemon.go` → `stopAgentRunner()`

**Implementation**:
```go
func stopAgentRunnerDocker(dataDir string) error {
    // Read container ID
    pidFile := filepath.Join(dataDir, "agent-runner-container.id")
    containerID, err := os.ReadFile(pidFile)
    if err != nil {
        // Try by name as fallback
        cmd := exec.Command("docker", "stop", "stigmer-agent-runner")
        _ = cmd.Run()
        return nil
    }
    
    // Stop container
    cmd := exec.Command("docker", "stop", string(containerID))
    if err := cmd.Run(); err != nil {
        return errors.Wrap(err, "failed to stop agent-runner container")
    }
    
    // Remove container
    cmd = exec.Command("docker", "rm", string(containerID))
    _ = cmd.Run()
    
    // Clean up pid file
    os.Remove(pidFile)
    
    return nil
}
```

**Acceptance Criteria**:
- ✅ Stops Docker container
- ✅ Removes container
- ✅ Cleans up container ID file
- ✅ Handles missing container gracefully

#### 2.4 Update Status Command
**File**: `client-apps/cli/cmd/stigmer/root/server.go` → status command

- Check if container is running: `docker ps --filter name=stigmer-agent-runner`
- Show container status in output

**Acceptance Criteria**:
- ✅ Shows container running/stopped status
- ✅ Shows container ID
- ✅ Integrated with existing status output

---

## Phase 3: Update Logs Command (30 minutes)

### Goal
Make `stigmer server logs` work with Docker container logs.

### Tasks

#### 3.1 Add Docker Logs Support
**File**: `client-apps/cli/internal/cli/logs/logs.go`

**Implementation**:
```go
func StreamDockerLogs(containerName string, follow bool, tailLines int) error {
    args := []string{"logs"}
    
    if follow {
        args = append(args, "-f")
    }
    
    if tailLines > 0 {
        args = append(args, "--tail", strconv.Itoa(tailLines))
    }
    
    args = append(args, containerName)
    
    cmd := exec.Command("docker", args...)
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr
    
    return cmd.Run()
}
```

**Acceptance Criteria**:
- ✅ Shows Docker container logs
- ✅ Supports `-f` (follow) flag
- ✅ Supports `--tail` flag
- ✅ Interleaves with stigmer-server/workflow-runner logs

---

## Phase 4: Testing & Validation (1 hour)

### Goal
Ensure complete end-to-end functionality with Docker-based agent-runner.

### Tasks

#### 4.1 Manual Testing Checklist

**Setup**:
```bash
# Stop any running stigmer server
stigmer server stop

# Rebuild CLI with Docker support
cd client-apps/cli
make build
make install

# Start server (should start Docker container)
stigmer server start
```

**Test Cases**:

1. **Server Start**:
   - [ ] Docker container starts automatically
   - [ ] No multipart import errors
   - [ ] Worker registers with Temporal
   - [ ] `stigmer server status` shows agent-runner running

2. **Agent Execution**:
   ```bash
   stigmer run --agent pr-reviewer --user-input "test"
   ```
   - [ ] Execution starts successfully
   - [ ] No import errors
   - [ ] Completes without crashes

3. **Logs**:
   ```bash
   stigmer server logs --component agent-runner
   ```
   - [ ] Shows Docker container logs
   - [ ] Real-time streaming works
   - [ ] No errors in output

4. **Server Stop**:
   ```bash
   stigmer server stop
   ```
   - [ ] Container stops cleanly
   - [ ] Container is removed
   - [ ] No orphaned containers

5. **Server Restart**:
   ```bash
   stigmer server start
   stigmer server stop
   stigmer server start
   ```
   - [ ] Restarts work correctly
   - [ ] No container ID conflicts
   - [ ] Workspace persists

**Acceptance Criteria**:
- ✅ All test cases pass
- ✅ No import errors
- ✅ Performance acceptable (<5s cold start)

#### 4.2 Error Handling Tests

1. **Docker Not Installed**:
   - [ ] Clear error message
   - [ ] Suggests installation steps

2. **Docker Daemon Not Running**:
   - [ ] Detects daemon status
   - [ ] Suggests starting Docker

3. **Container Already Running**:
   - [ ] Detects existing container
   - [ ] Offers to restart or skip

**Acceptance Criteria**:
- ✅ All error cases handled gracefully
- ✅ Helpful error messages

---

## Phase 5: Documentation & Cleanup (30 minutes)

### Goal
Update documentation and clean up PyInstaller artifacts.

### Tasks

#### 5.1 Update Documentation
**Files to Update**:
- `README.md` - Add Docker requirement
- `docs/installation.md` - Docker install instructions
- `docs/development.md` - Update local dev setup

**Content**:
```markdown
## Requirements

- Docker Desktop (macOS/Windows) or Docker Engine (Linux)
- Temporal server (managed by Stigmer)
- Go 1.21+ (for CLI development)

## Docker Installation

**macOS**: 
```bash
brew install --cask docker
# Or download from https://www.docker.com/products/docker-desktop
```

**Linux**:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

**Windows**: Download from https://www.docker.com/products/docker-desktop
```

**Acceptance Criteria**:
- ✅ Clear Docker requirements stated
- ✅ Installation instructions for all platforms
- ✅ Updated development workflow

#### 5.2 Clean Up PyInstaller Artifacts
**Files to Remove**:
- `backend/services/agent-runner/agent-runner.spec`
- `backend/services/agent-runner/hooks/`
- `backend/services/agent-runner/vendor/` (if we created it)
- References to binary in Makefiles

**Files to Update**:
- `backend/services/agent-runner/Makefile` - Remove binary targets
- `.gitignore` - Remove PyInstaller entries

**Acceptance Criteria**:
- ✅ No PyInstaller files remain
- ✅ Build processes updated
- ✅ Git history clean

#### 5.3 Create Migration Changelog
**File**: `_changelog/2026-01/2026-01-22-migrate-agent-runner-to-docker.md`

**Content**: Document the migration, reasons, and impact on users.

**Acceptance Criteria**:
- ✅ Changelog entry created
- ✅ Breaking change documented
- ✅ Migration guide included

---

## Risk Mitigation

### Risk 1: Docker Not Available
**Mitigation**: Provide dev mode flag `--dev-mode` to run with poetry
**Fallback**: Document poetry-based local execution

### Risk 2: Network Connectivity Issues
**Mitigation**: Use `--network host` for Linux, `host.docker.internal` for Mac/Windows
**Testing**: Verify on all platforms

### Risk 3: Volume Mount Permissions
**Mitigation**: Use user ID mapping or proper permissions in Dockerfile
**Testing**: Test workspace file creation

### Risk 4: Container Startup Time
**Mitigation**: Keep image lean, use slim base
**Target**: < 5 seconds cold start

---

## Success Metrics

**Completion Criteria**:
1. ✅ Agent-runner runs in Docker container
2. ✅ No multipart import errors
3. ✅ CLI manages container lifecycle
4. ✅ Logs accessible via CLI
5. ✅ All tests pass
6. ✅ Documentation updated
7. ✅ PyInstaller artifacts removed

**Performance Targets**:
- Container startup: < 5 seconds
- Memory usage: < 300MB
- Image size: < 500MB

**User Experience**:
- `stigmer server start` → just works
- No manual Docker commands needed
- Clear error messages if Docker unavailable

---

## Estimated Timeline

| Phase | Time | Cumulative |
|-------|------|------------|
| Phase 1: Dockerfile & Compose | 1-1.5h | 1-1.5h |
| Phase 2: CLI Docker Support | 1.5-2h | 2.5-3.5h |
| Phase 3: Logs Integration | 0.5h | 3-4h |
| Phase 4: Testing | 1h | 4-5h |
| Phase 5: Documentation | 0.5h | 4.5-5.5h |
| **Total** | **4.5-5.5h** | - |

**Buffer**: 0.5-1h for unexpected issues

**Total Estimated**: 4-6 hours

---

## Next Steps

1. **Review this plan**: Provide feedback on approach and scope
2. **Approve to proceed**: Confirm this plan aligns with goals
3. **Begin Phase 1**: Start with Dockerfile creation

---

**IMPORTANT**: This plan requires review and approval before execution begins.

Please review and provide feedback:
- Are all phases necessary?
- Any missing considerations?
- Any changes to approach?
- Ready to proceed?
