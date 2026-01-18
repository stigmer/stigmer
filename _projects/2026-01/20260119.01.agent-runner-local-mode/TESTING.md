# Testing Guide: Agent Runner Local Mode

This guide documents how to test the complete local mode implementation.

## Prerequisites

1. **Workspace Setup**:
   ```bash
   cd /Users/suresh/scm/github.com/stigmer/stigmer
   ```

2. **Required Services**:
   - Temporal server running on `localhost:7233`
   - Poetry installed (for agent-runner)

3. **Environment**:
   - No `ANTHROPIC_API_KEY` in environment (to test prompting)
   - Or set it to test env-based configuration

## Build Components

### 1. Build CLI Binary

```bash
cd client-apps/cli
make build
```

This builds the stigmer CLI at `bazel-bin/client-apps/cli/stigmer_/stigmer`

### 2. Build stigmer-server Binary

```bash
cd backend/services/stigmer-server
bazel build //backend/services/stigmer-server/cmd/server:server
```

Binary will be at: `bazel-bin/backend/services/stigmer-server/cmd/server/server_/server`

### 3. Verify agent-runner Script

The agent-runner script should be at:
```bash
ls -la backend/services/agent-runner/run.sh
```

Make sure it's executable:
```bash
chmod +x backend/services/agent-runner/run.sh
```

### 4. Install agent-runner Dependencies

```bash
cd backend/services/agent-runner
poetry install
```

## Test Scenarios

### Scenario 1: Fresh Start with Secret Prompting

**Expected Flow**:
1. User runs `stigmer local start`
2. System detects missing `ANTHROPIC_API_KEY`
3. Prompts: `Enter Anthropic API key: ` (masked input)
4. User enters key
5. System starts stigmer-server
6. System starts agent-runner with injected secret
7. Both processes run in background

**Commands**:
```bash
# Make sure no API key in environment
unset ANTHROPIC_API_KEY

# Start daemon
bazel-bin/client-apps/cli/stigmer_/stigmer local start

# Expected output:
# Enter Anthropic API key: ******** (user types, masked)
# ✓ Anthropic API key configured
# Starting daemon...
# Daemon started successfully
#   PID:  12345
#   Port: 50051
#   Data: /Users/suresh/.stigmer
# Agent-runner started successfully
```

**Verification**:
```bash
# Check status
bazel-bin/client-apps/cli/stigmer_/stigmer local status

# Expected output:
# Daemon Status:
# ─────────────────────────────────────
#   Status: ✓ Running
#   PID:    12345
#   Port:   50051
#   Data:   /Users/suresh/.stigmer

# Check processes
ps aux | grep stigmer-server
ps aux | grep agent-runner

# Check PID files
ls -la ~/.stigmer/daemon.pid
ls -la ~/.stigmer/agent-runner.pid

# Check log files
tail -f ~/.stigmer/logs/daemon.log
tail -f ~/.stigmer/logs/agent-runner.log
tail -f ~/.stigmer/logs/agent-runner.err
```

### Scenario 2: Start with Existing API Key

**Expected Flow**:
1. API key already in environment
2. No prompting occurs
3. Both services start with key from environment

**Commands**:
```bash
# Set API key in environment
export ANTHROPIC_API_KEY="your-key-here"

# Start daemon
bazel-bin/client-apps/cli/stigmer_/stigmer local start

# Should NOT prompt for key
# Should start both services directly
```

### Scenario 3: Stop Services

**Expected Flow**:
1. User runs `stigmer local stop`
2. System sends SIGTERM to agent-runner first
3. Agent-runner shuts down gracefully
4. System sends SIGTERM to stigmer-server
5. Stigmer-server shuts down gracefully
6. PID files are cleaned up

**Commands**:
```bash
# Stop daemon
bazel-bin/client-apps/cli/stigmer_/stigmer local stop

# Expected output:
# Stopping daemon...
# Sent SIGTERM to agent-runner
# Agent-runner stopped successfully
# Sent SIGTERM to daemon
# Daemon stopped successfully

# Verify processes are gone
ps aux | grep stigmer-server  # should be empty
ps aux | grep agent-runner    # should be empty

# Verify PID files removed
ls ~/.stigmer/daemon.pid           # should not exist
ls ~/.stigmer/agent-runner.pid     # should not exist
```

### Scenario 4: Restart Services

