# Verification Guide: Managed Local Temporal Runtime

**Purpose**: Step-by-step verification that the managed Temporal feature works correctly.

## Quick Test (Recommended)

### Test 1: Zero-Config First Run

```bash
# Clean slate
rm -rf ~/.stigmer

# Start daemon (should auto-download and start Temporal)
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local start

# Expected output:
# [•] Stigmer Local Daemon starting...
# [•] Resolved LLM configuration
# [•] Resolved Temporal configuration
# [•] Starting managed Temporal server...
# [!] Temporal CLI not found locally
# [⬇] Downloading Temporal CLI v1.25.1...
# [✓] Temporal binary installed to ~/.stigmer/bin/temporal
# [✓] Temporal started successfully
# [✓] Temporal is ready
# [✓] Daemon started successfully
```

**Verification Steps**:

```bash
# 1. Check Temporal binary downloaded
ls -lh ~/.stigmer/bin/temporal
# Expected: -rwxr-xr-x ... temporal (50-60 MB)

# 2. Check Temporal process running
ps aux | grep temporal | grep -v grep
# Expected: temporal server start-dev --port 7233 ...

# 3. Check Temporal PID file
cat ~/.stigmer/temporal.pid
# Expected: numeric PID

# 4. Check Temporal database created
ls -lh ~/.stigmer/temporal-data/temporal.db
# Expected: SQLite database file

# 5. Check Temporal logs
tail -20 ~/.stigmer/logs/temporal.log
# Expected: "Started Temporal server" messages

# 6. Verify Temporal is accessible
curl http://localhost:7233
# Expected: Connection successful (or specific response)

# 7. Check daemon status
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local status
# Expected: Running, PID shown
```

### Test 2: Cached Binary (Second Run)

```bash
# Stop daemon
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local stop

# Start again (should skip download)
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local start

# Expected output:
# [•] Stigmer Local Daemon starting...
# [•] Starting managed Temporal server...
# [✓] Temporal CLI already installed  <-- No download!
# [✓] Temporal started successfully
# [✓] Daemon started successfully
```

**Verification**:

```bash
# Check startup time (should be faster)
time bazel run //client-apps/cli/cmd/stigmer:stigmer -- local start
# Expected: < 5 seconds (vs 30+ seconds on first run)

# Verify same binary used
ls -lh ~/.stigmer/bin/temporal
# Expected: Same timestamp as Test 1
```

### Test 3: External Temporal via Environment Variable

```bash
# Stop daemon
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local stop

# Start with external Temporal
export TEMPORAL_SERVICE_ADDRESS="external-temporal.example.com:7233"
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local start

# Expected output:
# [•] Stigmer Local Daemon starting...
# [•] Resolved Temporal configuration
# [•] Using external Temporal: external-temporal.example.com:7233
# [✓] Daemon started successfully
```

**Verification**:

```bash
# No local Temporal process
ps aux | grep temporal | grep -v grep
# Expected: Empty (no process)

# No Temporal PID file
ls ~/.stigmer/temporal.pid
# Expected: File not found

# Daemon logs should mention external Temporal
tail ~/.stigmer/logs/daemon.log | grep Temporal
# Expected: "Using external Temporal"
```

### Test 4: External Temporal via Config File

```bash
# Stop daemon and unset env var
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local stop
unset TEMPORAL_SERVICE_ADDRESS

# Create config with external Temporal
cat > ~/.stigmer/config.yaml << 'EOF'
backend:
  type: local
  local:
    endpoint: "localhost:50051"
    llm:
      provider: "ollama"
      model: "qwen2.5-coder:7b"
      base_url: "http://localhost:11434"
    temporal:
      managed: false
      address: "config-temporal.example.com:7233"
EOF

# Start daemon
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local start

# Expected output:
# [•] Using external Temporal: config-temporal.example.com:7233
```

**Verification**:

```bash
# Check config was loaded
cat ~/.stigmer/config.yaml | grep -A 2 temporal
# Expected: managed: false, address: config-temporal.example.com:7233

# No local Temporal
ps aux | grep temporal | grep -v grep
# Expected: Empty
```

### Test 5: Custom Port for Managed Temporal

```bash
# Stop daemon
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local stop

# Update config for managed Temporal on custom port
cat > ~/.stigmer/config.yaml << 'EOF'
backend:
  type: local
  local:
    endpoint: "localhost:50051"
    llm:
      provider: "ollama"
      model: "qwen2.5-coder:7b"
      base_url: "http://localhost:11434"
    temporal:
      managed: true
      version: "1.25.1"
      port: 9999
EOF

# Start daemon
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local start

# Expected output:
# [•] Starting managed Temporal server...
# [✓] Temporal started successfully
# Address: localhost:9999
```

**Verification**:

```bash
# Check Temporal running on port 9999
lsof -i :9999 | grep temporal
# Expected: temporal process on port 9999

# Verify not on default port
lsof -i :7233 | grep temporal
# Expected: Empty

# Check daemon passed correct address to agent-runner
cat ~/.stigmer/logs/agent-runner.log | grep TEMPORAL_SERVICE_ADDRESS
# Expected: localhost:9999
```

### Test 6: Graceful Shutdown

