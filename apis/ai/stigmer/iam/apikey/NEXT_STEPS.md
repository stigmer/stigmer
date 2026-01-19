# API Key Implementation - Next Steps

This document outlines the remaining work to complete the API key feature in Stigmer.

## ✅ Completed

### Proto Definitions
- [x] `api.proto` - ApiKey message structure
- [x] `spec.proto` - ApiKeySpec with hash, fingerprint, expiration
- [x] `command.proto` - Command service RPCs
- [x] `query.proto` - Query service RPCs
- [x] `io.proto` - Wrapper messages
- [x] `BUILD.bazel` - Bazel build configuration
- [x] Example curl files (create, get, list, update, delete)
- [x] README.md documentation

### Java Backend Libraries
- [x] `ApiKeyConstants` - Define `stk_` prefix
- [x] `ApiKeyHasher` - SHA-256 hashing
- [x] `ApiKeyFingerprintExtractor` - Last 6 chars
- [x] `ApiKeyGenerator` - Generate secure random keys
- [x] `ApiKeyOwnerIdentityAccountIdExtractor` - Extract owner
- [x] `ApiKeyRedisCacheKeyBuilder` - Redis key format
- [x] `ApiKeyGrpcRepo` - Interface for IAM service calls
- [x] `ApiKeyDefaultGrpcRepo` - Default implementation
- [x] `ApiKeyRedisCacheRepo` - Redis cache operations
- [x] `ApiKeyHashToApiKeyCacheProxy` - Cache-aside pattern
- [x] `RedisApiKeyIntrospector` - OAuth2 token introspector
- [x] Updated `GrpcSecurityConfigBase` - Added API key support
- [x] `TimestampConverter` utility

## 🔨 To Do

### 1. Build Proto Stubs

Generate Java stubs from proto definitions:

```bash
cd /Users/suresh/scm/github.com/leftbin/stigmer
bazel build //apis/ai/stigmer/iam/apikey/v1:v1_java_proto
bazel build //apis/ai/stigmer/iam/apikey/v1:v1_java_grpc
```

**Verify:**
```bash
bazel query 'deps(//apis/ai/stigmer/iam/apikey/v1:v1_java_proto)'
```

### 2. Implement IAM Service Handlers

Create service implementations in IAM service:

**Location:** `backend/services/iam/src/main/java/ai/stigmer/iam/domain/apikey/`

**Files to Create:**

#### Command Handler
```java
// CreateApiKeyHandler.java
@Component
public class CreateApiKeyHandler {
    public ApiKey handle(ApiKey input) {
        // 1. Validate input
        // 2. Generate raw key (ApiKeyGenerator.generate())
        // 3. Hash key (ApiKeyHasher.hash())
        // 4. Extract fingerprint (ApiKeyFingerprintExtractor.extract())
        // 5. Set computed fields (keyHash, fingerprint)
        // 6. Set owner from security context
        // 7. Save to MongoDB
        // 8. Return with raw key in spec.keyHash (ONLY time!)
    }
}

// UpdateApiKeyHandler.java
@Component
public class UpdateApiKeyHandler {
    public ApiKey handle(ApiKey input) {
        // 1. Validate input (must have metadata.id)
        // 2. Load existing from MongoDB
        // 3. Verify ownership
        // 4. Update allowed fields (name, description, expiresAt)
        // 5. Cannot update keyHash or fingerprint
        // 6. Save to MongoDB
        // 7. Invalidate Redis cache
        // 8. Return updated
    }
}

// DeleteApiKeyHandler.java
@Component
public class DeleteApiKeyHandler {
    public ApiKey handle(ApiKeyId input) {
        // 1. Load from MongoDB
        // 2. Verify ownership
        // 3. Delete from MongoDB
        // 4. Invalidate Redis cache
        // 5. Return deleted
    }
}
```

