# `@stigmer/mcp-server`

A [Model Context Protocol](https://modelcontextprotocol.io) server for the
Stigmer platform. It exposes Stigmer **agents, skills, MCP servers, and
workflows** as MCP tools and resources, so any MCP-capable client (Claude
Desktop, Cursor, the Stigmer CLI, etc.) can read and manage Stigmer resources
through a uniform protocol.

The server is a **stateless protocol bridge**: it holds no per-user state and
performs no business logic. Every request is translated into a gRPC call against
`stigmer-server`, which remains the single source of truth and the sole authority
for authentication and authorization. This package is the TypeScript successor to
the Go `mcp-server/` and is contract-compatible with it.

## Architecture

```
MCP client ──JSON-RPC──▶ stdio | HTTP session ──▶ tool handler
                                                      │
                                          resolveToken (per request)
                                                      │
                                       short-lived raw *_pb gRPC controller
                                                      │
                                                Bearer passthrough
                                                      ▼
                                            stigmer-server (gRPC)
```

- **Proto-first.** Tools call the generated `@stigmer/protos` `*Controller`
  clients directly and serialize responses with protojson (`toJson` with
  `useProtoFieldName: true`), so output is byte-for-byte comparable with the Go
  server.
- **Credential passthrough.** In `http` mode each request carries its own
  `Authorization: Bearer` token, which is forwarded unchanged to
  `stigmer-server`; the MCP server never validates it. In `stdio`/`both` mode the
  startup `STIGMER_API_KEY` is used.
- **`apply_*` ergonomics are generated.** The flattened, LLM-friendly input
  schemas for the `apply_*` tools (metadata hoisting, enum→string, reference
  flattening, oneof / `task_config` expansion) are produced at build time by the
  codegen in `tools/codegen/generator/mcp_ts.go`, mirroring the Go generator so
  the two servers expose identical tool surfaces. Never hand-edit `src/gen/`.

## Tools (17)

| Tool | Description |
| --- | --- |
| `search` | Search across agents, skills, MCP servers, and workflows; results are enriched with `stigmer://` resource URIs. |
| `get_agent` | Read an agent by org + slug. |
| `apply_agent` | Create or update an agent (idempotent). |
| `delete_agent` | Delete an agent. |
| `get_mcp_server` | Read an MCP server by org + slug. |
| `apply_mcp_server` | Create or update an MCP server (stdio or http transport). |
| `delete_mcp_server` | Delete an MCP server. |
| `get_skill` | Read a skill (optionally a specific version). |
| `delete_skill` | Delete a skill (all versions). |
| `get_workflow` | Read a workflow by org + slug. |
| `apply_workflow` | Create or update a workflow, with typed per-kind task config and recursive nested tasks. |
| `delete_workflow` | Delete a workflow. |
| `validate_workflow_yaml` | Validate a Serverless Workflow YAML document against the task-kind registry. |
| `get_task_kind_registry` | List every supported workflow task kind. |
| `get_task_kind` | Read one task kind's config/output schema and examples. |
| `get_workflow_execution` | Read a workflow execution by id. |
| `get_workflow_execution_events` | Read the event stream for a workflow execution. |

## Resources (5)

Resource templates let clients discover and read resources by `stigmer://` URI:

| Resource | URI pattern |
| --- | --- |
| `stigmer_agent` | `stigmer://agents/{org}/{slug}` |
| `stigmer_mcp_server` | `stigmer://mcp-servers/{org}/{slug}` |
| `stigmer_skill` | `stigmer://skills/{org}/{slug}` (latest) |
| `stigmer_skill_version` | `stigmer://skills/{org}/{slug}/{version}` |
| `stigmer_workflow` | `stigmer://workflows/{org}/{slug}` |

## Configuration

All configuration is read from the environment.

| Variable | Default | Description |
| --- | --- | --- |
| `STIGMER_SERVER_ADDRESS` | `localhost:7234` | gRPC `host:port` of `stigmer-server`. |
| `STIGMER_API_KEY` | `""` | API key used in `stdio`/`both` mode. |
| `STIGMER_MCP_TRANSPORT` | `stdio` | `stdio`, `http`, or `both`. |
| `STIGMER_MCP_HTTP_PORT` | `8080` | Listen port for `http`/`both`. |
| `STIGMER_MCP_HTTP_AUTH_ENABLED` | `true` | Require an `Authorization: Bearer` header (presence only). |
| `STIGMER_MCP_LOG_FORMAT` | `text` | `text` or `json`. |
| `STIGMER_MCP_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error`. |

### OAuth discovery (RFC 9728, optional, off by default)

Additive discovery only — tokens are still never validated by this server.

| Variable | Description |
| --- | --- |
| `STIGMER_MCP_OAUTH_ENABLED` | `true` to serve `/.well-known/oauth-protected-resource` and emit `WWW-Authenticate`. |
| `STIGMER_MCP_OAUTH_RESOURCE` | This server's resource identifier (required when enabled). |
| `STIGMER_MCP_OAUTH_AUTHORIZATION_SERVERS` | Comma-separated issuer URLs (at least one required when enabled). |
| `STIGMER_MCP_OAUTH_SCOPES_SUPPORTED` | Comma-separated advertised scopes (optional). |

## Usage

```bash
# stdio (default) — for desktop clients that spawn the server
STIGMER_SERVER_ADDRESS=localhost:7234 \
STIGMER_API_KEY=sk-... \
npx -y -p @stigmer/mcp-server mcp-server-stigmer

# HTTP — for shared/remote deployments (per-request Bearer)
STIGMER_MCP_TRANSPORT=http \
STIGMER_MCP_HTTP_PORT=8080 \
npx -y -p @stigmer/mcp-server mcp-server-stigmer
```

In `http` mode the server also exposes `GET /health` (unauthenticated liveness).

### Embedding

```ts
import { createServer, serveStdio } from "@stigmer/mcp-server";

const server = createServer({ serverAddress: "localhost:7234", apiKey: "sk-..." });
const controller = new AbortController();
await serveStdio(server, controller.signal);
```

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run build       # tsc -p tsconfig.build.json
npm test            # vitest run
```

Tests live next to the code as `*.test.ts` (unit) and `*.integration.test.ts`
(in-process: a `connectNodeAdapter` backend + an in-memory MCP client, asserting
protojson parity). A live-server slice that boots the real Go `stigmer-server`
lives in `test/conformance/src/suites/mcp.conformance.test.ts`.

## Code generation

The `apply_*` tool schemas and proto bridges in `src/gen/` are generated:

```bash
make codegen-apply
```

This runs the Go emitter (`tools/codegen/generator`, target `mcp-ts`) over the
proto contracts. The same model also drives the Go MCP server, guaranteeing the
two servers stay in lockstep.

## Conventions

- Import generated proto code from `@stigmer/protos/.../*_pb` only — never the
  broken `*_connect` files.
- `src/gen/` is generated; edit the codegen, not the output.
