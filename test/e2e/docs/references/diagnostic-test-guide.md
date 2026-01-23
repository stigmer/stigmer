# Debug Agent Persistence Test

This diagnostic test helps investigate why only one agent appears in the database.

## Run the Diagnostic Test

```bash
cd /Users/suresh/scm/github.com/stigmer/stigmer/test/e2e

# Run just the debug test
go test -v -tags=e2e -run TestDebugAgentPersistence -timeout 5m

# Or run the direct DB query version
go test -v -tags=e2e -run TestDebugAgentPersistenceWithDirectDBQuery -timeout 5m
```

## What the Test Does

The diagnostic test:

1. **Applies agents** - Runs `stigmer apply` on the basic-agent example
2. **Queries via API** - Uses `GetAgentBySlug` (same as the existing test)
3. **Inspects BadgerDB** - Lists ALL keys in the database
4. **Reads agents directly** - Unmarshals each agent and prints details
5. **Compares counts** - Shows discrepancies between API and DB

## Expected Output

If everything is working correctly, you should see:

```
Agents in BadgerDB: 2
Agent 1 (key: agent/agt-...):
  ID: agt-...
  Name: code-reviewer
  Slug: code-reviewer
  
Agent 2 (key: agent/agt-...):
  ID: agt-...
  Name: code-reviewer-pro
  Slug: code-reviewer-pro
```

## If Only One Agent Exists

If you see only one agent in the database, the test will show:

- Which agent is present
- Which agent is missing
- The exact database keys
- Error messages from API queries

## Possible Root Causes

Based on the code analysis, here are potential issues to investigate:

### 1. **Slug Collision (Unlikely but Possible)**
- Check if both agents end up with the same slug
- The logs will show the exact slugs stored

### 2. **ID Generation Issue**
- Check if both agents somehow get the same ID
- The logs will show the exact IDs

### 3. **Second Agent Failing Silently**
- Check the CLI apply output for errors
- The deployer iterates sequentially, so an error would be logged

### 4. **Database Write Issue**
- Check if the second `SaveResource` call fails
- BadgerDB should log any write errors

### 5. **Test Environment Issue**
- Check if multiple tests are sharing the same database
- Check if the database is being cleared between test runs

## Manual Database Inspection

You can also inspect the database manually using BadgerDB tools:

```bash
# Find the test database path (it's in a temp directory)
# Look for a directory like: /tmp/stigmer-test-.../stigmer.db

# List all keys
cd /Users/suresh/scm/github.com/stigmer/stigmer
go run test/e2e/tools/list_db_keys.go /tmp/stigmer-test-.../stigmer.db
```

## Next Steps

1. **Run the diagnostic test** and review the output
2. **Check if both agents exist in the database** (direct DB query)
3. **If only one exists**, look at:
   - The apply command output (are both agents being deployed?)
   - The database keys (what IDs and slugs are stored?)
   - Server logs (any errors during creation?)
4. **Report findings** with the exact error messages and counts

## Understanding the Test Harness

The E2E test harness:

- Creates a **temporary directory** for each test suite
- Starts the **stigmer-server** with an isolated BadgerDB
- The database path is: `{TempDir}/stigmer.db`
- Each test suite gets its **own isolated database**
- Tests within the same suite **share the database**

So if you're running multiple tests, make sure to check which test is creating which agents.
