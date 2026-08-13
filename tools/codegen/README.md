# Stigmer Code Generation Toolchain

A two-stage pipeline that turns the proto API definitions into client-facing
artifacts for every SDK language, the MCP servers, the docs site, and the
server's task registry:

1. **`proto2schema`** — extracts JSON schemas from `.proto` files (messages,
   field types, doc comments, `buf.validate` required flags). The schemas are
   **committed** under `tools/codegen/schemas/` and are the single input every
   generator target consumes. Proto comment sections below a line that is
   exactly `@internal` are stripped here — this is the one owner of that
   convention (see `TestNoInternalSectionsLeak`).
2. **`generator`** — emits code/docs from the committed schemas, dispatched
   by `--target`.

## Generator targets

| `--target` | Output | Wired via |
|---|---|---|
| `sdk-client` | `sdk/go/internal/gen` (Go SDK resource clients) | `make -C sdk/go codegen-clients` |
| `sdk-client-ts` | `sdk/typescript/src/gen` | `make -C sdk/typescript codegen` |
| `sdk-client-python` | `sdk/python/src/stigmer/_gen` | `make -C sdk/python codegen` |
| `sdk-client-java` | `sdk/java/src/main/java/ai/stigmer/sdk/gen` | `make -C sdk/java codegen` |
| `mcp-ts` | `mcp-server/src/gen` (apply-input modules) | `make -C mcp-server codegen` |
| `sdk-docs` | `docs/sdk/resources/*.mdx` | `make gen-proto-sdk-docs` |
| `task-docs` | `docs/guides/workflows/task-types/*.mdx` | `make gen-task-docs` |
| `task-registry` | `task-kind-registry.json` + JSON Schemas (synced into the server embed) | `make gen-task-registry` |
| `docs-yaml-check` | none — pass/fail validation of docs YAML blocks | `make check-docs-yaml` |

Every generated directory above is committed, and every one is freshness-gated
in CI (regenerate + `git diff --exit-code`): the Go and Java SDK dirs in their
own lanes (`ci.go-sdk.yaml`, `ci.java-sdk.yaml`), the TypeScript / Python /
mcp-server dirs in `ci.codegen.yaml`, and the docs/registry outputs in
`ci.docs.yaml`. Hand-edits and stale regenerations fail CI instead of
drifting.

## Quick start

```bash
# Stage 1 (rarely needed by hand — schemas are committed):
make -C sdk/go codegen-schemas

# Stage 2, e.g. regenerate the TypeScript SDK client code:
make -C sdk/typescript codegen

# Or invoke the generator directly from the repo root:
go run ./tools/codegen/generator \
  --schema-dir tools/codegen/schemas \
  --output-dir sdk/typescript/src/gen \
  --target sdk-client-ts
```

Generator flags:

- `--schema-dir` — schema root (default `tools/codegen/schemas`)
- `--output-dir` — output directory (required for all generating targets)
- `--target` — one of the targets above (required)
- `--meta-dir` — sidecar YAML metadata dir (`task-registry`, `task-docs`)
- `--apis-dir` — proto root (`sdk-docs`, `task-docs`)
- `--docs-dir` — docs root (`docs-yaml-check` only)

## Dependency management (proto2schema)

Proto dependencies (like `buf/validate`) come from buf:

1. Declared in `apis/buf.yaml`, version-locked in `apis/buf.lock`.
2. `make protos` (or any buf command) populates `~/.cache/buf/v3/modules/`;
   proto2schema finds and uses that cache automatically (`--use-buf-cache`,
   default true).
3. If imports fail to resolve, run `make protos` once, or refresh with
   `cd apis && buf dep update`.

## Directory structure

```
tools/codegen/
├── proto2schema/        # Stage 1: proto → JSON schemas
├── generator/           # Stage 2: schemas → code/docs (one file per target:
│                        #   main.go (loading + dispatch), sdk_client*.go,
│                        #   mcp_ts.go + mcp_model.go, sdk_docs.go,
│                        #   task_registry.go, task_docs.go, docs_yaml_*.go)
├── schemas/
│   ├── tasks/           # workflow task configs (+ tasks/types/ shared types)
│   ├── agentic/         # per-resource spec schemas (+ <resource>/types/)
│   ├── iam/
│   ├── tenancy/
│   └── services/        # service/RPC schemas (sdk-docs)
└── output/              # task-registry staging (synced into the server embed)
```

## Schema format

Task/resource config schema:

```json
{
  "name": "SetTaskConfig",
  "kind": "SET",
  "description": "SET tasks assign variables in workflow state.",
  "protoType": "ai.stigmer.agentic.workflow.v1.tasks.SetTaskConfig",
  "protoFile": "apis/ai/stigmer/agentic/workflow/v1/tasks/set.proto",
  "fields": [
    {
      "name": "Variables",
      "jsonName": "variables",
      "protoField": "variables",
      "type": {"kind": "map", "keyType": {"kind": "string"}, "valueType": {"kind": "string"}},
      "description": "Variables to set in workflow state.",
      "required": false
    }
  ]
}
```

Type kinds: `string`, `int32`, `uint32`, `int64`, `bool`, `float`, `double`,
`bytes`, `map` (`keyType`/`valueType`), `array` (`elementType`), `message`
(`messageType`), `struct`, `timestamp`; enums carry `enumType`/`enumValues`.

## Development

```bash
# The toolchain's own tests (includes the @internal leak gate and the
# docs YAML gate) — also run by ci.go-sdk.yaml:
cd tools && go test ./codegen/...
```

Never commit compiled binaries of these tools (they are gitignored); both are
always run via `go run`.

## History

The generator originally had a single hardcoded target that emitted Go task
structs and per-resource Args packages into `sdk/go/gen`. That surface was
never consumed and drifted for months; oss#496 deleted the target and its
outputs. The current generator is dispatch-only: every target is explicit,
every output is gated.
