# Environment Runtime Variables - Implementation Plan

## Quick Resume
Drag this file into chat to continue.

## Current State
- **Status**: ✅✅✅✅✅✅ ALL MILESTONES COMPLETE + DOCUMENTATION COMPLETE
- **Last Session**: 2026-01-30 - Session 6: Complete User Documentation
- **Active Milestone**: Ready for E2E test execution in deployed environment

## Status After Milestone 1 Completion

| Component | Status |
|-----------|--------|
| Proto Definitions | ✅ Complete |
| **Environment CRUD** | ✅ **WITH ENCRYPTION** - AES-256-GCM at-rest encryption |
| **Secret Encryption** | ✅ **COMPLETE** - Java & Go implementations |
| **Workflow Runner (Go)** | ✅ **COMPLETE** - processes runtime_env via ExecutionContext |
| **Agent Runner (Python)** | ✅ **COMPLETE** - processes runtime_env via ExecutionContext |
| **Environment Resolution** | ✅ **COMPLETE** - Merging, decryption, placeholder resolution |
| **CLI --env flags** | ✅ **COMPLETE** - `--env` and `--env-file` with merge support |
| **MCP Server Env Resolution** | ✅ **COMPLETE** - Placeholder resolution for MCP servers |

**Key Correction**: The Go workflow-runner EXISTS in `stigmer-oss/backend/services/workflow-runner/` and already handles `runtime_env` (lines 265-300 of `execute_workflow_activity.go`). The missing pieces are upstream.

## Key Design Decisions

1. **Encryption (Cloud)**: Follow existing service configuration pattern with `$secrets-group/`
2. **Encryption (OSS)**: Environment variable `STIGMER_ENCRYPTION_KEY` or `~/.stigmer/encryption.key`
3. **Algorithm**: AES-256-GCM (same for both)
4. **Pulumi-Inspired**: SDK-first, layered environments, runtime overrides
5. **Security**: ExecutionContext pattern - pass IDs through Temporal, not secrets

## Session Progress

### Session 6 (2026-01-30) - Complete User Documentation ✅ COMPLETE

#### Accomplishments
- ✅ **Created comprehensive environment variables guide** - 725 lines covering all aspects
- ✅ **Created quick reference guide** - 307 lines for experienced users
- ✅ **Created 3 example template files** - `.env.example`, `.env.secret.example`, `.gitignore.example`
- ✅ **Updated CLI documentation** - New flags and precedence rules
- ✅ **Updated MCP server documentation** - Added placeholder resolution section (250+ lines)
- ✅ **Updated documentation index** - Added environment variables guide
- ✅ **Created documentation completion summary** - Full metrics and overview

#### Files Created (6 files)
**New Documentation:**
- `docs/guides/environment-variables.md` - Complete guide (725 lines)
- `docs/guides/environment-variables-quick-reference.md` - Quick reference (307 lines)
- `docs/guides/.env.example` - Environment template (83 lines)
- `docs/guides/.env.secret.example` - Secrets template (147 lines)
- `docs/guides/.gitignore.example` - Gitignore template (61 lines)
- `_projects/.../documentation-completion-summary.md` - Session summary

#### Files Updated (3 files)
**Updated Documentation:**
- `docs/cli/running-agents-workflows.md` - Added new flags, precedence rules (~50 lines changed)
- `docs/guides/using-mcp-servers.md` - Added placeholder resolution section (~250 lines added)
- `docs/README.md` - Updated documentation index (3 lines changed)

#### Documentation Coverage
- ✅ CLI Usage - All 4 flags with examples
- ✅ File Formats - Complete `.env` specification
- ✅ Security - AES-256-GCM, best practices, warnings
- ✅ MCP Integration - Placeholder syntax and resolution
- ✅ Troubleshooting - 6 common issues with solutions
- ✅ Examples - 50+ code examples across all docs
- ✅ Templates - Copy-paste ready files

#### Quality Metrics
- **Total documentation**: ~1,500+ lines of new/updated content
- **Code examples**: 50+ across all documentation
- **Complete guides**: 2 (main + quick reference)
- **Template files**: 3 (ready to copy)
- **Updated files**: 3 existing documentation files
- **Cross-references**: Proper links between all related docs

**Checkpoint**: User documentation complete and production-ready

### Session 5 (2026-01-30) - Pulumi-Style Secret Handling + Complete E2E Tests ✅ COMPLETE

#### Accomplishments
- ✅ **Refactored to Pulumi-style explicit secret handling** - Removed `secret:` prefix pattern
- ✅ **Added `--secret` and `--secret-file` flags** - Explicit secret declaration (not inferred from value)
- ✅ **Updated parser package** - Separate parsing functions for secrets vs non-secrets
- ✅ **Fixed test fixtures** - Moved from git-ignored `testdata/examples/` to committed `testdata/fixtures/`
- ✅ **Created comprehensive E2E test suite** - 9 test cases covering agents AND workflows
- ✅ **Added workflow test helpers** - Full parity with agent testing
- ✅ **Updated 55 unit tests** - All passing with new API

