# Workflow Runner Test Suite

This directory contains golden test cases for the workflow-runner service.

**All test workflows use DSL 1.0.0 format.**

## Prerequisites

**⚠️ IMPORTANT: Start the workflow-runner service locally before running any tests:**

```bash
cd backend/services/workflow-runner
source .env_export
bazel run //backend/services/workflow-runner:workflow_runner
```

The service must be running on `localhost:9090` for these tests to work.

---

## Test Tools

The test scripts require the following command-line tools:

### grpcurl

Used for making gRPC calls to the workflow-runner service and health checks.

**Installation:**

```bash
# macOS
brew install grpcurl

# Linux
go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest

# Verify installation
grpcurl --version
```

### jq

Used for JSON processing and manipulation in test scripts.

**Installation:**

```bash
# macOS
brew install jq

# Linux (Debian/Ubuntu)
sudo apt-get install jq

# Linux (RHEL/CentOS)
sudo yum install jq

# Verify installation
jq --version
```

**All other tools** (bash, date, cat, etc.) are standard Unix utilities available by default.

---

## Test 01: Basic Operation State

Tests basic operation state with simple task execution.

```bash
golden/test-01-operation-basic.sh
```

---

## Test 02: Switch/Conditional Branching

Tests conditional branching based on data (userId > 5 vs userId <= 5).

```bash
golden/test-02-switch-conditional.sh
```

---

## Test 03: ForEach Loop

Tests iteration over collections with forEach loops.

```bash
golden/test-03-foreach-loop.sh
```

---

## Test 04: Parallel Execution

Tests concurrent execution with parallel branches.

```bash
golden/test-04-parallel-concurrent.sh
```

---

## Test 05: Event Signal

Tests event waiting and external signal handling.

```bash
golden/test-05-event-signal.sh
```

---

## Test 06: Sleep Delay

Tests sleep/delay functionality with Temporal timers.

```bash
golden/test-06-sleep-delay.sh
```

---

## Test 07: Data Injection & Transform

Tests data injection and transformation capabilities.

```bash
golden/test-07-inject-transform.sh
```

---

## Test 08: Error Handling & Retry

Tests error handling and retry mechanisms.

```bash
golden/test-08-error-retry.sh
```

---

## Test 09: Nested States

Tests nested state machines and complex transitions.

```bash
golden/test-09-nested-states.sh
```

---

## Test 10: Complex Workflow

Tests real-world workflow combining multiple patterns (switch, parallel, events).

```bash
golden/test-10-complex-workflow.sh
```

---

## Test 11: Claim Check Pattern (Large Payloads)

Tests Claim Check pattern with large payloads (>50KB) - triggers R2 offloading.

```bash
golden/test-11-claimcheck.sh
```

---

## Test 12: Claim Check Between Steps

Tests Claim Check pattern with step-by-step offloading - verifies large data is offloaded BETWEEN steps, not just at workflow end.

**Key validation:** Without step-by-step offloading, activities would fail with "ScheduleActivityTaskCommandAttributes.Input exceeds size limit" when passing large datasets.

**Test flow:**
1. Fetch photos (~500KB) → Auto-offload to R2 after step
2. Fetch comments (~75KB) → Auto-retrieve photos, execute, offload comments
3. Process combined → Auto-retrieve both datasets, execute, offload result
4. Verify data access → Prove all data remains accessible

```bash
golden/test-12-claimcheck-between-steps.sh
```

---

## Run All Tests

Execute all golden tests sequentially:

```bash
for script in golden/test-*.sh; do
  echo "========================================"
  echo "Running $(basename $script)..."
  echo "========================================"
  "$script"
  echo ""
  echo ""
done
```

---

## Verifying Results

After running a test, check the Temporal UI to verify execution:

- **Local Temporal UI:** http://localhost:8233
- **Production Temporal UI:** https://stigmer-prod-temporal.planton.live

Search for the workflow ID printed by the test script.

---

## Troubleshooting

**Service not running:**
```
✗ Service is NOT running on localhost:9090
```
→ Start the service using the command in Prerequisites section

**Workflow file not found:**
```
✗ Workflow file not found: XX-test-name.yaml
```
→ Ensure you're running from the correct directory (scripts handle this automatically)

**gRPC error:**
```
Failed to dial target host "localhost:9090"
```
→ Verify the service is running and accessible on port 9090

---

## IntelliJ Users

When you open this README in IntelliJ, you'll see a ▶️ play button next to each shell script block. Simply click it to run that specific test!