```bash
# Start daemon with managed Temporal
rm ~/.stigmer/config.yaml
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local start

# Get PIDs
TEMPORAL_PID=$(cat ~/.stigmer/temporal.pid)
DAEMON_PID=$(cat ~/.stigmer/data/daemon.pid)

echo "Temporal PID: $TEMPORAL_PID"
echo "Daemon PID: $DAEMON_PID"

# Stop daemon
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local stop

# Expected output:
# [•] Stopping managed Temporal...
# [✓] Temporal stopped successfully
# [✓] Daemon stopped successfully
```

**Verification**:

```bash
# Verify Temporal process exited
ps -p $TEMPORAL_PID
# Expected: No such process

# Verify daemon process exited
ps -p $DAEMON_PID
# Expected: No such process

# PID files removed
ls ~/.stigmer/temporal.pid
ls ~/.stigmer/data/daemon.pid
# Expected: Files not found

# Check logs show graceful shutdown
tail ~/.stigmer/logs/temporal.log
tail ~/.stigmer/logs/daemon.log
# Expected: Clean shutdown messages
```

## Configuration Resolution Test

Verify cascading config priority:

```bash
# Setup: Create config file with managed Temporal
cat > ~/.stigmer/config.yaml << 'EOF'
backend:
  type: local
  local:
    temporal:
      managed: true
      port: 7233
EOF

# Test 1: Config only → Managed Temporal
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local start
# Expected: Managed Temporal on localhost:7233

bazel run //client-apps/cli/cmd/stigmer:stigmer -- local stop

# Test 2: Env var overrides config
export TEMPORAL_SERVICE_ADDRESS="env-temporal:7233"
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local start
# Expected: External Temporal (env-temporal:7233)

# Verify
tail ~/.stigmer/logs/daemon.log | grep "Using external Temporal"
# Expected: "Using external Temporal: env-temporal:7233"
```

## Cross-Platform Test

### macOS (darwin/arm64 or darwin/amd64)

```bash
# Check binary downloaded for correct platform
file ~/.stigmer/bin/temporal

# Expected on M1/M2/M3 Mac:
# Mach-O 64-bit executable arm64

# Expected on Intel Mac:
# Mach-O 64-bit executable x86_64
```

### Linux (linux/amd64 or linux/arm64)

```bash
# Check binary
file ~/.stigmer/bin/temporal

# Expected on x86_64:
# ELF 64-bit LSB executable, x86-64

# Expected on ARM64:
# ELF 64-bit LSB executable, ARM aarch64
```

## Error Handling Test

### Test: Port Already in Use

```bash
# Start managed Temporal
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local start

# Try to start another instance (should fail gracefully)
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local start

# Expected:
# [✗] Error: daemon is already running
```

### Test: Download Failure (Simulated)

```bash
# Disconnect network or use invalid version
cat > ~/.stigmer/config.yaml << 'EOF'
backend:
  type: local
  local:
    temporal:
      managed: true
      version: "999.999.999"  # Invalid version
EOF

bazel run //client-apps/cli/cmd/stigmer:stigmer -- local start

# Expected:
# [✗] Failed to download Temporal CLI: HTTP 404
# Clear error message suggesting manual installation
```

## Performance Benchmark

```bash
# First run (with download)
rm -rf ~/.stigmer
time bazel run //client-apps/cli/cmd/stigmer:stigmer -- local start
# Expected: 20-40 seconds (includes download)

bazel run //client-apps/cli/cmd/stigmer:stigmer -- local stop

# Subsequent run (cached binary)
time bazel run //client-apps/cli/cmd/stigmer:stigmer -- local start
# Expected: 2-5 seconds (no download)
```

## Success Criteria

All tests should pass with:

- ✅ Zero-config first run downloads and starts Temporal
- ✅ Cached binary reused on subsequent runs
- ✅ Environment variable correctly overrides config
- ✅ Config file correctly specifies managed vs external
- ✅ Custom port configuration works
- ✅ Graceful shutdown stops Temporal cleanly
- ✅ Correct binary for OS/arch downloaded
- ✅ Error messages are clear and actionable
- ✅ Fast startup after first run (< 5s)

## Troubleshooting

### Temporal didn't start

```bash
# Check logs
tail -50 ~/.stigmer/logs/temporal.log
tail -50 ~/.stigmer/logs/daemon.log

# Check if port is in use
lsof -i :7233

# Verify binary is executable
ls -l ~/.stigmer/bin/temporal
chmod +x ~/.stigmer/bin/temporal
```

### Binary download failed

```bash
# Check network connectivity
curl -I https://github.com/temporalio/cli/releases

# Manually download and install
cd ~/.stigmer/bin
curl -LO https://github.com/temporalio/cli/releases/download/v1.25.1/temporal_cli_1.25.1_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m).tar.gz
tar xzf temporal_cli_*.tar.gz
chmod +x temporal
```

### Process zombie after stop

```bash
# Force kill
kill -9 $(cat ~/.stigmer/temporal.pid)
rm ~/.stigmer/temporal.pid

# Clean restart
bazel run //client-apps/cli/cmd/stigmer:stigmer -- local start
```

## Next Steps After Verification

Once all tests pass:

1. **Document**: Update user-facing docs to remove Docker requirements
2. **Announce**: Communicate zero-dependency local dev experience
3. **Monitor**: Track any issues in production use
4. **Iterate**: Gather feedback and improve error messages

---

**All tests passing? Implementation is production-ready!** 🎉
