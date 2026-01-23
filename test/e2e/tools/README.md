# E2E Test Tools

**Utility scripts for E2E testing.**

All test scripts and utilities are organized in this directory following [Stigmer OSS Documentation Standards](../../../.cursor/rules/stigmer-oss-documentation-standards.md).

---

## Available Tools

### run-flakiness-test.sh

**Purpose**: Detect flaky tests by running the test suite multiple times.

**Usage**:
```bash
cd test/e2e
./tools/run-flakiness-test.sh
```

**What it does**:
- Runs the E2E test suite multiple times (configurable)
- Detects intermittent failures
- Reports pass/fail statistics
- Helps identify non-deterministic test behavior

**Configuration**:
Edit the script to change:
- Number of iterations (default: 10)
- Specific tests to run
- Timeout duration

**Output**:
```
Run 1/10: PASS
Run 2/10: PASS
Run 3/10: FAIL (TestApplyBasicAgent)
Run 4/10: PASS
...

Results:
- Total runs: 10
- Passed: 9
- Failed: 1
- Flakiness rate: 10%
```

**When to use**:
- After fixing flaky tests
- Before merging PRs with test changes
- When investigating intermittent CI failures
- During test suite refactoring

**Related Documentation**:
- [Flakiness Fix Report](../docs/implementation/flakiness-fix-2026-01-23.md) - Recent improvements
- [Test Organization](../docs/getting-started/test-organization.md) - Test structure

---

## Adding New Tools

When adding new test utilities:

1. **Create the script** in this directory
2. **Name it descriptively** with lowercase-with-hyphens
3. **Make it executable**: `chmod +x script-name.sh`
4. **Document it** in this README
5. **Follow shell script best practices**:
   - Use `#!/bin/bash` shebang
   - Add comments explaining what it does
   - Include usage instructions
   - Handle errors gracefully

### Script Template

```bash
#!/bin/bash
# Script Name: my-test-script.sh
# Purpose: Brief description of what this script does
# Usage: ./tools/my-test-script.sh [options]

set -e  # Exit on error
set -u  # Exit on undefined variable

# Script content here
```

---

## Future Tools (Ideas)

Potential utilities to add:

- **benchmark-tests.sh** - Run performance benchmarks
- **generate-coverage.sh** - Generate test coverage reports
- **validate-fixtures.sh** - Validate SDK example sync
- **cleanup-test-data.sh** - Clean up test databases/temp files

---

## Related Documentation

- **[Main E2E README](../README.md)** - How to run tests
- **[Documentation Index](../docs/README.md)** - Complete documentation
- **[Test Organization](../docs/getting-started/test-organization.md)** - Test structure

---

**Maintenance**: Keep this README updated when adding new tools.
