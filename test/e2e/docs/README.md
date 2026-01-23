# E2E Test Documentation

**Complete documentation for Stigmer E2E integration tests.**

This document serves as the central index for all E2E test documentation. All documentation follows the [Stigmer OSS Documentation Standards](../../../.cursor/rules/stigmer-oss-documentation-standards.md).

## Quick Start

**New to E2E tests?** Start here:
1. [Main E2E README](../README.md) - Prerequisites, setup, running tests
2. [File Guide](getting-started/file-guide.md) - What each test file does
3. [Test Organization](getting-started/test-organization.md) - How tests are structured

## Documentation Structure

```
docs/
├── README.md (this file)           # Documentation index
├── getting-started/                # Quick orientation and setup
├── guides/                         # How-to guides and strategies
├── implementation/                 # Implementation reports and history
└── references/                     # Additional references (future)
```

---

## Getting Started

### Quick Orientation

- **[File Guide](getting-started/file-guide.md)** - What each test file does
  - Overview of all test files in `test/e2e/`
  - Purpose and scope of each file
  - Quick reference for finding the right test

- **[Test Organization](getting-started/test-organization.md)** - How tests are structured
  - Test suite architecture
  - File naming conventions
  - Test categories and patterns

### Running Tests

See the [Main E2E README](../README.md) for:
- Prerequisites (Temporal, Ollama)
- Running tests locally
- Test modes and options
- Troubleshooting

---

## Guides

### Development Guides

- **[SDK Sync Strategy](guides/sdk-sync-strategy.md)** - How SDK examples are synchronized
  - Automatic copying of SDK examples to testdata
  - Single source of truth approach
  - Maintaining sync between examples and tests
  - When and how examples are copied

- **[Phase 2 Guide](guides/phase-2-guide.md)** - Implementing full execution tests
  - Phase 1 vs Phase 2 distinction
  - Setting up Temporal integration
  - Full execution test patterns
  - Waiting for execution completion

- **[Validation Framework](guides/validation-framework.md)** - Validating execution outputs
  - Deterministic validation approach
  - Three-tier validation (Status, Quality, Behavioral)
  - Gibberish detection
  - Error detection patterns

---

## Implementation

### Implementation Reports

- **[Basic Workflow Tests](implementation/basic-workflow-tests.md)** - Workflow test coverage (2026-01-23)
  - 9 comprehensive tests for basic workflow
  - Apply and run test patterns
  - Helper functions for workflow operations
  - Phase 1 smoke tests complete

- **[Flakiness Fix](implementation/flakiness-fix-2026-01-23.md)** - E2E test robustness improvements (2026-01-23)
  - Fixed server shutdown panic
  - Replaced CLI parsing with API queries
  - Substring matching bug fix
  - All tests passing with clean shutdown

- **[Implementation Summary](implementation/implementation-summary.md)** - Overall implementation details
  - Test harness architecture
  - Server management
  - API verification patterns
  - Design decisions

### Enhancement History

- **[Test Coverage Enhancement](implementation/test-coverage-enhancement-2026-01-23.md)** - Basic agent test improvements (2026-01-23)
  - Enhanced from 33% to 100% SDK coverage
  - Added comprehensive property verification
  - New helper functions
  - Test metrics and analysis

- **[Testdata Migration](implementation/testdata-migration-2026-01.md)** - Fixture reorganization (2026-01-01)
  - Migration from type-based to SDK-aligned structure
  - Before/after organization
  - Benefits of new structure
  - Migration process

- **[Documentation Reorganization](implementation/documentation-reorganization-2026-01-23.md)** - Documentation structure cleanup (2026-01-23)
  - Organized docs following OSS standards
  - Lowercase-with-hyphens naming convention
  - Created proper category structure
  - Moved scripts to tools/ directory

---

## References

### Testing Infrastructure

- **[Test Database Strategy](references/test-database-strategy.md)** - Why E2E tests use isolated databases
  - Benefits of test isolation (reproducibility, parallelization, safety)
  - Test database vs development database comparison
  - How to inspect test databases
  - Best practices for test design
  - Common questions answered

- **[Test Database Quick Reference](references/test-database-quick-reference.md)** - Quick answers about test vs dev databases
  - TL;DR summary
  - Visual guide to database indicators
  - Common questions
  - Troubleshooting tips