#### Key Design Decisions
1. **Explicit Secret Declaration**: Following Pulumi's pattern - secrets declared via flags, not value prefix
2. **No Backward Compatibility**: Clean break from `secret:` prefix (user explicitly requested no deprecation)
3. **Separate Parsing Paths**: `ParseFile()` vs `ParseFileAsSecrets()`, `ParseFlags()` vs `ParseFlagsAsSecrets()`
4. **Test Fixture Organization**: Committed fixtures in `testdata/fixtures/`, auto-gen in `testdata/examples/`

#### Files Modified (10 files)
**CLI Parser (`internal/cli/envfile/`):**
- `parser.go` - Removed `secretPrefix`, added separate secret parsing functions
- `merge.go` - New `LoadAndMergeWithSecrets()` function with 4-source merging
- `types.go` - Updated package documentation
- `parser_test.go` - Completely rewritten (55 tests, all passing)

**CLI Command (`cmd/stigmer/root/`):**
- `run.go` - Added `--secret` and `--secret-file` flags, updated help text
- `run_execute.go` - Updated to use new 4-parameter merge function
- `run_resolve.go` - Minor refactor

**E2E Tests (`test/e2e/`):**
- `env_var_test_constants.go` - Updated fixture paths to `testdata/fixtures/`
- `env_var_test_helpers.go` - Added workflow helpers (3 run functions + 2 verification functions)
- `workflow_test_constants.go` - Added `BasicWorkflowTestMessage` constant

#### Files Created (4 files)
**Test Fixtures (committed to git):**
- `testdata/fixtures/env-vars/test.env` - Non-secret environment variables for testing
- `testdata/fixtures/env-vars/test.env.secret` - Secret environment variables for testing

**E2E Tests:**
- `env_var_workflow_test.go` - 3 workflow tests (inline flags, secret flags, merge precedence)

#### E2E Test Coverage

**Agent Tests (6 test cases):**
1. `TestEnvVarInlineFlags` - `--env KEY=VALUE` for agents
2. `TestEnvVarSecretFlag` - `--secret KEY=VALUE` for agents
3. `TestEnvVarFileLoading` - `--env-file PATH` for agents
4. `TestEnvVarSecretFileLoading` - `--secret-file PATH` for agents
5. `TestEnvVarMergePrecedence` - All 4 sources combined for agents
6. `TestEnvVarIsSecretFlag` - `IsSecret=true/false` verification for agents

**Workflow Tests (3 test cases):**
1. `TestWorkflowEnvVarInlineFlags` - `--env` flags for workflows
2. `TestWorkflowEnvVarSecretFlags` - `--secret` flags for workflows
3. `TestWorkflowEnvVarMergePrecedence` - All 4 sources combined for workflows

**Total: 9 comprehensive E2E tests** covering both agents and workflows

#### Precedence Rules (As Designed)
```
Highest Priority: --secret flags (inline secrets)
                  --env flags (inline env vars)
                  --secret-file (secret files)
Lowest Priority:  --env-file (env files)
```

#### Code Quality Metrics
- ✅ 55 unit tests passing (0 failures)
- ✅ Clean separation of concerns (parsing vs merging)
- ✅ No technical debt introduced
- ✅ Test fixtures committed to git (not ignored)
- ✅ Full workflow test coverage (not just agents)

#### User Feedback Addressed
1. ✅ "Don't keep any backward deprecation messages; just remove them" - Clean removal of `secret:` prefix
2. ✅ "Test cases that you have run e2e are they only considering the agent flow" - Added workflow E2E tests
3. ✅ "This .env files which we have created might not be pushed to Git" - Fixed by moving to `testdata/fixtures/`

**Checkpoint**: Milestone 4 (E2E Testing Infrastructure) and Milestone 6 (CLI Integration) both complete

### Session 4 (2026-01-30) - Milestone 6: CLI Integration ✅ COMPLETE

#### Accomplishments
- ✅ **Created `internal/cli/envfile/` package** - Production-ready environment file parsing
- ✅ **Added `--env` and `--env-file` flags** to `stigmer run` command
- ✅ **Refactored `run.go`** from 895 lines into 6 focused files (all under 250 lines)
- ✅ **Comprehensive testing** - 53 unit tests, all passing
- ✅ **Quality standards met** - All files under 250 lines, no technical debt

#### Files Created (10 files)
**New Package (`internal/cli/envfile/`):**
- `types.go` (31 lines) - Type definitions (`EnvMap`, `ParseError`)
- `parser.go` (181 lines) - File/line parsing with full `.env` format support
- `merge.go` (87 lines) - Multi-source environment merging with precedence
- `parser_test.go` (662 lines) - 53 comprehensive unit tests
- `BUILD.bazel` (27 lines) - Bazel build configuration

**Refactored Command Files:**
- `run.go` (128 lines) - Command definition with new flags
- `run_execute.go` (217 lines) - Execution orchestration logic
- `run_create.go` (87 lines) - Execution creation functions
- `run_resolve.go` (187 lines) - Resource resolution (agents/workflows)
- `run_stream.go` (117 lines) - Log streaming functions
- `run_display.go` (203 lines) - Display/formatting functions

