# Fix Jackson Protobuf Deserializer Subtype Resolution for Temporal Activities

**Date**: April 9, 2026

## Summary

Fixed a Temporal workflow execution failure in the MCP Registry Sync pipeline caused by Jackson's `SimpleDeserializers` failing to resolve the custom `MessageDeserializer` for concrete protobuf `Message` subtypes like `McpServer`. The fix replaces the broken `addDeserializer(Message.class, ...)` registration with a `Deserializers.Base` implementation that uses `isAssignableFrom` for proper subtype matching.

## Problem Statement

The `UpsertMcpServerBatch` local activity in the MCP Registry Sync workflow failed on every execution with a `com.fasterxml.jackson.databind.exc.InvalidDefinitionException`:

```
Cannot find a (Map) Key deserializer for type
[simple type, class com.google.protobuf.Descriptors$FieldDescriptor]
```

This failure occurred despite a `ProtobufJacksonModule` already being registered on the Temporal `DataConverter`'s `ObjectMapper`, which was introduced earlier to handle protobuf serialization inside generic Java containers.

### Pain Points

- The workflow reached `RETRY_STATE_MAXIMUM_ATTEMPTS_REACHED` and failed permanently, blocking all MCP Registry sync runs
- The error message (`FieldDescriptor` key deserializer) was misleading — it suggested a missing key serializer rather than pointing to the real cause (the custom deserializer not being found at all)
- The root cause was an asymmetry in Jackson's internal `SimpleSerializers` vs `SimpleDeserializers` implementations that is not documented and not obvious from the Jackson API surface

## Solution

Replaced the `SimpleModule.addDeserializer(Message.class, ...)` call with a custom `Deserializers.Base` registered via `setupModule(SetupContext)`. The custom `Deserializers.Base` overrides `findBeanDeserializer` and performs an explicit `Message.class.isAssignableFrom(type)` check, ensuring that any concrete `Message` subclass (such as `McpServer`, `McpServerSpec`, or any future protobuf type) is correctly intercepted before Jackson falls back to its default `BeanDeserializer` path.

## Implementation Details

### Root Cause Analysis

The failure chain was:

1. `UpsertMcpServerBatchActivity.upsertBatch(List<McpServer>)` is a local Temporal activity
2. Temporal serializes the `List<McpServer>` argument to a `Payload` using `JacksonJsonPayloadConverter` (since `ProtobufJsonPayloadConverter` only handles top-level `Message` types, not collections)
3. On deserialization, Jackson needs a deserializer for the element type `McpServer.class`
4. `SimpleDeserializers.findBeanDeserializer` does `_classMappings.get(new ClassKey(McpServer.class))` — exact `HashMap` lookup — and returns `null` because only `Message.class` was registered
5. Jackson creates a default `BeanDeserializer` for `McpServer`, introspecting it as a POJO
6. During `BeanDeserializerBase.resolve()`, it encounters `Map<Descriptors.FieldDescriptor, Object>` from protobuf's internal `getAllFields()` method and fails

**Why serialization worked but deserialization did not:**

Jackson's `SimpleSerializers` stores interface-type registrations in a separate `_interfaceMappings` map that is searched using `isAssignableFrom`. So `addSerializer(Message.class, ...)` correctly matched `McpServer`.

Jackson's `SimpleDeserializers` has only `_classMappings` with exact-match `HashMap.get()` — no `_interfaceMappings`, no `isAssignableFrom` fallback. This asymmetry between serializer and deserializer resolution in Jackson 2.17.x is the root cause.

### Code Change (stigmer-cloud)

**File**: `backend/libs/java/infra/temporal-starter/.../converter/ProtobufJacksonModule.java`

- Removed `addDeserializer(Message.class, new MessageDeserializer())` from the constructor
- Added `setupModule` override that registers a `MessageDeserializers` class (extends `Deserializers.Base`)
- `MessageDeserializers.findBeanDeserializer` checks `Message.class.isAssignableFrom(raw)` and returns a type-specific `MessageDeserializer` with the concrete class already resolved
- Simplified `MessageDeserializer` by removing the `ContextualDeserializer` interface and no-arg constructor (the concrete type is now always known at construction time)
- Added Javadoc explaining the `SimpleSerializers` vs `SimpleDeserializers` asymmetry for future maintainers

## Benefits

- **Unblocks MCP Registry Sync** — the `UpsertMcpServerBatch` activity and all other protobuf-based activities can now deserialize correctly
- **Single infrastructure-layer fix** — zero changes to domain code, activity interfaces, or proto definitions
- **Robust for all Message subtypes** — any current or future Temporal activity that passes protobuf types inside generic containers works automatically
- **Well-documented** — the class Javadoc captures the Jackson asymmetry so future maintainers understand the design choice

## Impact

- MCP Registry Sync workflow resumes normal incremental and full-crawl operations
- All Temporal activities across the platform that use protobuf collections benefit from the fix
- The shared `temporal-starter` library remains the single point of protobuf serialization configuration, maintaining the architectural boundary between infrastructure and domain

## Related Work

- [MCP Registry Sync Overhaul](_changelog/2026-04/2026-04-09-210115-mcp-registry-sync-overhaul.md)
- [Fix Temporal Protobuf Serialization for MCP Registry Sync](stigmer-cloud changelog: 2026-04-09-201857) — the initial `ProtobufJacksonModule` that fixed serialization but missed the deserialization asymmetry

---

**Status**: Production Ready
**Timeline**: ~30 minutes
