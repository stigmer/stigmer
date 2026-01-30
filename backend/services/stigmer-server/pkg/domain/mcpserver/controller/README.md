# McpServer Controller

Go implementation of McpServer resource CRUD handlers for Stigmer OSS.

## Overview

The McpServer controller manages MCP (Model Context Protocol) server resources. MCP servers provide tools and capabilities to AI agents. This controller enables local management of MCP server definitions that can be referenced by agents via `mcp_server_usages`.

## Server Types

McpServer supports three transport types:

| Type | Description | Use Case |
|------|-------------|----------|
| **Stdio** | Subprocess with stdin/stdout communication | Node.js, Python, Go CLI tools |
| **HTTP** | HTTP + Server-Sent Events | Remote/managed services |
| **Docker** | Containerized MCP server | Isolated, reproducible environments |

## Architecture

Following the same pattern as Environment controller:
- **Pipeline-based**: All operations use the request pipeline pattern
- **Reusable steps**: Common steps shared across all API resources
- **Simplified from Cloud**: No IAM/FGA, authorization, or event publishing (OSS is single-user)

## Handler Implementation

### Controller Structure

```go
type McpServerController struct {
    mcpserverv1.UnimplementedMcpServerCommandControllerServer
    mcpserverv1.UnimplementedMcpServerQueryControllerServer
    store store.Store
}
```

### Implemented Operations

| Operation | File | Pipeline Steps | Description |
|-----------|------|----------------|-------------|
| **Create** | `create.go` | ValidateProto → ResolveSlug → CheckDuplicate → BuildNewState → Persist | Create new MCP server |
| **Update** | `update.go` | ValidateProto → ResolveSlug → LoadExisting → BuildUpdateState → Persist | Update existing MCP server |
| **Delete** | `delete.go` | ValidateProto → LoadExistingForDelete → DeleteResource | Delete MCP server by ID |
| **Get** | `get.go` | ValidateProto → LoadTarget | Retrieve MCP server by ID |
| **GetByReference** | `get_by_reference.go` | ValidateProto → LoadByReference | Retrieve MCP server by slug |
| **Apply** | `apply.go` | ValidateProto → ResolveSlug → LoadForApply → (delegate to Create or Update) | Declarative create-or-update |

### Validation Rules

Validation is enforced via proto buf.validate constraints:

| Field | Constraint | Description |
|-------|------------|-------------|
| `server_type` | `oneof.required = true` | Exactly one of stdio/http/docker must be set |
| `stdio.command` | `required = true` | Command to execute is mandatory |
| `http.url` | `string.uri = true` | Must be a valid URI |
| `docker.image` | `string.min_len = 1` | Image name is mandatory |
| `http.timeout_seconds` | `int32.gte = 0, lte = 300` | Timeout between 0-300 seconds |

### Differences from Stigmer Cloud (Java)

The Go implementation excludes enterprise features:

| Feature | Stigmer Cloud (Java) | Stigmer OSS (Go) | Reason |
|---------|---------------------|------------------|---------|
| **Authorization** | FGA-based tri-scope permissions | Excluded | OSS is single-user |
| **Tri-Scope Support** | Platform, Organization, Identity Account | All local | No multi-tenancy in OSS |
| **IAM Policies** | CreateIamPolicies step | Excluded | No IAM system in OSS |
| **Event Publishing** | Publish step | Excluded | No event bus in OSS |
| **Response Transforms** | TransformResponse step | Excluded | Not needed for local usage |

## Pipeline Steps Used

All steps are reusable from `backend/libs/go/grpc/request/pipeline/steps/`:

- **ValidateProtoStep** - Validates buf.validate constraints (including server_type oneof)
- **ResolveSlugStep** - Generates slug from metadata.name
- **CheckDuplicateStep** - Prevents duplicate slugs
- **BuildNewStateStep** - Sets ID, timestamps, audit fields for create
- **BuildUpdateStateStep** - Merges spec, updates timestamps for update
- **PersistStep** - Saves resource to SQLite
- **LoadExistingStep** - Loads resource for update
- **LoadExistingForDeleteStep** - Loads resource before deletion
- **LoadTargetStep** - Loads resource for get operations
- **LoadByReferenceStep** - Loads resource by slug
- **LoadForApplyStep** - Checks existence for apply operations
- **DeleteResourceStep** - Deletes resource from database

## Registration

The controller is registered in `pkg/server/server.go`:

```go
mcpServerController := mcpservercontroller.NewMcpServerController(store)
mcpserverv1.RegisterMcpServerCommandControllerServer(grpcServer, mcpServerController)
mcpserverv1.RegisterMcpServerQueryControllerServer(grpcServer, mcpServerController)
```

## File Organization

