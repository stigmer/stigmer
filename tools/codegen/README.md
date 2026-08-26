# Stigmer Code Generation Toolchain

A TypeScript toolchain (`@stigmer/codegen`, an npm workspace living in this directory) that turns the proto API definitions into client-facing artifacts for every SDK language, the MCP servers, the docs site, and the server's task registry. Two stages:

1. **`protoc-gen-stigmer-schema`** — a buf plugin that extracts JSON schemas from `.proto` files (messages, field types, doc comments, `buf.validate` required flags). buf compiles the protos and drives the plugin (`apis/buf.gen.schema.yaml`, `clean: true`); the schemas are **committed** under `tools/codegen/schemas/` and are the single input every generator target consumes. Proto comment sections below a line that is exactly `@internal` are stripped here — this is the one owner of that convention.
2. **`generator`** — emits code/docs from the committed schemas, dispatched by `--target`.

Everything runs from TypeScript source via the repo-pinned `tsx` (never bare `npx` — oss#531): `node_modules/.bin/tsx tools/codegen/src/<tool>/main.ts`. The `sdk-client` (Go) target additionally pipes its output through the `gofmt` binary, so the Go toolchain must be on PATH for that one target — which it always is, since the Go SDK build follows it.

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

Every generated directory above is committed, and every one is freshness-gated in CI (regenerate + `git diff --exit-code`): the Go and Java SDK dirs in their own lanes (`ci.go-sdk.yaml`, `ci.java-sdk.yaml`), the TypeScript / Python / mcp-server dirs in `ci.codegen.yaml`, and the docs/registry outputs in `ci.docs.yaml`. Hand-edits and stale regenerations fail CI instead of drifting.

## Quick start

```bash
# Stage 1 (rarely needed by hand — schemas are committed):
make -C sdk/go codegen-schemas

# Stage 2, e.g. regenerate the TypeScript SDK client code:
make -C sdk/typescript codegen

# Or invoke the generator directly from the repo root:
node_modules/.bin/tsx tools/codegen/src/generator/main.ts \
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
- `--authoring-dirs` — comma-separated raw authoring surfaces (`docs-yaml-check`)
- `--rules` — protovalidate rule mode `off`/`report`/`enforce` (`docs-yaml-check`)

## Directory structure

```
tools/codegen/
├── src/
│   ├── protoc-gen-stigmer-schema/  # Stage 1: buf plugin, proto → JSON schemas
│   ├── generator/                  # Stage 2: schemas → code/docs (one module
│   │                               #   per target: main.ts (dispatch),
│   │                               #   sdk-client*.ts, mcp-ts.ts + mcp-model.ts,
│   │                               #   sdk-docs.ts, task-registry.ts,
│   │                               #   task-docs.ts, docs-yaml-*.ts)
│   ├── stubscrub/                  # @internal scrub for protoc-copied stubs
│   ├── internalcomment/            # the @internal comment-section contract
│   ├── decode-manifest/            # debug: binary Agent manifest → JSON
│   └── gojson.ts                   # Go json.MarshalIndent-equivalent serializer
├── schemas/
│   ├── tasks/           # workflow task configs (+ tasks/types/ shared types)
│   ├── agentic/         # per-resource spec schemas (+ <resource>/types/)
│   ├── iam/
│   ├── tenancy/
│   └── services/        # service/RPC schemas (sdk-docs)
└── output/              # task-registry staging (synced into the server embed)
```

The generator reads typed proto metadata (kind_meta options, discriminator options, protovalidate consts) from `@stigmer/protos` — the committed TS stubs — so `npm run build -w @stigmer/protos` must have run for the targets that need it (the Makefile targets handle this).

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

Type kinds: `string`, `int32`, `uint32`, `int64`, `bool`, `float`, `double`, `bytes`, `map` (`keyType`/`valueType`), `array` (`elementType`), `message` (`messageType`), `struct`, `timestamp`; enums carry `enumType`/`enumValues`.

Schemas are serialized with `src/gojson.ts`, a byte-exact equivalent of Go's `json.MarshalIndent` (HTML escaping, sorted map keys, two-space indent) — the toolchain was ported from Go and every committed artifact reproduces byte-for-byte, so diffs stay meaningful.

## Development

```bash
# The toolchain's own tests (includes the @internal strip contract and the
# gojson serializer's pinned Go-equivalence corpus) — also run by
# ci.go-sdk.yaml:
npm run test -w @stigmer/codegen

# Typecheck:
npm run typecheck -w @stigmer/codegen
```

## History

The toolchain was originally written in Go (`proto2schema` + `generator`); it was ported to TypeScript with byte-identical output in 2026-08 so the codegen stack matches the language of the project it generates for, with Stage 1 becoming a proper buf plugin. Before that, the generator once had a single hardcoded target that emitted Go task structs into `sdk/go/gen`; that surface was never consumed and drifted for months, so oss#496 deleted it. The current generator is dispatch-only: every target is explicit, every output is gated.
