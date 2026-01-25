# T01: Environment Variables & Secrets - Comprehensive Implementation Plan

## Executive Summary

### Status After Investigation

| Component | Status | Notes |
|-----------|--------|-------|
| Proto Definitions | ✅ Complete | Well-designed 3-tier architecture |
| Environment CRUD | ✅ Partial | Basic save/retrieve, **no encryption** |
| ExecutionContext CRUD | ✅ Partial | Basic CRUD exists |
| Workflow Runner (Go) | ✅ Exists | **Already processes runtime_env!** (Lines 265-300) |
| Agent Runner (Python) | ✅ Exists | Needs env var integration |
| Environment Resolution | ❌ Missing | env_refs → actual values |
| Environment Merging | ❌ Missing | Multi-source merge logic |
| Placeholder Resolution | ❌ Missing | `${VAR}` → actual value |
| Secret Encryption | ❌ Missing | At-rest encryption |
| CLI --env flags | ❌ Missing | No runtime env from CLI |

### Key Correction
The **Go workflow runner EXISTS** in `stigmer-oss/backend/services/workflow-runner/` and already handles `runtime_env` from WorkflowExecution (passes to Zigflow engine via `EnvVars` field). The missing pieces are upstream: Environment resolution, secret encryption, and CLI integration.

---

## Design Philosophy

### Pulumi-Inspired Architecture

Following Pulumi's proven patterns for config/secrets management:

| Pulumi Concept | Stigmer Equivalent |
|----------------|-------------------|
| `pulumi.secret(value)` | `EnvironmentValue.is_secret = true` |
| Stack state encryption | Environment secret encryption |
| `Config` object in SDK | `env_spec` in Agent/Workflow |
| Pulumi ESC environments | Environment resource with layering |
| Runtime config access | `${VAR}` placeholder resolution |

### Core Principles

1. **SDK-First**: Environment requirements declared in code (Agent/Workflow `env_spec`)
2. **Layered Configuration**: Multiple environments merged with clear priority
3. **Runtime Overrides**: Execution-time values via `runtime_env`
4. **Secrets Never in Temporal**: Pass IDs, not values through Temporal history
5. **Universal Design**: Platform-agnostic, not tied to specific customers

---

## Part 1: Secret Encryption Architecture

### 1.1 Cloud Version (stigmer-cloud)

**Follow the existing service configuration pattern.**

**Encryption Key Storage:**
```yaml
# _ops/planton/service-hub/secrets-group/stigmer-encryption.yaml
apiVersion: planton.cloud/v1
kind: SecretsGroup
metadata:
  name: stigmer-encryption
  org: stigmer
spec:
  secrets:
    prod:
      environment-encryption-key: <32-byte-base64-encoded-key>
    local:
      environment-encryption-key: <local-dev-key>
```

**Service Configuration:**
```yaml
# backend/services/stigmer-service/_kustomize/base/service.yaml
env:
  secrets:
    STIGMER_ENVIRONMENT_ENCRYPTION_KEY:
      value: $secrets-group/stigmer-encryption/prod.environment-encryption-key
```

**Java Configuration Class:**
```java
@Configuration
@ConfigurationProperties(prefix = "stigmer.encryption")
public class EncryptionConfig {
    private String environmentKey;  // From STIGMER_ENVIRONMENT_ENCRYPTION_KEY
    
    // Getters/setters
}
```

### 1.2 OSS Version (stigmer-oss)

**Simple environment variable approach (no cloud dependencies).**

**Option A: Environment Variable**
```bash
# User sets before starting daemon
export STIGMER_ENCRYPTION_KEY="base64-encoded-32-byte-key"

# Or let daemon generate if not set
stigmer server start  # Auto-generates key, stores in ~/.stigmer/encryption.key
```

**Option B: Local File**
```
~/.stigmer/encryption.key  # Generated on first run, 32-byte random key
```

**Go Implementation:**
```go
// pkg/encryption/key.go
func GetEncryptionKey() ([]byte, error) {
    // 1. Check environment variable
    if key := os.Getenv("STIGMER_ENCRYPTION_KEY"); key != "" {
        return base64.StdEncoding.DecodeString(key)
    }
    
    // 2. Check local file
    keyPath := filepath.Join(os.UserHomeDir(), ".stigmer", "encryption.key")
    if data, err := os.ReadFile(keyPath); err == nil {
        return data, nil
    }
    
    // 3. Generate new key
    key := make([]byte, 32)
    if _, err := rand.Read(key); err != nil {
        return nil, err
    }
    
    // 4. Save for future use
    os.MkdirAll(filepath.Dir(keyPath), 0700)
    os.WriteFile(keyPath, key, 0600)
    
    return key, nil
}
```

