---
name: Encryption Foundation Milestone
overview: Implement AES-256-GCM encryption for environment secrets across both Cloud (Java) and OSS (Go) codebases, following existing architectural patterns and quality standards.
todos:
  - id: encryption-config
    content: Create EncryptionConfig.java with @ConfigurationProperties pattern and key validation
    status: completed
  - id: secret-service-java
    content: Implement EnvironmentSecretService.java with AES-256-GCM encrypt/decrypt/isEncrypted methods
    status: completed
  - id: pipeline-steps
    content: Create EncryptSecretValues, DecryptSecretValues, and RedactSecretValues pipeline steps
    status: completed
  - id: handler-integration
    content: Integrate encryption steps into EnvironmentCreateHandler and EnvironmentUpdateHandler pipelines
    status: completed
  - id: service-config
    content: Add STIGMER_ENCRYPTION_ENVIRONMENT_KEY to service.yaml and create secrets-group
    status: completed
  - id: encryption-pkg-go
    content: Create pkg/encryption/ package in stigmer-server with AES-256-GCM and key management
    status: completed
  - id: unit-tests
    content: Write comprehensive unit tests for both Java and Go implementations
    status: completed
  - id: integration-tests
    content: Write integration tests verifying MongoDB stores encrypted values
    status: completed
  - id: cross-platform-test
    content: Create shared test vectors and verify Java/Go interoperability
    status: completed
isProject: false
---

# Encryption Foundation - Implementation Plan

## Overview

This milestone establishes the cryptographic foundation for securing environment secrets at rest. Secrets marked with `is_secret=true` in Environment resources will be encrypted before MongoDB persistence and decrypted on retrieval.

**Algorithm**: AES-256-GCM (authenticated encryption with 12-byte nonce, 128-bit auth tag)

**Format**: `base64(nonce || ciphertext || auth_tag)`

---

## Part 1: Cloud Implementation (Java - stigmer-cloud)

### 1.1 Configuration Layer

Create encryption configuration following the established `@ConfigurationProperties` pattern.

**New File**: `backend/services/stigmer-service/src/main/java/ai/stigmer/config/encryption/EncryptionConfig.java`

```java
@Data
@Configuration
@ConfigurationProperties(prefix = "stigmer.encryption")
public class EncryptionConfig {
    
    /**
     * Base64-encoded 32-byte AES-256 key for environment secret encryption.
     * Sourced from STIGMER_ENCRYPTION_ENVIRONMENT_KEY environment variable.
     */
    private String environmentKey;
    
    /**
     * Validates that the key is present and correctly sized.
     */
    public void validate() {
        if (environmentKey == null || environmentKey.isEmpty()) {
            throw new IllegalStateException(
                "STIGMER_ENCRYPTION_ENVIRONMENT_KEY must be configured");
        }
        byte[] decoded = Base64.getDecoder().decode(environmentKey);
        if (decoded.length != 32) {
            throw new IllegalStateException(
                "Encryption key must be exactly 32 bytes (256 bits)");
        }
    }
}
```

### 1.2 Encryption Service

**New File**: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/environment/service/EnvironmentSecretService.java`

Core implementation requirements:

- **Thread-safe**: `SecretKeySpec` is immutable and thread-safe
- **Unique nonce per encryption**: Use `SecureRandom.getInstanceStrong()` for IV generation
- **Proper error handling**: Wrap crypto exceptions in domain exceptions
- **No plaintext in logs**: Never log plaintext secrets
- **Validation on startup**: Fail fast if key is invalid via `@PostConstruct`

Key methods:

```java
public String encrypt(String plaintext)   // Returns base64(iv || ciphertext)
public String decrypt(String encrypted)   // Decrypts and returns plaintext
public boolean isEncrypted(String value)  // Detects if value is already encrypted
```

### 1.3 Pipeline Step Integration

**New File**: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/environment/request/step/EncryptSecretValues.java`

A dedicated pipeline step (following the existing `RequestPipelineStepV2` pattern) that:

1. Iterates through `spec.data` entries
2. For entries with `is_secret=true`, encrypts the `value` field
3. Preserves all other fields unchanged

**Modify**: [EnvironmentCreateHandler.java](backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/environment/request/handler/EnvironmentCreateHandler.java)

Insert `encryptSecretValues` step before `buildNewState`:

```java
.addStep(commonSteps.validateFieldConstraints)
.addStep(commonSteps.authorize)
.addStep(commonSteps.resolveSlug)
.addStep(createSteps.checkDuplicate)
.addStep(encryptSecretValues)          // NEW: Encrypt before persistence
.addStep(createSteps.buildNewState)
.addStep(createSteps.persist)
```

**Modify**: `EnvironmentUpdateHandler.java` with same pattern.

### 1.4 Decryption for Reads

**New File**: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/environment/request/step/DecryptSecretValues.java`

For GET operations, decrypt secrets before returning (with option to redact instead for UI responses).

**New File**: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/environment/request/step/RedactSecretValues.java`

For responses where secrets should be masked (e.g., list operations, UI responses):

- Replace decrypted value with `"***REDACTED***"` or similar
- Preserve `is_secret=true` flag

### 1.5 Service Configuration

**Modify**: [service.yaml](backend/services/stigmer-service/_kustomize/base/service.yaml)

Add under `env.secrets`:

```yaml
secrets:
  STIGMER_ENCRYPTION_ENVIRONMENT_KEY:
    value: $secrets-group/stigmer-encryption/prod.environment-key
```

**New File**: `_ops/planton/service-hub/secrets-group/stigmer-encryption.yaml`

```yaml
apiVersion: planton.cloud/v1
kind: SecretsGroup
metadata:
  name: stigmer-encryption
  org: stigmer
spec:
  secrets:
    prod:
      environment-key: <generate-32-byte-key-base64>
    local:
      environment-key: <local-dev-key>
```

**Modify**: `application.yaml` to bind the property:

```yaml
stigmer:
  encryption:
    environment-key: ${STIGMER_ENCRYPTION_ENVIRONMENT_KEY:}
```

---

## Part 2: OSS Implementation (Go - stigmer)

### 2.1 Encryption Package

**New Directory**: `backend/services/stigmer-server/pkg/encryption/`

**New Files**:

- `encryption.go` - Core AES-256-GCM encrypt/decrypt
- `keymanager.go` - Key loading from env var or file
- `encryption_test.go` - Comprehensive tests

Key management priority:

1. `STIGMER_ENCRYPTION_KEY` environment variable (base64-encoded 32-byte key)
2. `~/.stigmer/encryption.key` file (raw 32-byte key)
3. Auto-generate and persist to file if neither exists (first run experience)
```go
func GetOrCreateKey() ([]byte, error) {
    // 1. Check env var
    if key := os.Getenv("STIGMER_ENCRYPTION_KEY"); key != "" {
        return base64.StdEncoding.DecodeString(key)
    }
    
    // 2. Check file
    keyPath := filepath.Join(os.UserHomeDir(), ".stigmer", "encryption.key")
    if data, err := os.ReadFile(keyPath); err == nil && len(data) == 32 {
        return data, nil
    }
    
    // 3. Generate new key
    key := make([]byte, 32)
    if _, err := crypto_rand.Read(key); err != nil {
        return nil, fmt.Errorf("failed to generate encryption key: %w", err)
    }
    
    // 4. Persist with secure permissions
    if err := os.MkdirAll(filepath.Dir(keyPath), 0700); err != nil {
        return nil, err
    }
    if err := os.WriteFile(keyPath, key, 0600); err != nil {
        return nil, err
    }
    
    return key, nil
}
```


### 2.2 Service Integration

**New File**: `backend/services/stigmer-server/pkg/encryption/service.go`

```go
type SecretService struct {
    key []byte
}

func NewSecretService() (*SecretService, error)
func (s *SecretService) Encrypt(plaintext string) (string, error)
func (s *SecretService) Decrypt(ciphertext string) (string, error)
func (s *SecretService) IsEncrypted(value string) bool
```

### 2.3 Domain Integration

**Modify**: Environment domain handlers to use `SecretService` for encrypt/decrypt operations (similar to Java pattern).

---

## Part 3: Interoperability Requirements

Both implementations MUST produce compatible ciphertext:

- **Algorithm**: AES-256-GCM
- **Nonce**: 12 bytes, prepended to ciphertext
- **Auth tag**: 128 bits (16 bytes), appended to ciphertext
- **Encoding**: `base64(nonce || ciphertext || tag)`

Cross-platform test: Encrypt in Java, decrypt in Go (and vice versa) using same key.

---

## Part 4: Security Hardening

### 4.1 Memory Safety (Go)

