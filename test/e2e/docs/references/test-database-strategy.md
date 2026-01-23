# E2E Test Database Strategy

## Why Tests Use Isolated Databases

### ✅ Benefits

1. **Test Isolation** - Each test suite gets a fresh database
   - No interference between tests
   - Tests can run in parallel
   - Reproducible results every time

2. **Deterministic State** - Tests know exactly what's in the database
   ```go
   // Test starts with empty database, creates 2 agents
   assert.Equal(2, agentCount) // ✅ Always passes
   ```

3. **Safe CI/CD** - Tests don't pollute production data
   - Can run tests on developer machines without risk
   - CI servers get clean environments
   - No accidental data corruption

4. **Debugging** - Failures are reproducible
   - Same initial state every run
   - No "works on my machine" issues
   - Easy to isolate problems

### ❌ Potential Confusion

**Symptom**: "I see different data in tests vs debug UI"

**Cause**: Tests use temp databases, manual server uses persistent database

**Solution**: Check the database path shown in the debug UI

## Database Locations

### Test Databases (Temporary)
```
/var/folders/.../stigmer-e2e-{random}/stigmer.db
```
- Created fresh for each test suite
- Automatically deleted after tests complete
- Located in system temp directory

### Development Database (Persistent)
```
~/.stigmer/stigmer.db  (or custom path via DB_PATH env var)
```
- Persists across server restarts
- Used when running server manually
- Contains your manual testing data

## How to Tell Which Database You're Looking At

The debug UI now shows the database path:

```
📂 BadgerDB Inspector
Database Location: /Users/you/.stigmer/stigmer.db
```

- If path contains `stigmer-e2e-*` → Test database
- If path contains `~/.stigmer/` → Development database

## When to Use Each Approach

### Use Isolated Test Databases (Current Approach) ✅
- **Unit tests** - Testing specific components
- **E2E smoke tests** - Basic functionality verification
- **CI/CD pipelines** - Automated testing
- **Parallel test execution** - Running multiple tests simultaneously

### Use Shared Database (When Needed)
- **Integration tests** - Testing with real persistent state
- **Manual testing** - Interactive debugging
- **Migration testing** - Verifying data migrations
- **Performance testing** - Load testing with realistic data

## Best Practices

### 1. Keep Tests Isolated by Default

```go
// ✅ Good - Each test starts fresh
func (s *E2ESuite) TestFeatureA() {
    // Test starts with empty database
    agent := createAgent()
    assert.Equal(1, countAgents())
}

func (s *E2ESuite) TestFeatureB() {
    // Test starts with empty database (not affected by TestFeatureA)
    agent := createAgent()
    assert.Equal(1, countAgents())
}
```

### 2. Use Test Fixtures for Common Setup

```go
// ✅ Good - Reusable setup
func (s *E2ESuite) SetupTest() {
    // Create common test data
    s.testAgent = createTestAgent()
}
```

### 3. Document Database State in Tests

```go
// ✅ Good - Clear expectations
func (s *E2ESuite) TestAgentCreation() {
    // Given: Empty database
    // When: Create 2 agents
    // Then: Database contains exactly 2 agents
    createAgent("code-reviewer")
    createAgent("code-reviewer-pro")
    assert.Equal(2, countAgents())
}
```

### 4. Preserve Test Databases for Debugging

```go
// In suite_test.go TearDownSuite
func (s *E2ESuite) TearDownSuite() {
    if s.T().Failed() {
        // Keep database for inspection if test failed
        s.T().Logf("Test failed - database preserved at: %s", s.TempDir)
        return
    }
    // Clean up only on success
    os.RemoveAll(s.TempDir)
}
```

## Inspecting Test Databases

### Option 1: Preserve Failed Test Databases

When a test fails, the database is kept for inspection:

```bash
# Test output shows:
# Test failed - database preserved at: /tmp/stigmer-e2e-123456

# Inspect with debug tool
go run backend/services/stigmer-server/cmd/server/main.go \
  --db-path=/tmp/stigmer-e2e-123456/stigmer.db \
  --debug-port=9999
```

### Option 2: Run Single Test and Inspect

```bash
# Run one test and keep database
go test -v -tags=e2e -run TestApplyBasicAgent

# Find the database path in test output
# Open debug UI while test is running
```

### Option 3: Use Debug Endpoint in Tests

```go
func (s *E2ESuite) TestWithDebugInfo() {
    // ... test logic ...
    
    // Dump database contents
    keys, _ := ListKeysFromDB(s.DBPath, "agent/")
    s.T().Logf("Database contains %d agents", len(keys))
}
```

## Alternative: Integration Tests

If you need to test against the persistent database, create separate integration tests:

```go
// integration_test.go
//go:build integration
// +build integration

func TestIntegrationWithPersistentDB(t *testing.T) {
    // Uses actual ~/.stigmer/stigmer.db
    // NOT isolated - tests may interfere
    // Run separately: go test -tags=integration
}
```

## Comparison: Test Database vs Development Database

| Aspect | Test Database | Development Database |
|--------|---------------|---------------------|
| Location | `/tmp/stigmer-e2e-*` | `~/.stigmer/stigmer.db` |
| Lifecycle | Created → Used → Deleted | Persistent across runs |
| Isolation | Complete isolation | Shared state |
| Use Case | Automated tests | Manual development |
| Data Loss Risk | None (temp data) | High (if not backed up) |
| Debugging | Hard (deleted quickly) | Easy (persistent) |
| Reproducibility | Perfect | Variable |

## Recommendations

1. ✅ **Keep test isolation** - Don't remove it
2. ✅ **Improve visibility** - Show database path in UI (already implemented)
3. ✅ **Add integration tests** - For testing with persistent state
4. ✅ **Document clearly** - Explain the strategy (this document)
5. ✅ **Preserve failed tests** - Keep database on failure for debugging

## Summary

**Test database isolation is a feature, not a bug.** It ensures:
- Reliable, reproducible tests
- Safe parallel execution
- No data pollution

The confusion you experienced is solved by:
- ✅ Debug UI now shows database path
- ✅ This documentation explains the strategy
- ✅ Tests remain isolated for reliability

When you need to test with persistent state, use integration tests, not by removing test isolation.