- **[Diagnostic Test Guide](references/diagnostic-test-guide.md)** - Running diagnostic tests
  - How to run debug tests
  - What diagnostic tests show
  - Inspecting databases
  - Manual inspection tools

---

## Tools

### Test Utilities

- **[Run Flakiness Test](../tools/run-flakiness-test.sh)** - Script to test for flaky tests
  - Runs tests multiple times to detect flakiness
  - Located in `test/e2e/tools/` (not in root)

---

## Test Structure Overview

### Test Files

```
test/e2e/
├── suite_test.go                    # Test suite setup (testify/suite)
├── harness_test.go                  # Test harness (server, temp dirs)
├── helpers_test.go                  # Helper functions (API queries)
│
├── basic_agent_apply_test.go       # Agent deployment tests
├── basic_agent_run_test.go         # Agent execution tests
├── basic_workflow_apply_test.go    # Workflow deployment tests
├── basic_workflow_run_test.go      # Workflow execution tests
│
├── cli_runner_test.go              # CLI command execution
├── prereqs_test.go                 # Prerequisites checking
├── validation_test.go              # Validation framework
├── sdk_fixtures_test.go            # SDK example sync
└── stigmer_server_manager_test.go  # Server lifecycle management
```

### Test Fixtures

```
test/e2e/testdata/examples/
├── 01-basic-agent/                 # Basic agent example
├── 02-agent-with-skills/           # Agent with skills
├── 07-basic-workflow/              # Basic workflow example
└── ... (19 SDK examples total)
```

See [SDK Sync Strategy](guides/sdk-sync-strategy.md) for how these are maintained.

---

## Test Patterns

### Query by Slug Pattern (Preferred)

```go
org := "local" // Using local backend in tests
agent, err := GetAgentBySlug(s.Harness.ServerPort, "code-reviewer", org)
s.Require().NoError(err, "Should be able to query agent by slug")
s.Require().NotNil(agent, "Agent should exist")
```

**Why**: More robust than parsing CLI output. Direct API verification.

### Comprehensive Property Verification

```go
s.Equal("code-reviewer", agent.Metadata.Name, "Agent name should match")
s.Equal("local", agent.Metadata.Org, "Agent org should be local")
s.NotEmpty(agent.Spec.Instructions, "Agent should have instructions")
```

**Why**: Ensures SDK example properties are correctly stored.

### Phase 1 vs Phase 2 Tests

**Phase 1** (Current):
- Deployment verification
- Execution creation (smoke tests)
- No Temporal required
- Fast (< 2 seconds per test)

**Phase 2** (Future):
- Full execution verification
- Phase progression (PENDING → RUNNING → COMPLETED)
- Requires Temporal + runners
- Longer execution time

---

## Contributing Documentation

When adding new documentation:

1. **Determine category** (getting-started, guides, implementation, references)
2. **Use lowercase-with-hyphens** for filename
3. **Update this index** (docs/README.md)
4. **Follow writing guidelines** from workspace rules
5. **Include diagrams** where helpful (Mermaid)
6. **Link to related docs** (no duplication)

See [Documentation Standards](../../../.cursor/rules/stigmer-oss-documentation-standards.md) for complete guidelines.

---

## Related Documentation

### Stigmer OSS Documentation
- [Main Stigmer README](../../../README.md)
- [SDK Examples](../../../sdk/go/examples/)
- [Backend Services](../../../backend/services/)

### Project Documentation
- [E2E Testing Project](../../../_projects/2026-01/20260122.05.e2e-integration-testing/)

---

## Maintenance

**Documentation Status**: ✅ **Organized and Up-to-Date** (2026-01-23)

### Recent Updates
- **2026-01-23**: Reorganized documentation following OSS standards
- **2026-01-23**: Added basic workflow test coverage
- **2026-01-23**: Fixed test flakiness and server shutdown issues
- **2026-01-23**: Enhanced agent test coverage to 100%

### Future Documentation Needs
- [ ] Architecture diagram for E2E test infrastructure
- [ ] Debugging guide for test failures
- [ ] Performance benchmarking guide
- [ ] CI/CD integration guide

---

**Remember**: Good documentation is grounded, developer-friendly, concise, timeless, and well-organized. 

Write for the person who will read this at 2 AM trying to understand or fix something. Give them context, clarity, and concrete examples.
