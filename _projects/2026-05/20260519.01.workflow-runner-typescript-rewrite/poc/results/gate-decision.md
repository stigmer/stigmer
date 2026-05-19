# T01d: Phase 0 Gate Decision

**Date**: 2026-05-19
**Decision**: **CONDITIONAL GO**
**Confidence**: ~85% (up from 70% pre-spike)

## Executive Summary

All three highest-risk TypeScript dependencies have been validated via working PoC code against real golden YAML files and Go source patterns. Each area is viable for the TypeScript rewrite, with one documented workaround required for the CNCF SDK.

---

## T01a: jq Expression Evaluation — PASS

### Results

| Library | Pass Rate | Avg Latency | Binary Dep |
|---------|-----------|-------------|------------|
| **jq-wasm** (in-process WASM) | 92.6% (25/27) | **0.66ms** | None |
| **node-jq** (subprocess) | 100% (27/27) | 2.85ms | Requires `jq` binary |

### Key Findings

- **jq-wasm is the recommended choice**: Sub-millisecond latency (0.66ms avg), no external binary dependency, runs in-process like Go's `gojq`. The Go engine achieves ~microsecond latency with `gojq`, so 0.66ms is a ~100x regression but well within the 20ms target and acceptable for workflow execution where network calls dominate.
- **Two minor jq-wasm failures**: `1 == 1` and `now` with `null` input. Trivially fixed by normalizing `null` inputs to `{}` — verified working.
- **Custom variable injection works**: Both libraries support `$context`, `$data`, `$env`, `$input`, `$output` via expression wrapping (`.as $varname`). This replicates Go's `gojq.WithVariables`.
- **Custom function registration NOT supported**: Neither library supports registering custom jq functions (Go uses `gojq.WithFunction` for `uuid()`). **Workaround**: Pre-process `uuid` calls by replacing them with generated UUIDs before jq evaluation, or use a jq `def` to register functions inline. Only one custom function exists today (`uuid`), making this trivial.
- **Both jq evaluation paths work**: Runtime expressions (with state variables) and transform expressions (raw input document) both produce correct results.

### Recommendation

Use **jq-wasm** as the primary jq engine. Keep **node-jq** available as a fallback for edge cases where WASM jq has spec gaps.

---

## T01b: Dynamic gRPC Invocation — PASS

### Results

7/7 tests passed (100%)

| Test | Result |
|------|--------|
| Dynamic proto loading | PASS |
| Unary RPC (nested + repeated + enum) | PASS |
| Unary RPC (nested request) | PASS |
| Error: NOT_FOUND | PASS |
| Error: INVALID_ARGUMENT | PASS |
| Error: connection refused | PASS |
| Error: method not found | PASS |

### Key Findings

- **`@grpc/proto-loader`** successfully loads `.proto` files at runtime without code generation, replicating Go's `grpcurl.DescriptorSourceFromProtoFiles`.
- **`@grpc/grpc-js`** creates dynamic clients from loaded definitions and invokes methods with JSON-like objects.
- Nested message types, repeated fields, and enum values all serialize/deserialize correctly.
- gRPC error codes (`NOT_FOUND`, `INVALID_ARGUMENT`, `UNAVAILABLE`) propagate with meaningful user-facing messages — matching Go's error handling.
- Method names are automatically converted between proto `snake_case` and JS `camelCase`.

### Comparison to Go's grpcurl

| Capability | Go (grpcurl) | TypeScript (@grpc/proto-loader) |
|-----------|-------------|--------------------------------|
| Dynamic proto loading | `DescriptorSourceFromProtoFiles` | `protoLoader.loadSync` |
| RPC invocation | `grpcurl.InvokeRPC` | `client[method](args, callback)` |
| JSON input/output | Yes | Yes (native JS objects) |
| Server reflection | Yes | Requires separate package |
| Error handling | gRPC status codes | gRPC status codes (identical) |

### Recommendation

No concerns. This is fully functional for the rewrite.

---

## T01c: CNCF Serverless Workflow SDK — CONDITIONAL PASS

### Results

All 12 golden YAMLs parse successfully **when using the SDK without strict validation** (constructor hydration), which matches Go's approach (`json.Unmarshal` without Ajv schema validation).

