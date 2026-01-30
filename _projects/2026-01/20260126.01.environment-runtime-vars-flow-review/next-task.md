# Environment Runtime Variables - Implementation Plan

## Quick Resume
Drag this file into chat to continue.

## Current State
- **Status**: ✅✅✅ Milestones 1, 2 & 3 COMPLETE
- **Last Session**: 2026-01-30 - Implemented Milestone 3 (Environment Placeholder Resolution)
- **Active Milestone**: Ready for Milestone 4 (Runner Integration - partially complete)

## Status After Milestone 1 Completion

| Component | Status |
|-----------|--------|
| Proto Definitions | ✅ Complete |
| **Environment CRUD** | ✅ **WITH ENCRYPTION** - AES-256-GCM at-rest encryption |
| **Secret Encryption** | ✅ **COMPLETE** - Java & Go implementations |
| **Workflow Runner (Go)** | ✅ **EXISTS** - already processes runtime_env! |
| **Agent Runner (Python)** | ✅ **EXISTS** - needs env integration |
| Environment Resolution | ❌ Missing - Next milestone |
| CLI --env flags | ❌ Missing |
| **MCP Server Env Resolution** | ❌ **NEW SCOPE** - placeholder resolution for MCP servers |

**Key Correction**: The Go workflow-runner EXISTS in `stigmer-oss/backend/services/workflow-runner/` and already handles `runtime_env` (lines 265-300 of `execute_workflow_activity.go`). The missing pieces are upstream.

## Key Design Decisions

1. **Encryption (Cloud)**: Follow existing service configuration pattern with `$secrets-group/`
2. **Encryption (OSS)**: Environment variable `STIGMER_ENCRYPTION_KEY` or `~/.stigmer/encryption.key`
3. **Algorithm**: AES-256-GCM (same for both)
4. **Pulumi-Inspired**: SDK-first, layered environments, runtime overrides
5. **Security**: ExecutionContext pattern - pass IDs through Temporal, not secrets

## Session Progress

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
| 4. Runner Integration | 2-3 days | ⚠️ **PARTIALLY DONE** (ExecutionContext clients added) |
| 5. **MCP Server Env Resolution** | 1-2 days | ✅ **COMPLETE** (Merged into M3) |
| 6. CLI Integration | 1-2 days | ⏭️ **NEXT** |

**Total: ~12-16 days** (Milestones 1-3 complete, ~4-5 days remaining)

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

## Next Steps (Milestone 4 & 6: Runner Integration & CLI)

### Immediate Actions
1. **CLI Integration** (Milestone 6):
   - Add `--env KEY=VALUE` flags to CLI commands
   - Add `--env-file PATH` support for bulk environment loading
   - Integrate with AgentExecution/WorkflowExecution creation

2. **Complete Runner Integration** (Milestone 4):
   - Verify ExecutionContext flow in workflow-runner (already done)
   - Verify ExecutionContext flow in agent-runner (already done)
   - End-to-end testing of environment variable flow

3. **Documentation**:
   - Update user docs for environment variable usage
   - Document MCP server environment requirements
   - Add examples for common patterns

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
