# Environment Runtime Variables - Implementation Plan

## Quick Resume
Drag this file into chat to continue.

## Current State
- **Status**: ✅ Milestone 1 COMPLETE - Encryption Foundation implemented
- **Last Session**: 2026-01-30 - Implemented AES-256-GCM encryption for environment secrets
- **Active Milestone**: Ready for Milestone 2 (ExecutionContext Lifecycle)

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

## Session Progress (2026-01-30)

### Accomplishments
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
| 2. ExecutionContext Lifecycle | 2-3 days | ⏭️ **NEXT** |
| 3. Environment Resolution | 2-3 days | Pending |
| 4. Runner Integration | 2-3 days | Pending |
| 5. **MCP Server Env Resolution** | 1-2 days | Pending |
| 6. CLI Integration | 1-2 days | Pending |

**Total: ~12-16 days** (Milestone 1 complete, ~9-13 days remaining)

## Next Steps (Milestone 2: ExecutionContext Lifecycle)

### Immediate Actions
1. **Add findByExecutionId query** to ExecutionContextRepo
2. **Create GetByExecutionIdHandler** for internal gRPC access
3. **Modify AgentExecutionCreateHandler**:
   - Merge environments (template + instance + runtime)
   - Create ExecutionContext with merged env
   - Pass only execution_id to Temporal (NO SECRETS)
4. **Modify WorkflowExecutionCreateHandler** (same pattern)
5. **Add cleanup logic** - Delete ExecutionContext on completion

### Implementation Approach
- Follow same patterns as Milestone 1 (pipeline steps, ConfigurationProperties)
- Use EnvironmentSecretService for encryption/decryption
- Add TTL-based auto-deletion backup (24h)
- Comprehensive tests for lifecycle management

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