| Test | Result | Notes |
|------|--------|-------|
| Parse 12 golden YAMLs (strict) | FAIL | `document.description` rejected as unevaluated property |
| Parse 12 golden YAMLs (no-validation) | **PASS** | All 12 parse, model fully accessible |
| Document metadata | **PASS** | dsl, name, namespace, version accessible |
| Task type discrimination | **PASS** | set, call:http, switch, fork, try, listen, wait, do all detected |
| Expression preservation | **PASS** | 33 expressions preserved in parsed model |
| Task base properties | **PASS** | `then`, `export` accessible |
| Custom CallFunction extensions | **PASS** | call:llm, call:agent, call:transform, call:validate preserved |
| Expression detection | **PASS** | Manual `isStrictExpr`/`sanitizeExpr` (5 lines each) — 5/5 correct |
| Serialization round-trip | FAIL | Same validation issue on re-serialization |
| Graph builder | **PASS** | 12 nodes, 8 edges for complex workflow |

### The `document.description` Issue

The SDK's `Workflow.deserialize()` method applies strict Ajv JSON Schema validation that rejects `document.description` as an "unevaluated property." This is a schema strictness issue in the TS SDK — the Go SDK (`sdk-go/v3`) does not enforce this.

**Workaround** (already validated): Use `new Workflow(parsedYaml)` instead of `Workflow.deserialize(yaml)`. This hydrates the model from parsed YAML without triggering Ajv validation, exactly mirroring Go's `json.Unmarshal` approach. The full model is accessible with all properties, task types, expressions, and metadata.

**Alternatives**:
- Strip `description` from golden YAMLs (our files, easy change)
- Report upstream to `@serverlessworkflow/sdk` as a schema bug
- Use the SDK types for model structure but do our own YAML→JSON→model pipeline

### Other Findings

- **SDK does NOT provide `isStrictExpr`/`sanitizeExpr`**: Trivial to implement manually (5 lines each). Go's `model.IsStrictExpr` checks for `${ ... }` wrapping with a space after `${`; `model.SanitizeExpr` strips the wrapper.
- **Custom `call:` values are first-class**: `CallFunction` type preserves any `call` string value and its `with` arguments. This means `call: llm`, `call: agent`, `call: transform`, etc. are fully supported.
- **Graph builder works**: Can generate DAG representations for visualization.
- **SDK version alignment**: `@serverlessworkflow/sdk@1.0.1` targets schema version 1.0.0, matching our `document.dsl: '1.0.0'`.

### Recommendation

Use the SDK for model types and structure. Skip built-in validation (use our own, matching Go's approach). The type definitions and model hierarchy provide significant value over raw YAML parsing.

---

## Overall Gate Decision: CONDITIONAL GO

### Conditions

1. **jq engine**: Use `jq-wasm` as the primary engine, with `node-jq` as fallback. Pre-process `uuid()` custom function calls since neither library supports custom function registration.

2. **CNCF SDK**: Use `new Workflow(parsed)` constructor instead of `Workflow.deserialize()` to avoid strict schema validation. All model types, task structures, and expression strings are fully accessible through this path.

3. **gRPC**: No conditions — fully functional.

### Risks Remaining (for Phase 1+)

| Risk | Severity | Mitigation |
|------|----------|------------|
| jq-wasm spec gaps in advanced expressions | Low | Fallback to node-jq; test against full Go test suite |
| Temporal determinism with jq evaluation | Medium | Wrap in `workflow.sideEffect` (same pattern as Go) |
| CNCF SDK model changes between versions | Low | Pin to `@1.0.1`; track upstream releases |
| Performance at scale (many expressions per workflow) | Low | jq-wasm is 0.66ms/eval; even 200 expressions = 132ms total |
| node-jq binary in Docker image | Low | Only needed if jq-wasm has spec gaps; `apt-get install jq` |

### Confidence Adjustment

- Pre-spike: 70% (Deep Research estimate)
- Post-spike: **~85%**
- Remaining uncertainty: Temporal determinism, full golden test suite parity, performance under production load

### Next Step

Proceed to **Phase 1: Core Engine Scaffold** — YAML parsing, task graph builder, basic expression evaluation.
