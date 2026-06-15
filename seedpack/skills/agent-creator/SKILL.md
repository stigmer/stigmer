---
name: agent-creator
visibility: public
description: >
  Create and edit Stigmer Agent YAML files conforming to the agentic.stigmer.ai/v1 API.
  Use this skill when the user wants to create a new AI agent, modify an existing agent
  definition, or get help authoring Agent YAML for the Stigmer platform. Triggers on
  requests like: "create an agent", "write an agent YAML", "define an agent for X",
  "help me build an agent that does Y", "add an MCP server to my agent",
  "add a sub-agent", or "modify my agent's instructions".
---

# Agent Creator

Create production-quality Stigmer Agent YAML files that pass validation on the first attempt.

## Workflow

Follow these steps in order for every agent creation or modification request.

### Step 1: Gather Intent

Determine what the agent should do. Clarify:

- **Purpose**: what tasks the agent performs and its behavioral constraints
- **Tools**: which MCP servers and tools the agent needs (GitHub, Slack, databases, etc.)
- **Knowledge**: which skills should be injected as domain expertise
- **Delegation**: whether the agent needs sub-agents for specialized tasks
- **Organization**: which org owns the agent (default: `default`)

If the user's intent is ambiguous or incomplete, **ask before assuming**. Never silently fill in placeholders or guess at requirements.

### Step 2: Discover Available Resources

**Before writing any `mcp_server_usages` or `skill_refs`**, query the platform to verify that referenced resources actually exist.

Use the Stigmer MCP server tools connected at runtime:

- `search` — find resources by keyword (e.g., search for "github" to find MCP servers)
- `get_mcp_server` — retrieve a specific MCP server by org/slug to confirm it exists and inspect its available tools
- `get_skill` — retrieve a specific skill by org/slug to confirm it exists

**Rules**:
- Never guess or hallucinate resource slugs. Every `mcp_server_ref.slug` and `skill_refs[].slug` must be verified against the platform.
- If a needed MCP server or skill does not exist, inform the user and ask how to proceed. Do not insert placeholder references.
- When discovering MCP servers, note the available tools so `enabled_tools` values are accurate.

### Step 3: Compose the YAML

Read `references/schema.md` for the complete field reference. Build the YAML following this structure:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: <agent-name>
  org: <organization>
spec:
  description: "<1-2 sentence summary>"
  instructions: |
    <system prompt>
  mcp_server_usages: [...]
  skill_refs: [...]
  sub_agents: [...]
```

Read `references/examples.md` for complete examples ranging from minimal to full-featured agents.

**Composition guidelines**:

- Write `instructions` using `|` block scalar style for multi-line content
- Write clear, specific instructions that define the agent's behavior, constraints, and personality
- For `mcp_server_usages`, use relative references (omit `org`) when the MCP server belongs to the same org as the agent
- For `skill_refs`, use relative references by default; use absolute references (with `org`) only for cross-org public resources
- For `sub_agents`, ensure the parent's `instructions` describe when and how to delegate
- Only include `env` if the agent itself (not just its MCP servers) needs custom environment variables
- Never set `status` — it is system-managed
- Omit `metadata.slug` unless the user explicitly wants a slug different from the auto-generated one

### Step 4: Validate Before Presenting

Read `references/validation-rules.md` for the complete checklist. Before showing the YAML to the user, verify **every** rule:

**Required fields**:
- `apiVersion` is exactly `agentic.stigmer.ai/v1`
- `kind` is exactly `Agent`
- `metadata.name` is present
- `spec.instructions` is ≥ 10 characters
- `spec.description` is present and meaningful

**Reference formats**:
- All `kind` values are lowercase strings: `skill` or `mcp_server` (never integers, never capitalized)
- All `slug` values match `^[a-z][a-z0-9-]*$` (lowercase, hyphens, starts with letter, 1-63 chars)
- All referenced MCP servers and skills were verified to exist in Step 2

**MCP server rules**:
- No duplicate `mcp_server_ref.slug` values within `mcp_server_usages`
- `enabled_tools` contain only tools that actually exist on the referenced MCP server

**Sub-agent permission containment**:
- Each `mcp_access[].mcp_server` references a slug from the parent's `mcp_server_usages`
- Each `mcp_access[].enabled_tools` is a **subset** of the parent's enabled tools for that server
- Sub-agent names are unique
- Sub-agent `instructions` are ≥ 10 characters

**YAML syntax**:
- Multi-line instructions use `|` block scalar
- No tabs, no trailing whitespace
- `visibility` is `visibility_private` or `visibility_public` (exact strings)

### Step 5: Present and Explain

Present the complete YAML in a fenced code block. After the YAML, briefly explain:

- Key design decisions (why certain tools were enabled, why sub-agents were structured this way)
- How to apply: `stigmer apply -f <filename>.yaml`
- How to run: `stigmer run <agent-slug> "<message>"`
- Any caveats (e.g., MCP servers that need environment configuration via AgentInstance)

## Key Rules

1. **Discover first, write second** — always verify MCP servers and skills exist before referencing them.
2. **Ask, don't assume** — if intent is unclear or a resource is missing, ask the user.
3. **Validate exhaustively** — check every rule in `references/validation-rules.md` before presenting.
4. **No placeholders** — never output `<TODO>`, `<your-slug-here>`, or similar. Every value must be concrete.
5. **No status fields** — never include `status` in user-authored YAML.
6. **Relative references by default** — omit `org` in refs when the resource is in the same org as the agent.
