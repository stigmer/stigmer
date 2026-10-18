# Subagents

How an agent hands work to other agents, which version of each one runs, and
what each one runs with.

## What Is a Subagent?

A subagent is an agent the main agent of a conversation can hand a task to. It
works on the task in its own context and reports back to the main agent, which
alone answers the person or the channel. The word is the one Claude Code and
Claude Managed Agents use.

A turn offers two kinds of subagent:

- **Saved subagents.** Agents of your organization that the agent lists in
  `spec.subagents`. Each is an agent of its own, saved and versioned like any
  other, and runs its own definition: its instructions, model, tools, plugins,
  skills, hooks and values. One agent can be the subagent of many.
- **Plugin subagents.** The agents a plugin carries, named `<plugin>:<agent>`,
  joined to every turn whose agent or conversation lists the plugin. They are
  Claude Code's plugin subagents: they work with the conversation's tools,
  narrowed by their agent file's lists.

The native engine also offers built-in subagents, such as `explore`.

## Listing Subagents

Save the agent that does the work first:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: release-notes
spec:
  description: "Writes release notes from the pull requests merged since a tag"
  instructions: |
    You write release notes. Read the pull requests merged since the tag you
    are given, group them by area, and write one plain sentence per change.
  plugins:
    - kind: plugin
      slug: github
  tools: [Read, mcp__plugin_github_github__list_pull_requests]
  harness: HARNESS_NATIVE
  run_config:
    model_name: claude-sonnet-4.5
```

Then list it in the agent that hands work to it:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: pr-bot
spec:
  description: "Reviews pull requests and prepares releases"
  instructions: |
    You review pull requests and prepare releases. When asked for release
    notes, hand the work to the release-notes subagent.
  plugins:
    - kind: plugin
      slug: github
  tools: [Read, Grep, Agent, mcp__plugin_github_github]
  subagents:
    - kind: agent
      slug: release-notes
```

A listed agent must exist when the agent that lists it is saved. A `tools` list
names `Agent` when the agent hands work on: "only these" is exact.

## The `subagents` Field

Each entry is an `ApiResourceReference` (see
[resource-references.md](resource-references.md)) with `kind: agent`.