```
mcpserver/controller/
├── mcpserver_controller.go      # Controller struct + constructor
├── create.go                    # Create handler + pipeline
├── update.go                    # Update handler + pipeline
├── delete.go                    # Delete handler + pipeline
├── get.go                       # Get handler + pipeline
├── get_by_reference.go          # GetByReference handler + pipeline
├── apply.go                     # Apply handler + pipeline
├── mcpserver_controller_test.go # Comprehensive tests
├── BUILD.bazel                  # Bazel build file
└── README.md                    # This file
```

## Usage Examples

### Creating an MCP Server (Stdio)

```go
mcpServer := &mcpserverv1.McpServer{
    ApiVersion: "agentic.stigmer.ai/v1",
    Kind:       "McpServer",
    Metadata: &apiresource.ApiResourceMetadata{
        Name:       "GitHub MCP Server",
        OwnerScope: apiresource.ApiResourceOwnerScope_identity_account,
    },
    Spec: &mcpserverv1.McpServerSpec{
        Description: "GitHub tools for code management",
        ServerType: &mcpserverv1.McpServerSpec_Stdio{
            Stdio: &mcpserverv1.StdioServerConfig{
                Command: "npx",
                Args:    []string{"-y", "@modelcontextprotocol/server-github"},
            },
        },
    },
}

created, err := controller.Create(ctx, mcpServer)
```

### Creating an MCP Server (HTTP)

```go
mcpServer := &mcpserverv1.McpServer{
    ApiVersion: "agentic.stigmer.ai/v1",
    Kind:       "McpServer",
    Metadata: &apiresource.ApiResourceMetadata{
        Name:       "Cloud MCP Service",
        OwnerScope: apiresource.ApiResourceOwnerScope_organization,
    },
    Spec: &mcpserverv1.McpServerSpec{
        Description: "Managed MCP service",
        ServerType: &mcpserverv1.McpServerSpec_Http{
            Http: &mcpserverv1.HttpServerConfig{
                Url:            "https://mcp.example.com/v1",
                TimeoutSeconds: 30,
                Headers: map[string]string{
                    "Authorization": "Bearer ${API_TOKEN}",
                },
            },
        },
    },
}

created, err := controller.Apply(ctx, mcpServer)
```

### Creating an MCP Server (Docker)

```go
mcpServer := &mcpserverv1.McpServer{
    ApiVersion: "agentic.stigmer.ai/v1",
    Kind:       "McpServer",
    Metadata: &apiresource.ApiResourceMetadata{
        Name:       "Custom MCP Container",
        OwnerScope: apiresource.ApiResourceOwnerScope_identity_account,
    },
    Spec: &mcpserverv1.McpServerSpec{
        Description: "Isolated MCP environment",
        ServerType: &mcpserverv1.McpServerSpec_Docker{
            Docker: &mcpserverv1.DockerServerConfig{
                Image: "ghcr.io/org/mcp-server:v1.0",
                Volumes: []*mcpserverv1.VolumeMount{
                    {HostPath: "/data", ContainerPath: "/app/data"},
                },
            },
        },
    },
}

created, err := controller.Create(ctx, mcpServer)
```

## Testing

Run the controller tests:

```bash
cd /Users/suresh/scm/github.com/stigmer/stigmer
bazel test //backend/services/stigmer-server/pkg/domain/mcpserver/controller:controller_test
```

Or with Go directly:

```bash
go test ./backend/services/stigmer-server/pkg/domain/mcpserver/controller/...
```

## Integration with Agents

Agents reference MCP servers via `mcp_server_usages`:

```go
agent := &agentv1.Agent{
    // ...
    Spec: &agentv1.AgentSpec{
        McpServerUsages: []*agentv1.McpServerUsage{
            {
                Slug:         "github-mcp-server",
                AllowedTools: []string{"search_code", "create_pull_request"},
            },
        },
    },
}
```

The Agent Runner resolves these slugs to full McpServer resources during execution.

## Alignment with Implementation Rules

This implementation follows established patterns:

- **Pipeline Pattern**: ALL handlers use pipelines (mandatory)
- **Domain Package Pattern**: Separate package at `domain/mcpserver/controller/`
- **File-per-Handler**: Each operation in its own file
- **Reusable Steps**: All steps from common library
- **No IAM/FGA**: Excluded enterprise-only features
- **Error Handling**: Uses grpclib helpers
- **Documentation**: Comprehensive comments in each handler
- **Comprehensive Tests**: Full test coverage for all operations

## Related Documentation

- [Environment Controller](../environment/controller/README.md) - Similar pattern reference
- [Agent Controller](../agent/controller/README.md) - Agent-specific patterns
- [Pipeline Architecture](../../../../libs/go/grpc/request/pipeline/README.md)
- [McpServer Proto Spec](../../../../../../apis/ai/stigmer/agentic/mcpserver/v1/spec.proto)