#### Query Handler
```java
// GetApiKeyByIdHandler.java
@Component
public class GetApiKeyByIdHandler {
    public ApiKey handle(ApiKeyId input) {
        // 1. Load from MongoDB
        // 2. Verify ownership or platform operator
        // 3. Return (keyHash field will be empty - never returned)
    }
}

// GetApiKeyByKeyHashHandler.java
@Component
public class GetApiKeyByKeyHashHandler {
    public ApiKey handle(ApiKeyHash input) {
        // 1. Query MongoDB by spec.keyHash
        // 2. Verify ownership or platform operator
        // 3. Return (used by RedisApiKeyIntrospector)
    }
}

// FindAllApiKeysHandler.java
@Component
public class FindAllApiKeysHandler {
    public ApiKeys handle(Empty input) {
        // 1. Get identity from security context
        // 2. Query MongoDB where metadata.ownerId = identityAccountId
        // 3. Return all owned keys
    }
}
```

#### MongoDB Repository
```java
// ApiKeyMongoEntity.java
@Document(collection = "api_keys")
public class ApiKeyMongoEntity {
    @Id
    private String id;
    private String name;
    private String description;
    private String ownerId;
    private String keyHash;
    private String fingerprint;
    private Instant expiresAt;
    private boolean neverExpires;
    private Instant lastUsedAt;
    // ... getters/setters
}

// ApiKeyMongoRepository.java
public interface ApiKeyMongoRepository extends MongoRepository<ApiKeyMongoEntity, String> {
    Optional<ApiKeyMongoEntity> findByKeyHash(String keyHash);
    List<ApiKeyMongoEntity> findByOwnerId(String ownerId);
}

// ApiKeyEntityMapper.java
@Component
public class ApiKeyEntityMapper {
    public ApiKeyMongoEntity toEntity(ApiKey proto) { ... }
    public ApiKey toProto(ApiKeyMongoEntity entity) { ... }
}
```

#### gRPC Service
```java
// ApiKeyCommandControllerImpl.java
@GrpcService
public class ApiKeyCommandControllerImpl 
        extends ApiKeyCommandControllerGrpc.ApiKeyCommandControllerImplBase {
    
    @Override
    public void create(ApiKey request, StreamObserver<ApiKey> responseObserver) {
        var response = createHandler.handle(request);
        responseObserver.onNext(response);
        responseObserver.onCompleted();
    }
    
    // ... update, delete
}

// ApiKeyQueryControllerImpl.java
@GrpcService
public class ApiKeyQueryControllerImpl 
        extends ApiKeyQueryControllerGrpc.ApiKeyQueryControllerImplBase {
    
    // ... get, getByKeyHash, findAll
}
```

### 3. Update Last Used Timestamp

Add interceptor to update `status.lastUsedAt` on every successful authentication:

```java
// ApiKeyUsageTrackerInterceptor.java
@Component
public class ApiKeyUsageTrackerInterceptor implements ServerInterceptor {
    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(...) {
        // After successful auth, check if token is API key
        // If yes, extract token_id from security context
        // Update MongoDB: db.api_keys.updateOne({_id}, {$set: {lastUsedAt: now}})
    }
}
```

### 4. Add Background Cleanup Job

Delete expired keys periodically:

```java
// ExpiredApiKeyCleanupJob.java
@Component
public class ExpiredApiKeyCleanupJob {
    
    @Scheduled(cron = "0 0 2 * * ?")  // 2 AM daily
    public void cleanupExpiredKeys() {
        var now = Instant.now();
        var expiredKeys = mongoRepo.findByExpiresAtBeforeAndNeverExpiresFalse(now);
        
        for (var key : expiredKeys) {
            mongoRepo.delete(key);
            redisCacheRepo.delete(key.getKeyHash());
            log.info("Deleted expired API key: {}", key.getFingerprint());
        }
    }
}
```

### 5. Add Unit Tests

**Test Coverage:**
- `ApiKeyHasher` - Verify deterministic SHA-256 output
- `ApiKeyFingerprintExtractor` - Edge cases (keys shorter than 6 chars)
- `ApiKeyGenerator` - Verify prefix, length, uniqueness
- `RedisApiKeyIntrospector` - Expiration logic, error handling
- `ApiKeyHashToApiKeyCacheProxy` - Cache hit/miss behavior
- Create/Update/Delete handlers - Business logic
- MongoDB repository queries

