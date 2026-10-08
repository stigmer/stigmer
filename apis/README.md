# Stigmer APIs

This directory contains Protocol Buffer definitions for Stigmer's APIs.

## Overview

The `apis/` directory houses all `.proto` files that define:
- Agent definitions and configurations
- Agent runs, schedules and sessions
- Execution contexts and environments
- IAM policies and permissions
- Common types and resources

## Structure

```
apis/
├── ai/stigmer/agentic/           # Agentic AI APIs
│   ├── agent/                    # Agent definitions
│   ├── environment/              # Execution environments
│   ├── executioncontext/         # Execution context management
│   ├── mcpserver/                # MCP server definitions
│   ├── run/                      # Run tracking
│   ├── schedule/                 # Scheduled runs
│   ├── session/                  # User sessions
│   └── skill/                    # Agent skills
├── buf.yaml                      # Buf configuration
├── buf.gen.go.yaml              # Go code generation config
├── buf.gen.python.yaml          # Python code generation config
├── Makefile                     # Build automation
└── stubs/                       # Generated code (gitignored)
    ├── go/                      # Generated Go stubs
    └── python/                  # Generated Python stubs
```

## Building

### Prerequisites

- [Buf CLI](https://buf.build/docs/installation) installed
- Go 1.24+ (for Go stubs)
- Python 3.12+ (for Python stubs)

### Generate All Stubs

```bash
cd apis
make build
```

Or use the alias:

```bash
make protos
```

### Generate Specific Language Stubs

```bash
# Go only
make go-stubs

# Python only
make python-stubs
```

### Linting and Formatting

```bash
# Lint proto files
make lint

# Format proto files
make fmt
```

## Generated Stubs

Generated code is placed in `apis/stubs/` and is excluded from version control:

- **Go**: `apis/stubs/go/`
  - Module: `github.com/stigmer/stigmer/apis/stubs/go`
  - Includes gRPC service definitions

- **Python**: `apis/stubs/python/stigmer/`
  - Includes `.py`, `.pyi` (type stubs), and `_grpc.py` files

## Publishing

To publish protos to the Buf Schema Registry:

```bash
make push
```

Full release (lint + format + push):

```bash
make release
```

## Maintenance

```bash
# Update Buf dependencies
make update

# Clean all generated stubs
make clean

# Clean and reinitialize stub directories
make prep
```

## Agent output formats

Stigmer never invents a format for what an agent did. The rule covers every new
surface that emits an agent's output: a session's event stream, an export, and
each adapter to another protocol (A2A, OpenTelemetry GenAI, AG-UI).

- The surface is compatible with a named outside specification at a pinned
  version, and its documentation states that claim with the version.
- A conformance test drives the surface with that specification's own SDK or
  schema. The pin moves only by a deliberate bump that reruns the test.
- Stigmer-only data uses the specification's own extension mechanism under a
  `stigmer.` namespace. Where the specification has none, it travels as separate
  `stigmer.`-namespaced events. It is never a field added to one of the
  specification's own messages.

Two surfaces predate the rule: the run transcript on `RunStatus`
(`ai/stigmer/agentic/run/v1/api.proto`, `message.proto`) and the CLI's NDJSON
run stream (`client-apps/cli/src/resources/stream/render-ndjson.ts`). They are
maintained until a compatible surface replaces them, and changing them is not
forbidden by this rule; a new kind of output is added to the compatible surface,
not to them.

## Development Workflow

1. **Modify protos**: Edit `.proto` files in the appropriate subdirectory
2. **Lint**: `make lint` to check for issues
3. **Format**: `make fmt` to format files
4. **Generate**: `make build` to regenerate stubs
5. **Test**: Test changes in consuming code
6. **Publish**: `make release` to push to Buf Schema Registry

## Buf Configuration

- `buf.yaml`: Defines the module, linting rules, and breaking change detection
- `buf.gen.go.yaml`: Go code generation configuration
- `buf.gen.python.yaml`: Python code generation configuration

## Help

For a full list of available targets:

```bash
make help
```