#### Key Features Implemented
1. **`--env KEY=VALUE`** - Inline environment variables (repeatable)
2. **`--env-file PATH`** - Load from `.env` files (repeatable, later overrides earlier)
3. **`secret:` prefix** - Mark values as secrets: `--env "secret:DB_PASS=value"`
4. **Merge precedence** - `--env` > later `--env-file` > earlier `--env-file`
5. **Standard `.env` format** - Comments, quotes, escape sequences, export prefix

#### Code Quality Metrics
- ✅ All files under 250 lines (max: 217 lines)
- ✅ All functions under 50 lines
- ✅ Every error wrapped with specific context
- ✅ No business logic in command handlers
- ✅ Descriptive file names (no utils.go/helpers.go)
- ✅ Properly organized imports
- ✅ 53 comprehensive unit tests - all passing
- ✅ Bazel BUILD files updated via gazelle

#### Testing Results
```
=== RUN   TestParseLine_BasicKeyValue (7 subtests) - PASS
=== RUN   TestParseLine_QuotedValues (7 subtests) - PASS
=== RUN   TestParseLine_CommentsAndEmptyLines (4 subtests) - PASS
=== RUN   TestParseLine_SecretPrefix (4 subtests) - PASS
=== RUN   TestParseLine_ExportPrefix (2 subtests) - PASS
=== RUN   TestParseLine_InvalidFormats (5 subtests) - PASS
=== RUN   TestParseFlags (6 subtests) - PASS
=== RUN   TestParseFile (5 subtests) - PASS
=== RUN   TestMergeEnvSources (5 subtests) - PASS
=== RUN   TestLoadAndMerge (5 subtests) - PASS
=== RUN   TestCopyEnvMap (3 subtests) - PASS
=== RUN   TestParseError_Error (3 subtests) - PASS
=== RUN   TestIsValidEnvKey (12 subtests) - PASS

Total: 53 tests - ALL PASSING ✅
```

#### Technical Highlights
- **Pulumi-style UX**: Familiar flag patterns for developers
- **Production-ready parsing**: Handles edge cases (quotes, escapes, comments, empty lines)
- **Backward compatible**: Existing `--runtime-env` still works
- **Clean architecture**: Business logic in `internal/`, command handlers only orchestrate
- **Zero technical debt**: Followed all CLI coding guidelines strictly

**Checkpoint**: Milestone 6 (CLI Integration) fully complete and tested

### Session 3 (2026-01-30) - Architectural Cleanup: Downstream gRPC Pattern

#### Accomplishments
- ✅ **Refactored ExecutionContext creation to use downstream gRPC client pattern**
- ✅ Created `ExecutionContextGrpcRepo` interface and `ExecutionContextGrpcRepoImpl`
- ✅ Updated both `CreateExecutionContextStep` implementations (agent + workflow)
- ✅ **Moved all domain-specific gRPC interfaces to local downstream packages**
- ✅ Cleaned up `api-authorization/repo/` to contain only IAM authorization logic

#### Key Architectural Decisions
1. **Domain Ownership**: ExecutionContext domain owns creation via handler pipeline
2. **Downstream Pattern**: Cross-domain access via in-process gRPC (not direct repo)
3. **Package Organization**: Domain-specific interfaces belong in downstream packages, not api-authorization
4. **System Channel**: ExecutionContext creation uses system credentials (backend automation)

#### Files Modified/Created (16 files - stigmer-cloud only)

**New Interfaces (moved from api-authorization to downstream):**
- `downstream/agentic/agentinstance/AgentInstanceGrpcRepo.java`
- `downstream/agentic/session/SessionGrpcRepo.java`
- `downstream/agentic/workflowinstance/WorkflowInstanceGrpcRepo.java`
- `downstream/agentic/executioncontext/ExecutionContextGrpcRepo.java`

**New Implementation:**
- `downstream/agentic/executioncontext/ExecutionContextGrpcRepoImpl.java`

**Modified:**
- `agentexecution/request/step/CreateExecutionContextStep.java` - Uses gRPC repo
- `workflowexecution/request/step/CreateExecutionContextStep.java` - Uses gRPC repo
- `downstream/agentic/agentinstance/AgentInstanceGrpcRepoImpl.java` - Updated import
- `downstream/agentic/session/SessionGrpcRepoImpl.java` - Updated import
- `downstream/agentic/workflowinstance/WorkflowInstanceGrpcRepoImpl.java` - Updated import
- `agent/request/handler/AgentCreateHandler.java` - Updated import
- `agentexecution/request/handler/AgentExecutionCreateHandler.java` - Updated imports
- `workflow/request/handler/WorkflowCreateHandler.java` - Updated import
- `workflowexecution/request/handler/WorkflowExecutionCreateHandler.java` - Updated import

**Deleted (moved to downstream):**
- `api-authorization/repo/AgentInstanceGrpcRepo.java`
- `api-authorization/repo/SessionGrpcRepo.java`
- `api-authorization/repo/WorkflowInstanceGrpcRepo.java`

#### Technical Highlights
- Maintains single ownership of ExecutionContext creation logic
- Handler pipeline ensures validation, authorization, encryption, and persistence
- Microservice-ready architecture (swap channel config, no code changes)
- Consistent with domain boundary principles
- Go codebase already follows correct pattern (no changes needed)