### 1.3 Encryption Algorithm

**AES-256-GCM (same for both Cloud and OSS)**

```java
// Cloud (Java)
@Component
@RequiredArgsConstructor
public class EnvironmentSecretService {
    private final EncryptionConfig config;
    private SecretKeySpec secretKey;
    
    @PostConstruct
    public void init() {
        byte[] keyBytes = Base64.getDecoder().decode(config.getEnvironmentKey());
        this.secretKey = new SecretKeySpec(keyBytes, "AES");
    }
    
    public String encrypt(String plaintext) {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        byte[] iv = new byte[12];
        SecureRandom.getInstanceStrong().nextBytes(iv);
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, new GCMParameterSpec(128, iv));
        
        byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        
        // Format: base64(iv || ciphertext)
        byte[] combined = new byte[iv.length + ciphertext.length];
        System.arraycopy(iv, 0, combined, 0, iv.length);
        System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);
        
        return Base64.getEncoder().encodeToString(combined);
    }
    
    public String decrypt(String encrypted) {
        byte[] combined = Base64.getDecoder().decode(encrypted);
        byte[] iv = Arrays.copyOfRange(combined, 0, 12);
        byte[] ciphertext = Arrays.copyOfRange(combined, 12, combined.length);
        
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(128, iv));
        
        return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    }
}
```

```go
// OSS (Go)
package encryption

import (
    "crypto/aes"
    "crypto/cipher"
    "crypto/rand"
    "encoding/base64"
)

type SecretService struct {
    key []byte
}

func NewSecretService() (*SecretService, error) {
    key, err := GetEncryptionKey()
    if err != nil {
        return nil, err
    }
    return &SecretService{key: key}, nil
}

func (s *SecretService) Encrypt(plaintext string) (string, error) {
    block, _ := aes.NewCipher(s.key)
    gcm, _ := cipher.NewGCM(block)
    
    nonce := make([]byte, gcm.NonceSize())
    rand.Read(nonce)
    
    ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
    return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func (s *SecretService) Decrypt(encrypted string) (string, error) {
    ciphertext, _ := base64.StdEncoding.DecodeString(encrypted)
    
    block, _ := aes.NewCipher(s.key)
    gcm, _ := cipher.NewGCM(block)
    
    nonceSize := gcm.NonceSize()
    nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
    
    plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
    if err != nil {
        return "", err
    }
    return string(plaintext), nil
}
```

---

## Part 2: Environment Resolution & Merging