**Expected Flow**:
1. User runs `stigmer local restart`
2. System stops both services (if running)
3. System starts both services again
4. Prompts for secrets if needed

**Commands**:
```bash
# Restart daemon
bazel-bin/client-apps/cli/stigmer_/stigmer local restart

# Expected output:
# Stopping daemon...
# Daemon stopped successfully
# Starting daemon...
# Daemon started successfully
```

### Scenario 5: Agent-runner Crashes

**Expected Flow**:
1. Both services running
2. Agent-runner crashes or is killed manually
3. Stigmer-server continues running
4. User can see status and decide whether to restart

**Commands**:
```bash
# Kill agent-runner manually
kill -9 $(cat ~/.stigmer/agent-runner.pid)

# Check status
bazel-bin/client-apps/cli/stigmer_/stigmer local status

# Stigmer-server should still show as running
# Agent-runner PID file may be stale

# Restart to fix
bazel-bin/client-apps/cli/stigmer_/stigmer local restart
```

## Debugging

### Check Environment Variables

Verify agent-runner is launched with correct environment:

```bash
# View agent-runner process environment
ps eww -p $(cat ~/.stigmer/agent-runner.pid) | tr ' ' '\n' | grep -E '(MODE|SANDBOX|ANTHROPIC|STIGMER)'
```

Expected variables:
- `MODE=local`
- `SANDBOX_TYPE=filesystem`
- `SANDBOX_ROOT_DIR=./workspace`
- `STIGMER_BACKEND_ENDPOINT=localhost:50051`
- `ANTHROPIC_API_KEY=<your-key>`

### Check Log Files

```bash
# Stigmer-server logs
tail -100 ~/.stigmer/logs/daemon.log

# Agent-runner logs
tail -100 ~/.stigmer/logs/agent-runner.log

# Agent-runner errors
tail -100 ~/.stigmer/logs/agent-runner.err
```

### Verify gRPC Connection

Agent-runner should connect to stigmer-server on localhost:50051:

```bash
# Check if port is listening
lsof -i :50051

# Should show stigmer-server process
```

### Verify Temporal Connection

Agent-runner should connect to Temporal on localhost:7233:

```bash
# Check if Temporal is running
lsof -i :7233

# Check agent-runner logs for Temporal connection
grep -i temporal ~/.stigmer/logs/agent-runner.log
```

## Known Issues

### Issue: Binary Not Found

**Symptom**: `stigmer-server binary not found`

**Solution**:
```bash
# Build stigmer-server
cd backend/services/stigmer-server
bazel build //backend/services/stigmer-server/cmd/server:server

# Set environment variable
export STIGMER_SERVER_BIN=/Users/suresh/scm/github.com/stigmer/stigmer/bazel-bin/backend/services/stigmer-server/cmd/server/server_/server
```

### Issue: Agent-runner Script Not Found

**Symptom**: `agent-runner script not found`

**Solution**:
```bash
# Verify script exists
ls -la backend/services/agent-runner/run.sh

# Set environment variable
export STIGMER_AGENT_RUNNER_SCRIPT=/Users/suresh/scm/github.com/stigmer/stigmer/backend/services/agent-runner/run.sh
```

### Issue: Poetry Not Found

**Symptom**: Agent-runner fails to start, `poetry: command not found` in logs

**Solution**:
```bash
# Install Poetry
curl -sSL https://install.python-poetry.org | python3 -

# Or use pipx
pipx install poetry
```

### Issue: Temporal Not Running

**Symptom**: Agent-runner fails with "failed to connect to Temporal"

**Solution**:
```bash
# Start Temporal development server
temporal server start-dev
```

## Success Criteria

✅ CLI builds successfully  
✅ Secret prompting works with masked input  
✅ Both stigmer-server and agent-runner start successfully  
✅ Secrets are injected into agent-runner environment  
✅ No plaintext secrets in files or logs  
✅ Both services can be stopped gracefully  
✅ PID files are created and cleaned up properly  
✅ Log files are created and contain proper output  
✅ Agent-runner connects to Stigmer server on localhost:50051  
✅ Agent-runner uses filesystem backend in local mode  

## Next Steps After Testing

Once all test scenarios pass:

1. Document any issues or edge cases discovered
2. Update implementation if needed
3. Create PR with all changes
4. Update ADR with actual implementation details
5. Create user documentation for local mode
