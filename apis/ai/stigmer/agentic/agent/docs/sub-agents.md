# Sub-Agents

How Agents delegate to specialized sub-agents, and how a sub-agent's tool lists narrow the parent's tools.

## What Are Sub-Agents?

Sub-agents enable delegation: the parent agent can route specialized tasks to focused sub-agents. Each sub-agent has its own instructions and skills, and starts from the parent's tools, which it can narrow.

Sub-agents are defined inline within the parent Agent YAML — they are not separate resources.

## Defining Sub-Agents

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
  tools: [Read, Grep, Glob, Agent, mcp__github]

  sub_agents:
    - name: code-reviewer
      description: "Reviews code changes for quality and security"
      instructions: |
        You review code changes. Focus on:
        - Security vulnerabilities
        - Performance issues
        - Code style consistency
      tools: [Read, Grep, mcp__github__search_code, mcp__github__get_file_contents]
      skill_refs:
        - kind: skill
          slug: code-review-best-practices
```

## SubAgent Fields

Defined by `SubAgent` in `ai/stigmer/agentic/agent/v1/spec.proto`.

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique identifier within the parent agent. Used for delegation routing and logging. Examples: `code-reviewer`, `researcher`, `writer`. |
| `description` | No | Helps the parent agent decide when to delegate to this sub-agent. Should clearly describe the sub-agent's specialization. |
| `instructions` | Yes | System prompt for the sub-agent. Minimum 10 characters (enforced by `buf.validate`). Defines the sub-agent's expertise and constraints. |
| `tools` | No | Tools this sub-agent may use, from what the parent may use. Empty means all of the parent's. Same names as the agent's `tools`. |
| `disallowed_tools` | No | Tools this sub-agent may never use, in the same names. Applied before `tools`. |
| `skill_refs` | No | Skills for this sub-agent. Independent of parent — can reference any skill. See [skill-integration.md](skill-integration.md). |

The names are Claude Code's: built-ins such as `Read`, `Grep` or `Bash(git push *)`, and `mcp__<server-slug>`, `mcp__<server-slug>__<tool>` or `mcp__*` for MCP tools. [mcp-server-integration.md](mcp-server-integration.md) lists the forms.

## Permission Model

A sub-agent can never exceed its parent's tools.

### Tool Narrowing

- A sub-agent starts from the parent's resolved tools: whatever the parent's `tools` and `disallowed_tools` leave.
- Its own `disallowed_tools` is applied first, then its own `tools` against what remains.
- A sub-agent can **narrow** (fewer tools than the parent) but never **widen**: naming a tool the parent excluded does not give it back.
- The native harness enforces a sub-agent's own lists inside the sub-agent. The Cursor harness cannot tell which sub-agent made a call, so it refuses a turn whose sub-agent carries lists of its own, naming the sub-agent; run such an agent on the native harness.
- A sub-agent with no lists has exactly the parent's tools, MCP servers included.
- Inside a sub-agent, the type list of an `Agent(...)` entry is ignored, as in Claude Code. In the main agent's `tools`, `Agent(code-reviewer)` limits which sub-agents it may start.

### Skill Independence

- Sub-agent `skill_refs` are **independent** of the parent agent's skills.
- A sub-agent can reference any Skill resource, including skills the parent does not use.
- This allows sub-agents to have specialized knowledge without loading it into the parent's context.

### Containment Summary

```
Parent Agent
├── mcp_server_usages: [github, slack]
├── tools: [Read, Grep, Agent, mcp__github, mcp__slack]
├── skill_refs: [style-guide, testing-guide]
│
├── Sub-Agent: code-reviewer
│   ├── tools: [Read, mcp__github__get_file_contents]  ← narrowed
│   └── skill_refs: [security-checklist]                ← independent
│
└── Sub-Agent: notifier
    ├── disallowed_tools: [mcp__github]                ← narrowed
    └── skill_refs: []                                  ← no skills needed
```

## Delegation Routing

The parent agent decides when to delegate using the sub-agent's `name` and `description`. Well-written descriptions help the parent make accurate delegation decisions:

```yaml
# Good — clear about what triggers delegation
description: "Reviews code changes for security vulnerabilities and coding standards"

# Poor — too vague for the parent to route effectively
description: "Handles code stuff"
```

The parent's `instructions` should describe how delegation works:

```yaml
instructions: |
  You coordinate engineering work. Delegate to sub-agents based on the task:
  - Code reviews go to the code-reviewer sub-agent
  - PR creation goes to the pr-creator sub-agent
  Handle general questions yourself.
```
