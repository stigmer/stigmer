# T01b: Dynamic gRPC Invocation Results

**Date**: 2026-05-19T07:04:08.392Z

## Test Results (7/7 passed)

| Test | Result | Detail |
|------|--------|--------|
| Dynamic proto loading | PASS | Service: sample.v1.UserService, Methods: [GetUser, CreateUser] |
| Unary RPC (nested + repeated + enum) | PASS | {
  "roles": [
    "admin",
    "editor"
  ],
  "user_id": "usr_001",
  "name":  |
| Unary RPC (nested request) | PASS | {"user_id":"usr_1779174248377","success":true} |
| Error: NOT_FOUND | PASS | code=5, message=5 NOT_FOUND: User 'not-found' not found |
| Error: INVALID_ARGUMENT | PASS | code=3, message=3 INVALID_ARGUMENT: user_id is required |
| Error: connection refused | PASS | code=14, message=14 UNAVAILABLE: No connection established. Last error: Error: c |
| Error: method not found | PASS | Method 'NonExistentMethod' not found on service 'sample.v1.UserService' |

## Key Findings

- `@grpc/proto-loader` successfully loads .proto files at runtime without code generation
- `@grpc/grpc-js` creates clients dynamically from loaded package definitions
- Nested messages, repeated fields, and enums work correctly
- gRPC error codes (NOT_FOUND, INVALID_ARGUMENT, UNAVAILABLE) propagate with meaningful messages
- Method invocation uses camelCase on the client (auto-converted from proto snake_case)

## Comparison to Go grpcurl

| Capability | Go (grpcurl) | TypeScript (@grpc/proto-loader) |
|-----------|-------------|--------------------------------|
| Dynamic proto loading | `DescriptorSourceFromProtoFiles` | `protoLoader.loadSync` |
| RPC invocation | `grpcurl.InvokeRPC` | `client[method](args, callback)` |
| JSON input/output | Yes | Yes (native JS objects) |
| Server reflection | Yes | Requires separate package |
| Error handling | gRPC status codes | gRPC status codes (same) |

## Gate Assessment

**PASS**: Dynamic gRPC invocation is fully functional. All test patterns (nested, repeated, enum, errors) work correctly.