### 2.1 Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            RESOLUTION FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. AGENT/WORKFLOW TEMPLATE (Lowest Priority)                                │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Agent/Workflow.spec.env_spec:                                        │    │
│  │   data:                                                              │    │
│  │     LOG_LEVEL: {value: "info", is_secret: false}  ← Default values  │    │
│  │     GITHUB_TOKEN: {is_secret: true}               ← Declaration only │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  2. INSTANCE ENVIRONMENTS (Medium Priority)                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Instance.spec.environment_refs: [env-base, env-prod, env-team]       │    │
│  │                                                                      │    │
│  │   env-base:                                                          │    │
│  │     LOG_LEVEL: info                                                  │    │
│  │     TIMEOUT: 30s                                                     │    │
│  │                                                                      │    │
│  │   env-prod:               ← Override LOG_LEVEL                       │    │
│  │     LOG_LEVEL: warn                                                  │    │
│  │     GITHUB_TOKEN: "ghp_encrypted..."  (encrypted in MongoDB)        │    │
│  │                                                                      │    │
│  │   env-team:               ← Further override                         │    │
│  │     SLACK_WEBHOOK: "https://..."                                     │    │
│  │                                                                      │    │
│  │   MERGED: {LOG_LEVEL: warn, TIMEOUT: 30s, GITHUB_TOKEN: ghp_...,    │    │
│  │            SLACK_WEBHOOK: https://...}                               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  3. RUNTIME ENVIRONMENT (Highest Priority)                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Execution.spec.runtime_env:                                          │    │
│  │   LOG_LEVEL: debug        ← Override for this execution only        │    │
│  │   SPECIAL_TOKEN: "..."    ← Execution-specific secret               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  4. FINAL MERGED ENVIRONMENT                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ {                                                                    │    │
│  │   LOG_LEVEL: "debug",           # From runtime_env (highest)        │    │
│  │   TIMEOUT: "30s",               # From env-base                     │    │
│  │   GITHUB_TOKEN: "ghp_...",      # From env-prod (decrypted)        │    │
│  │   SLACK_WEBHOOK: "https://...", # From env-team                     │    │
│  │   SPECIAL_TOKEN: "..."          # From runtime_env                  │    │
│  │ }                                                                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Java Service Implementation

```java
// EnvironmentResolverService.java
@Service
@RequiredArgsConstructor
public class EnvironmentResolverService {
    private final EnvironmentRepo environmentRepo;
    private final EnvironmentSecretService secretService;
    
    /**
     * Resolve environment references to actual values.
     * 
     * @param refs List of environment references (merged in order)
     * @return Map of env var name → value (secrets decrypted)
     */
    public Map<String, ExecutionValue> resolveEnvironments(
            List<ApiResourceReference> refs) {
        
        Map<String, ExecutionValue> merged = new LinkedHashMap<>();
        
        for (ApiResourceReference ref : refs) {
            Optional<Environment> env = environmentRepo.findById(ref.getId());
            if (env.isEmpty()) {
                throw new ValidationException(
                    "Environment not found: " + ref.getId());
            }
            
            for (var entry : env.get().getSpec().getData().entrySet()) {
                EnvironmentValue value = entry.getValue();
                
                // Decrypt secret values
                String actualValue = value.getIsSecret()
                    ? secretService.decrypt(value.getValue())
                    : value.getValue();
                
                // Build ExecutionValue (preserves is_secret flag)
                ExecutionValue execValue = ExecutionValue.newBuilder()
                    .setValue(actualValue)
                    .setIsSecret(value.getIsSecret())
                    .build();
                
                // Later entries override earlier (merge semantics)
                merged.put(entry.getKey(), execValue);
            }
        }
        
        return merged;
    }
}
```

```java
// EnvMergeService.java
@Service
@RequiredArgsConstructor
public class EnvMergeService {
    private final EnvironmentResolverService resolver;
    
    /**
     * Merge all environment sources for an execution.
     * 
     * Priority: template defaults < environments < runtime_env
     */
    public Map<String, ExecutionValue> mergeForExecution(
            EnvironmentSpec templateDefaults,
            List<ApiResourceReference> environmentRefs,
            Map<String, ExecutionValue> runtimeEnv) {
        
        Map<String, ExecutionValue> merged = new LinkedHashMap<>();
        
        // 1. Apply template defaults (lowest priority)
        if (templateDefaults != null) {
            for (var entry : templateDefaults.getData().entrySet()) {
                merged.put(entry.getKey(), toExecutionValue(entry.getValue()));
            }
        }
        
        // 2. Apply environments in order (middle priority)
        if (environmentRefs != null && !environmentRefs.isEmpty()) {
            Map<String, ExecutionValue> resolved = 
                resolver.resolveEnvironments(environmentRefs);
            merged.putAll(resolved);
        }
        
        // 3. Apply runtime_env (highest priority)
        if (runtimeEnv != null) {
            merged.putAll(runtimeEnv);
        }
        
        return merged;
    }
    
    private ExecutionValue toExecutionValue(EnvironmentValue env) {
        return ExecutionValue.newBuilder()
            .setValue(env.getValue())
            .setIsSecret(env.getIsSecret())
            .build();
    }
}
```

### 2.3 Placeholder Resolution

```java
// PlaceholderResolverService.java
@Service
public class PlaceholderResolverService {
    
    private static final Pattern PLACEHOLDER_PATTERN = 
        Pattern.compile("\\$\\{([^}]+)\\}");
    
    /**
     * Resolve ${VARIABLE} placeholders in MCP server configurations.
     */
    public Map<String, String> resolvePlaceholders(
            Map<String, String> placeholders,
            Map<String, ExecutionValue> environment) {
        
        Map<String, String> resolved = new HashMap<>();
        
        for (var entry : placeholders.entrySet()) {
            String value = entry.getValue();
            
            Matcher matcher = PLACEHOLDER_PATTERN.matcher(value);
            if (matcher.matches()) {
                String varName = matcher.group(1);
                ExecutionValue envValue = environment.get(varName);
                
                if (envValue == null) {
                    throw new ValidationException(
                        "Required environment variable not found: " + varName);
                }
                
                resolved.put(entry.getKey(), envValue.getValue());
            } else {
                resolved.put(entry.getKey(), value);
            }
        }
        
        return resolved;
    }
}
```

---

## Part 3: Security - Keeping Secrets Out of Temporal

### Critical Design Decision

**Problem**: Temporal workflow history is persistent and queryable. If we pass secrets through workflow inputs, they become visible in Temporal UI and event history.

**Solution**: ExecutionContext Pattern

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TEMPORAL SECURITY FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Handler (Java) - Backend                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 1. Receive AgentExecution/WorkflowExecution request                  │    │
│  │ 2. Merge all environment sources                                     │    │
│  │ 3. Create ExecutionContext (stores merged env, secrets encrypted)    │    │
│  │ 4. Start Temporal workflow with ONLY execution_id (no secrets!)     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              │ execution_id only                            │
│                              ▼                                               │
│  Temporal Workflow (Java)                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ - Receives execution_id                                              │    │
│  │ - Passes execution_id to activity                                    │    │
│  │ - NO SECRETS in workflow history                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              │ execution_id only                            │
│                              ▼                                               │
│  Activity (Go/Python) - Runner                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 1. Receive execution_id                                              │    │
│  │ 2. Query ExecutionContext by execution_id (gRPC)                    │    │
│  │ 3. Decrypt secrets in memory                                         │    │
│  │ 4. Pass to agent/workflow engine                                     │    │
│  │ 5. Secrets ONLY exist in activity worker memory                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  On Completion:                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ ExecutionContext is DELETED (secrets are ephemeral)                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### ExecutionContext API

```protobuf
// Already exists - ExecutionContextSpec
message ExecutionContextSpec {
  string execution_id = 1;  // Links to AgentExecution or WorkflowExecution
  map<string, ExecutionValue> data = 2;  // Merged environment (encrypted secrets)
}
```

**New gRPC endpoints needed:**

```java
// ExecutionContextRepo.java - Add method
Optional<ExecutionContext> findByExecutionId(String executionId);

// ExecutionContextGrpcAutoController.java - Add endpoint
ExecutionContext getByExecutionId(String executionId);
```

---

## Part 4: CLI Integration

### 4.1 Runtime Environment Flags

```go
// cmd/stigmer/agentexecution/create.go
var (
    envVars    map[string]string  // --env KEY=VALUE
    secretVars map[string]string  // --secret KEY=VALUE  
    envFile    string             // --env-file path
)

func init() {
    createCmd.Flags().StringToStringVarP(&envVars, "env", "e", nil, 
        "Environment variable (KEY=VALUE)")
    createCmd.Flags().StringToStringVarP(&secretVars, "secret", "s", nil, 
        "Secret variable (KEY=VALUE, or just KEY to prompt)")
    createCmd.Flags().StringVar(&envFile, "env-file", "", 
        "Path to env file")
}

func runCreate(cmd *cobra.Command, args []string) error {
    runtimeEnv := make(map[string]*executioncontextv1.ExecutionValue)
    
    // Process --env flags
    for key, value := range envVars {
        runtimeEnv[key] = &executioncontextv1.ExecutionValue{
            Value:    value,
            IsSecret: false,
        }
    }
    
    // Process --secret flags
    for key, value := range secretVars {
        if value == "" {
            // Prompt for secret value
            value, _ = PromptForSecret(fmt.Sprintf("Enter value for %s", key))
        }
        runtimeEnv[key] = &executioncontextv1.ExecutionValue{
            Value:    value,
            IsSecret: true,
        }
    }
    
    // Process --env-file
    if envFile != "" {
        fileEnv, _ := parseEnvFile(envFile)
        for key, value := range fileEnv {
            runtimeEnv[key] = &executioncontextv1.ExecutionValue{
                Value:    value,
                IsSecret: false,
            }
        }
    }
    
    // Build execution request
    execution := &agentexecutionv1.AgentExecution{
        Spec: &agentexecutionv1.AgentExecutionSpec{
            AgentId:    agentID,
            Message:    message,
            RuntimeEnv: runtimeEnv,
        },
    }
    
    // ... rest of execution
}
```

### 4.2 Example Usage

```bash
# Execute agent with runtime environment
stigmer agent execute agt-github-bot \
  --message "Review PR #123" \
  --env LOG_LEVEL=debug \
  --env REPO=my-org/my-repo \
  --secret GITHUB_TOKEN=ghp_xxx

# Execute with secret prompt
stigmer agent execute agt-github-bot \
  --message "Review PR #123" \
  --secret GITHUB_TOKEN  # Prompts interactively

# Execute with env file
stigmer agent execute agt-github-bot \
  --message "Review PR #123" \
  --env-file ./runtime.env

# Execute workflow with runtime environment  
stigmer workflow execute wf-deploy \
  --trigger "Deploy to production" \
  --env ENVIRONMENT=prod \
  --secret AWS_ACCESS_KEY=AKIA... \
  --secret AWS_SECRET_KEY
```

---

## Part 5: Implementation Milestones

### Milestone 1: Encryption Foundation (2-3 days)
**Owner**: Backend (Java) + CLI (Go)

1. Create `EnvironmentSecretService.java` (Cloud)
   - AES-256-GCM encryption/decryption
   - Key from service configuration
   
2. Create `encryption/` package in Go (OSS)
   - Same algorithm
   - Key from env var or local file
   
3. Update `EnvironmentCreateHandler.java`
   - Encrypt `is_secret=true` values before persistence
   
4. Update `EnvironmentUpdateHandler.java`
   - Handle re-encryption on update

5. Add encryption key to service configuration
   - Create `stigmer-encryption` secrets group
   - Update service.yaml

### Milestone 2: ExecutionContext Lifecycle (2-3 days)
**Owner**: Backend (Java)

1. Add `findByExecutionId` to `ExecutionContextRepo`

2. Create `GetByExecutionIdHandler` for gRPC endpoint

3. Modify `AgentExecutionCreateHandler`:
   - Merge environments (template + instance envs + runtime)
   - Create ExecutionContext with merged values
   - Pass only execution_id to Temporal

4. Modify `WorkflowExecutionCreateHandler`:
   - Same pattern as agent execution
   
5. Add cleanup:
   - Delete ExecutionContext when execution completes
   - Add TTL backup (24h auto-delete)

### Milestone 3: Environment Resolution (2-3 days)
**Owner**: Backend (Java)

1. Create `EnvironmentResolverService.java`
   - Fetch environments by refs
   - Decrypt secrets
   - Return merged map

2. Create `EnvMergeService.java`
   - Merge priority: template < envs < runtime

3. Create `PlaceholderResolverService.java`
   - Resolve `${VAR}` in MCP configs
   - Validate all required vars present

4. Integrate into execution handlers

### Milestone 4: Runner Integration (2-3 days)
**Owner**: Workflow Runner (Go) + Agent Runner (Python)

1. **Go (workflow-runner)**:
   - Already handles `runtime_env` ✅
   - Add: Query ExecutionContext if runtime_env not provided
   - Add: Decrypt secrets before passing to Zigflow

2. **Python (agent-runner)**:
   - Add ExecutionContext query (gRPC client)
   - Pass env vars to MCP server spawning
   - Resolve placeholders in MCP configs

3. **Both**:
   - Ensure secrets are never logged
   - Use secure memory handling where possible

### Milestone 5: CLI Integration (1-2 days)
**Owner**: CLI (Go)

1. Add `--env`, `--secret`, `--env-file` flags
   - `stigmer agent execute`
   - `stigmer workflow execute`

2. Implement secret prompting
   - If `--secret KEY` without value, prompt

3. Implement env file parsing
   - Standard `.env` format
   - Support `# comments`

---

## Part 6: SDK Integration (Pulumi-Inspired)

### Go SDK Example

```go
package main

import (
    "github.com/stigmer/stigmer/sdk/go/stigmer"
    "github.com/stigmer/stigmer/sdk/go/agent"
    "github.com/stigmer/stigmer/sdk/go/mcp"
)

func main() {
    stigmer.Run(func(ctx *stigmer.Context) error {
        // Declare environment requirements (like Pulumi Config)
        agent.New(ctx,
            agent.WithName("github-reviewer"),
            agent.WithInstructions("Review GitHub PRs"),
            
            // Declare required environment variables
            agent.WithEnvSpec(map[string]agent.EnvVar{
                "GITHUB_TOKEN": {
                    IsSecret:    true,
                    Description: "GitHub personal access token",
                },
                "GITHUB_ORG": {
                    IsSecret:    false,
                    Description: "GitHub organization name",
                },
            }),
            
            // MCP server with placeholder references
            agent.WithMcpServer(mcp.StdioServer{
                Name:    "github",
                Command: "npx",
                Args:    []string{"@modelcontextprotocol/server-github"},
                EnvPlaceholders: map[string]string{
                    "GITHUB_TOKEN": "${GITHUB_TOKEN}",  // Resolved at runtime
                },
            }),
        )
        
        return nil
    })
}
```

### Execution

```bash
# Apply the agent template
stigmer apply ./my-agent.go

# Create environment with secrets
cat > env-prod.yaml <<EOF
apiVersion: ai.stigmer.agentic/v1
kind: Environment
metadata:
  name: github-prod
spec:
  data:
    GITHUB_TOKEN:
      value: "ghp_xxx..."
      is_secret: true
    GITHUB_ORG:
      value: "my-org"
      is_secret: false
EOF
stigmer apply ./env-prod.yaml

# Create instance binding environment
cat > instance.yaml <<EOF
apiVersion: ai.stigmer.agentic/v1
kind: AgentInstance
metadata:
  name: github-reviewer-prod
spec:
  agent_id: agt-github-reviewer
  environment_refs:
    - id: env-github-prod
EOF
stigmer apply ./instance.yaml

# Execute with runtime override
stigmer agent execute agt-github-reviewer \
  --message "Review PR #123" \
  --env GITHUB_ORG=other-org  # Override for this execution
```

---

## Part 7: Test Plan

### Unit Tests

```java
// EnvironmentSecretServiceTest.java
@Test
void shouldEncryptAndDecrypt() {
    String plaintext = "super-secret-token";
    String encrypted = secretService.encrypt(plaintext);
    String decrypted = secretService.decrypt(encrypted);
    
    assertThat(decrypted).isEqualTo(plaintext);
    assertThat(encrypted).isNotEqualTo(plaintext);
}

// EnvMergeServiceTest.java
@Test
void shouldMergeWithCorrectPriority() {
    // Template: LOG_LEVEL=info
    // Environment: LOG_LEVEL=warn, DB_HOST=localhost
    // Runtime: LOG_LEVEL=debug
    
    // Result: LOG_LEVEL=debug, DB_HOST=localhost
}
```

### Integration Tests

```bash
# Test complete flow
# 1. Create environment with secrets
stigmer apply test-env.yaml

# 2. Verify secret is encrypted in MongoDB
# (use MongoDB Compass to inspect)

# 3. Create agent with env_spec
stigmer apply test-agent.go

# 4. Create instance with env ref
stigmer apply test-instance.yaml

# 5. Execute with runtime override
stigmer agent execute agt-test \
  --message "test" \
  --env OVERRIDE=true

# 6. Verify:
# - Temporal history shows NO secrets
# - Agent receives correct merged env
# - Secrets are decrypted in runner
```

---

## Open Questions Resolved

| Question | Decision |
|----------|----------|
| Key management (Cloud) | Use service configuration pattern with `$secrets-group/` |
| Key management (OSS) | Environment variable or `~/.stigmer/encryption.key` |
| Workflow runner language | Already Go, no change needed |
| Algorithm | AES-256-GCM (industry standard) |
| Design philosophy | Pulumi-inspired, universal, SDK-first |

---

## Quality Checklist

- [ ] No secrets in Temporal workflow history
- [ ] Secrets encrypted at rest in MongoDB
- [ ] Secrets never logged (redacted in all logs)
- [ ] Clear merge priority documented and tested
- [ ] Placeholder resolution validates all required vars
- [ ] ExecutionContext deleted after execution
- [ ] CLI provides intuitive UX for secrets
- [ ] SDK feels natural for Pulumi users
- [ ] Code follows existing patterns (ConfigurationProperties, pipeline steps)
- [ ] Comprehensive test coverage
- [ ] Documentation updated
