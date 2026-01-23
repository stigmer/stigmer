# Quick Reference: Test vs Development Databases

## TL;DR

**Should we remove test database isolation?** → **NO** ❌

**Why?** → Test isolation is critical for reliable, reproducible tests ✅

**What changed?** → Debug UI now clearly shows which database you're looking at 🎯

---

## Visual Guide

### Before (Confusing)
```
📂 BadgerDB Inspector
[Shows only data, no context about which DB]
```

### After (Clear)
```
📂 BadgerDB Inspector
🗄️ Production Database
Location: /Users/you/.stigmer/stigmer.db

OR

🧪 ⚠️ Test Database (Temporary)
Location: /tmp/stigmer-e2e-123456/stigmer.db
```

---

## Why Two Databases?

| Use Case | Database Type | Location |
|----------|---------------|----------|
| Running tests | **Test DB** (isolated) | `/tmp/stigmer-e2e-*` |
| Manual development | **Dev DB** (persistent) | `~/.stigmer/stigmer.db` |

---

## Benefits of Isolation

✅ **Parallel Testing** - Run multiple tests simultaneously  
✅ **Reproducibility** - Same result every time  
✅ **Safety** - Tests can't corrupt your dev data  
✅ **CI/CD Ready** - Clean environment for automation  

---

## What Was Fixed

### 1. Debug UI Enhancement
The debug endpoint now shows:
- 🗄️ **Production Database** (green) - Your development data
- 🧪 **Test Database** (yellow) - Temporary test data

### 2. Documentation
Created comprehensive guides:
- `TEST_DATABASE_STRATEGY.md` - Full explanation
- `QUICK_REFERENCE.md` - This file

### 3. Code Improvements
- Database path shown in UI
- Visual indicator for test vs production
- Color coding for easy identification

---

## Common Questions

### "Why do tests show different data than my debug UI?"

**Answer**: They're looking at different databases!
- Tests create fresh, isolated databases
- Your dev server uses a persistent database
- **Solution**: Check the database path shown in the UI

### "Can I inspect test databases?"

**Yes!** When a test fails, the database is preserved:
```bash
# Test output shows:
# Test failed - database preserved at: /tmp/stigmer-e2e-123456

# Start server with that database
DB_PATH=/tmp/stigmer-e2e-123456/stigmer.db make server

# Open debug UI
open http://localhost:8234/debug/db
```

### "Should tests use my development database?"

**No!** This would cause:
- ❌ Test pollution (tests affect each other)
- ❌ Non-deterministic results
- ❌ Can't run tests in parallel
- ❌ Risk of data corruption

---

## How to Use

### For Development
```bash
# Start server (uses ~/.stigmer/stigmer.db)
make server

# Open debug UI
open http://localhost:8234/debug/db

# You'll see: 🗄️ Production Database
```

### For Testing
```bash
# Run tests (uses temp database)
make test-e2e

# If test fails, check output for DB path
# Then inspect with debug UI
```

---

## Summary

✅ **Keep test isolation** - It's essential  
✅ **Use debug UI path indicator** - Know which DB you're viewing  
✅ **Separate concerns** - Tests use temp DBs, dev uses persistent DB  
✅ **Trust the tests** - If they pass, the code works  

The confusion is solved, not by removing isolation, but by making it visible!
