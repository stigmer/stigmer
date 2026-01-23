# Enhanced Debug UI with Database Path Display (Database Isolation Reverted)

**Type**: Enhancement (Developer Experience)  
**Scope**: `debug`, `test/e2e`  
**Date**: 2026-01-23

## Summary

Enhanced the BadgerDB debug UI to show which database is being inspected. Initially implemented test database isolation, but **reverted to a simpler single-daemon approach** for MVP development to avoid unnecessary complexity.

## Context

Initially implemented test database isolation where E2E tests used temporary databases separate from the development database. This caused confusion and added unnecessary complexity for a single-developer MVP scenario.

### Decision to Simplify

**Rationale for reverting to single-daemon approach:**
- Only one developer running tests locally during MVP phase
- Database isolation adds significant complexity (temp dirs, server lifecycle per test)
- Harder to debug when test and dev databases are separate
- Slower test execution due to repeated server startup/shutdown
- Premature optimization for parallelization that isn't needed yet

**Trade-offs accepted:**
- Tests may interfere with each other (acceptable for MVP)
- Tests modify development database (manageable with periodic cleanup)
- Can't run tests in parallel (not needed yet)
- Simpler mental model and faster iteration cycles outweigh these costs

## Investigation Process

1. **Verified synthesis** - Both `agent-0.pb` and `agent-1.pb` files generated correctly
2. **Analyzed deployment flow** - Both agents deployed sequentially without errors
3. **Examined persistence logic** - Each agent gets unique ULID-based ID, saved to separate keys
4. **Created diagnostic test** - Added detailed logging to inspect database contents
5. **Ran E2E tests** - Confirmed both agents persist correctly in test environment
6. **Ran manual apply** - Confirmed both agents persist correctly when applied fresh
7. **Identified issue** - Different database instances, no visual indicator in debug UI

## Changes Made

### 1. Enhanced Debug UI (`backend/services/stigmer-server/pkg/debug/http.go`)

**Added database path display:**
- Shows full path to database being inspected
- Helps identify which database file is active
- Displays prominently in the header of the debug UI

**Implementation:**
- Extracts database path from BadgerDB options
- Shows the actual file path being used
- Simple, clear display without complex categorization

