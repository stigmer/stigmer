# `@stigmer/mcp-server`

A [Model Context Protocol](https://modelcontextprotocol.io) server for
Stigmer. It exposes Stigmer **agents and skills** as
MCP tools and resources — covering both the
authoring loop (create, read, update, delete, version) and the run loop
(run, observe, approve, cancel) — so any MCP-capable client (Claude Desktop,
Cursor, the Stigmer CLI, etc.) can build on Stigmer through a uniform protocol.

The server is a **stateless protocol bridge**: it holds no per-user state and
performs no business logic. Every request is translated into a gRPC call against
`stigmer-server`, which remains the single source of truth and the sole authority
for authentication and authorization.

## Architecture

```
MCP client ──JSON-RPC──▶ stdio | HTTP (stateless) ──▶ tool handler
                                                      │
                                          resolveToken (per request)
                                                      │
                                       short-lived raw *_pb gRPC controller
                                                      │
                                                Bearer passthrough
                                                      ▼
                                            stigmer-server (gRPC)
```

- **Proto-first.** Tools call the generated `@stigmer/apis` `*Controller`
  clients directly and serialize responses with protojson (`toJson` with
  `useProtoFieldName: true`), so output is byte-for-byte comparable with the
  CLI's `-o json`.
- **Credential passthrough.** In `http` mode each request carries its own
  `Authorization: Bearer` token, which is forwarded unchanged to
  `stigmer-server`; the MCP server never validates it. In `stdio`/`both` mode the
  startup `STIGMER_API_KEY` is used.
- **Stateless HTTP.** Every HTTP request is served on its own, with no MCP
  session and a plain JSON reply: no tool sends anything outside its own
  response, so any number of replicas can serve, and a restart drops no
  client. `GET` and `DELETE` answer `405` (no stream to open, no session to
  end), a body that is not JSON answers `400`, and a body over 10 MiB
  (stigmer-server's own message limit) answers `413`. A body holding a
  collection over 1,000 items, or more than 10,000 collection items in all,
  answers `400` before any input schema sees it (`src/collection-bound.ts`).
- **`apply_*` ergonomics are generated.** The flattened, LLM-friendly input
  schemas for the `apply_*` tools (metadata hoisting, enum→string, reference
  flattening, oneof expansion) are produced at build time by the codegen in
  `tools/codegen/src/generator/mcp-ts.ts`. Never hand-edit `src/gen/`.

## Tools (16)

Every tool carries MCP tool annotations (`src/domains/toolmarks.ts`), its
**marks**, which clients act on: Codex asks the person before any tool not
marked read-only or closed-world and not destructive, and Stigmer's own runner
tightens approval for a tool marked destructive. The marks below are those
sets: **read** (read-only), **read, open world** (reads the public docs),
**write** (changes Stigmer data, losing nothing), **write, open world**
(spends model tokens, reaches a person or lets a run act), **destructive**
(can't be undone). `src/__tests__/roster.test.ts` holds this list equal to
what each roster registers.

The full roster also sends MCP `instructions` (`src/instructions.ts`): what the
tools are for, how to answer from the docs, and the rules for acting for a
person (propose a delete, an overwrite, a key, access or spending first; never
answer a run's approval for the person). Claude Code puts them in the agent's
prompt whether or not any skill loads.

### Full roster: discovery and docs

| Tool | Marks | Description |
| --- | --- | --- |
| `search` | read | Search across agents and skills; results are enriched with `stigmer://` resource URIs. |
| `search_docs` | read, open world | Find the stigmer.ai/docs pages that answer a question, from the site's `llms.txt`. |
| `read_doc` | read, open world | Read one stigmer.ai/docs page whole, as its Markdown export, opening with its `Source:` URL. Only stigmer.ai/docs is read. |

### Full roster: authoring

| Tool | Marks | Description |
| --- | --- | --- |
| `get_agent` | read | Read an agent by org + slug. |
| `apply_agent` | write | Create or update an agent (idempotent); every new spec keeps the version it replaces. |
| `delete_agent` | destructive | Delete an agent. |
| `get_skill` | read | Read a skill (optionally a specific version). |
| `delete_skill` | destructive | Delete a skill (all versions). |
| `list_skill_versions` | read | List a skill's version history. |

### Full roster: runs

Runs are asynchronous: the `run_*` tools return immediately with the run ID and
the assistant polls the observation tools.

| Tool | Marks | Description |
| --- | --- | --- |
| `run_agent` | write, open world | Start a run of an agent (new session or `session_id` follow-up); a new session uses the caller's My vault unless `include_my_vault` is false, then the shared `vaults` it names, and the installed `plugins` it names beside its agent's. |
| `get_run` | read | Poll a run: its lifecycle and its events from the session's event log, as a turn summary (phase, answer, the tool uses waiting for an answer by `tool_use_id`, a bounded item tail) or every event as Managed Agents JSON. |
| `submit_run_approval` | write, open world | Answer a tool use the run waits on, by `tool_use_id`: allow, deny (with a reason for the agent) or allow_all (the call's class for the rest of the turn). |
| `cancel_run` | destructive | Cancel a run (`run_*`) by interrupting its conversation: every unfinished turn stops. |

### Narrow rosters

Each serves one tool to agents running inside Stigmer, attached by the runner
(`/channels`, `/conversation`, `/memory`); none carries instructions.

| Tool | Roster | Marks | Description |
| --- | --- | --- | --- |
| `send_channel_message` | channels | write, open world | Send a message on a Channel, to a person outside Stigmer. |
| `escalate_to_human` | conversation | write | Ask a human to take over the conversation; safe to repeat. |
| `remember` | memory | write | Propose a durable fact about the person, for review. |

## Resources (3)

Resource templates let clients discover and read resources by `stigmer://` URI:

| Resource | URI pattern |
| --- | --- |
| `stigmer_agent` | `stigmer://agents/{org}/{slug}` |
| `stigmer_skill` | `stigmer://skills/{org}/{slug}` (latest) |
| `stigmer_skill_version` | `stigmer://skills/{org}/{slug}/{version}` |

## Configuration

All configuration is read from the environment.

| Variable | Default | Description |
| --- | --- | --- |
| `STIGMER_SERVER_ADDRESS` | `localhost:7234` | gRPC `host:port` of `stigmer-server`. |
| `STIGMER_API_KEY` | `""` | The startup bearer used in `stdio`/`both` mode — an API key for a desktop client; the run's own credential when the runner spawns this server for a run. |
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

In `http` mode the server also exposes `GET /health` (unauthenticated
liveness) and `GET /ready` (liveness and a working backend hop).

### Docker image

The published image, `ghcr.io/stigmer/mcp-server-stigmer`, runs the same
package and reads the same variables; stdio stays its default, so a desktop
client runs it as `docker run -i --rm ghcr.io/stigmer/mcp-server-stigmer`. Its
health check follows the transport. Under `stdio` nothing listens on a port, so
a running container is healthy. Under `http` or `both` the check requests
`/health` on `STIGMER_MCP_HTTP_PORT` (default `8080`).

### Embedding

Run the whole server in-process, as the `stigmer` CLI does:

```ts
import { defaultConfig, run } from "@stigmer/mcp-server";

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
await run(defaultConfig(), controller.signal);
```

A host whose credential changes while the server runs passes a token provider,
named and typed as `@stigmer/client`'s `getAccessToken`. The server asks it on
every call that brings no bearer of its own, in place of `STIGMER_API_KEY`; the
CLI passes one over the signed-in cloud backend, so a sign-in that expires
within the hour is refreshed instead of failing. `createTokenCache` from
`@stigmer/client` keeps one token until it is about to expire:

```ts
import { createTokenCache } from "@stigmer/client";

const tokens = createTokenCache(fetchMyToken); // () => Promise<{ accessToken, expiresAt } | null>
await run(defaultConfig(), controller.signal, { getAccessToken: tokens.getAccessToken });
```

Or mount the HTTP handler on a listener the host already runs, beside its own
routes. The request must reach the handler unread (it reads the body itself,
under its cap). The host answers its own probes; the handler serves the four MCP routes
(`/`, `/channels`, `/conversation`, `/memory`) and the RFC 9728 metadata
document, answers a POST to any other path `404` and any method but POST `405`,
and never rejects. The optional
`authenticate` check lets a host that can verify tokens refuse one at the door:
`refused` answers `401` with the OAuth challenge, so clients refresh and retry,
and `unavailable` answers `503`.

```ts
import { createServer } from "node:http";
import { createMcpHttpHandler } from "@stigmer/mcp-server";

const handler = createMcpHttpHandler({
  target: { serverAddress: "127.0.0.1:7234", apiKey: "" },
  authRequired: true,
  oauth: { enabled: false, resource: "", authorizationServers: [], scopesSupported: [] },
  authenticate: async (token) => ((await verify(token)) ? "accepted" : "refused"),
});
createServer((req, res) => void handler(req, res)).listen(8080);
```

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run build       # tsc -p tsconfig.build.json
npm test            # vitest run
```

Tests live in a `__tests__` directory beside the module each tests, as `*.test.ts`. Many run in-process against a
`connectNodeAdapter` backend and an in-memory MCP client, asserting protojson
parity: unit tests by the standard in `test/README.md`, which admits an
in-process loopback server. A live-server slice that boots the real `stigmer-server`
lives in `test/conformance/src/suites/mcp.conformance.test.ts`.

## Code generation

The `apply_*` tool schemas and proto bridges in `src/gen/` are generated:

```bash
make codegen-apply
```

This runs the TypeScript emitter (`tools/codegen/src/generator`, target
`mcp-ts`) over the proto contracts. Adding an `apply_*` tool for a new resource
is an append to `MCP_TS_APPLY_RESOURCES` in
`tools/codegen/src/generator/mcp-ts.ts` plus regeneration.

## Conventions

- Import generated proto code from `@stigmer/apis/.../*_pb` only — never the
  broken `*_connect` files.
- `src/gen/` is generated; edit the codegen, not the output.