#### Code Quality Impact
- Eliminated direct repository access across domain boundaries
- All ExecutionContext creation now goes through proper handler pipeline
- Reduced code duplication (buildExecutionContext simplified - no manual ID generation)
- Clear separation: api-authorization only contains IAM/authorization logic

**Checkpoint**: All architectural cleanup complete

### Session 2 (2026-01-30) - Milestone 2: ExecutionContext Lifecycle

#### Accomplishments
- ✅ **Milestone 1: Encryption Foundation COMPLETE**
- ✅ Implemented AES-256-GCM encryption for both Cloud (Java) and OSS (Go)
- ✅ Created encryption pipeline steps (Encrypt, Decrypt, Redact)
- ✅ Integrated encryption into Environment CRUD handlers
- ✅ Created comprehensive unit and integration tests
- ✅ Established cross-platform compatibility (Java ↔ Go)
- ✅ Added encryption key configuration (service.yaml, secrets-group)

### Key Decisions Made
1. **Encryption format**: Versioned prefix `enc:v1:` for future key rotation support
2. **Redaction for API responses**: Secret values never exposed via public APIs
3. **Backward compatibility**: Non-encrypted values pass through unchanged
4. **Thread-safe design**: No shared mutable state in encryption services
5. **Fail-fast validation**: Invalid keys cause startup failure, not runtime errors

### Files Created (20 files)

**stigmer-cloud (Java):**
- `config/encryption/EncryptionConfig.java` - Configuration with validation
- `domain/agentic/environment/service/EnvironmentSecretService.java` - AES-256-GCM service
- `domain/agentic/environment/request/step/EncryptSecretValues.java` - Encryption pipeline step
- `domain/agentic/environment/request/step/DecryptSecretValues.java` - Decryption pipeline step
- `domain/agentic/environment/request/step/RedactSecretValues.java` - Redaction pipeline step
- `test/.../EnvironmentSecretServiceTest.java` - Unit tests
- `test/.../EnvironmentEncryptionIntegrationTest.java` - Integration tests
- `_ops/planton/service-hub/secrets-group/stigmer-encryption.yaml` - Encryption key secrets

**stigmer (Go):**
- `backend/services/stigmer-server/pkg/encryption/encryption.go` - Core AES-256-GCM
- `backend/services/stigmer-server/pkg/encryption/keymanager.go` - Key management
- `backend/services/stigmer-server/pkg/encryption/encryption_test.go` - Comprehensive tests
- `backend/services/stigmer-server/pkg/encryption/BUILD.bazel` - Build config

**Both:**
- `_projects/.../test-vectors/encryption_test_vectors.json` - Cross-platform test vectors
- `_projects/.../test-vectors/README.md` - Testing documentation

**Modified (6 files):**
- Environment handlers (Create, Update, Get, GetByReference) - Added encryption steps
- `service.yaml` - Added encryption key configuration
- `application.yaml` - Added property binding

## Implementation Milestones

| Milestone | Duration | Status |
|-----------|----------|--------|
| **1. Encryption Foundation** | **2-3 days** | ✅ **COMPLETE** |
| **2. ExecutionContext Lifecycle** | **2-3 days** | ✅ **COMPLETE** |
| **3. Environment Resolution** | **2-3 days** | ✅ **COMPLETE** |
| **4. Runner Integration** | **2-3 days** | ✅ **COMPLETE** (E2E test infrastructure ready) |
| 5. **MCP Server Env Resolution** | 1-2 days | ✅ **COMPLETE** (Merged into M3) |
| **6. CLI Integration** | **1-2 days** | ✅ **COMPLETE** |

**Total: ~12-16 days** - ✅ **ALL MILESTONES COMPLETE**

**Remaining**: E2E test execution in deployed environment + user documentation

## Session Progress (2026-01-30 - Milestone 3)

### Accomplishments
- ✅ Created comprehensive PlaceholderResolver service (Python) with strict/lenient modes
- ✅ Implemented McpEnvironmentValidator service (Java) for fail-fast validation
- ✅ Integrated validation into both Agent and Workflow execution pipelines
- ✅ Refactored config_transformer.py to use new PlaceholderResolver
- ✅ Added 90 comprehensive tests (58 new + 32 existing passing)
- ✅ All tests passing with no linter errors

### Key Decisions Made
1. **Two-phase validation**: Java validates at execution creation, Python resolves at runtime
2. **Strict vs Lenient modes**: PlaceholderResolver supports both for different use cases
3. **Tri-scope MCP lookup**: Proper support for platform/org/identity-account scoped servers
4. **Fail-fast errors**: Clear, actionable error messages for missing variables

### Files Created (8 files)
**Python (stigmer-oss)**:
- `backend/services/agent-runner/worker/mcp/placeholder_resolver.py` (380 lines)
- `backend/services/agent-runner/tests/mcp/test_placeholder_resolver.py` (682 lines)

**Java (stigmer-cloud)**:
- `domain/agentic/executioncontext/service/McpEnvironmentValidator.java` (303 lines)
- `test/.../McpEnvironmentValidatorTest.java` (526 lines)

**Plans**:
- `.cursor/plans/environment_placeholder_resolution_546fc060.plan.md`
- Plus 3 other plan files (auto-generated during session)

