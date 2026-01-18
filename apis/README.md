# Stigmer APIs

This directory contains Protocol Buffer definitions for Stigmer's APIs.

## Overview

The `apis/` directory houses all `.proto` files that define:
- Agent definitions and configurations
- Workflow specifications
- Execution contexts and sessions
- IAM policies and permissions
- Common types and resources

## Structure

```
apis/
├── ai/stigmer/agentic/           # Agentic AI APIs
│   ├── agent/                    # Agent definitions
│   ├── agentexecution/           # Agent execution tracking
│   ├── agentinstance/            # Agent instances
│   ├── environment/              # Execution environments
│   ├── executioncontext/         # Execution context management
│   ├── session/                  # User sessions
│   ├── skill/                    # Agent skills
│   ├── workflow/                 # Workflow definitions
│   ├── workflowexecution/        # Workflow execution tracking
│   ├── workflowinstance/         # Workflow instances
│   └── workflowrunner/           # Workflow execution interface
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
