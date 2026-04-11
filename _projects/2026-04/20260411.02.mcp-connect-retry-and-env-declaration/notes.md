# Notes: 20260411.02.mcp-connect-retry-and-env-declaration

**Created**: 2026-04-11

## Purpose

Use this file to capture important information as you work:

- 🎯 **Decisions**: Why you chose approach A over B
- 🐛 **Gotchas**: Issues discovered and how you solved them
- 💡 **Learnings**: Insights that might help later
- 📝 **Commands**: Useful commands or snippets
- 🔗 **References**: Links to docs, Stack Overflow, etc.

Keep entries **timestamped** and **concise**. This isn't a novel - just enough context to remember later.

---

## 2026-04-11 -- Investigation and Design

### Root cause chain for 401 error

The `tolerateMissing` flag in `McpServerConnectHandler.resolveFromPersonalEnvironment()` (Java) exists because `EnvironmentValue` has no way to distinguish required auth vars from optional platform vars. When SDK sends `runtime_env` (system vars), the handler sets `tolerateMissing=true`, which silently skips missing auth credentials. The `PlaceholderResolver` in lenient mode then sends a literal `${SLACK_ACCESS_TOKEN}` as the Authorization header.

### Why EnvironmentValue can't just get an `optional` field

`EnvironmentValue` is shared between two contexts:
- **Storage**: `Environment.spec.data` (actual encrypted values)
- **Declaration**: `McpServer.spec.env_spec.data` (what the blueprint needs)

The `optional` concept only applies to declarations. Adding it to the storage message is a semantic leak. Decision: create a dedicated `EnvVarDeclaration` message for the declaration context.

### Temporal default retry policy

When no `retry_policy` is passed to `workflow.execute_activity()`, Temporal uses: unlimited retries, initial_interval=1s, backoff_coefficient=2.0, maximum_interval=100s. For a connect workflow (user-triggered, synchronous), this is wrong -- a 401 will never succeed on retry.

### Proto field number allocation

- `McpServerSpec`: fields 1-14 used, next available = 15 (for `env`)
- `AgentSpec`: fields 1-7 used, next available = 8 (for `env`)
- `WorkflowSpec`: fields 1-4 used, next available = 5 (for `env`)

### YAML nesting improvement

The `EnvironmentSpec` wrapper message adds an unnecessary `data` nesting level in YAML (`env_spec.data.KEY`). The new flat `map<string, EnvVarDeclaration> env` removes this: `env.KEY`. Cleaner for MCP server authors.

---

## 2026-04-11 -- Implementation Session

### McpServerAuth should NOT be merged into EnvVarDeclaration

Considered moving `McpServerAuth` into `EnvVarDeclaration` (embedding OAuth config per env var instead of separate `auth` block). Rejected for three reasons:

1. **Aggregate boundary violation** — `EnvVarDeclaration` is in the `environment` package, shared across McpServer, Agent, and Workflow. OAuth is MCP-server-specific. Agents and Workflows never have OAuth flows.
2. **Separation of "what I need" vs "how to get it"** — Declaration describes schema; auth describes an acquisition strategy. Different responsibilities.
3. **MCP-specific runtime semantics** — DCR mode, Connect page UX, pre-flight token refresh are all tied to the McpServer domain.

The `target_env_var` string indirection is a minor wart (fragile name-coupling), but the right fix is apply-time validation, not merging the concepts.

### RetryPolicy on classify_tool_approvals

The classify activity makes an LLM call (transient failures possible). Still set `maximum_attempts=1` because:
- Connect is synchronous — user is waiting
- Classify is fast (~2s) and cheap to re-trigger
- Silent retries with backoff make the user wait with no feedback