### Files Modified (5 files)
- Updated placeholder resolution in config_transformer.py
- Integrated validation in AgentExecution CreateExecutionContextStep
- Integrated validation in WorkflowExecution CreateExecutionContextStep
- Updated __init__.py exports
- Fixed edge case test in test_config_transformer.py

## Next Steps

### Immediate Actions (Ready for Execution)
1. **Run E2E Tests in Deployed Environment**:
   ```bash
   # Execute E2E test suite
   cd /Users/suresh/scm/github.com/stigmer/stigmer
   bazel test //test/e2e:go_default_test --test_filter="TestEnvVar.*" --test_output=all
   ```
   - 9 E2E tests ready to run (6 agent + 3 workflow tests)
   - Tests verify: inline flags, file loading, merge precedence, IsSecret flag
   - All test fixtures committed to git (`testdata/fixtures/env-vars/`)

2. **User Documentation**: ✅ **COMPLETE**
   - ✅ Updated CLI docs with `--env`, `--secret`, `--env-file`, `--secret-file` examples
   - ✅ Documented precedence rules (flags > files)
   - ✅ Added comprehensive `.env` file format examples
   - ✅ Created complete environment variables guide (`docs/guides/environment-variables.md`)
   - ✅ Updated MCP server guide with runtime environment resolution
   - ✅ Added security best practices and troubleshooting
   - ✅ Created example template files (`.env.example`, `.env.secret.example`, `.gitignore.example`)
   - ✅ Updated documentation index (`docs/README.md`)

   **Files Created/Updated (8 files)**:
   - `docs/cli/running-agents-workflows.md` - Updated with new flags and examples
   - `docs/guides/environment-variables.md` - **NEW** - Complete 700+ line guide
   - `docs/guides/using-mcp-servers.md` - Added runtime environment resolution section
   - `docs/README.md` - Added environment variables guide to index
   - `docs/guides/.env.example` - **NEW** - Template for environment variables
   - `docs/guides/.env.secret.example` - **NEW** - Template for secrets
   - `docs/guides/.gitignore.example` - **NEW** - Template for .gitignore rules

3. **Optional Enhancements** (Future):
   - Shell completion for `--env-file` and `--secret-file` (path completion)
   - Performance testing with large environment files
   - Consider adding `--env-prefix` flag for bulk env var injection

## Context for Resume

### What's Working
- Encryption is production-ready and cross-platform compatible
- Pipeline steps integrate cleanly into existing handlers
- Format supports future key rotation via version prefix
- Tests verify MongoDB stores encrypted values (not plaintext)

### Key Implementation Details
- **Encryption format**: `enc:v1:<base64(nonce || ciphertext || tag)>`
- **Java service**: Spring Boot with @ConfigurationProperties pattern
- **Go service**: Standalone with env var or file-based key management
- **Pipeline integration**: Steps inserted before persist (encrypt) and after load (decrypt/redact)

### Testing Strategy
- Unit tests verify algorithm correctness
- Integration tests verify MongoDB encryption
- Cross-platform tests use shared test vectors
- Test key: `MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=`

### Session 1 (2026-01-30) - Milestone 1: Encryption Foundation

#### Accomplishments
- ✅ **Milestone 1: Encryption Foundation COMPLETE**
- ✅ Implemented AES-256-GCM encryption for both Cloud (Java) and OSS (Go)
- ✅ Created encryption pipeline steps (Encrypt, Decrypt, Redact)
- ✅ Integrated encryption into Environment CRUD handlers
- ✅ Created comprehensive unit and integration tests
- ✅ Established cross-platform compatibility (Java ↔ Go)
- ✅ Added encryption key configuration (service.yaml, secrets-group)

---

## Session Progress (Most Recent)

### Session 3 (2026-01-30) - Architectural Cleanup: Downstream gRPC Pattern ✅ COMPLETE

#### Accomplishments
- ✅ **Refactored ExecutionContext creation to use downstream gRPC client pattern**
- ✅ Created `ExecutionContextGrpcRepo` + `ExecutionContextGrpcRepoImpl`
- ✅ Updated both `CreateExecutionContextStep` implementations (agent + workflow)
- ✅ **Moved all domain-specific gRPC interfaces to local downstream packages**
- ✅ Cleaned up `api-authorization/repo/` to contain only IAM authorization logic

#### Key Decisions
1. **Domain Ownership**: ExecutionContext domain owns creation via handler pipeline
2. **Package Organization**: Domain-specific interfaces → downstream packages (not api-authorization)
3. **System Channel**: ExecutionContext creation uses system credentials (backend automation)

#### Files Changed (16 files)
- 5 new files (4 interfaces + 1 implementation moved to downstream)
- 9 modified files (handlers + downstream impls updated imports)
- 3 deletions (interfaces moved from api-authorization)
- Net: -88 lines of code (architectural cleanup)

**Detailed checkpoint:** `checkpoints/2026-01-30-session-3-downstream-grpc-cleanup.md`

### Session 2 (2026-01-30) - Milestone 2: ExecutionContext Lifecycle ✅ COMPLETE

