# T01 Interface Sketches

**Date**: 2026-04-20
**Status**: DRAFT — for review
**Scope**: Java signatures only. No implementations. Final package paths assume the [Decision 2](../design-decisions/001-neutral-interfaces-and-reflection-contract.md#decision-2--java-package-rename-to-aistigmerplatform) rename has been applied.

## Bucket A — Resource kind & registry

```java
package ai.stigmer.platform.apishape.kind;

/** Typed wrapper around a String kind identifier. Prevents stringly-typed call sites. */
public record ResourceKind(String value) {
    public ResourceKind {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("kind value must not be blank");
        }
    }
}
```

```java
package ai.stigmer.platform.apishape.kind;

import com.google.protobuf.Descriptors.Descriptor;
import com.google.protobuf.Message;

public interface KindRegistry {
    void register(ResourceKind kind, KindMetadata metadata);
    KindMetadata resolve(ResourceKind kind);
    java.util.Set<ResourceKind> all();
    java.util.Optional<ResourceKind> kindOf(Class<? extends Message> protoClass);
}
```

```java
package ai.stigmer.platform.apishape.kind;

import com.google.protobuf.Descriptors.Descriptor;
import com.google.protobuf.Message;

/** Per-kind metadata previously held by ApiResourceKindMeta proto. */
public interface KindMetadata {
    ResourceKind kind();
    String pluralName();          // e.g. "users"
    String singularName();        // e.g. "user"
    String idPrefix();            // e.g. "usr"
    String groupName();           // e.g. "iam"
    String apiVersion();          // e.g. "v1"
    Class<? extends Message> protoClass();
    Descriptor protoDescriptor();
    boolean versioned();
}
```

## Bucket B — Resource metadata

```java
package ai.stigmer.platform.apishape.metadata;

public interface ResourceMetadata {
    String id();
    String slug();
    String org();
    String name();
    Visibility visibility();
    java.util.Optional<String> versionId();
    java.util.Map<String, String> labels();
    java.util.Map<String, String> annotations();
    java.util.List<String> tags();
}
```

```java
package ai.stigmer.platform.apishape.metadata;

public enum Visibility {
    UNSPECIFIED,
    PUBLIC,
    PRIVATE
}
```

```java
package ai.stigmer.platform.apishape.metadata;

import com.google.protobuf.Message;
import com.google.protobuf.Descriptors.Descriptor;
import com.google.protobuf.Descriptors.FieldDescriptor;

/**
 * Adapter that wraps any proto Message and reads metadata sub-fields by NAME.
 * Contract: the wrapped message must have a sub-message field named "metadata"
 * containing string fields named "id", "slug", "org", "name" and an enum field
 * named "visibility" whose values are 0=UNSPECIFIED, 1=PUBLIC, 2=PRIVATE.
 */
public final class ProtoReflectionMetadataAdapter implements ResourceMetadata {
    private final Message metadataMessage;

    public static ProtoReflectionMetadataAdapter from(Message resource) { /* ... */ }

    private ProtoReflectionMetadataAdapter(Message metadataMessage) {
        this.metadataMessage = metadataMessage;
    }

    @Override public String id()                                   { /* findFieldByName("id") */ }
    @Override public String slug()                                 { /* findFieldByName("slug") */ }
    @Override public String org()                                  { /* findFieldByName("org") */ }
    @Override public String name()                                 { /* findFieldByName("name") */ }
    @Override public Visibility visibility()                       { /* enum value -> Visibility */ }
    @Override public java.util.Optional<String> versionId()        { /* findFieldByName("version") */ }
    @Override public java.util.Map<String, String> labels()        { /* ... */ }
    @Override public java.util.Map<String, String> annotations()   { /* ... */ }
    @Override public java.util.List<String> tags()                 { /* ... */ }
}
```

## Bucket C — Audit

```java
package ai.stigmer.platform.apishape.audit;

public interface ResourceAudit {
    java.util.Optional<AuditInfo> created();
    java.util.Optional<AuditInfo> lastModified();
    java.util.List<AuditInfo> events();
}
```

```java
package ai.stigmer.platform.apishape.audit;

import java.time.Instant;

public interface AuditInfo {
    Instant timestamp();
    AuditEventType eventType();
    AuditActor actor();
    java.util.Optional<String> message();
}
```

```java
package ai.stigmer.platform.apishape.audit;

public interface AuditActor {
    String id();
    String displayName();
    ActorKind kind();   // USER, SERVICE, API_KEY, SYSTEM

    enum ActorKind { USER, SERVICE, API_KEY, SYSTEM, UNSPECIFIED }
}
```

```java
package ai.stigmer.platform.apishape.audit;

public enum AuditEventType {
    UNSPECIFIED,
    CREATED,
    UPDATED,
    DELETED,
    RESTORED,
    PERMISSION_CHANGED;

    /** Whether the event must be persisted to the audit log. */
    public boolean isPersistRequired() {
        return this == CREATED || this == UPDATED || this == DELETED;
    }
}
```

```java
package ai.stigmer.platform.apishape.audit;

import com.google.protobuf.Message;

public final class ProtoReflectionAuditAdapter implements ResourceAudit {
    public static ProtoReflectionAuditAdapter from(Message statusMessage) { /* ... */ }
    // Reads "audit", "audit.created", "audit.last_modified", "audit.events[]" by name
}
```

## Bucket D — Find request

Decision: reflection over interface, consistent with Bucket B.

```java
package ai.stigmer.platform.grpcrequest.find;

import com.google.protobuf.Message;

public interface FindRequest {
    int pageSize();
    String pageToken();
    java.util.Optional<String> parent();
    java.util.Map<String, String> filters();
}

public final class ProtoReflectionFindRequestAdapter implements FindRequest {
    public static ProtoReflectionFindRequestAdapter from(Message request) { /* ... */ }
}
```

## Bucket E — Method authorization config

```java
package ai.stigmer.platform.apiauthorization.config;

import ai.stigmer.platform.apishape.kind.ResourceKind;

public interface MethodAuthorizationConfig {
    ResourceKind targetKind();
    java.util.Set<String> requiredPermissions();
    AuthorizationScope scope();
    java.util.Optional<String> resourceIdFieldName();   // proto field on the request that holds the resource id
}
```

```java
package ai.stigmer.platform.apiauthorization.config;

public enum AuthorizationScope {
    PLATFORM,
    ORG,
    RESOURCE,
    UNSPECIFIED
}
```

```java
package ai.stigmer.platform.apiauthorization.config;

import ai.stigmer.platform.apishape.kind.ResourceKind;

public interface KindAuthorizationConfig {
    ResourceKind kind();
    OwnerAttribution ownerAttribution();
    java.util.List<ParentRelation> parentRelations();
    java.util.List<String> defaultRoles();
}
```

```java
package ai.stigmer.platform.apiauthorization.config;

public enum OwnerAttribution {
    CALLER, ORG, PARENT_RESOURCE, NONE
}
```

```java
package ai.stigmer.platform.apiauthorization.config;

import ai.stigmer.platform.apishape.kind.ResourceKind;

public interface ParentRelation {
    ResourceKind parentKind();
    String parentIdFieldName();
    boolean propagatePermissions();
}
```

## Bucket F — Authorization policy (replaces IAM proto types)

```java
package ai.stigmer.platform.apiauthorization.policy;

public interface AuthorizationPolicy {
    String id();
    java.util.List<RoleBinding> roleBindings();
}
```

```java
package ai.stigmer.platform.apiauthorization.policy;

public interface RoleBinding {
    Role role();
    java.util.List<String> memberIds();
    java.util.List<ResourceRef> resources();
}
```

```java
package ai.stigmer.platform.apiauthorization.policy;

public interface Role {
    String id();
    String displayName();
    java.util.Set<Permission> permissions();
}
```

```java
package ai.stigmer.platform.apiauthorization.policy;

import ai.stigmer.platform.apishape.kind.ResourceKind;

public interface Permission {
    ResourceKind kind();
    String action();        // e.g. "read", "write", "delete"
}
```

```java
package ai.stigmer.platform.apiauthorization.policy;

import ai.stigmer.platform.apishape.kind.ResourceKind;

public interface ResourceRef {
    ResourceKind kind();
    String id();
}
```

## Bucket G — Authentication primitives

```java
package ai.stigmer.platform.apiauthentication;

public interface AuthenticatedIdentity {
    String accountId();
    String email();
    java.util.Optional<String> orgId();
    java.util.Set<String> roles();
}
```

```java
package ai.stigmer.platform.apiauthentication.apikey;

import java.time.Instant;

public interface ApiKeyDescriptor {
    String id();
    String hashedSecret();
    String ownerAccountId();
    java.util.Optional<Instant> expiresAt();
    boolean revoked();
}
```

## Cross-cutting — Contract validator

```java
package ai.stigmer.platform.apishape.contract;

import ai.stigmer.platform.apishape.kind.KindRegistry;
import ai.stigmer.platform.apishape.kind.ResourceKind;

public final class MetadataContractValidator {
    public java.util.List<ContractViolation> validateAll(KindRegistry registry) { /* ... */ }

    public java.util.Optional<ContractViolation> validate(ResourceKind kind) { /* ... */ }
}

public record ContractViolation(
    ResourceKind kind,
    String missingFieldPath,    // e.g. "metadata.slug"
    String reason
) {}

/** Hook into Spring lifecycle so that a contract violation prevents the application from starting. */
@org.springframework.stereotype.Component
public class MetadataContractStartupCheck {
    public MetadataContractStartupCheck(KindRegistry registry, MetadataContractValidator validator) {
        var violations = validator.validateAll(registry);
        if (!violations.isEmpty()) {
            throw new IllegalStateException("Contract violations:\n" + format(violations));
        }
    }
}
```

## Documented metadata field-name contract (the spec the validator enforces)

For any `Message resource` registered in `KindRegistry`:

| Path | Type | Required | Notes |
|------|------|----------|-------|
| `resource.metadata` | message | yes | sub-message containing the fields below |
| `metadata.id` | string | yes | resource id |
| `metadata.slug` | string | yes | url-safe identifier |
| `metadata.org` | string | yes | organization id (may be empty for platform-scoped resources) |
| `metadata.name` | string | yes | human-readable name |
| `metadata.visibility` | enum | yes | values 0=UNSPECIFIED, 1=PUBLIC, 2=PRIVATE |
| `metadata.version` | string | no | version id (only for versioned resources) |
| `metadata.labels` | map<string,string> | no | |
| `metadata.annotations` | map<string,string> | no | |
| `metadata.tags` | repeated string | no | |
| `resource.status.audit` | message | yes (for audited kinds) | sub-message with audit info |
| `audit.created` | message (AuditInfo) | yes | |
| `audit.last_modified` | message (AuditInfo) | no | |
| `audit.events` | repeated AuditInfo | no | |
| `audit_info.timestamp` | google.protobuf.Timestamp | yes | |
| `audit_info.event_type` | enum | yes | values match `AuditEventType` ordering |
| `audit_info.actor` | message (AuditActor) | yes | |
| `audit_actor.id` | string | yes | |
| `audit_actor.display_name` | string | no | |
| `audit_actor.kind` | enum | yes | values match `AuditActor.ActorKind` ordering |

For Find requests:

| Path | Type | Required | Notes |
|------|------|----------|-------|
| `request.page_size` | int32 | yes | |
| `request.page_token` | string | yes | empty for first page |
| `request.parent` | string | no | parent resource id |
| `request.filters` | map<string,string> | no | |

Field options:

| Option | Type | Notes |
|--------|------|-------|
| `[(api_resource.computed) = true]` | bool field option | marks server-computed fields |
| `[(api_resource.id_field) = true]` | bool field option | marks the id field on resource ref messages |

Each product MUST define a `FieldOptionsProto` in its own apis repo with these option NAMES (option NUMBERS may differ per product since the libs key off names via descriptor introspection).

## Corrections from T02 planning session (2026-04-20)

### Corrected KindMetadata (Decision 8 — authorization config embedded)

The original `KindMetadata` sketch above omits authorization and visibility config. The corrected shape embeds them, mirroring the existing `ApiResourceKindMeta.authorization` nesting:

```java
package ai.stigmer.apishape.kind.neutral;

import com.google.protobuf.Descriptors.Descriptor;
import com.google.protobuf.Message;

public interface KindMetadata {
    ResourceKind kind();
    String pluralName();
    String singularName();
    String idPrefix();
    String groupName();
    String apiVersion();
    Class<? extends Message> protoClass();
    Descriptor protoDescriptor();
    boolean versioned();
    KindAuthorizationConfig authorizationConfig();
    KindVisibilityConfig visibilityConfig();
}
```

```java
package ai.stigmer.apishape.kind.neutral;

public interface KindAuthorizationConfig {
    AuthorizationScope scopeType();
    OwnerAttribution ownerType();
    java.util.List<ParentRelation> additionalParents();
    java.util.List<String> grantableRoles();
}
```

```java
package ai.stigmer.apishape.kind.neutral;

public interface KindVisibilityConfig {
    boolean supportsPublic();
}
```

```java
package ai.stigmer.apishape.kind.neutral;

public interface ParentRelation {
    ResourceKind parentKind();
    String relation();
}
```

```java
package ai.stigmer.apishape.kind.neutral;

public enum AuthorizationScope {
    UNSPECIFIED, NONE, PLATFORM, ORGANIZATION, RESOURCE
}
```

```java
package ai.stigmer.apishape.kind.neutral;

public enum OwnerAttribution {
    UNSPECIFIED, NONE, DIRECT, SELF, INHERITED
}
```

### Corrected ResourceAudit (Decision 9 — two-bucket shape)

The original Bucket C sketch above defines `ResourceAudit { created(), lastModified(), events[] }`. The actual Stigmer proto is two-bucket: `{ statusAudit, specAudit }`. Corrected:

```java
package ai.stigmer.apishape.audit.neutral;

public interface ResourceAudit {
    AuditInfo statusAudit();
    AuditInfo specAudit();
}
```

```java
package ai.stigmer.apishape.audit.neutral;

import java.time.Instant;

public interface AuditInfo {
    Instant createdAt();
    AuditActor createdBy();
    Instant updatedAt();
    AuditActor updatedBy();
    String event();
}
```

```java
package ai.stigmer.apishape.audit.neutral;

public interface AuditActor {
    String id();
}
```

### New: Role + RoleCatalog (Decision 7 — staged deprecation)

```java
package ai.stigmer.apishape.role.neutral;

public interface Role {
    String id();
    String displayName();
    String description();
}
```

```java
package ai.stigmer.apishape.role.neutral;

public interface RoleCatalog {
    void register(Role role);
    java.util.Optional<Role> resolve(String roleId);
    java.util.Optional<Role> resolveByRelation(String relation);
    java.util.Collection<Role> all();
    boolean isAssignableRole(String relation);
}
```

### New: Write-side adapters (Decision 6)

```java
package ai.stigmer.apishape.metadata.neutral;

public final class ProtoReflectionMetadataWriter {
    public static <I extends com.google.protobuf.Message> I write(
            I targetResource, ResourceMetadata metadata) { /* ... */ }
}
```

```java
package ai.stigmer.apishape.audit.neutral;

public final class ProtoReflectionAuditWriter {
    public static void write(
            com.google.protobuf.Message.Builder statusBuilder,
            ResourceAudit audit) { /* ... */ }
}
```

## Open questions for the developer

None. All decisions for T01 and T02 planning are locked. T02 implementation is in progress.