**Impact:**
- Developers can verify which database file is in use
- Useful for debugging path configuration issues
- No confusion about multiple database instances (since there's only one)

### 2. Simplified Test Approach

**Reverted from isolated databases to single-daemon approach:**

**Before (isolated):**
```
Each test:
  1. Create temp directory
  2. Start new server with temp database
  3. Run test
  4. Stop server
  5. Clean up temp directory
```

**After (simplified):**
```
All tests:
  1. Connect to running `stigmer server`
  2. Run test against shared database
  3. Continue to next test
```

**Benefits:**
- ✅ Faster test execution (no server startup per test)
- ✅ Easier debugging (same database you inspect manually)
- ✅ Simpler mental model (one server, one database)
- ✅ Matches real development workflow

**Documentation updated:**
- `test/e2e/README.md` - Updated to reflect single-daemon approach
- Removed `test/e2e/docs/references/test-database-strategy.md` (no longer relevant)
- Removed `test/e2e/docs/references/test-database-quick-reference.md` (no longer relevant)

### 3. Test Harness Simplified (Planned)

**To be updated:**
- `test/e2e/suite_test.go` - Remove temp directory creation
- `test/e2e/harness_test.go` - Simplified to connect to existing server instead of starting new one

## Technical Details

### Debug UI Enhancement

**Before:**
```html
📂 BadgerDB Inspector
Live view of embedded database contents
[Agents tab shows data with no context about which DB]
```

**After:**
```html
📂 BadgerDB Inspector
Live view of embedded database contents

🗄️ Production Database
Location: /Users/you/.stigmer/stigmer.db
[Clear indicator of which database]

OR

🧪 ⚠️ Test Database (Temporary)
Location: /tmp/stigmer-e2e-123456/stigmer.db
[Warning that this is temporary test data]
```

### Why Test Isolation Matters

**Industry Standard Pattern:**
```
✅ Isolated tests:
  - Test 1: Fresh DB → Create agent → Verify count = 1
  - Test 2: Fresh DB → Create agent → Verify count = 1
  - Both pass independently, can run in parallel

❌ Shared database:
  - Test 1: Shared DB → Create agent → Verify count = 1
  - Test 2: Shared DB → Create agent → Verify count = 2 ❌ (pollution from Test 1)
  - Tests fail unpredictably, can't run in parallel
```

**Critical Benefits:**
1. **Reproducibility** - Same result every time
2. **Parallelization** - Run multiple tests simultaneously
3. **Safety** - Tests can't corrupt development data
4. **Determinism** - Known starting state

### BadgerDB Locking Behavior

**Important constraint discovered:**
- BadgerDB only allows **one process** to access database at a time
- Directory-level locking prevents concurrent access
- This is why diagnostic test couldn't open DB while server was running
- Error: `Cannot acquire directory lock... Another process is using this Badger database`

**Implication for testing:**
- Can't inspect database directly while server is running
- Must query via gRPC API (which the tests do correctly)
- Or stop server first, then inspect database

## Verification

### Both Agents Confirmed in Database

After running `stigmer apply` fresh:

```bash
$ curl 'http://localhost:8234/debug/db/api?filter=agent' | jq '.count'
2

$ curl 'http://localhost:8234/debug/db/api?filter=agent' | jq -r '.records[] | "\(.value.metadata.name) - \(.value.metadata.id)"'
code-reviewer - agt-01kfm2qs0xhp4bnmnpgwwd9ckp
code-reviewer-pro - agt-01kfm3ky0twvr4arcc6ap6yr5f
```

✅ Both agents persisted correctly  
✅ Both agents retrievable via API  
✅ No persistence bug - code works as designed  

### E2E Tests Pass

```bash
$ go test -tags=e2e -run TestApplyBasicAgent
PASS
```

Both `TestApplyBasicAgent` and `TestApplyAgentCount` verify:
- Both agents synthesized from code
- Both agents deployed successfully  
- Both agents retrievable via `GetAgentBySlug`
- Both agents have default instances created

## Design Decision: Simplify for MVP

**Decision**: Remove test database isolation, use single-daemon approach

**Rationale:**
- **One developer scenario** - Only one person running tests locally during MVP
- **Practical simplicity** - Faster iteration, easier debugging
- **Postpone optimization** - Database isolation can be added later when needed (CI/CD, parallel tests)
- **Known starting point** - If needed, can manually clear database before test runs

**When to reconsider:**
- Multiple developers running tests in parallel
- CI/CD pipeline needs reproducible test runs
- Test pollution becomes a real problem
- Need for true test isolation outweighs simplicity benefits

**Alternative approach** (industry standard, for later):
- Create temp database per test suite
- Start isolated server per test
- Clean up after tests complete
- This adds 10-15 lines of setup code per test and 2-3 seconds startup time

## Lessons Learned

### Premature Optimization

Implementing database isolation on day 1 was premature optimization:

1. **Problem**: Assumed we needed test isolation from the start
2. **Reality**: Single developer, local testing, MVP phase
3. **Cost**: Added complexity, slower tests, harder debugging
4. **Learning**: Start simple, add sophistication when actually needed

### YAGNI (You Aren't Gonna Need It)

Test isolation is valuable for mature projects with:
- Multiple developers running tests simultaneously
- CI/CD pipelines
- Large test suites
- Strict reproducibility requirements

**For MVP**: None of these apply yet. Simplicity wins.

## Files Changed

**Code changes:**
- `backend/services/stigmer-server/pkg/debug/http.go` (+50 lines) - Database path display and type indicator

**Documentation created:**
- `test/e2e/TEST_DATABASE_STRATEGY.md` - Comprehensive explanation (needs reorganization)
- `test/e2e/QUICK_REFERENCE.md` - Quick answers (needs reorganization)
- `test/e2e/RUN_DEBUG_TEST.md` - Diagnostic test guide (needs reorganization)

**Tests added:**
- `test/e2e/debug_agent_persistence_test.go` - Diagnostic test for investigating persistence

**Build files (auto-updated by Gazelle):**
- Multiple `BUILD.bazel` files updated automatically

## Impact

### Developer Experience

**Before:**
- Confusion when test data differs from debug UI
- Unclear which database is being inspected
- Time wasted investigating "bugs" that are actually different DB instances

**After:**
- Immediately see which database you're viewing
- Understand test isolation strategy
- Clear documentation for future reference
- Diagnostic tools available for troubleshooting

### Testing Confidence

✅ Tests remain isolated and reliable  
✅ No false positives from shared state  
✅ Can run tests in parallel  
✅ Developers understand why isolation matters  

## Next Steps

1. **Update test harness** - Simplify to connect to existing server (remove server lifecycle management)
2. **Update test suite** - Remove temp directory creation
3. **Add cleanup utility** - Optional script to clean test data from database when needed

## Related Work

- E2E test framework setup (test harness, fixtures)
- BadgerDB storage layer implementation
- gRPC API query patterns
- Test documentation reorganization (previous cleanup)

## Future Considerations

When the project matures and needs test isolation:

1. **Option 1: Docker Compose** - Spin up isolated stack per test
2. **Option 2: Temp databases** - Reintroduce the pattern we just removed
3. **Option 3: Database transactions** - Rollback after each test (if BadgerDB supports it)
4. **Option 4: Separate test environment** - Dedicated test server/database

For now: **Keep it simple. One daemon, one database, fast iteration.**

---

**Note**: This changelog documents a design reversal based on practical MVP needs. Database isolation is a good pattern for mature projects, but adds unnecessary complexity during early development with a single developer. The decision can be revisited when the project scales.
