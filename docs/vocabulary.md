# Stigmer vocabulary guide

This is the single source of truth for all Stigmer terminology. Every
customer-facing artifact---sales site, documentation, README, tooltips, error
messages, conference talks---draws its terms and definitions from this document.

**status**: draft, pending review **Created**: 2026-03-31

## How to use this guide

- **Writing copy?** Check the [quick-reference table](#quick-reference) first.
  Find the term, read across to your context column, use that phrasing.
- **Need a definition?** Each term has a one-sentence plain-language definition
  in its [detailed entry](#tier-1--core-product-concepts).
- **Updating glossary.ts?** Copy the definition from the detailed entry. This
  file is the source; `glossary.ts` is a derived artifact.
- **Found an inconsistency?** Add it to the
  [inconsistency register](#inconsistency-register) with file paths and a
  recommended resolution.

### Other files that reference this guide

These files previously contained their own terminology sections. Those sections
have been replaced with pointers to this document:

- `docs/STYLE.md`---capitalization and formatting rules for terms
- `.agents/skills/docs-writing/SKILL.md`---the writing doctrine coding agents
  load; it points here for every term and register
- `site/src/components/docs/glossary.ts`---runtime tooltip definitions (keeps
  inline data for performance, but must match this file)

---

## Writing contexts

Five contexts, each with its own register. When the quick-reference table says
"use X in context Y," this section explains why.

| Context                    | Audience                                   | Register                                                                           | Example                                                                         |
| -------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Sales site**             | Technical founders choosing infrastructure | Business-outcome language. No jargon. Lead with what they gain.                    | "Teach your Agent your domain."                                                 |
| **Quickstart / tutorials** | Developers following steps                 | Action-oriented. Introduce Stigmer terms with a plain-language gloss on first use. | "Create a Skill (a piece of domain knowledge your Agent can use)."              |
| **Concepts / how-to**      | Developers building understanding          | Explanatory. Use Stigmer terms as proper nouns. Analogies welcome.                 | "A Skill is like a training manual for your Agent."                             |
| **Reference / SDK**        | Developers looking up specifics            | Precise. Use API field names. Assume familiarity with the platform.                | "`spec.skill_refs`---list of Skill IDs attached to this Agent."                 |
| **README / GitHub**        | Developers evaluating Stigmer              | Developer-direct. CLI-first. Technical credibility.                                | "Versioned knowledge artifacts. A Skill is a directory with a `SKILL.md` file." |

**Rule of thumb**: move left in the table for simpler language, move right for
more precise language. Never use a right-column term in a left-column context.

---

## Quick reference

Scan this table to find the right word for your context. Detailed entries with
definitions, API names, and examples follow below.

| Term              | Sales site       | Quickstart / tutorial                  | Concepts / how-to   | Reference / SDK                        | README         |
| ----------------- | ---------------- | -------------------------------------- | ------------------- | -------------------------------------- | -------------- |
| **Agent**         | Agent            | Agent                                  | Agent               | Agent, `kind: Agent`                   | Agent          |
| **Skill**         | domain knowledge | Skill ("domain knowledge")             | Skill               | Skill, `skill_refs`                    | Skill          |
| **Plugin**        | plugin           | plugin ("what you install")            | Plugin              | Plugin, `kind: Plugin`                 | plugin         |
| **Marketplace**   | marketplace      | Marketplace ("where you install from") | Marketplace         | Marketplace; source, `stigmer install` | marketplace    |
| **MCP Server**    | tools            | MCP server ("tool connection")         | MCP Server          | McpServer, `mcp_server_usages`         | MCP server     |
| **Session**       | conversation     | Session ("conversation")               | Session             | Session, `kind: Session`               | Session        |
| **Runner**        | compute          | runner ("where your Agent runs")       | Runner              | Runner                                 | runner         |
| **Harness**       | execution engine | harness ("execution engine")           | Harness             | Harness, `SessionSpec.harness`         | harness        |
| **Approval flow** | approval flow    | approval flow                          | approval flow, HITL | `destructive_hint`, `submitApproval`   | HITL, approval |
| **Organization**  | Organization     | Organization                           | Organization        | Organization, `kind: organization`     | Organization   |
| **Team**          | teams            | ---                                    | Team                | Team, `kind: team`                     | Team           |
| **Vault**         | vault            | vault ("your keys and logins")         | Vault               | Vault, `kind: Vault`                   | vault          |
| **Preference**    | preferences      | preference ("standing context")        | Preference          | `spec.preferences.standing_context`    | Preference     |

<!-- vale Stigmer.terms = NO -->

| **Identity Provider** | --- | identity provider | Identity Provider |
IdentityProvider, `kind: identity_provider` | Identity Provider |

<!-- vale Stigmer.terms = YES -->

| **Identity Account** | --- | --- | Identity Account | IdentityAccount,
`kind: identity_account` | Identity Account | | **PlatformClient** | --- | --- |
PlatformClient | PlatformClient, `kind: platform_client` | PlatformClient | |
**Run** | --- | run | run | Run, `kind: Run` | Run | | **Sub-Agent** | --- | ---
| Sub-Agent | SubAgent, `sub_agents` | Sub-Agent | | **Agent Channel** | --- |
--- | channel, Agent Channel | AgentChannel, `kind: AgentChannel` | Agent
Channel | | **Channel App** | --- | --- | Channel App | ChannelApp,
`kind: ChannelApp` | Channel App | | **Schedule** | --- | --- | schedule,
Schedule | Schedule, `kind: Schedule` | Schedule |

Dash (—) means the term should not appear in that context.

---

## Term entries

### Tier 1---Core product concepts

These are the terms users encounter first. The gap between internal name and
user-facing language is widest here. Get these right and the rest follows.

---

#### Agent

A reusable definition of what an AI assistant knows and can do.

- **User-facing alternative**: None needed. "Agent" is understood by both
  founders and developers. The word does not require translation across
  contexts.
- **Capitalize**: Yes, when referring to the Stigmer resource. Lowercase when
  used generically ("AI agents are becoming common").
- **API surface**: `kind: Agent`, `apiVersion: agentic.stigmer.ai/v1`. proto:
  `agent/v1/spec.proto`, `agent/v1/api.proto`. CLI:
  `stigmer apply -f agent.yaml`, `stigmer run <name>`,
  `stigmer get agent <name>`, `stigmer list agent`.
- **YAML fields**: `spec.instructions`, `spec.mcp_server_usages` (repeated
  `McpServerUsage` entries, each containing `mcp_server_ref`).

**Good examples**:

| Context    | Copy                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Sales site | "Build agents that work for your business."                                                                                                |
| Quickstart | "Create a file called `agent.yaml`. This file defines your Agent---what it knows, which tools it can use, and how it behaves."             |
| Concepts   | "An Agent is a reusable definition. You define it once. Any application can call it via API."                                              |
| Reference  | "`Agent`---a managed resource representing an AI Agent definition. Applied via `stigmer apply` or the `AgentCommandController.apply` RPC." |

**Bad examples**:

| Context    | Copy                                                    | Problem                                                    |
| ---------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| Sales site | "Define an Agent resource with YAML."                   | Technical language in a business context.                  |
| Quickstart | "The Agent abstraction encapsulates LLM orchestration." | Jargon. The reader just wants to create their first Agent. |

---

#### Skill

A piece of knowledge you attach to an Agent so it has domain expertise.

- **User-facing alternative**: "domain knowledge" on the sales site and in
  introductory copy. Once the reader knows what a Skill is, use the canonical
  name.
- **Capitalize**: Yes, when referring to the Stigmer resource.
- **API surface**: `kind: Skill`, prefix `skl`. proto: `skill/v1/spec.proto`,
  `skill/v1/command.proto`. CLI: `stigmer push` (push Skill from current
  directory).
- **YAML/file structure**: A Skill is a directory containing a `SKILL.md` file
  with YAML frontmatter. proto fields: `skill_md`, `name`, `description`, `tag`.
  Referenced on Agents and Sessions via `skill_refs`.

**Good examples**:

| Context    | Copy                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sales site | "Teach your Agent what generic AI doesn't know---your return policy, your product catalog, your escalation process."                             |
| Quickstart | "Create a Skill---a piece of domain knowledge your Agent can use. A Skill is a directory with a `SKILL.md` file."                                |
| Concepts   | "A Skill is like a training manual for your Agent. Without it, the Agent gives generic answers. With it, the Agent gives domain-expert answers." |
| Reference  | "`Skill`---a versioned knowledge artifact attached to Agents via `skill_refs`. Pushed via `stigmer push` or `SkillCommandController.push`."      |

**Bad examples**:

| Context    | Copy                                         | Problem                                                             |
| ---------- | -------------------------------------------- | ------------------------------------------------------------------- |
| Sales site | "Create a Skill with YAML frontmatter."      | The audience doesn't know what frontmatter is and doesn't need to.  |
| Sales site | "Upload your knowledge artifacts."           | "Knowledge artifacts" is internal language. Say "domain knowledge." |
| Quickstart | "Configure the RAG pipeline for your Skill." | Stigmer Skills are not RAG. This is a positioning violation.        |

---

#### Plugin

A package you install to add capabilities to your Organization: skills, MCP
servers, and the agent that uses them, as one unit. A plugin is what you
install; it installs an agent, tools for your agents, or both (a plugin that is
only MCP servers installs its servers and no agent of its own).

- **User-facing alternative**: none needed. "Plugin" is the word the Cursor,
  Claude Code and Codex communities already use for the same package, and
  Stigmer reads their plugins unchanged.
- **Capitalize**: Yes, when referring to the Stigmer resource ("the Plugin
  kind"); lowercase for the package in the wild ("install a plugin").
- **API surface**: `kind: Plugin`, prefix `plg`. proto: `plugin/v1/spec.proto`,
  `plugin/v1/command.proto`. CLI: `stigmer push plugin <dir>` (install or
  upgrade), `stigmer get|list|delete plugin`, `stigmer validate -f <dir>`
  (offline check). Console: Library > Plugins lists what is installed and offers
  the two ways in: "Browse Marketplace" opens the Marketplace page, and "Upload
  plugin" installs a folder or a `.zip` from your computer (the console's
  `stigmer push plugin`); a plugin's page is where an install ends: it shows
  what it installed, says per MCP server what stands before its first tool call
  ("Sign in", "Signed in", the variables it needs, or nothing), starts a session
  on its agent, lists its hooks with every command each runs beside the ones
  Stigmer does not run, and offers "Add to an agent" for a plugin with tools and
  no agent or with hooks; "Remove" is the console's word for `delete plugin`. A
  plugin is never authored as YAML: its spec is read from the package manifest.
- **File structure**: A plugin is a directory holding a manifest (`plugin.json`,
  `.cursor-plugin/plugin.json`, `.claude-plugin/plugin.json` or
  `.codex-plugin/plugin.json`), `skills/`, `mcp.json`, `agents/`, `hooks/`, and
  Stigmer's own `ai.stigmer/` overlay. Installing it materializes ordinary
  Skills, MCP Servers and an Agent, each labelled with the plugin's id; those
  resources are the plugin's to redefine, so you change the plugin and push it
  again rather than editing them, or compose your own Agent over them.
- **What it is not**: a plugin does not run on its own. The Agent it installs
  runs, in a Session, on a Runner, exactly like an Agent you wrote by hand; the
  plugin's hooks run within the tool calls of each Agent that names the plugin.

**Good examples**:

| Context    | Copy                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Sales site | "Bring your Cursor, Claude or Codex plugin. Install it on Stigmer and run it remotely."                                             |
| Quickstart | "Install a plugin---a folder of skills and tools---and you get an agent you can talk to."                                           |
| Concepts   | "A plugin is a toolbox. An agent is the worker who picks it up. Installing the toolbox gives you a worker who knows how to use it." |
| Reference  | "`Plugin`---the unit of install. `PluginCommandController.push` materializes its members; `listMembers` lists them."                |

**Bad examples**:

| Context    | Copy                                      | Problem                                                              |
| ---------- | ----------------------------------------- | -------------------------------------------------------------------- |
| Quickstart | "Run the plugin."                         | Plugins do not run; the agent it installed does.                     |
| Concepts   | "Edit the plugin's skill in the console." | Members are the plugin's to redefine; the console shows the refusal. |
| Reference  | "Apply the plugin YAML."                  | A plugin has no YAML; it is pushed as its folder.                    |

---

#### Marketplace

Where you find and install plugins. In the console it is the Marketplace page:
the sources first as chips, one search box, one grid of cards across the chosen
sources with Install on each, and an Upload a plugin tile. In the CLI it is
`stigmer install <name>`. What the Marketplace shows comes from its **sources**:
catalogues the client reads, each a directory tree with a marketplace file at
its root listing the plugins it offers as a name and a folder. One source is
built in, Stigmer's official catalogue (`stigmer`), published with each release
and curated: every plugin in it is one Stigmer may ship and one whose tools
Stigmer can connect to. You add your own catalogue by pointing at a GitHub
repository; a vendor's public catalogue can be added the same way but is never
on offer by default.

- **User-facing alternative**: none needed. "Marketplace" is the word Cursor,
  Claude Code and Codex use for the same place, and Stigmer reads their
  catalogue format unchanged. Say "source" for one catalogue the Marketplace
  reads; never "a marketplace" for a source, and never "marketplace" for the
  tree format alone. Say "the official catalogue" for the built-in source, and
  "your own catalogue" for one the user adds; never present a vendor's
  repository as a place to browse.
- **Capitalize**: "the Marketplace" for the console page; lowercase for the
  concept ("install from the marketplace") and for a source ("the official
  catalogue", "your own catalogue"). A source is named by the name it is listed
  under (`stigmer`, `acme-plugins`). A marketplace is not a Stigmer resource.
- **API surface**: none on the server; the sources are client-side (the built-in
  one is code in both clients; added ones live in `marketplaces` in
  `~/.stigmer/config.yaml` for the CLI and in this browser's storage for the
  console), and the server only ever receives the plugin archive a client pushes
  from one. CLI: `stigmer marketplace add|list|show|remove` manages sources;
  `stigmer install [source/]name[@version]` installs. Console: the Marketplace
  entry in the sidebar; "Manage sources", beside the chips, lists the sources
  and, under "Add your own catalogue", adds or removes your own. Nothing is
  installed from a source unasked.
- **File structure**: a source's marketplace file is in one of four locations,
  read in this precedence: `marketplace.json` (Stigmer's own),
  `.claude-plugin/marketplace.json`, `.cursor-plugin/marketplace.json`,
  `.agents/plugins/marketplace.json`. Each entry is a `name` and a `source`
  naming a folder in the tree. A field that names entries to install unasked
  (Codex's `INSTALLED_BY_DEFAULT`, the `defaults` list of older Stigmer files)
  is read past.
- **What it is not**: the Marketplace does not know where an installed plugin
  came from. Nothing on the server records the source, so installing `thermos`
  from a second source upgrades the `thermos` from the first: a plugin is
  identified by its name in your Organization, and the install preview names the
  installed plugin an upgrade replaces. The Marketplace is also the only way
  another Organization's work reaches yours: the Library shows your
  Organization's resources, and what you want from elsewhere you install as a
  plugin and own.

**Good examples**:

| Context    | Copy                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| Quickstart | "Open the Marketplace, find a plugin, choose Install."                                                                      |
| Quickstart | "Linear, Notion and the rest are already there; install any of them by name."                                               |
| How-to     | "`stigmer install linear`; to install from your own catalogue, `stigmer marketplace add owner/repo` first."                 |
| Reference  | "A source is a directory tree with a marketplace file at its root; `stigmer marketplace show <name>` lists what it offers." |

**Bad examples**:

| Context    | Copy                                        | Problem                                                                                                   |
| ---------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Quickstart | "Publish your plugin to the Marketplace."   | There is no publish step; a plugin reaches the Marketplace through a source's catalogue.                  |
| How-to     | "Add a marketplace, then install from it."  | You add a source; the Marketplace is the one place you install from.                                      |
| Quickstart | "Browse Cursor's catalogue from the chips." | The vendors' repositories are not on offer; the official catalogue carries what Stigmer can ship of them. |
| Reference  | "`kind: Marketplace`"                       | A marketplace is not a resource; the server never sees one.                                               |

---

#### MCP Server

An external tool connection that lets an Agent interact with other systems.

- **User-facing alternative**: "tools" or "tool access" on the sales site. "Tool
  connection" in introductory docs. Use "MCP server" (lowercase "s") in
  tutorials after first mention. Use "MCP Server" (capitalized) in concept pages
  and reference docs.
- **Capitalize**: Yes, when referring to the Stigmer resource. "MCP server"
  (lowercase "server") is acceptable in casual tutorial prose after the concept
  has been introduced.
- **API surface**: `kind: McpServer`, prefix `mcp`. proto:
  `mcpserver/v1/spec.proto`, `mcpserver/v1/command.proto`. CLI:
  `stigmer mcp-server` (start the Stigmer MCP server),
  `stigmer apply -f mcpserver.yaml`, `stigmer get mcp-server <name>`.
- **YAML fields**: `spec.stdio_server_config`, `spec.http_server_config`,
  `status.discovered_capabilities.tools[].destructive_hint` (recorded by Connect
  from the tool's MCP `destructiveHint` annotation). Agent references via:
  `spec.mcp_server_usages` (repeated `McpServerUsage` entries with
  `mcp_server_ref`); the Agent narrows a server's tools with `spec.tools` and
  `spec.disallowed_tools` (`mcp__<server-slug>`, `mcp__<server-slug>__<tool>`).
- **Protocol**: MCP stands for Model Context Protocol, an open standard. Spell
  out on first use in any context. Link to `https://modelcontextprotocol.io` in
  docs.

**Good examples**:

| Context    | Copy                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sales site | "Connect your Agent to your systems. It checks inventory, creates tickets, updates records---with the same APIs your team already uses."                                             |
| Quickstart | "Give your Agent tools by adding an MCP server---a connection to an external system like GitHub, a database, or a file store."                                                       |
| Concepts   | "An MCP Server is a bridge between your Agent and an external system. The Agent discovers what tools are available, and Stigmer handles input validation and execution sandboxing."  |
| Reference  | "`McpServer`---a managed resource defining an MCP server connection. Supports `stdio` and `http` transport. Tools are discovered via the MCP protocol when the server is connected." |

**Bad examples**:

| Context    | Copy                                             | Problem                                                                                                                |
| ---------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Sales site | "Configure MCP servers for tool integration."    | Technical jargon. Say "connect your tools."                                                                            |
| Quickstart | "Set up the McpServerUsage with mcp_server_ref." | proto message names in a tutorial. Say "add an MCP server to your Agent." Show the YAML by example, not by field name. |

---

#### Session

An ongoing conversation with an Agent across multiple messages.

- **User-facing alternative**: "conversation" on the sales site and in
  introductory copy. The platform name is "Session"---use it once the reader is
  past the first encounter.
- **Capitalize**: Yes, when referring to the Stigmer resource.
- **API surface**: `kind: Session`, prefix `ses`. proto: `session/v1/api.proto`,
  `session/v1/spec.proto`.
- **Key fields**: `agent_ref` (the Agent the conversation runs; empty for the
  built-in assistant), `status.agent_version_hash` (the Agent version the
  conversation runs until someone updates it), `thread_id` (persists across
  runs), `subject` (display title), `workspace_entries`, `sandbox_id`. Sessions
  can add `mcp_server_usages` and `skill_refs` to the Agent's; the Agent's tool
  lists still govern every tool.
- **Related terms**: A Session contains multiple runs. Each message exchange
  within a Session is one run. The proto also uses `MessageType` (HUMAN, AI,
  TOOL, SYSTEM) for individual messages.

**Good examples**:

| Context    | Copy                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sales site | "Your Agent remembers the conversation. Ask a follow-up question tomorrow---it picks up where you left off."                                                            |
| Quickstart | "Start a Session---an ongoing conversation where your Agent remembers what was said."                                                                                   |
| Concepts   | "A Session is a container for a multi-turn conversation. It holds the message history, attached Skills, and tool connections for that conversation."                    |
| Reference  | "`Session`---a multi-turn conversation container. Persists message history via `thread_id`. Merges Agent-level and Session-level `skill_refs` and `mcp_server_usages`." |

**Bad examples**:

| Context    | Copy                                                          | Problem                                                                       |
| ---------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Sales site | "Create a Session resource to enable multi-turn interaction." | Resource-model language in a business context.                                |
| Quickstart | "Configure the `thread_id` for Session persistence."          | Implementation detail. The quickstart should just say "start a conversation." |

---

#### Runner

A process that connects to Stigmer and executes your Agents.

- **User-facing alternative**: "compute" on the sales site. In quickstart
  guides, use "runner" with a gloss: "a runner (the process that runs your
  Agent)." In concepts and reference, "Runner" stands alone.
- **Capitalize**: Yes, when referring to the Stigmer concept. Lowercase "runner"
  when used generically ("start a runner").
- **Not an API resource**: A Runner is a runtime process, not a declarative
  resource---there is no `kind: Runner`, no `apiVersion`, and no
  `stigmer apply`. The server keeps no record of which runners exist and the web
  console has no runner page. You start one with `stigmer up` (and stop it with
  `stigmer down`); the Docker Compose stack and the Helm chart each run one
  beside the server. (The Runner API resource that once existed, with its
  phases, heartbeats and runner picker, was removed from the OSS repo.)
- **How work reaches it**: The server puts each run on a Temporal task queue
  (`stigmer_runner` by default) and whichever runner polls that queue takes the
  work. Nothing selects a runner; the queue is the contract. A run carries the
  Session's Harness and a credential minted for that run alone. See the
  [Runners concept page](/docs/concepts/runners).
- **Two postures**: One shared runner (the laptop, the all-in-one, Compose, the
  chart) or a runner per Session started by the server's sandbox provisioner
  (Stigmer Cloud; described, not taught, on the
  [self-hosting runner page](/docs/guides/self-hosting/runners)).
- **Related terms**: Do not confuse with "Agent Runner" (the TypeScript Temporal
  worker binary---architecture docs only).

**Good examples**:

| Context    | Copy                                                                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sales site | "Run Agents on your machine or let the platform handle it."                                                                                                                 |
| Quickstart | "Start a runner---the process that runs your Agent on your machine."                                                                                                        |
| Concepts   | "A Runner is the process that picks up runs, calls the LLM, runs tools, and reports results back to the server."                                                            |
| Reference  | "The runner polls the `stigmer_runner` task queue; set `STIGMER_TASK_QUEUE` on the runner and `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE` on the server to the same name." |

**Bad examples**:

| Context    | Copy                                                                 | Problem                                                                   |
| ---------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Sales site | "Provision a Runner resource to execute Agent workloads."            | Resource-model language in a business context.                            |
| Quickstart | "The Agent Runner connects via bidirectional gRPC every 30 seconds." | Internal architecture detail. The quickstart should say "start a runner." |

---

#### Harness

The execution engine that processes agent activities for a Session.

- **User-facing alternative**: "execution engine" on the sales site and in
  introductory copy. Once the reader knows what a Harness is, use the canonical
  name.
- **Capitalize**: Yes, when referring to the Stigmer concept.
- **API surface**: `SessionSpec.harness`, enum `Harness` (values: `NATIVE`,
  `CURSOR`). proto: `session/v1/spec.proto`.
- **Two values**:
  1. **Native** --- Stigmer's built-in engine. Default for all Sessions. Full
     control over model selection from all supported providers. Deep integration
     with Stigmer's checkpoint, pause/resume, and sandbox features.
  2. **Cursor** --- Uses the Cursor SDK as the execution engine. Access to
     Cursor-specific models and tooling. Ideal for developer-facing agents that
     need code-level capabilities.
- **Immutability**: A Session's Harness cannot change after the first run
  starts. It determines which models are available and which runtime processes
  the agent's turns.
- **Related terms**: Sessions bind to a Harness via `SessionSpec.harness`.
  Runners host workers for each Harness type on separate task queues.

**Good examples**:

| Context    | Copy                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sales site | "Choose an execution engine that fits your workload---Stigmer's built-in engine or Cursor for coding-focused capabilities."                           |
| Quickstart | "Pick a harness---the execution engine that powers your Agent's Session."                                                                             |
| Concepts   | "A Harness determines which runtime processes your Agent's turns. Stigmer supports two: Native and Cursor."                                           |
| Reference  | "`Harness`---enum on `SessionSpec`. `HARNESS_NATIVE` for the built-in engine, `HARNESS_CURSOR` for the Cursor SDK engine. Immutable after first run." |

**Bad examples**:

| Context    | Copy                                                    | Problem                                                            |
| ---------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| Sales site | "Configure the SessionSpec.harness field."              | API-level detail in a business context.                            |
| Quickstart | "The Cursor harness uses a TypeScript Temporal worker." | Internal architecture. The quickstart should say "pick a harness." |

---

#### Approval flow (Human-in-the-Loop)

A mechanism where an Agent pauses and waits for a human to approve or reject an
action before proceeding.

- **User-facing alternative**: "approval flow" everywhere except internal code
  and reference docs. Never use "HITL" in any customer-facing context---it is an
  internal acronym.
- **Capitalize**: No. "Approval flow" is a description of behavior, not a named
  Stigmer resource kind. Capitalize "Human-in-the-Loop" when used as a feature
  name in marketing.
- **API surface**: There is no single `ApprovalFlow` resource. Approval is
  tool-call approval, by default not configured: Stigmer asks before shell
  commands, file writes and deletes, and MCP tools whose server marks them
  destructive (`destructive_hint`). An Agent's hooks (`hooks`) decide call by
  call: refuse, ask, or allow. Its `tools` and `disallowed_tools` lists decide
  which tools it has at all. Submitted via
  `RunCommandController.submitApproval`. Statuses: `TOOL_CALL_WAITING_APPROVAL`,
  `TOOL_CALL_SKIPPED`. Actions: `APPROVE`, `SKIP`, `REJECT`.

**Good examples**:

| Context    | Copy                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sales site | "Your Agent handles routine requests on its own. For anything risky, it asks a human first. You decide which tools it can use."                                                                                          |
| Quickstart | "Your Agent asks before risky actions---shell commands, file changes, and any tool its server marks destructive."                                                                                                        |
| Concepts   | "An approval flow is a checkpoint. The Agent pauses, presents what it wants to do and why, and waits for a human to approve or reject. The Agent's run is durable---it waits indefinitely without losing state."         |
| Reference  | "Tool-call approval is required for shell commands, file writes and deletes, and MCP tools with `destructive_hint`. `auto_approve_all` resolves every approval for one run; `tools` and `disallowed_tools` still apply." |

**Bad examples**:

| Context    | Copy                                    | Problem                                                                    |
| ---------- | --------------------------------------- | -------------------------------------------------------------------------- |
| Sales site | "Enable HITL for sensitive operations." | "HITL" is internal jargon.                                                 |
| Quickstart | "Set `destructive_hint` on the tool."   | API-level detail in a tutorial. Say "the server marks the tool risky."     |
| Any        | "Set up human-in-the-loop."             | Hyphenated compound used as an instruction. Prefer "add an approval flow." |

---

#### Hook

A command that runs around an Agent's tool calls, in Claude Code's or Cursor's
hooks format. Before a call it can refuse it, ask a person first, or let it run
without the approval it would otherwise need; after a call it can tell the Agent
something about the result. A plugin brings hooks, or an Agent carries a block
written in it.

- **User-facing alternative**: none needed. "Hook" is the word Claude Code and
  Cursor use, and Stigmer runs their plugins' hooks unchanged.
- **Capitalize**: No. A hook is part of a plugin or an Agent, not a Stigmer
  resource kind: "the plugin's hooks", "switch the hooks on for an Agent".
- **API surface**: `AgentSpec.hooks` (a plugin reference or an inline block),
  `PluginStatus.hooks` (what a plugin recorded at install), `HookConfig` in
  `plugin/v1/hooks.proto`. Console: the plugin's page and the Agent's page list
  every hook with the command it runs; "Add to an agent" switches a plugin's
  hooks on. Approvals a hook decides read "decided by the agent's hook" or
  "decided by the `<plugin>` plugin's hook".
- **What it is not**: a webhook, or a React hook in the SDK. Stigmer runs
  command hooks on tool calls only; a plugin's hooks on other events are listed
  as not run.

**Good examples**:

| Context  | Copy                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------- |
| How-to   | "Switch the plugin's hooks on for your Agent, and they run on every tool call they match."            |
| Concepts | "A hook can refuse a tool call, ask you first, or let it run. A refusal holds even in a trusted run." |

**Bad examples**:

| Context    | Copy                          | Problem                                                              |
| ---------- | ----------------------------- | -------------------------------------------------------------------- |
| Sales site | "Configure PreToolUse hooks." | An event name is reference detail. Say "a check before a tool runs." |
| Any        | "Create a Hook resource."     | There is no Hook kind; hooks live in a plugin or an Agent.           |

---

### Tier 2---Platform structure

These terms describe how the platform is organized. The user-facing and internal
names are usually the same---the main concern is consistent capitalization and
clear definitions.

---

#### Organization

The boundary that holds people, Agents, Sessions and secrets together; nothing
outside it sees them.

- **Capitalize**: Yes, when referring to the Stigmer concept.
- **API surface**: `kind: organization`, prefix `org`. proto:
  `tenancy/organization/v1/spec.proto`. CLI: `--org` flag, the `STIGMER_ORG`
  environment variable and the `context.org` config key. In every field name an
  Organization is `org`: `org` for the one a message is about (`metadata.org`,
  `GetCreditBalanceInput.org`), `<role>_org` for a second one in the same
  message (`ProviderKey.inherited_from_org`), `orgs` for a list
  (`CursorAccount.orgs`), `org_<attribute>` for something that describes one
  (`InvitationPreview.org_name`), `orgs` in a count (`max_orgs`), and `org` in a
  per-organization amount (`per_extra_org_micros`). RPCs and requests that
  filter by one say `Org` (`listByOrg`, `getForOrg`). The kind itself, and the
  messages and RPCs that return it, keep the full word (`Organization`,
  `findMyOrganizations`), as `Agent` does.
- **Identity**: a permanent id, `org_` and a ULID, minted when the Organization
  is made; every resource names its Organization by it in `metadata.org`. The
  slug is the name people type, unique across the server and changed only by
  `rename`. A request may name an Organization by either; responses carry the
  id, and clients show the slug.
- **Key fields**: `description`, `logo_url`, `preferences`, and the
  child-organization fields `parent_org` and `external_id` (see
  [Parent organization, child organization](#parent-organization-child-organization)).
- **Note**: Every edition has Organizations. Open source holds one: its server
  makes it the first time it starts, `stigmer`, fills it into every request that
  names none, refuses a second one and refuses to delete it, so a user never
  names it, and the console and the CLI never show it
  (`GetServerInfoOutput.single_org`). Enterprise and Stigmer Cloud hold many,
  and a request names its Organization; `stigmer config context set --org`
  points the CLI at one. Signing up for Stigmer Cloud creates an ordinary
  Organization that the new person owns.
- **Context rule**: `org` in identifiers, "Organization" in prose. Never call it
  a tenant, and never a Workspace, which is a Session's files. In docs for open
  source, do not make a reader name or create one. "System Organization" is a
  retired phrase from when default content was installed into it.

---

#### Purge

The background removal of everything a deleted Organization owned, after its
delete has answered.

- **User-facing words**: say "deleting" while it runs and "deleted" once it is
  done ("Acme is being deleted"). "Purge" is the operator's and the developer's
  word, for docs that explain what happens behind a delete.
- **What it is**: deleting an Organization answers at once, and from then on the
  Organization answers "not found" to everyone. The purge stops what is still
  running, removes every resource the Organization owned, destroys its keys
  where the edition keeps keys per Organization, and frees its slug last.
- **What it is not**: a restore window. Nothing a purge removes comes back.

---

#### "Platform" (the word)

"Platform" has meant several things in the API and docs. Use it for one of them
only.

- **Use it for**: the Stigmer platform as a whole ("the Stigmer platform"), and
  inside names that already carry it: `PlatformClient`, the `platform/v1`
  package, the `platform` authorization scope.
- **Say instead**:
  - a company that builds its product on Stigmer: an **integrator**;
  - Stigmer's own staff who run Stigmer Cloud: **Stigmer operators**;
  - the holder of a subscription or a license: the **customer**;
  - a messaging service such as Slack or WhatsApp: a **messaging service**, or
    its name.
- **Context rule**: If a sentence would still be true with "Stigmer" in place of
  "the platform", write "Stigmer".

---

#### "Tenant" (the word)

Stigmer has no concept called a tenant.

- **Say instead**:
  - one customer's isolated space inside Stigmer: an **Organization**;
  - the holder of a subscription or a license: the **customer**.
- **Keep it** only where an outside system names it: an Auth0 tenant, a
  Microsoft Entra tenant id, and the established terms single-tenant and
  multi-tenant for how a server is deployed.
- **Note**: One customer's Organization under an integrator's is a **child
  organization**, never a tenant organization; see
  [Parent organization, child organization](#parent-organization-child-organization).

---

#### Parent organization, child organization

An Organization that manages others is a **parent organization**; each of the
Organizations it manages is a **child organization**: for example, the
Organization an integrator runs for one of its customers.

- **Capitalize**: No; "Organization" keeps its capital when it stands alone.
  Write "child organization", "parent organization".
- **API surface**: `OrganizationSpec.parent_org` (the parent, on the child) and
  `OrganizationSpec.external_id`; `OrganizationQueryController.getByExternalId`
  and `listChildOrgs`; the permission `can_manage_child_orgs`; the share level
  `visibility_child_orgs` (the CLI and frontmatter spelling `child-orgs`); the
  Identity Provider's `external_id_claim`; the plan feature `child_orgs` and its
  limit `included_child_orgs`.
- **Note**: One level deep: a child has no children, and is never moved to
  another parent. `parent_org` and `external_id` are fixed at create. An
  Organization that still has children cannot be deleted. Nobody owns a child
  when it is created; its parent's admins manage it.
- **Context rule**: Use in concepts, how-to and reference. On the sales site,
  say "an organization for each of your customers". Never "platform-managed",
  "managed organization", "tenant organization" or "sub-organization".

---

#### External id

The identifier a parent organization keeps for one of its child organizations:
an integrator's own customer id (`cust-4411`).

- **Capitalize**: No.
- **API surface**: `OrganizationSpec.external_id`, unique among one parent's
  children; `getByExternalId(parent_org, external_id)`; an Identity Provider's
  `external_id_claim` names the JWT claim that carries it.
- **Context rule**: "external id" in prose, `external_id` in identifiers. Not
  "external org id" and not "tenant id".

---

#### Parent admin

An admin of a parent organization, as seen from one of its child organizations.

- **Capitalize**: No.
- **API surface**: the model relation `parent_admin` on the child
  (`fga/model/tenancy/organization.fga`), which feeds `can_view_settings`,
  `can_edit`, `can_delete`, `can_grant_access`, `can_view_access`,
  `can_assign_roles` and `can_view_billing`, and no role; and, from the child's
  invitations (`fga/model/iam/invitation.fga`), their `owner` and `viewer`.
- **Note**: A parent admin manages a child (settings, members, access, and the
  invitations that grant that access), sees its billing, and reads nothing else
  it holds. To look inside, they join the child as a member, which its member
  list and access history show; nothing impersonates a child's user.
- **Context rule**: Use in concepts and reference. In how-to, say "your
  Organization's admins" when the reader is the parent.

---

#### Vault

A person's or a team's box of the logins and secrets their runs use. Everyone
has their own **My vault**; an organization's admins create **shared vaults**
and decide who may use them.

- **Capitalize**: Yes, when referring to the Stigmer resource ("a Vault", "the
  Vault kind"). Lowercase "vault" is fine in prose once established ("save it in
  your vault"). "My vault" is the name of a person's own vault.
- **API surface**: `kind: Vault`, prefix `vlt`. proto: `vault/v1/spec.proto`.
  CLI: `stigmer vault`, `stigmer get vault`, `stigmer list vaults`.
- **Key fields**: `secrets` (by name), `connections` (by address),
  `external_id`. Values are write-only: no read returns one. Surfaces name
  vaults in an ordered `vaults` list; a Session also sets `include_my_vault` to
  use each sender's own My vault first. An Agent names no vaults.
- **Related terms**: a **secret** is a vault entry matched by its name
  (`OPENAI_API_KEY`). A **connection** (in the console, a **login**) is a vault
  entry matched by the address of the tool or Git host it is for
  (`https://mcp.linear.app/mcp`, `github.com`); a sign-in saves one. **Can use**
  is the grant that lets a person or a Team use a shared vault.
- **Note**: A run keeps no copy of its values. Its status records where each
  value lives (`credentials.sources`: a vault ID and an entry, never a value),
  and the runner fetches the values from those vaults when the run's work
  starts.

---

#### Environment

Reserved. Stigmer once had an Environment resource holding variables and
secrets; vaults replaced it. The word now names only the sandbox a run executes
in.

<!-- vale Stigmer.terms = NO -->

- **Capitalize**: Lowercase when used generically ("environment variables", "the
  run's environment").

<!-- vale Stigmer.terms = YES -->

- **Context rule**: Never name a place where keys are saved an "Environment":
  say vault. A manifest with `kind: Environment` is an old file.

---

#### Preference

A standing default or free-text context a user or Organization declares once,
applied to their runs automatically, and always overridable where a per-action
control exists.

- **Capitalize**: Yes, when referring to the Stigmer concept.
- **API surface**: not a resource kind — a spec message on existing kinds:
  `OrganizationSpec.preferences` (`OrganizationPreferences`) and
  `IdentityAccountSpec.preferences` (`IdentityAccountPreferences`), each with
  `standing_context`. The server snapshots the texts onto
  `RunStatus.declared_preferences` when the run is created.
- **Boundaries**: a Preference is not a **Skill** (Agent knowledge), not an
  **Vault** (logins and secrets), not a **Session** (conversation state), and
  not a **Memory** (a learned fact an agent proposed and you confirmed — a
  preference is something you declared yourself).
- **Related terms, never synonyms**: a **policy** is an org- or
  platform-authored constraint that _bounds_ what lower layers may choose
  (clamps, ceilings, allowlists) — a preference never binds anyone but its
  author. A **setting** is client-app device-local state (theme, sidebar width)
  — not an API concept. One term per concept, everywhere.

---

#### Memory

A single fact the platform remembers about a person: an agent proposes it during
a session, and it becomes active only after the person it is about confirms it.
Confirmed Memories are recalled into that person's future runs as background
context.

- **Capitalize**: Yes, when referring to the Stigmer concept. Lowercase when
  used generically ("memory usage").
- **API surface**: `kind: memory`, prefix `mem`. proto:
  `agentic/memory/v1/spec.proto`. System-generated — there is no `apply` and no
  manifest; records are managed from the console's Memory page.
- **Key fields**: `content` (the fact, verbatim, max 500 chars),
  `subject_identity_account_id` (who it is about — server-derived, never
  client-supplied), `provenance` (which agent/session proposed it), and
  `status.lifecycle_state` (`proposed` → `confirmed`/`rejected`).
- **Boundaries**: a Memory is not a **Preference** (you declare a preference
  yourself; an agent proposes a memory and you confirm it), not a **Skill**
  (Agent knowledge, not knowledge about a person), and not a **Session**
  (conversation state; a memory outlives every session).
- **Note**: memory content is subject-only — org admins govern whether memory
  operates in the org (`memory_enabled`), but never read members' memories. Both
  the org and the member must opt in; the switch defaults off at both scopes.

---

#### Identity Provider

An external trust relationship that tells Stigmer how to validate tokens from
your authentication system.

- **Capitalize**: Yes, when referring to the Stigmer resource.
- **API surface**: `kind: identity_provider`, prefix `idp`. proto:
  `iam/identityprovider/v1/spec.proto`.
- **Key fields**: `jwks_uri`, `allowed_issuers`, `expected_audience`,
  `is_sso_provider`, `oidc_client_id`, `create_accounts_on_sign_in`,
  `sign_in_role`, `external_id_claim`.
- **Context rule**: Do not use on the sales site. In quickstart, say "identity
  provider" in lowercase on first use with a brief gloss. In concepts and
  how-to, capitalize as "Identity Provider." In reference, use
  `IdentityProvider`.
- **Note**: An Identity Provider is not a user database---it defines how Stigmer
  validates externally issued JWTs. It is owned by an Organization and can route
  its users to that Organization's child organizations. Each token it vouches
  for is a **bound credential**: it works in the child organization
  `external_id_claim` names, or in the provider's own Organization.

---

#### Identity Account

A principal that Stigmer can authenticate and authorize. Comes in four types:
Direct (user signed up on Stigmer), Federated (created via an Identity
Provider), Platform (created via PlatformClient), and Machine
(service-to-service).

- **Capitalize**: Yes, when referring to the Stigmer resource.
- **API surface**: `kind: identity_account`, prefix `ida`. proto:
  `iam/identityaccount/v1/spec.proto`.
- **Key fields**: `provisioning_mode` (`direct`, `federated`, `platform_client`,
  `machine`), `identity_provider_ref`, `idp_id`.
- **Context rule**: Do not use on the sales site. In how-to and concept docs,
  capitalize as "Identity Account." In reference, use `IdentityAccount`. In
  quickstart, avoid unless the tutorial covers federation or PlatformClient.
- **Note**: Federated accounts can be provisioned via JIT (automatic on first
  token, when the Identity Provider sets `create_accounts_on_sign_in`) or
  explicitly via `createFederatedAccount`. Platform accounts are created by
  `mintUserToken` when the PlatformClient sets `create_accounts_on_sign_in`, or
  by the platform beforehand.

---

#### Identity federation

The pattern of letting users from an external authentication system access
Stigmer without creating Stigmer-native accounts.

- **Capitalize**: No. "Identity federation" is a pattern, not a Stigmer resource
  type. Do not capitalize "federation" unless it starts a sentence.
- **Related resources**: Identity Provider, Identity Account, IAM Policy.
- **Context rule**: Use in federation guides and concept pages. On the sales
  site, say "your users sign in with their existing credentials" without naming
  the mechanism. In quickstart, avoid unless the tutorial covers federation
  setup.

---

#### Bound credential

A credential that names one Organization and works in that Organization only,
whatever roles its person holds elsewhere.

- **Capitalize**: No. "Bound credential" is a property of a credential, not a
  Stigmer resource type.
- **Examples**: a PlatformClient user token (bound to the PlatformClient's
  Organization, or the child organization it was minted for), a federated token
  through an Identity Provider (bound to the child organization
  `external_id_claim` names, or the provider's own), an API key limited to an
  Organization (`ApiKeySpec.bound_org`), and the credential a runner holds for
  one run (bound to the run's Organization). A person signed in at the Stigmer
  Console with their own Stigmer sign-in is not bound and moves between all
  their Organizations.
- **Reach**: its Organization's resources; the person's own account, and their
  API keys limited to the same Organization; in a child organization, reading
  and running the Agents, Skills, MCP Servers and Plugins its parent shares at
  `visibility_child_orgs`; and, for a credential bound to a parent, managing
  that parent's child organizations (never reading what they hold). It cannot
  create an Organization, except a child of its own, or accept an invitation to
  another one. One exception: a platform operator's acts (credits, plans,
  pricing, licenses) follow the person's platform role, so their limited key
  still performs them.
- **Context rule**: Use in authentication guides and reference. On the sales
  site, say "a key that works in one Organization." In quickstart, avoid unless
  the tutorial covers API keys, federation or PlatformClient.
- **Note**: a bound credential used in another Organization gets
  `PERMISSION_DENIED`. A federated token whose external id claim is missing or
  names no child organization gets `UNAUTHENTICATED`, on every sign-in.

---

#### Team

A named group of an Organization's people that access is shared with as one.
Sharing an Agent, a Skill or another resource with a Team gives every member of
the Team that access; joining the Team grants it, and leaving the Team or the
Organization takes it away.

- **Capitalize**: Yes, when referring to the Stigmer resource. "Your team" in
  its everyday sense stays lowercase.
- **API surface**: `kind: team`, prefix `tm`. proto: `iam/team/v1/spec.proto`. A
  membership is an IAM Policy granting `member` on the Team; a share with a Team
  names it as `team:<id>#member`.
- **Key fields**: `description`. The members are the access list on the Team,
  not a field.
- **Editions**: Stigmer Enterprise and Cloud. The open-source edition shares
  resources with people and with the whole Organization.
- **Context rule**: On the sales site, say "share with your teams." In concepts
  and how-to, capitalize as "Team." In reference, use `Team`. In quickstart,
  avoid unless the tutorial covers access management.
- **Note**: A Team's members are always members of its Organization; removing
  someone from the Organization removes them from every Team at once. Slack
  calls a workspace a "team", so an Agent Channel's `status.slack.team_id` names
  a Slack workspace; it is never a Stigmer Team.

---

#### PlatformClient

An OAuth2 credential pair (`client_id` + `client_secret`) that lets your backend
mint Stigmer-signed user tokens for embedding Stigmer in your product.

- **Capitalize**: Yes, as one word: "PlatformClient." Do not split into
  "Platform Client" in prose---the API surface uses the compound form.
- **API surface**: `kind: platform_client`, prefix `pc`. proto:
  `iam/platformclient/v1/spec.proto`, `iam/platformclient/v1/token.proto`.
- **Key fields**: `client_id`, `client_secret_hash`,
  `create_accounts_on_sign_in`, `sign_in_role`, `allowed_origins`.
- **Context rule**: Do not use on the sales site---say "embed Stigmer in your
  app" or "add Stigmer to your product." In quickstart, avoid unless the
  tutorial covers PlatformClient setup. In concepts and how-to, capitalize as
  "PlatformClient." In reference, use `PlatformClient`.

<!-- vale Vale.Spelling = NO -->

- **Note**: PlatformClient credentials authenticate your backend, not your
  users. The backend calls `mintUserToken` to get user-scoped JWTs, each a
  **bound credential** that works in the PlatformClient's Organization only.
  This is the same pattern used by Twilio (Access Tokens), Stream (User Tokens),
  and Liveblocks (access tokens).

<!-- vale Vale.Spelling = YES -->

---

#### Cursor harness

The Cursor SDK-backed Harness that uses Cursor's agent runtime as the execution
engine.

- **Capitalize**: No special capitalization beyond "Cursor" (the product name).
  Write "Cursor harness" in lowercase "h" in prose.
- **Context rule**: Concepts and reference only. Do not use "Cursor harness" in
  sales copy---say "Cursor-powered execution" or "Cursor execution engine." In
  quickstart, refer to it as "the Cursor harness" after the Harness concept has
  been introduced.
- **Related terms**: Harness (the parent concept), cursor-runner (the Temporal
  worker that implements it, architecture only).

---

#### Run

One run of an Agent from start to finish: what a user starts when they send a
message, fire a schedule or open a share link.

- **Capitalize**: As the resource name in labels and reference pages
  (`kind: Run`, the console's "Run" page). In prose say "run" in lower case: the
  word is also a verb, so no style rule can capitalize it.
- **API surface**: `kind: Run`, id prefix `run` (`run_...`); a store that
  existed before the rename also holds runs whose ids start `aex_...`, and those
  ids keep working. proto: `run/v1/api.proto`. CLI:

  ```bash
  stigmer run <agent_name> "<prompt>"
  stigmer get run <id>
  stigmer runs logs <id>
  ```

- **Message types**: `HUMAN`, `AI`, `TOOL`, `SYSTEM` (from `run/v1/enum.proto`).
- **Phases**: `RUN_WAITING_FOR_APPROVAL` is a notable phase---the run pauses
  during an approval flow.
- **Two meanings**: the word "run" means two different things across Stigmer.
  Say which one when a page touches both.
  1. **A Stigmer run**---what a user starts: a run, with an id (`run_...`), a
     phase and a page in the console. This is the meaning everywhere in
     user-facing docs.
  2. **Temporal's run of a workflow**---one attempt of a Temporal workflow
     (`runId`). It appears only in engine code and engine operations pages,
     never in user-facing docs.
- **Engine words**: the engine underneath still says "execution": its logs, its
  Temporal task queues (`agent_execution_stigmer`) and operator settings such as
  `TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE` keep that word. Do not rename
  them in docs; say "run" for what the user started.
- **Former names**: `AgentExecution` (`kind: AgentExecution`), then `AgentRun`
  (`kind: AgentRun`, "Agent Run"). Do not use them in new writing.

---

#### Agent Channel

A connection that puts an Agent into an external messaging platform---Slack or
WhatsApp---so people can chat with it where they already work.

- **Capitalize**: Yes, when referring to the Stigmer resource. Lowercase
  "channel" is fine in prose once the concept is established ("connect a
  channel," "the channel card").
- **API surface**: `kind: AgentChannel`, prefix `ach`. proto:
  `agentchannel/v1/spec.proto`.
- **Key fields**: `agent_ref`, `enabled`, `slack` or `whatsapp` (provider
  config), `vaults`, `app_ref` (optional for Slack, required for WhatsApp).
- **Context rule**: On the sales site, say "connect your Agent to Slack" without
  naming the resource. In how-to docs, introduce as "channel" with a gloss, then
  use "channel." In reference, use `AgentChannel`.
- **Note**: Do not confuse with a Slack channel (a room inside a workspace). An
  Agent Channel connects an Agent to a whole workspace (Slack) or a Business
  phone number (WhatsApp); people then reach it from any conversation. Provider
  identity facts and credentials live in `status`, written by the install
  flow---applying a manifest never touches them.

---

#### Channel App

A customer-owned messaging-platform app (your own Slack app, or your Meta app
with WhatsApp Business access) that Agent Channels install through.

- **Capitalize**: Yes, two words: "Channel App."
- **API surface**: `kind: ChannelApp`, prefix `chapp`. proto:
  `channelapp/v1/spec.proto`.
- **Key fields**: `slack` (`client_id`, `client_secret`, `signing_secret`) or
  `whatsapp` (`app_id`, `app_secret`, `access_token`, `verify_token`); secrets
  are encrypted at rest and redacted in responses.
- **Context rule**: How-to and reference only. For Slack the user-facing phrase
  is "bring your own Slack app"; for WhatsApp it is "your Meta app" (the only
  install path---there is no shared platform app). Channel App is the resource
  that stores either.
- **Note**: Each app is its own bot identity. For Slack, a workspace hosts one
  Agent per app, so registering additional Channel Apps is also how several
  Agents serve the same workspace. For WhatsApp, a phone number serves one Agent
  per app.

---

#### Schedule

A recurring trigger that runs an Agent on a cron schedule---for example, sending
fee reminders every morning at nine.

- **Capitalize**: Yes, when referring to the Stigmer resource. Lowercase
  "schedule" is fine in prose once the concept is established ("the schedule
  fires," "disable the schedule").
- **API surface**: `kind: Schedule`, prefix `sch`. proto:
  `agentic/schedule/v1/spec.proto`. CLI: `stigmer get schedule`,
  `stigmer list schedule`.
- **Key fields**: `cron` (classic 5-field form, evaluated in `time_zone`),
  `time_zone` (IANA name), `enabled`, and the target (`agent` with `agent_ref`
  and `message`). Firing observations (`next_fire_at`, `consecutive_failures`,
  `paused_reason`) live in `status`, written only by the platform---applying a
  manifest never touches them.
- **Disabled vs. paused**: two words, two levers, two writers. A schedule is
  **disabled** when its owner sets `enabled: false` in the spec---the owner's
  switch, cleared by the owner editing the spec. A schedule is **paused** when
  the platform stops it after repeated failed runs and records why in
  `status.paused_reason`---the platform's latch, cleared only by the resume
  command (`stigmer schedule resume`). Never use "paused" for the owner's switch
  or "disabled" for the platform's latch.
- **Context rule**: How-to and reference only. In how-to docs, introduce as "run
  your Agent on a schedule," then use "schedule."
- **Note**: Do not confuse with a Temporal Schedule, the engine artifact the
  platform manages internally to do the firing. Docs and code comments always
  say "Temporal Schedule" for the engine artifact and "Schedule" (or
  `kind: Schedule`) for the user-facing resource; one Schedule resource is
  backed by one Temporal Schedule.

---

#### Score

One grade of a finished run: a person's thumbs up or down on the final answer,
the free run-health checks Stigmer runs on every completed run, an AI judge's
verdict, or a plugin eval's checks on one try.

- **Capitalize**: As the resource name in labels and reference pages
  (`kind: Score`). In prose say "score" in lower case, as "run".
- **API surface**: `kind: Score`, prefix `scr`. proto:
  `agentic/score/v1/spec.proto`. Written by a person rating a run in the
  console, by the platform's checks, by its AI judge or by a plugin eval; there
  is no `apply` and no manifest. CLI:

  ```bash
  stigmer runs scores <run-id>
  stigmer get score <id>
  ```

- **Key fields**: `run_id`, `metric` (what is measured: `feedback`,
  `run-health`, `judge` or `eval`), `source` (`score_source_human`,
  `score_source_check`, `score_source_judge` or `score_source_eval`), `passed`,
  `criteria` (one per check or rubric, each with its reason), `comment` (a
  person's feedback only), `judge_model` (a judge's only), and `status.state`
  (`graded`, `not_graded` with a reason, or `pending` while a judge grades).
- **Boundaries**: a Score is not a usage report (cost and tokens), and a
  not-graded score is never a failing one: it means the run could not be graded.
- **Note**: a score's visibility is its run's. Whoever can see the run sees its
  scores; nothing is shared on a score by itself.

---

#### Evaluator

AI grading switched on for one Agent: how many of its runs an AI judge grades,
the monthly spending limit, and the judge's model.

- **Capitalize**: As the resource name in labels and reference pages
  (`kind: Evaluator`). In prose say "AI grading" for what it does; "evaluator"
  in lower case for the setting itself.
- **API surface**: `kind: Evaluator`, prefix `evl`. proto:
  `agentic/evaluator/v1/spec.proto`. Set in the Agent's Quality tab in the
  console; there is no `apply` and no manifest, so an Agent's YAML never carries
  grading criteria. CLI:

  ```bash
  stigmer get evaluator <id>
  stigmer delete evaluator <id>
  ```

- **Key fields**: `agent_id`, `enabled`, `sample_rate` (0 to 1: 0.1 grades one
  run in ten), `monthly_limit_usd` (estimated model spend per UTC month),
  `model_name`, and the status's `spent_usd`, `reserved_usd`, `graded`,
  `not_graded` and `last_not_graded_reason` for the current month.
- **Boundaries**: an Evaluator configures grading; the grades themselves are
  Scores on each run. The rubrics are Stigmer's, the same in every Organization.
- **Note**: the name is Langfuse's word for an LLM judge configured to run on
  live data. Access is the Agent's: whoever may edit the Agent configures its
  grading, whoever may view it sees the settings.

---

#### Plugin Eval

One run of a plugin's own test cases: every case in the plugin's evals folder is
tried several times with the plugin and several times without it, on each model
the eval names. The eval records both scores and the difference the plugin
makes.

- **User-facing alternative**: "eval" in prose ("start an eval", "the plugin's
  evals"), the word Claude Code's `claude plugin eval` uses. The cases are the
  plugin's "test cases" or its "suite".
- **Capitalize**: As the resource name in labels and reference pages
  (`kind: PluginEval`, display name "Plugin Eval"). In prose say "eval" or
  "plugin eval" in lower case.
- **API surface**: `kind: PluginEval`, prefix `pev`. proto:
  `agentic/plugineval/v1/spec.proto`. Started from the plugin's Evals tab in the
  console or with `stigmer plugin eval`; there is no `apply`, no update and no
  manifest. CLI:

  ```bash
  stigmer plugin eval <plugin>
  stigmer plugin eval cancel <id>
  stigmer get plugin-eval <id>
  stigmer delete plugin-eval <id>
  ```

- **Key fields**: `plugin_id`, `plugin_digest` (the version evaluated),
  `targets` (engine and model pairs), `runs`, `ablation` (`with_without` or
  `none`), `threshold`, `max_cost_usd`, and the status's `phase`, per-case
  results per target and arm, `aggregates` and `cost_usd`.
- **Boundaries**: a Plugin Eval measures a plugin, an Evaluator grades an
  Agent's live runs. The criteria live in the plugin's `evals/` folder, in
  Claude Code's plugin-eval format, never in an Agent's YAML.
- **Note**: the plugin's editors start, cancel and delete its evals; its viewers
  in its own Organization read them. The Organization that installed the plugin
  pays for every try.
- **Editions**: in Stigmer Cloud every viewer of the plugin in its Organization
  opens each try's conversation, read-only. In open source the tries belong to
  the eval's creator, who opens them; the plugin's other viewers read the eval,
  its results and each try's scores, and cannot open a try's conversation.

---

#### Try

One run of one test case in a plugin eval, in a fresh conversation of its own:
what Claude Code calls a run of a case.

- **Capitalize**: No.
- **API surface**: `PluginEvalTry` in `agentic/plugineval/v1/status.proto`, with
  its `run_id`, `score`, and `not_graded_reason`.
- **Boundaries**: a try is an ordinary run; "try" names its place in the eval.
  Say "try" for the eval's unit and "run" for the run itself, so "three tries
  per case" never reads as three separate commands.
- **Note**: a try the platform could not run or grade is "not graded" with a
  reason and left out of every score, never a zero.

---

#### Arm (with-arm, without-arm)

One side of a plugin eval's comparison: the with-arm is a case's tries with the
plugin, the without-arm the same number of tries with nothing attached.

- **Capitalize**: No. Write "with-arm" and "without-arm" with hyphens.
- **API surface**: `PluginEvalCaseTarget.with_plugin` and `without_plugin`
  (`PluginEvalArm`); `ablation: plugin_eval_ablation_none` runs the with-arm
  only. In the result file: `cases[].arms.with` and `cases[].arms.without`.
- **Note**: the difference between the two arms' scores is `Δ` ("delta"), what
  the plugin contributed. The table headers are `WITH` and `W/OUT`, as in Claude
  Code.

---

#### pass^k

Whether every one of a case's k with-arm tries scored 1.0: a case that passes^k
works every time, not only on average.

- **Capitalize**: No; written `pass^k` in prose and `PASS^k` as a table header.
- **API surface**: `PluginEvalCaseTarget.pass_k`; `passK` in the result file.
- **Boundaries**: Stigmer's addition to Claude Code's format, which reports the
  mean score and "perfect runs" (the share of with-arm runs where every grader
  passed) instead.

---

### Tier 3---Technical and internal

These terms appear only in reference documentation, SDK guides, architecture
pages, and internal discussions. They should never appear on the sales site and
only in tutorials when unavoidable.

---

#### Sub-Agent

A delegated specialist Agent that a parent Agent can call to handle a specific
subtask.

- **Capitalize**: Yes, hyphenated: "Sub-Agent."
- **API surface**: `SubAgent` message in `agent/v1/spec.proto`. Fields: `tools`,
  `disallowed_tools` (narrow the parent's tools, never widen them),
  `skill_refs`, `model_override`. Run tracking: `run/v1/subagent.proto`.
- **Context rule**: Concepts and reference only. Never on the sales site. In
  tutorials, if needed, describe as "an Agent that calls another Agent."

---

#### Durable Execution

The ability for runs to survive crashes, restart automatically, and resume
exactly where they left off.

- **Capitalize**: Yes, as a Stigmer concept.
- **Implementation**: Powered by Temporal. Do not mention Temporal on the sales
  site or in quickstart. Name it in architecture docs and reference pages.
- **Sales-site phrasing**: "Agents that keep running even if something crashes."
  or "Your Agents resume where they left off---automatically."
- **Context rule**: "Durable Execution" as a term belongs in concepts and
  reference. On the sales site and in quickstart, describe the benefit without
  naming the mechanism.

---

#### Resource model (apiVersion, kind, metadata, spec)

Stigmer resources follow a declarative model inspired by Kubernetes resource
conventions. Every resource has four top-level fields: `apiVersion`, `kind`,
`metadata`, and `spec`.

- **apiVersion**: Always `agentic.stigmer.ai/v1` for current resources.
- **kind**: The resource type (for example, `Agent`, `Skill`, `McpServer`).
- **metadata**: Contains `name` and optional labels.
- **spec**: The resource-specific configuration.
- **Context rule**: Show by example in quickstart (the reader sees the YAML
  structure). Explain the pattern in concepts. Define the fields in reference.
  Never mention on the sales site.
- **Do not say**: "Kubernetes-style resources" or "CRD-like definitions"---the
  document writer role explicitly prohibits Kubernetes analogies.

---

#### gRPC and protobuf

The wire protocol (gRPC) and interface definition language (Protocol Buffers)
that define Stigmer's API contracts.

- **Canonical forms**: Always write "gRPC" with a lowercase g. Always write
  "protobuf" or "Protocol Buffers" in customer-facing copy.
- **Context rule**: Use in Reference and SDK docs without restriction. Concepts
  docs can mention gRPC as the API protocol. Do not mention on the sales
  site---say "standard API" or "type-safe API clients." In the README, use
  without restriction.
- **Sales-site phrasing**: "Real API contracts---generate type-safe clients in
  any language."
- **proto location**: All proto definitions live under `apis/ai/stigmer/` in the
  Stigmer OSS repo.

---

#### Graphton

<!-- vale Stigmer.terms = NO -->

The Agent framework of the retired Python agent runner. The name survives only
in historical references; today's runner executes the native harness with
LangGraph.js deep-agent.

<!-- vale Stigmer.terms = YES -->

- **Context rule**: Historical architecture references only. Never in
  customer-facing documentation, and never for describing the current runtime.

---

#### Stigmer Server

The gRPC API server that powers the local development experience.

- **Capitalize**: Yes.
- **CLI**: `stigmer server`, `stigmer server status`, `stigmer server stop`,
  `stigmer server setup`, `stigmer server reset`.
- **Context rule**: Quickstart and docs (it's the command they run). Not on the
  sales site.

---

#### Agent Runner

The TypeScript Temporal worker (`stigmer-runner`, `backend/services/runner`)
that executes agent sessions, driving both harnesses: Cursor and the native
deep-agent (LangGraph.js).

- **Capitalize**: Yes.
- **Context rule**: Architecture docs only. Customers do not start or configure
  the Agent Runner directly---`stigmer up` runs it for local execution and the
  desktop app embeds it as a subprocess.
- **Not Python**: The original Agent Runner was a Python Temporal worker; it was
  replaced by the TypeScript runner. Any doc describing a "Python Temporal
  worker" is describing the retired service.

---

#### cursor-runner

The TypeScript Temporal worker that executes agent activities for the Cursor
harness via the `@cursor/sdk`.

- **Capitalize**: No. Use lowercase hyphenated form `cursor-runner` in all
  contexts.
- **Context rule**: Architecture docs and contributor guides only. Never in
  customer-facing documentation. Customers interact with the Cursor harness
  through the Session's `harness` field, not by configuring `cursor-runner`
  directly.
- **Related terms**: Harness (user-facing concept), Cursor harness (Tier 2),
  Agent Runner (the native equivalent).

---

#### Seedpack

Retired term. The starter bundle of Agents, Skills and MCP Servers that earlier
releases installed on a fresh stack. A fresh install now gets the one
Organization its server makes at its first start and nothing else: a Session
with no Agent runs the built-in assistant, and everything else is a Plugin you
install by name; see Plugin and Marketplace.

- **Capitalize**: Yes (when quoting historical docs).
- **Context rule**: Do not use in new writing. A doc describing "the built-in
  Agents and servers" or "the curated library" is describing the retired bundle;
  point it at Plugin instead.

---

#### Project

Retired term. A `kind: Project` was a manifest (`stigmer.yaml`) at the root of a
directory that listed the Agents, Skills and MCP Servers applied from it as
members, reconciled by `stigmer apply`; a second flavour synthesised the members
from a TypeScript, Go or Python program. Both were removed with the kind: a
folder of resources that belong together is a Plugin, installed with
`stigmer push plugin` or from the Marketplace, and upgraded or removed as one
unit. The seven Project pages under the SDK reference and `examples/project`
went with it.

- **Capitalize**: Yes, when quoting historical docs or the CLI's refusal.
- **Context rule**: Do not use in new writing. A reader still meets the word in
  one place: the sentence `stigmer apply -f` and `stigmer validate -f` print for
  a manifest that still carries `kind: Project`, which says what happened and
  names `stigmer push plugin`. Lowercase "project" for an npm, Go, Python or
  Maven project stays ordinary English.

---

#### Public (visibility)

Retired term. `visibility_public` was a resource visibility level that made an
Agent, Skill, MCP Server or Plugin readable to every signed-in person on the
server, and the Library's "All" scope listed other Organizations' public
resources for reference in place. Both went with the level: a resource is
visible to its creator (Private), to its Organization (Organization, the
default), or to every Organization a platform manages through its Identity
Provider (Platform). Another Organization's work reaches yours as a Plugin you
install and own. A server upgrading from a release that still had the level
moves every row that carried it to Organization visibility.

- **Capitalize**: Yes, when naming the retired level in an upgrade note.
- **Context rule**: Do not use for a resource level in new writing. "Public"
  stays ordinary English for a share's audience ("anyone with the link", the
  `public` audience of a share) and for a public website or API. A doc
  describing "publishing to the marketplace" or "a public Skill another
  Organization can reference" is describing the retired level; point it at
  Plugin, or at Platform when the two Organizations share an Identity Provider.

---

#### Agent Instance

Retired term. A `kind: AgentInstance` (prefix `ain`) was a deployed copy of an
Agent bound to its own settings, and a Session named an instance rather than its
Agent; every Agent carried a default one. The kind and its CLI verbs were
removed: a Session names its Agent directly (`agent_ref`) and runs the version
it started on, and a run's keys come from vaults (the conversation's, the
surface that started it, or the sending person's own).

- **Capitalize**: Yes, when naming the retired kind in an upgrade note.
- **Context rule**: Do not use in new writing. A reader still meets the word in
  the sentence `stigmer apply -f` and `stigmer validate -f` print for a manifest
  that still carries `kind: AgentInstance`, which says what happened and names
  `stigmer run`.

---

## Inconsistency register

Known inconsistencies across the codebase. Each entry includes what the
inconsistency is, where it appears, and a recommended resolution.

These require human decisions. Do not resolve them autonomously.

---

### 1. OSS README tagline contradicts positioning---RESOLVED

**What**: The OSS README previously said "open-source agentic automation
platform." The positioning document says the category is "AI Agent Platform."
The word "agentic" was explicitly rejected as jargon.

**Resolution**: The README has been updated to "open-source AI Agent platform,"
matching the positioning document's category name.

---

### 2. Cloud README tagline contradicts positioning

<!-- vale Stigmer.terms = NO -->

**What**: The Cloud README (`stigmer/stigmer-cloud/README.md`, line 7) says
"SDK-first agent orchestration platform." This uses a different category name
("agent orchestration platform") and leads with an implementation detail
("SDK-first").

**Where**:

- `stigmer-cloud/README.md` line 7: "SDK-first agent orchestration platform"
- `stigmer-cloud/README.md` line 15: repeats the phrase

<!-- vale Stigmer.terms = YES -->

**Recommendation**: Update to align with the positioning category "AI Agent
platform." The "SDK-first" aspect can remain as a supporting description, not as
the category name. Example: "Stigmer Cloud---the cloud-hosted AI Agent platform.
Define Agents as code."

---

### 3. Audience definition conflict between the writing guidance and STYLE.md---RESOLVED

**What**: The writing guidance coding agents followed said "Write for a smart
person who is not technical." The style guide (`docs/STYLE.md`, line 14) says
"Assume readers are comfortable with APIs, CLIs, and infrastructure concepts."

**Resolution**: The writing guidance was rewritten around a context-sensitive
register framework that references this guide's five writing contexts. Plain
language remains the default for the sales site and introductory docs; reference
and SDK docs use precise technical language. The guidance now lives in
`.agents/skills/docs-writing/SKILL.md` ("Match the register to the reader").

---

### 4. Cloud README lists "Credential" as a concept

**What**: The Cloud README architecture table includes "Credential" as a
resource type with the description "Encrypted credentials---AWS keys, GitHub
tokens." No `Credential` kind exists in `api_resource_kind.proto`. The closest
resources are `Vault` (holds logins and secrets) and `ApiKey` (IAM
authentication tokens).

**Where**:

- `stigmer-cloud/README.md` architecture table (line 45)
- `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto`
  (no `Credential` kind)

**Recommendation**: Determine whether "Credential" was a planned resource that
hasn't been implemented, or whether it's a misnomer for vault secrets. Update
the Cloud README accordingly. If credentials are managed through vaults, remove
the "Credential" row and clarify in the Vault description.

---

### 5. YAML shorthand vs proto field names---RESOLVED

**What**: The OSS README showed `mcpServers:` as a YAML field on Agent
definitions. The proto field is `mcp_server_usages` (a repeated `McpServerUsage`
message containing `mcp_server_ref`).

**Investigation**: The CLI Agent loader (`agent/loader.go`) uses strict
`protojson` `Unmarshal` with `DiscardUnknown: false`. There is no alias or
remapping for `mcpServers`. The field would be rejected as unknown. `mcpServers`
was a documentation simplification, not a supported alias.

**Resolution**: The README and this vocabulary guide have been updated to show
the real YAML structure (`mcp_server_usages` with `McpServerUsage` entries). No
shorthand exists or is planned.

---

### 6. Child-organization words---RESOLVED

**What**: An Organization that belongs to another Organization, one per customer
of an integrator, was called platform-managed, managed, tenant and external in
different places, and its fields carried the same mix.

**Resolution**: The mechanism and its words were replaced together. A child
organization names its parent in `parent_org`, carries the parent's customer id
in `external_id`, and is reached through `external_id_claim` and shared with at
`visibility_child_orgs`. See
[Parent organization, child organization](#parent-organization-child-organization).