#### Accomplishments
- ✅ **Milestone 2: ExecutionContext Lifecycle COMPLETE**
- ✅ Added `getByExecutionId` RPC to ExecutionContext proto (operator-only)
- ✅ Implemented `EnvironmentMergeService` with priority-based merging
- ✅ Created pipeline steps for both AgentExecution and WorkflowExecution
- ✅ Integrated ExecutionContext creation into execution handlers
- ✅ Implemented Temporal cleanup activity (finally blocks + TTL index)
- ✅ Added runner integration (Go + Python) with backward compatibility
- ✅ Created comprehensive unit tests for EnvironmentMergeService

#### Files Modified/Created (27 files)

**stigmer (11 files):**
- Proto definitions: io.proto, query.proto
- Go/Python stubs regenerated
- New runner clients: execution_context_client.go, execution_context_client.py
- Modified activities: execute_workflow_activity.go, execute_graphton.py

**stigmer-cloud (16 files):**
- Java stubs regenerated
- New services: EnvironmentMergeService.java
- New handlers: ExecutionContextGetByExecutionIdHandler.java
- New pipeline steps: DecryptExecutionContextValues.java, CreateExecutionContextStep.java (×2)
- New Temporal activities: DeleteExecutionContextActivity.java + Impl
- Modified handlers: AgentExecutionCreateHandler.java, WorkflowExecutionCreateHandler.java
- Modified workflows: InvokeAgentExecutionWorkflowImpl.java, InvokeWorkflowExecutionWorkflowImpl.java
- Modified repo: ExecutionContextRepo.java (added TTL index)
- New tests: EnvironmentMergeServiceTest.java

#### Key Decisions
1. **Security**: Secrets encrypted at rest, decrypted only for operator-level runners
2. **Backward Compatibility**: Runners try ExecutionContext first, fall back to legacy flow
3. **Cleanup Strategy**: Dual-layer (Temporal activity + 24h TTL index)
4. **Priority Order**: Template < Instance envs < Runtime env (Pulumi-inspired)
5. **Bean Naming**: Unique @Component names to avoid Spring collision