| Field     | Required | Description                                                                                                                                                   |
| --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`    | Yes      | Always `agent`.                                                                                                                                               |
| `slug`    | Yes      | The listed agent's slug. It is also the subagent's name in a turn, the name `Agent(...)` entries and hooks see.                                               |
| `org`     | No       | Empty for an agent of this agent's organization. Another organization's agent follows the reference rule in [resource-references.md](resource-references.md). |
| `version` | No       | Empty or `latest` for the listed agent's latest version, a tag, or a version hash. See [Which Version Runs](#which-version-runs).                             |

Saving refuses:

- more than 20 subagents, or two agents of one slug (a turn names a subagent by
  its slug);
- an agent that lists itself;
- an agent you may not run: you can list only agents you can run yourself;
- an agent that lists subagents of its own: a subagent cannot hand work on to
  another agent, so there is one level;
- an agent more private than the agent listing it: an agent may not be more
  visible than the skills, plugins and agents it references;
- an agent last saved before agents were versioned, until it is saved once.

An agent that another agent lists cannot be deleted. The refusal names the
agents that list it:

```text
agent 'release-notes' is still used by agent 'pr-bot'; remove it from their subagents first
```

## Which Version Runs

Each subagent is pinned when the agent that lists it is saved. The saved
reference carries the version hash it resolved to, and every conversation on
that version of the parent runs that version of the subagent.

| `version` sent on save | What is pinned                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Empty or `latest`      | The listed agent's latest version at the moment of the save.                                          |
| A tag, such as stable  | The version the tag names at the moment of the save; a later move of the tag does not change the pin. |
| A version hash         | That version.                                                                                         |

What a save sends decides. A reference without a version takes the latest again,
so `stigmer apply` of a manifest that names no version always takes each
subagent's latest version. A save that sends the stored list back, as the
console does when you edit the instructions, keeps every pin. When the team
improves `release-notes`, `pr-bot` keeps the version it was saved with until
someone saves it again; the console's agent page shows each subagent's pinned
version and says when a newer one exists.

## What a Saved Subagent Runs With

A saved subagent runs its own definition:

- **Its instructions.** Its `description` tells the main agent when to hand it
  work.
- **Its model.** Its `run_config.model_name` when its `harness` is the
  conversation's engine; otherwise the turn's model.
- **Its tools.** Its own `tools` and `disallowed_tools`, capped by the turn's
  lists (those a message, or the routine or channel it came through, sets), never by the
  parent agent's lists. A subagent can use a tool the parent may not.
- **Its plugins.** Their MCP servers, skills and hooks. Their agents are not
  offered: a subagent hands work to no one.
- **Its MCP servers** (`mcp_servers`), the ones written in it. A server's name
  is the agent's and its subagents' together: an agent and a subagent it lists
  may not both have a server of one name, and run planning refuses such a turn,
  naming both.
- **Its skills** (`skill_refs`) and **its hooks** (`hooks`).
- **Its values.** The keys its `env` declares, found in the conversation's
  vaults like the agent's own, reach only its shell and its own hooks. The
  parent's keys never reach the subagent, and the subagent's never reach the
  parent.

It does not get the conversation's own plugins (the Session's `spec.plugins`),
the parent's plugins, skills or tools, or the platform's channel, conversation
and memory tools: it reports to the parent agent.

It runs as the conversation's person, on the conversation's budget. The
conversation's hooks run on its calls first (the hooks of the session's and the
main agent's plugins, then the main agent's own block), then its own. A hook an
organization puts on its agents still sees the work they hand on. Its work is
recorded on the run as a `SubAgentRun` under its name.

## Plugin Subagents

A plugin's agents follow Claude Code's rule for plugin subagents:

- **Tools.** The main agent's tools, narrowed by the `tools` and
  `disallowed_tools` the agent file declares. A plugin subagent can narrow the
  main agent's tools, never widen them: naming a tool the main agent may not use
  does not give it back.
- **Skills.** The plugin's own skills its file names.
- **No hooks or MCP servers of its own.** The conversation's hooks run on its
  calls.
- **Model.** The `model:` its file names, when that is a model id the
  conversation's engine lists. `inherit`, an alias such as `sonnet`, or any
  other value runs the turn's model, and install warns about an alias or an
  unknown value. A plugin pushed before the model was read carries none until it
  is pushed again.

## Choosing Which Subagents Start

In the main agent's `tools`, `Agent` lets it start any subagent, and
`Agent(release-notes, thermos:review)` limits it to those named. Inside a
subagent the `Agent` tool is gone, whatever its lists say.

## Engines

The native engine runs everything on this page.

The Cursor engine runs a subagent with its instructions, model and skills. It
cannot tell a subagent's tool call from the main agent's, so it refuses a turn
whose saved subagent brings its own plugins, hooks, MCP servers or tool lists:

```text
Subagent 'release-notes' brings its own plugins, hooks, MCP servers or tool lists, which the Cursor engine cannot keep to it: it cannot tell a subagent's tool call from the main agent's. Run this agent on the native engine, or remove them from 'release-notes'.
```

For the same reason it refuses a turn whose plugin subagent carries tool lists
of its own, a hook on the Cursor engine is not told which subagent made a call,
and the Cursor engine refuses a turn whose main agent limits `Agent` to types,
since it cannot hold back its own built-in subagents. A bare `Agent`, or `Agent`
excluded, runs there.

A subagent the Cursor engine runs works inside the main agent's session: it has
the main agent's tools, the platform's channel, conversation and memory tools
included, under the main agent's tool lists and hooks, and its own `env` values
do not reach it. Run an agent whose subagents need their own values, or must not
reach the platform's tools, on the native engine.

## Writing Descriptions

The main agent decides when to hand work over from each subagent's name and
description. A description that says what work the agent takes on routes well:

```yaml
# Good — clear about what the agent takes on
description: "Writes release notes from the pull requests merged since a tag"

# Poor — too vague for the main agent to route
description: "Handles release stuff"
```

The main agent's `instructions` can say when to hand work over:

```yaml
instructions: |
  You coordinate engineering work. Hand release notes to the release-notes
  subagent and security reviews to the security-review subagent. Handle
  everything else yourself.
```

## Subagents Written Inside an Agent

An agent once carried subagents written inside it, under `sub_agents`, each
narrowing the agent's own tools. That field is gone. `stigmer apply` and
`stigmer validate` refuse a manifest that still uses it:

```text
A subagent is now a saved agent: write each subagent as an Agent of its own, then list it under the agent's `subagents` (`- kind: agent` with `slug: <its slug>`).
```

To move one, write it as an Agent: its `name` as `metadata.name`, its
`description`, `instructions` and `skill_refs`. Give it the plugins and `env`
declarations whose tools and keys it used, since it no longer borrows the
parent's, and its tool lists over the parent's. A `model_override` becomes
`run_config.model_name` with `harness: HARNESS_NATIVE`. Apply it, then list it
in the parent's `subagents`.

A local install that held such subagents removes them when it upgrades. Each
one is written to the server's log as a ready-to-apply Agent manifest that runs
as the subagent ran, together with the `subagents` entry to add to its parent.