- Consider `memguard` for sensitive key storage (evaluate complexity vs benefit)
- Zero key material after use where practical

### 4.2 Logging Protection

- **NEVER** log plaintext secrets
- Log encryption/decryption operations at DEBUG level with secret name only
- Add integration with existing log redaction if available

### 4.3 Startup Validation

Both implementations must fail fast on startup if:

- Encryption key is not configured (production mode)
- Encryption key is wrong size (not 32 bytes)
- Key file has incorrect permissions (Go: not 0600)

---

## Part 5: Testing Strategy

### 5.1 Unit Tests

**Java** (`EnvironmentSecretServiceTest.java`):

- `shouldEncryptAndDecrypt` - Round-trip test
- `shouldProduceUniqueCiphertextForSamePlaintext` - Nonce uniqueness
- `shouldRejectInvalidKey` - Key validation
- `shouldDetectTamperedCiphertext` - GCM authentication

**Go** (`encryption_test.go`):

- Same test cases
- `TestCrossLanguageCompatibility` - Using fixed test vectors

### 5.2 Integration Tests

**Java** (`EnvironmentCreateHandlerIntegrationTest.java`):

- Create environment with `is_secret=true` value
- Verify MongoDB stores encrypted value (not plaintext)
- Retrieve and verify decryption

### 5.3 Test Vectors

Create shared test vectors file for cross-platform validation:

```json
{
  "key_base64": "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
  "test_cases": [
    {
      "plaintext": "super-secret-token",
      "nonce_base64": "AAAAAAAAAAAAAAAA",
      "expected_ciphertext_base64": "..."
    }
  ]
}
```

---

## Part 6: Migration Considerations

### 6.1 Existing Data

If any environments with `is_secret=true` already exist with plaintext values:

1. **Option A (Recommended)**: Run one-time migration script to encrypt existing secrets
2. **Option B**: Service detects plaintext on read, encrypts and updates on next write

### 6.2 Key Rotation (Future)

Design encryption format to support key rotation:

- Consider adding key version prefix to ciphertext format
- Document key rotation procedure for future implementation

---

## File Summary

### New Files (Cloud - Java)

| File | Purpose |

|------|---------|

| `config/encryption/EncryptionConfig.java` | Configuration properties |

| `domain/agentic/environment/service/EnvironmentSecretService.java` | Encryption service |

| `domain/agentic/environment/request/step/EncryptSecretValues.java` | Pipeline step (encrypt) |

| `domain/agentic/environment/request/step/DecryptSecretValues.java` | Pipeline step (decrypt) |

| `domain/agentic/environment/request/step/RedactSecretValues.java` | Pipeline step (redact) |

| Tests for all above | Comprehensive test coverage |

### Modified Files (Cloud - Java)

| File | Change |

|------|--------|

| `_kustomize/base/service.yaml` | Add encryption key env var |

| `EnvironmentCreateHandler.java` | Add encrypt step to pipeline |

| `EnvironmentUpdateHandler.java` | Add encrypt step to pipeline |

| `EnvironmentGetHandler.java` | Add decrypt/redact step |

| `application.yaml` | Bind encryption properties |

### New Files (OSS - Go)

| File | Purpose |

|------|---------|

| `pkg/encryption/encryption.go` | Core AES-256-GCM implementation |

| `pkg/encryption/keymanager.go` | Key loading/generation |

| `pkg/encryption/service.go` | High-level service interface |

| `pkg/encryption/BUILD.bazel` | Bazel build configuration |

| `pkg/encryption/encryption_test.go` | Comprehensive tests |

### Infrastructure

| File | Purpose |

|------|---------|

| `_ops/planton/service-hub/secrets-group/stigmer-encryption.yaml` | Encryption key secrets |

---

## Quality Checklist

- [ ] AES-256-GCM with 12-byte random nonce per encryption
- [ ] 128-bit authentication tag for tamper detection
- [ ] Base64 encoding for storage compatibility
- [ ] Thread-safe implementation (no shared mutable state)
- [ ] Fail-fast key validation on startup
- [ ] No plaintext secrets in logs
- [ ] Comprehensive unit tests (>90% coverage)
- [ ] Integration tests for full CRUD flow
- [ ] Cross-language compatibility verified
- [ ] File permissions enforced (Go: 0600 for key file)
- [ ] Documentation updated
- [ ] Existing patterns followed (ConfigurationProperties, pipeline steps)