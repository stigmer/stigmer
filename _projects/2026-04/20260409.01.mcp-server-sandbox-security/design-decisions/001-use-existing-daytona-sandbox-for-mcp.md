# Design Decision 001: Use the Existing Daytona Sandbox for MCP Server Isolation

**Date**: 2026-04-09
**Status**: Accepted
**Context**: MCP server security brainstorming session

## Decision

Run stdio MCP server processes inside the **same Daytona sandbox** already created for workspace operations (file I/O, shell commands, git), rather than introducing a new microservice, separate pods, or additional sandboxes.

## Options Considered

| Option | Verdict | Reason |
|--------|---------|--------|
| **Same Daytona sandbox** (chosen) | Accepted | No new infra, no cold start, reuses existing sandbox lifecycle |
| Separate Daytona sandbox per MCP server | Rejected | Additional cold start + cost, unnecessary for current threat model |
| Dedicated K8s pod per MCP server | Rejected | Heavy infrastructure, cold start (5-30s pod scheduling), requires stdio-to-HTTP bridge |
| MCP Runner microservice | Rejected | Unnecessary new component, over-engineering at this stage |
| Sidecar containers | Rejected | K8s doesn't support dynamic sidecar injection after pod creation |
| Linux namespace isolation (nsjail/bwrap) | Rejected | Requires CAP_SYS_ADMIN, complex, shared kernel |
| Firecracker microVMs | Rejected | Requires bare-metal/nested virt, very high complexity |

## Rationale

1. **No additional cold start** -- sandbox is already warm before MCP servers start
2. **No additional cost** -- no extra Daytona sandbox per MCP server
3. **Simpler lifecycle** -- sandbox teardown cleans up everything (workspace + MCP)
4. **Shared runtimes** -- Node.js, Python, Go already in sandbox image
5. **Security boundary is sufficient** -- sandbox has separate network namespace (no access to Temporal/Redis/MongoDB/K8s API), separate filesystem (no access to agent-runner code/virtualenv), separate process environment (no platform secrets)

## Trade-off Acknowledged

MCP servers share the sandbox with workspace files. A malicious MCP server could access agent work products, skill files, and attachments. This is acceptable because:
- Workspace contains user-level data, not platform secrets
- MCP server already has the user's API tokens via env vars (user-level trust)
- If stronger isolation is needed later, a second sandbox can be added as an upgrade path

## Consequences

- Sandbox Docker images must include MCP runtimes (Go, uvx, Node.js)
- Need a stdio relay to communicate with MCP processes over the Daytona session API
- Local mode continues using local subprocesses (no sandbox in OSS/local deployment)