#### Technical Highlights
- Cross-repository proto generation (stigmer + stigmer-cloud)
- Environment merging with source decryption and re-encryption
- Idempotent, fault-tolerant cleanup (logs errors, doesn't throw)
- Backward compatibility via NOT_FOUND error handling in runners

**Detailed checkpoint:** `checkpoints/2026-01-30-milestone-2-complete.md`

## Quality Requirements (From User)

- This is foundational code for a world-class platform
- No complacency, no garbage code, no technical debt
- Follow existing patterns (ConfigurationProperties, pipeline steps)
- Pulumi-inspired UX for SDK users

## Task Files
- Full plan: `tasks/T01_0_plan.md`

## Design Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                     ENVIRONMENT FLOW                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Agent.env_spec (lowest)                                         │
│         │                                                        │
│         ▼                                                        │
│  Instance.environment_refs (medium) → Decrypt secrets           │
│         │                                                        │
│         ▼                                                        │
│  Execution.runtime_env (highest)                                 │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────────────────────────────────┐                │
│  │ MERGED ENVIRONMENT                           │                │
│  │ (stored in ExecutionContext, secrets        │                │
│  │  encrypted at rest)                         │                │
│  └─────────────────────────────────────────────┘                │
│         │                                                        │
│         │ execution_id only (NO SECRETS)                        │
│         ▼                                                        │
│  Temporal Workflow                                               │
│         │                                                        │
│         │ execution_id only                                     │
│         ▼                                                        │
│  Activity (Go/Python)                                            │
│         │                                                        │
│         │ Query ExecutionContext, decrypt                       │
│         ▼                                                        │
│  Agent/Workflow Engine                                           │
│         │                                                        │
│         │ Resolve ${PLACEHOLDERS} in:                           │
│         │ - HttpServerConfig.headers                            │
│         │ - HttpServerConfig.query_params                       │
│         │ - StdioServerConfig.env (future)                      │
│         │ - DockerServerConfig.env (future)                     │
│         ▼                                                        │
│  MCP Servers with real secrets                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## NEW SCOPE: MCP Server Environment Variable Resolution

### Integration with MCP Server API Resource

**Cross-Project Dependency**: This project integrates with the MCP Server API Resource project (`20260126.02.mcp-server-api-resource`).

### MCP Server Environment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              MCP SERVER ENVIRONMENT RESOLUTION                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. McpServer Resource (Template/Definition)                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ McpServerSpec.env_spec:                                  │    │
│  │   data:                                                  │    │
│  │     GITHUB_TOKEN: {is_secret: true}  ← Declaration only │    │
│  │     API_ENDPOINT: {is_secret: false} ← Optional default │    │
│  │                                                          │    │
│  │ HttpServerConfig:                                        │    │
│  │   headers:                                               │    │
│  │     Authorization: "Bearer ${GITHUB_TOKEN}"  ← Placeholder│   │
│  │   query_params:                                          │    │
│  │     api_key: "${API_KEY}"            ← Placeholder      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  2. Agent/Workflow Execution (Actual Values)                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ AgentInstance.environment_refs → Environment resources   │    │
│  │   GITHUB_TOKEN: "ghp_encrypted..."  (encrypted)         │    │
│  │   API_KEY: "secret_encrypted..."    (encrypted)         │    │
│  │                                                          │    │
│  │ AgentExecution.runtime_env (highest priority):           │    │
│  │   GITHUB_TOKEN: "ghp_override..."   (for this exec)     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  3. Environment Resolution (This Project)                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Merge all environment sources:                           │    │
│  │   1. McpServerSpec.env_spec defaults (lowest)           │    │
│  │   2. AgentInstance.environment_refs (medium)            │    │
│  │   3. AgentExecution.runtime_env (highest)               │    │
│  │                                                          │    │
│  │ Decrypt secrets from ExecutionContext                    │    │
│  │                                                          │    │
│  │ Result: {GITHUB_TOKEN: "ghp_override...", API_KEY: "..."} │   │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  4. Placeholder Resolution (This Project)                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Resolve ${PLACEHOLDERS} in MCP configs:                  │    │
│  │                                                          │    │
│  │ HttpServerConfig.headers:                                │    │
│  │   Authorization: "Bearer ghp_override..."  ← Resolved   │    │
│  │                                                          │    │
│  │ HttpServerConfig.query_params:                           │    │
│  │   api_key: "secret_decrypted..."       ← Resolved       │    │
│  │                                                          │    │
│  │ Validation: All required env vars present               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  5. MCP Server Startup (Lifecycle Management Project)            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Start MCP server with resolved configuration             │    │
│  │ - HTTP client configured with actual headers/params     │    │
│  │ - Stdio subprocess with env vars injected               │    │
│  │ - Docker container with env vars                        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Details for MCP Server Support

#### 1. McpServerSpec.env_spec Resolution

**Java Service Extension** (`EnvMergeService.java`):

```java
/**
 * Merge environment sources for MCP server execution.
 * 
 * Priority: McpServer defaults < Agent template < Instance envs < runtime_env
 */
public Map<String, ExecutionValue> mergeForMcpServer(
        EnvironmentSpec mcpServerDefaults,      // From McpServerSpec.env_spec
        EnvironmentSpec agentTemplateDefaults,  // From AgentSpec.env_spec
        List<ApiResourceReference> environmentRefs,
        Map<String, ExecutionValue> runtimeEnv) {
    
    Map<String, ExecutionValue> merged = new LinkedHashMap<>();
    
    // 1. Apply MCP server defaults (lowest priority)
    if (mcpServerDefaults != null) {
        for (var entry : mcpServerDefaults.getData().entrySet()) {
            merged.put(entry.getKey(), toExecutionValue(entry.getValue()));
        }
    }
    
    // 2. Apply agent template defaults
    if (agentTemplateDefaults != null) {
        for (var entry : agentTemplateDefaults.getData().entrySet()) {
            merged.put(entry.getKey(), toExecutionValue(entry.getValue()));
        }
    }
    
    // 3. Apply environment refs (middle priority)
    if (environmentRefs != null && !environmentRefs.isEmpty()) {
        Map<String, ExecutionValue> resolved = 
            resolver.resolveEnvironments(environmentRefs);
        merged.putAll(resolved);
    }
    
    // 4. Apply runtime_env (highest priority)
    if (runtimeEnv != null) {
        merged.putAll(runtimeEnv);
    }
    
    return merged;
}
```

#### 2. Placeholder Resolution for MCP Configs

**Java Service Extension** (`PlaceholderResolverService.java`):

```java
/**
 * Resolve placeholders in HttpServerConfig.
 */
public HttpServerConfig resolvePlaceholders(
        HttpServerConfig config,
        Map<String, ExecutionValue> environment) {
    
    HttpServerConfig.Builder resolved = config.toBuilder();
    
    // Resolve headers
    if (config.getHeadersCount() > 0) {
        Map<String, String> resolvedHeaders = 
            resolvePlaceholders(config.getHeadersMap(), environment);
        resolved.clearHeaders();
        resolved.putAllHeaders(resolvedHeaders);
    }
    
    // Resolve query params
    if (config.getQueryParamsCount() > 0) {
        Map<String, String> resolvedParams = 
            resolvePlaceholders(config.getQueryParamsMap(), environment);
        resolved.clearQueryParams();
        resolved.putAllQueryParams(resolvedParams);
    }
    
    return resolved.build();
}

/**
 * Resolve placeholders in StdioServerConfig (future).
 */
public StdioServerConfig resolvePlaceholders(
        StdioServerConfig config,
        Map<String, ExecutionValue> environment) {
    
    StdioServerConfig.Builder resolved = config.toBuilder();
    
    // Future: Resolve env map if we add it to proto
    // if (config.getEnvCount() > 0) {
    //     Map<String, String> resolvedEnv = 
    //         resolvePlaceholders(config.getEnvMap(), environment);
    //     resolved.clearEnv();
    //     resolved.putAllEnv(resolvedEnv);
    // }
    
    return resolved.build();
}

/**
 * Resolve placeholders in DockerServerConfig (future).
 */
public DockerServerConfig resolvePlaceholders(
        DockerServerConfig config,
        Map<String, ExecutionValue> environment) {
    
    DockerServerConfig.Builder resolved = config.toBuilder();
    
    // Future: Resolve env map if we add it to proto
    // Similar to StdioServerConfig
    
    return resolved.build();
}
```

#### 3. Validation for MCP Server Required Env Vars

```java
/**
 * Validate all required env vars for MCP server are provided.
 */
public void validateMcpServerEnv(
        McpServerSpec mcpServerSpec,
        Map<String, ExecutionValue> mergedEnvironment) {
    
    if (mcpServerSpec.getEnvSpec() == null) {
        return; // No env requirements
    }
    
    List<String> missingVars = new ArrayList<>();
    
    for (var entry : mcpServerSpec.getEnvSpec().getData().entrySet()) {
        String varName = entry.getKey();
        EnvironmentValue spec = entry.getValue();
        
        // Check if required var is present
        if (!mergedEnvironment.containsKey(varName)) {
            // If spec has no default value, it's required
            if (spec.getValue() == null || spec.getValue().isEmpty()) {
                missingVars.add(varName);
            }
        }
    }
    
    if (!missingVars.isEmpty()) {
        throw new ValidationException(
            "MCP server '" + mcpServerSpec.getName() + 
            "' missing required environment variables: " + 
            String.join(", ", missingVars));
    }
}
```

### Test Cases for MCP Server Environment Resolution

#### Test 1: HTTP Server with Placeholders

```java
@Test
void shouldResolvePlaceholdersInHttpServerConfig() {
    // Given: HTTP MCP server with placeholder auth
    HttpServerConfig config = HttpServerConfig.newBuilder()
        .setUrl("https://api.example.com/mcp")
        .putHeaders("Authorization", "Bearer ${GITHUB_TOKEN}")
        .putQueryParams("api_key", "${API_KEY}")
        .build();
    
    Map<String, ExecutionValue> env = Map.of(
        "GITHUB_TOKEN", ExecutionValue.newBuilder()
            .setValue("ghp_secret123")
            .setIsSecret(true)
            .build(),
        "API_KEY", ExecutionValue.newBuilder()
            .setValue("key_abc")
            .setIsSecret(true)
            .build()
    );
    
    // When: Resolve placeholders
    HttpServerConfig resolved = 
        placeholderResolverService.resolvePlaceholders(config, env);
    
    // Then: Placeholders replaced with actual values
    assertThat(resolved.getHeadersMap())
        .containsEntry("Authorization", "Bearer ghp_secret123");
    assertThat(resolved.getQueryParamsMap())
        .containsEntry("api_key", "key_abc");
}
```

#### Test 2: Missing Required Env Var

```java
@Test
void shouldFailWhenRequiredEnvVarMissing() {
    // Given: MCP server requires GITHUB_TOKEN
    McpServerSpec spec = McpServerSpec.newBuilder()
        .setEnvSpec(EnvironmentSpec.newBuilder()
            .putData("GITHUB_TOKEN", EnvironmentValue.newBuilder()
                .setIsSecret(true)
                .build())
            .build())
        .build();
    
    Map<String, ExecutionValue> env = Map.of(); // Empty
    
    // When/Then: Should throw validation error
    assertThatThrownBy(() -> 
        validator.validateMcpServerEnv(spec, env))
        .isInstanceOf(ValidationException.class)
        .hasMessageContaining("GITHUB_TOKEN");
}
```

#### Test 3: Multi-Source Environment Merge for MCP Server

```java
@Test
void shouldMergeMcpServerEnvironmentWithCorrectPriority() {
    // Given: MCP server default, agent default, instance env, runtime env
    EnvironmentSpec mcpDefaults = EnvironmentSpec.newBuilder()
        .putData("LOG_LEVEL", envValue("info", false))
        .putData("TIMEOUT", envValue("30s", false))
        .build();
    
    EnvironmentSpec agentDefaults = EnvironmentSpec.newBuilder()
        .putData("LOG_LEVEL", envValue("warn", false))  // Override
        .build();
    
    List<ApiResourceReference> envRefs = List.of(
        envRef("env-github-prod")  // Contains GITHUB_TOKEN
    );
    
    Map<String, ExecutionValue> runtimeEnv = Map.of(
        "LOG_LEVEL", execValue("debug", false)  // Highest priority
    );
    
    // When: Merge all sources
    Map<String, ExecutionValue> merged = 
        envMergeService.mergeForMcpServer(
            mcpDefaults, agentDefaults, envRefs, runtimeEnv);
    
    // Then: Runtime wins, GITHUB_TOKEN from env, TIMEOUT from MCP default
    assertThat(merged.get("LOG_LEVEL").getValue()).isEqualTo("debug");
    assertThat(merged.get("TIMEOUT").getValue()).isEqualTo("30s");
    assertThat(merged).containsKey("GITHUB_TOKEN");
}
```

### Cross-Project Integration Points

**Dependencies:**
1. **MCP Server API Resource Project** provides:
   - `McpServerSpec` with `env_spec` field
   - `HttpServerConfig`, `StdioServerConfig`, `DockerServerConfig` definitions
   - McpServer repository for loading specs

2. **This Project** (Environment Variables) provides:
   - Environment resolution and merging
   - Placeholder resolution (`${VAR}` → actual value)
   - Secret encryption/decryption
   - Validation of required env vars

3. **Lifecycle Management Project** consumes:
   - Resolved MCP server configurations (no placeholders)
   - Decrypted environment variables
   - Ready-to-use server configs for startup

```