### 6. Add Integration Tests

**Test Scenarios:**
1. Create API key → verify raw key returned → verify hash stored
2. Use API key in Authorization header → verify authentication succeeds
3. Use API key → verify Redis cache populated
4. Use cached API key → verify no gRPC call to IAM
5. Delete API key → verify authentication fails immediately
6. Create expired key → verify authentication fails
7. Update key expiration → verify cache invalidated

### 7. Update Other Services

**Services That Call IAM:**

All services using `api-authentication` library need:

1. **Add gRPC client stub:**
```java
@Configuration
public class IamGrpcClientConfig {
    @Bean
    ApiKeyQueryControllerBlockingStub apiKeyQueryStub(
            @GrpcClient("iam-service") Channel channel) {
        return ApiKeyQueryControllerGrpc.newBlockingStub(channel);
    }
}
```

2. **Rebuild with updated proto stubs:**
```bash
bazel build //backend/services/[service-name]:all
```

### 8. Documentation

**User Documentation:**
- [ ] Add API key section to user guide
- [ ] Create tutorial: "Using API Keys for CI/CD"
- [ ] Add API reference to docs site
- [ ] Update CLI help text to mention API key auth

**Developer Documentation:**
- [ ] Architecture diagram (authentication flow)
- [ ] Runbook for troubleshooting API key issues
- [ ] Security guidelines for key management

### 9. Monitoring & Observability

**Metrics to Add:**
```java
// In RedisApiKeyIntrospector
counter("api_key_auth_total").increment();
counter("api_key_auth_failures", "reason", reason).increment();
histogram("api_key_auth_duration_seconds").record(duration);

// In ApiKeyRedisCacheRepo
counter("api_key_cache_hit").increment();
counter("api_key_cache_miss").increment();
```

**Alerts to Configure:**
- High cache miss rate (> 10%)
- High authentication failure rate (> 5%)
- Slow authentication (p99 > 100ms)

### 10. Deployment

**Staging:**
1. Deploy updated proto stubs
2. Deploy IAM service with API key handlers
3. Deploy other services with updated auth library
4. Smoke test: create key, use key, revoke key
5. Load test: 1000 req/s with cached keys

**Production:**
1. Blue-green deployment
2. Monitor authentication success rate
3. Monitor cache hit ratio
4. Monitor API key usage vs JWT usage
5. Rollback plan: revert to previous version

## Verification Checklist

### Functional
- [ ] Can create API key
- [ ] Raw key shown only once
- [ ] Can list owned keys
- [ ] Can update key (name, expiration)
- [ ] Can delete key
- [ ] Deleted key immediately invalid
- [ ] Expired key rejected
- [ ] Non-owned key not visible

### Performance
- [ ] Cached auth < 10ms p99
- [ ] Cache miss auth < 100ms p99
- [ ] Cache hit ratio > 90%
- [ ] Redis memory usage < 100 MB for 10K keys

### Security
- [ ] Raw key never stored in database
- [ ] Raw key never logged
- [ ] Hash irreversible (SHA-256)
- [ ] Fingerprint not guessable
- [ ] Owner verification enforced

## Estimated Effort

| Task | Estimate |
|------|----------|
| IAM service implementation | 2-3 days |
| Unit tests | 1 day |
| Integration tests | 1 day |
| Documentation | 1 day |
| Deployment & verification | 1 day |
| **Total** | **6-7 days** |

## Support

For questions or issues during implementation:

1. Check `API_KEY_IMPLEMENTATION_SUMMARY.md` for design details
2. Review Planton Cloud implementation at:
   - `/Users/suresh/scm/github.com/plantonhq/planton/backend/services/iam/src/main/java/ai/planton/iam/domain/apikey/`
3. Check Spring Security OAuth2 docs: https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/opaque-token.html
