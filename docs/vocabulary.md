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

| Context                    | Audience                                   | Register                                                                           | Example                                                                            |
| -------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Sales site**             | Technical founders choosing infrastructure | Business-outcome language. No jargon. Lead with what they gain.                    | "Teach your Agent your domain."                                                    |
| **Quickstart / tutorials** | Developers following steps                 | Action-oriented. Introduce Stigmer terms with a plain-language gloss on first use. | "Create a Skill (a piece of domain knowledge your Agent can use)."                 |
| **Concepts / how-to**      | Developers building understanding          | Explanatory. Use Stigmer terms as proper nouns. Analogies welcome.                 | "A Skill is like a training manual for your Agent."                                |
| **Reference / SDK**        | Developers looking up specifics            | Precise. Use API field names. Assume familiarity with the platform.                | "`spec.skill_refs`---the Skills this Agent loads, each a reference by slug or ID." |
| **README / GitHub**        | Developers evaluating Stigmer              | Developer-direct. CLI-first. Technical credibility.                                | "Versioned knowledge artifacts. A Skill is a directory with a `SKILL.md` file."    |

**Rule of thumb**: move left in the table for simpler language, move right for
more precise language. Never use a right-column term in a left-column context.

---

## Quick reference

Scan this table to find the right word for your context. Detailed entries with
definitions, API names, and examples follow below.

<!-- vale Stigmer.terms = NO -->

| Term                   | Sales site                 | Quickstart / tutorial                  | Concepts / how-to   | Reference / SDK                                     | README             |
| ---------------------- | -------------------------- | -------------------------------------- | ------------------- | --------------------------------------------------- | ------------------ |
| **Agent**              | Agent                      | Agent                                  | Agent               | Agent, `kind: Agent`                                | Agent              |
| **Skill**              | domain knowledge           | Skill ("domain knowledge")             | Skill               | Skill, `skill_refs`                                 | Skill              |
| **Plugin**             | plugin                     | plugin ("what you install")            | Plugin              | Plugin, `kind: Plugin`                              | plugin             |
| **Marketplace**        | marketplace                | Marketplace ("where you install from") | Marketplace         | Marketplace; source, `stigmer install`              | marketplace        |
| **MCP server**         | tools                      | MCP server ("tool connection")         | MCP server          | `PluginStatus.mcp_servers`, `AgentSpec.mcp_servers` | MCP server         |
| **Session**            | conversation               | Session ("conversation")               | Session             | Session, `kind: Session`                            | Session            |
| **Session event**      | ---                        | ---                                    | event               | `SessionEvent`, `agent.message`, `stigmer.*`        | event              |
| **Runner**             | compute                    | runner ("where your Agent runs")       | Runner              | Runner                                              | runner             |
| **Harness**            | execution engine           | harness ("execution engine")           | Harness             | Harness, `SessionSpec.harness`                      | harness            |
| **Approval flow**      | approval flow              | approval flow                          | approval flow, HITL | `destructiveHint`, `confirmToolUse`                 | HITL, approval     |
| **Organization**       | Organization               | Organization                           | Organization        | Organization, `kind: organization`                  | Organization       |
| **Agent hour**         | agent hours                | ---                                    | agent hours         | `included_agent_hours`, `per_agent_hour_micros`     | agent hours        |
| **Working time**       | ---                        | working time                           | working time        | `working_seconds`                                   | working time       |
| **Edition**            | the three names            | ---                                    | edition             | `ServerEdition`, `DeploymentMode`                   | edition            |
| **Team**               | teams                      | ---                                    | Team                | Team, `kind: team`                                  | Team               |
| **Grant**              | ---                        | ---                                    | Grant               | Grant, `kind: Grant`                                | Grant              |
| **Vault**              | vault                      | vault ("your keys and logins")         | Vault               | Vault, `kind: Vault`                                | vault              |
| **Environment**        | ---                        | Environment ("packages and network")   | Environment         | Environment, `kind: Environment`                    | Environment        |
| **Preference**         | preferences                | preference ("standing context")        | Preference          | `spec.preferences.standing_context`                 | Preference         |
| **Federation Issuer**  | ---                        | identity provider (Auth0, Okta, …)     | Federation Issuer   | FederationIssuer, `kind: FederationIssuer`          | Federation Issuer  |
| **Identity Account**   | ---                        | ---                                    | Identity Account    | IdentityAccount, `kind: identity_account`           | Identity Account   |
| **Embedding settings** | ---                        | ---                                    | embedding settings  | `OrganizationSpec.embedding`                        | embedding settings |
| **App user**           | ---                        | ---                                    | app user            | `provisioning_mode: app_user`                       | app user           |
| **Run**                | ---                        | run                                    | run                 | Run, `kind: Run`                                    | Run                |
| **Subagent**           | ---                        | ---                                    | subagent            | subagent, `subagents`, `<plugin>:<agent>`           | subagent           |
| **Channel**            | chat link, Slack, WhatsApp | chat link                              | channel, Channel    | Channel, `kind: Channel`                            | Channel            |
| **Channel App**        | ---                        | ---                                    | Channel App         | ChannelApp, `kind: ChannelApp`                      | Channel App        |
| **Routine**            | run on a schedule          | routine                                | routine, Routine    | Routine, `kind: Routine`                            | Routine            |
| **Label**              | ---                        | label                                  | label               | `metadata.labels`, `labels` filter                  | label              |
| **Tag**                | ---                        | tag                                    | tag                 | `metadata.tags`                                     | tag                |

<!-- vale Stigmer.terms = YES -->

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
- **YAML fields**: `spec.instructions`, `spec.plugins` (references with
  `kind: plugin`, each plugin attached whole), `spec.mcp_servers` (MCP servers
  written in the Agent itself, reached over HTTP; only the Organization's admins
  add one or change its address or headers), `spec.skill_refs`, `spec.tools`,
  `spec.subagents` (saved Agents it may hand work to, each pinned to a version
  when this Agent is saved, one level deep), and `spec.run_config` with
  `spec.harness`: the model and engine a conversation on the Agent starts on, a
  default that a message, a channel or a routine may override (see
  [Run settings](/docs/concepts/agents#run-settings)), and
  `spec.environment_ref`: the [Environment](#environment) its conversations run
  in when nothing else names one.

**Good examples**:

| Context    | Copy                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Sales site | "Build agents that work for your business."                                                                                                |
| Quickstart | "Create a file called `agent.yaml`. This file defines your Agent---what it knows, which tools it can use, and how it behaves."             |
| Concepts   | "An Agent is a reusable definition. You define it once. Any application can call it via API."                                              |
| Reference  | "`Agent`---a managed resource representing an AI Agent definition. Applied via `stigmer apply` or the `AgentCommandController.apply` RPC." |

**Bad examples**:

| Context    | Copy                                                    | Problem                                                                                             |
| ---------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Sales site | "Define an Agent resource with YAML."                   | Technical language in a business context.                                                           |
| Quickstart | "The Agent abstraction encapsulates LLM orchestration." | Jargon. The reader just wants to create their first Agent.                                          |
| Concepts   | "Install the plugin to get its agent."                  | Installing stores the plugin alone; an Agent is saved on its own and lists the plugin in `plugins`. |

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
- **Skills from a plugin**: a plugin's skills live in the plugin and are not in
  the Skill list. A turn names each one `<plugin>:<skill>` (`thermos:review`),
  so two plugins may both ship `review`; they change when the plugin is pushed
  again (see [Plugins](/docs/concepts/plugins)).

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

A package you install to add capabilities to your Organization: skills, agents,
hooks and MCP servers, as one unit. A plugin is how an MCP server is packaged
and shared. Installing it stores the plugin alone; an Agent or a conversation
that lists it in `plugins` gets all of it.

- **User-facing alternative**: none needed. "Plugin" is the word the Cursor,
  Claude Code and Codex communities already use for the same package, and
  Stigmer reads their plugins unchanged.
- **Capitalize**: Yes, when referring to the Stigmer resource ("the Plugin
  kind"); lowercase for the package in the wild ("install a plugin").
- **API surface**: `kind: Plugin`, prefix `plg`. proto: `plugin/v1/spec.proto`,
  `plugin/v1/command.proto`. CLI: `stigmer push plugin <dir>` (install or
  upgrade), `stigmer mcp add <name> <url>` (a plugin of one MCP server),
  `stigmer connect plugin <plugin>` (sign in and list a server's tools),
  `stigmer run --plugin <ref>`, `stigmer get|list|delete plugin`,
  `stigmer validate -f <dir>` (offline check). Console: Library > Plugins lists
  what is installed and offers "Add MCP server" beside the two ways in: "Browse
  Marketplace" opens the Marketplace page, and "Upload plugin" installs a folder
  or a `.zip` from your computer (the console's `stigmer push plugin`); a
  plugin's page is where an install ends: it shows what the plugin holds, says
  per MCP server what stands before its first tool call ("Sign in", "Signed in",
  the variables it needs, or nothing), lists its hooks with every command each
  runs beside the ones Stigmer does not run, offers "Sign in" and "Check tools"
  per server, and "Start a chat" (a conversation with the built-in assistant and
  the plugin on) and "Add to an agent" (the plugin listed in that agent's
  `plugins`); "Remove" is the console's word for `delete plugin`. A plugin is
  never authored as YAML: its spec is read from the package manifest.
- **File structure**: A plugin is a directory holding a manifest (`plugin.json`,
  `.cursor-plugin/plugin.json`, `.claude-plugin/plugin.json` or
  `.codex-plugin/plugin.json`), `skills/`, `mcp.json`, `agents/` and `hooks/`.
  Stigmer-only settings go in the manifest's `extensions["ai.stigmer"]`; an
  `ai.stigmer/` folder is not read, and install warns about it. Installing it
  writes one resource, whose status lists the skills, agents and MCP servers the
  archive holds; to change them you change the plugin and push it again.
- **What it is not**: a plugin does not run on its own. An Agent or a
  conversation that lists it runs, in a Session, on a Runner; the plugin's
  skills, agents, hooks and servers join that run.
- **Concept page**: [Plugins](/docs/concepts/plugins), with how Stigmer's plugin
  compares with Claude Code's, Cursor's and Codex's and where it differs.

**Good examples**:

| Context    | Copy                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Sales site | "Bring your Cursor, Claude or Codex plugin. Install it on Stigmer and run it remotely."                                             |
| Quickstart | "Install a plugin---a folder of skills and tools---and turn it on for your chat."                                                   |
| Concepts   | "A plugin is a toolbox. An agent is the worker who picks it up. Listing the toolbox on an agent gives the worker everything in it." |
| Reference  | "`Plugin`---the unit of install. `PluginCommandController.push` stores it; `status` lists the skills, agents and servers it holds." |

**Bad examples**:

| Context    | Copy                                      | Problem                                                               |
| ---------- | ----------------------------------------- | --------------------------------------------------------------------- |
| Quickstart | "Run the plugin."                         | Plugins do not run; the agent or chat that lists it does.             |
| Concepts   | "Edit the plugin's skill in the console." | A plugin's skills live in its archive; change the plugin, push again. |
| Reference  | "Apply the plugin YAML."                  | A plugin has no YAML; it is pushed as its folder.                     |

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

#### MCP server

An external tool connection that lets an Agent interact with other systems. In
Stigmer an MCP server is an entry in a plugin, or one an Agent lists itself; it
is not a resource of its own.

- **User-facing alternative**: "tools" or "tool access" on the sales site. "Tool
  connection" in introductory docs. "MCP server" everywhere else.
- **Capitalize**: "MCP server", lowercase "server", in every context: it is part
  of a plugin or an Agent, not a Stigmer resource kind.
- **API surface**: `PluginStatus.mcp_servers` (`McpServerEntry`: `name`, `stdio`
  or `http`, `env`, `sign_in`), `PluginCommandController.listTools`;
  `AgentSpec.mcp_servers` (`AgentMcpServer`: `name`, `url`, `headers`), a server
  written in the Agent itself, HTTP only. CLI: `stigmer mcp add <name> <url>`
  (install one server as a plugin), `stigmer connect plugin <plugin>` (sign in
  and list its tools). Not to be confused with `stigmer mcp-server`, which
  starts Stigmer's own MCP server for IDEs. Console: Library > Plugins > "Add
  MCP server"; a plugin's page shows "Sign in" and "Check tools" per server; an
  Agent's page and the new-Agent wizard's Capabilities step show "MCP servers"
  to admins.
- **YAML fields**: an Agent or Session lists plugins in `spec.plugins`; an Agent
  writes its own servers in `spec.mcp_servers`. The Agent narrows a server's
  tools with `spec.tools` and `spec.disallowed_tools`: a plugin's server as
  `mcp__plugin_<plugin>_<server>` and `mcp__plugin_<plugin>_<server>__<tool>`,
  its own as `mcp__<server>` and `mcp__<server>__<tool>`. A tool asks first when
  its server's MCP annotation says `destructiveHint: true`, read live each turn.
- **Protocol**: MCP stands for Model Context Protocol, an open standard. Spell
  out on first use in any context. Link to `https://modelcontextprotocol.io` in
  docs.

**Good examples**:

| Context    | Copy                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sales site | "Connect your Agent to your systems. It checks inventory, creates tickets, updates records---with the same APIs your team already uses."         |
| Quickstart | "Give your Agent tools by adding an MCP server---a connection to an external system like GitHub, a database, or a file store."                   |
| Concepts   | "An MCP server is a bridge between your Agent and an external system. It comes in a plugin the Agent lists, or is written in the Agent itself."  |
| Reference  | "`McpServerEntry`---one MCP server a plugin carries, a local program (`stdio`) or an address (`http`). Its tools are listed live, never stored." |

**Bad examples**:

| Context    | Copy                                              | Problem                                                                                                                |
| ---------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Sales site | "Configure MCP servers for tool integration."     | Technical jargon. Say "connect your tools."                                                                            |
| Quickstart | "Set up the McpServerEntry in the plugin status." | proto message names in a tutorial. Say "add an MCP server." Show the command or YAML by example, not by field name.    |
| Any        | "Create an MCP Server resource."                  | There is no MCP server kind; a server is an entry in a plugin or in an Agent's `mcp_servers`. Say "add an MCP server". |

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
  conversation runs until someone updates it), `status.harness_state_id` (the
  harness's own id for the conversation, kept across runs), `subject` (display
  title), `workspace_entries`, `environment_ref` (the
  [Environment](#environment) the conversation names itself),
  `status.environment` and `status.environment_source` (the Environment it runs
  in and whose choice that was), `vaults` (the vaults the conversation uses, in
  order) and `include_my_vault` (use each sender's own My vault first). Sessions
  can add `plugins` and `skill_refs` to the Agent's; the Agent's tool lists
  still govern every tool.
- **Related terms**: A Session contains multiple runs. Each message exchange
  within a Session is one run. What happens in a Session is its event log
  (`session/v1/event.proto`): the person's messages, the Agent's messages and
  tool uses, and every answer, read with `listEvents` or `streamEvents`.
- **Sharing**: A Session is private to the person who started it, and its
  Organization's admins do not read it. In the Enterprise and Cloud editions its
  owner shares it with people one by one, as a **Participant** (reads and sends
  messages) or a **Viewer** (reads only); never with a Team. See [Role](#role).

**Good examples**:

| Context    | Copy                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sales site | "Your Agent remembers the conversation. Ask a follow-up question tomorrow---it picks up where you left off."                                                                        |
| Quickstart | "Start a Session---an ongoing conversation where your Agent remembers what was said."                                                                                               |
| Concepts   | "A Session is a container for a multi-turn conversation. It holds the message history, attached Skills, and tool connections for that conversation."                                |
| Reference  | "`Session`---a multi-turn conversation container. Keeps the conversation across runs (`status.harness_state_id`). Merges Agent-level and Session-level `skill_refs` and `plugins`." |

**Bad examples**:

| Context    | Copy                                                          | Problem                                                                       |
| ---------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Sales site | "Create a Session resource to enable multi-turn interaction." | Resource-model language in a business context.                                |
| Quickstart | "Configure the `harness_state_id` for Session persistence."   | Implementation detail. The quickstart should just say "start a conversation." |

---

#### Session event

One entry in a Session's event log: a message, a tool call or its result, an
answer, or a change in what the Session is doing.

- **User-facing alternative**: "what the Agent did" on the sales site and in
  introductory copy; "event" once the reader reads or streams them.
- **Capitalize**: No.
- **API surface**: `SessionEvent` in `session/v1/event.proto`, read with
  `listEvents` or `streamEvents`. Each event is a Claude Managed Agents event,
  named and shaped as Anthropic's SDK types it
  ([Use Anthropic's SDK](/docs/sdk/managed-agents)): `user.message`,
  `agent.message`, `agent.tool_use`, `session.status_idle` and the rest. A type
  that starts with `stigmer.` is Stigmer's own, listed with its reason in
  [Stigmer's own events](/docs/sdk/streaming#stigmers-own-events).
- **Related terms**: A [Session](#session) holds the log, and each [run](#run)
  is one turn in it. A [subagent](#subagent)'s events are a thread of their own
  (`session.thread_created`). A call that waits for an answer is an
  `agent.tool_use`, answered by a `user.tool_confirmation`
  ([Approval flow](#approval-flow-human-in-the-loop)).
- **Context rule**: Reference and SDK docs use Managed Agents' event names
  exactly; never invent a name for an event. Concepts say "the Session's events"
  or "the conversation".

**Good examples**:

| Context   | Copy                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Concepts  | "Everything that happens in a Session is one ordered list of events: your messages, the Agent's messages and tool calls, every answer." |
| Reference | "An `agent.tool_use` with `evaluated_permission` `ask` waits for an answer; answer it with `confirmToolUse`."                           |

**Bad examples**:

| Context   | Copy                                       | Problem                                                                                                              |
| --------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Any       | "The run's transcript holds its messages." | A run holds no transcript; the conversation is the Session's events.                                                 |
| Reference | "The `stigmer.agent.message` event."       | There is no such type: the Agent's text is `agent.message`. A Managed Agents type never takes the `stigmer.` prefix. |

---

#### Channel

A way people reach an Agent: a hosted chat link, a Slack workspace or a WhatsApp
number. Each Channel has one type, and an Agent can have several.

- **Types**: `web`, the **chat link** (a hosted page at `/chat/<id>`, and the
  widget sites embed); `slack`; and `whatsapp`.
- **User-facing alternative**: "chat link" for the `web` type everywhere, never
  "share". On the sales site, "connect your Agent to Slack" without naming the
  resource. In how-to docs, introduce "channel" with a gloss, then use
  "channel".
- **Capitalize**: Yes, when referring to the Stigmer resource ("the Channel
  kind"). Lowercase "channel" is fine in prose once the concept is established
  ("add a channel", "the channel card").
- **API surface**: `kind: Channel`, prefix `chn`; a chat link made before chat
  links became channels keeps its `ash_` id, and a Slack or WhatsApp connection
  made before keeps its `ach_` id. proto: `channel/v1/spec.proto`. CLI:
  `stigmer channel link|enable|disable`.
- **Key fields**: `agent_ref`, `enabled`, `vaults`, `run_config`, and the type's
  own fields: `web.audience` (`org` or `public`) and `allowed_origins`; the
  `app_ref` of a `slack` or `whatsapp` channel (optional for Slack, required for
  WhatsApp).
- **Context rule**: A chat link's omitted audience means the Organization: only
  its signed-in members chat. Say "Anyone with the link can chat" only for the
  `public` audience, an explicit choice. A channel lets people chat; it never
  grants a role on the Agent ([Share (the word)](#share-the-word)).
- **Note**: Do not confuse with a Slack channel (a room inside a workspace). A
  Slack channel of an Agent connects it to a whole workspace, and a WhatsApp one
  to a Business phone number; people then reach it from any conversation.
  Provider identity facts and credentials live in `status`, written by the
  install flow---applying a manifest never touches them.
- **Roles**: A channel's **Participant** reads its conversations and replies to
  customers as the business; its **Viewer** reads them and cannot reply.
  Creating a channel is an Organization admin's act, because it runs the Agent
  on the Organization's provider keys for everyone who reaches it. See
  [Channels](/docs/concepts/channels) and
  [Create a chat link](/docs/guides/channels/create-a-chat-link).
- **Former names**: `AgentShare` (`Agent Share`) for the chat link and
  `AgentChannel` (`Agent Channel`) for Slack and WhatsApp. Do not use them in
  new writing.

**Good examples**:

| Context    | Copy                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------ |
| Sales site | "Give your Agent a chat link, or connect it to Slack and WhatsApp."                        |
| How-to     | "Open the **Channels** tab and click **Add channel → Chat link**."                         |
| Reference  | "`Channel`---one way people reach one Agent; `spec.web`, `spec.slack` or `spec.whatsapp`." |

**Bad examples**:

| Context | Copy                           | Problem                                                                    |
| ------- | ------------------------------ | -------------------------------------------------------------------------- |
| How-to  | "Create a share of the Agent." | A chat link is a channel; "share" means giving people access to something. |
| Any     | "Shared Agent"                 | Say "an Agent's chat link"; sharing an Agent is granting a role on it.     |

---

#### Routine

A saved Agent invocation (which Agent, what to tell it, its workspace, vaults
and Environment) that starts on its schedule, when someone runs it, or when
another system calls it with a note.

- **User-facing alternative**: "run your Agent on a schedule" on the sales site
  and on first use in how-to docs; "routine" after that.
- **Capitalize**: Yes, when referring to the Stigmer resource ("the Routine
  kind"). Lowercase "routine" is fine in prose once the concept is established
  ("run the routine", "the routine's history").
- **API surface**: `kind: Routine`, prefix `rtn`; a routine made while the kind
  was called `Schedule` keeps its `sch_` id, and that id keeps working. proto:
  `routine/v1/spec.proto`, `routine/v1/api.proto`. CLI: the unified verbs
  (`stigmer apply`, `stigmer get routine`, `stigmer list routines`,
  `stigmer delete routine`) and `stigmer routine fire|fires|resume`.
- **Key fields**: `cron` (optional: the classic 5-field form or an `@daily`
  shorthand, evaluated in `time_zone`; absent, the routine runs only when
  started), `time_zone` (IANA name, required with a `cron`), `enabled`, and
  `agent` (`agent_ref`, `message`, `vaults`, `environment_ref`, the workspace
  and run settings). Firing observations (`next_fire_at`, `last_fire_at`,
  `last_run_id`, `consecutive_failures`, `paused_reason`) live in `status`,
  written only by the platform---applying a manifest never touches them.
- **Starting it**: say "start" and **Run now** in how-to docs; reference docs
  say `fire` (`FireRoutineInput`), and each start is a `RoutineFire` with an
  origin, `schedule` or `manual`, and `fired_by` for whoever started it. A start
  may carry a note of up to 65,536 characters, which reaches the Agent after the
  routine's message as information from whoever started the run, never as
  instructions. By default a routine starts by hand at most 30 times an hour.
- **Who it acts as**: every run, on its schedule or started by anyone, acts as
  the routine's owner: the person or service account that created it. On a
  routine the Owner role is only that account, never granted and never inherited
  by an Organization's admins, so say "the person who created it" on first use
  and never call an admin a routine's owner. A routine meant to outlive a person
  is created by a service account.
- **Roles**: only the person who created it grants a role on it, to people,
  Teams or service accounts. A **Participant** starts it, with or without a
  note, and reads its conversations; a **Viewer** reads it, its history and its
  conversations, and starts nothing. Only its owner changes what it runs. An
  Organization's admins see it, its history and who has access, and may switch
  it off, rename, relabel, resume or delete it, and remove access; they neither
  start it, nor change what it runs, nor read its conversations. Granting a role
  on one routine is Enterprise and Cloud; on open source only its owner starts
  it.
- **Disabled vs. paused**: two words, two levers, two writers. A routine is
  **disabled** when its owner sets `enabled: false` in the spec---the owner's
  switch, cleared by the owner editing the spec. A routine is **paused** when
  the platform stops it after repeated failed runs on its schedule and records
  why in `status.paused_reason`---the platform's latch, cleared only by the
  resume command (`stigmer routine resume`). A disabled routine refuses to
  start; a paused one may still be started, which is how its owner tests a fix.
  Never use "paused" for the owner's switch or "disabled" for the platform's
  latch.
- **Note**: Do not confuse with a Temporal Schedule, the engine artifact the
  platform manages internally to do the firing. Docs and code comments say
  "Temporal Schedule" for the engine artifact; one Routine with a `cron` is
  backed by one Temporal Schedule. Lowercase "schedule" stays: it is the
  routine's own timing ("the routine's schedule") and the verb.
- **Former names**: `Schedule` (`kind: Schedule`), its fire record
  `ScheduleFire`, `trigger` for starting one, and the hosted edition's per-org
  schedule account that runs once acted as. Do not use them in new writing.
  `stigmer apply` on an old `kind: Schedule` file answers with the fix: rewrite
  it as `kind: Routine`. See [Routines](/docs/concepts/routines).

**Good examples**:

| Context    | Copy                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| Sales site | "Run your Agent on a schedule, or let your alerting tool start it."                                      |
| How-to     | "Open the routine and click **Run now**. Add a note if the run needs to know what happened."             |
| Concepts   | "Every run of a routine acts as the person who created it, so its conversations are theirs."             |
| Reference  | "`Routine`---a saved Agent invocation; `spec.cron` optional, started by `fire` with an optional `text`." |

<!-- vale Stigmer.FormerNames = NO -->

**Bad examples**:

| Context | Copy                                                        | Problem                                                                                               |
| ------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Any     | "Create a Schedule for the Agent."                          | The kind is Routine; "Schedule" is its former name.                                                   |
| Any     | "The run acts as the organization's schedule account."      | No such account exists: every run acts as the routine's owner.                                        |
| How-to  | "Ask an admin, the routine's owner, to change the message." | An admin is not a routine's owner and cannot change what it runs; only the person who created it can. |

<!-- vale Stigmer.FormerNames = YES -->

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
  destructive (`destructiveHint`). An Agent's hooks (`hooks`) decide call by
  call: refuse, ask, or allow. Its `tools` and `disallowed_tools` lists decide
  which tools it has at all. A call that asks is an `agent.tool_use` with
  `evaluated_permission` `ask`, announced by `stigmer.permission.asked`. Read
  from the Session's log, and answered on the Session:
  `SessionCommandController.confirmToolUse` (`allow` or `deny`, recorded as
  `user.tool_confirmation`) or `grantPermission` (the call's class for the rest
  of the run). `interrupt` stops the Session's unfinished work, recorded as
  `user.interrupt`. The CLI answers with the same words: `allow`, `deny` or
  `allow-all` (`stigmer runs approve --action`, and `--approve-default` for a
  run that nobody watches).

**Good examples**:

| Context    | Copy                                                                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sales site | "Your Agent handles routine requests on its own. For anything risky, it asks a human first. You decide which tools it can use."                                                                                         |
| Quickstart | "Your Agent asks before risky actions---shell commands, file changes, and any tool its server marks destructive."                                                                                                       |
| Concepts   | "An approval flow is a checkpoint. The Agent pauses, presents what it wants to do and why, and waits for a human to approve or reject. The Agent's run is durable---it waits indefinitely without losing state."        |
| Reference  | "Tool-call approval is required for shell commands, file writes and deletes, and MCP tools with `destructiveHint`. `auto_approve_all` resolves every approval for one run; `tools` and `disallowed_tools` still apply." |

**Bad examples**:

| Context    | Copy                                    | Problem                                                                    |
| ---------- | --------------------------------------- | -------------------------------------------------------------------------- |
| Sales site | "Enable HITL for sensitive operations." | "HITL" is internal jargon.                                                 |
| Quickstart | "Set `destructiveHint` on the tool."    | API-level detail in a tutorial. Say "the server marks the tool risky."     |
| Any        | "Set up human-in-the-loop."             | Hyphenated compound used as an instruction. Prefer "add an approval flow." |

---

#### Hook

A command that runs around an Agent's tool calls, in Claude Code's or Cursor's
hooks format. Before a call it can refuse it, ask a person first, or let it run
without the approval it would otherwise need; after a call it can tell the Agent
something about the result. A plugin brings hooks to every Agent or conversation
that lists it, or an Agent carries a block written in it.

- **User-facing alternative**: none needed. "Hook" is the word Claude Code and
  Cursor use, and Stigmer runs their plugins' hooks unchanged.
- **Capitalize**: No. A hook is part of a plugin or an Agent, not a Stigmer
  resource kind: "the plugin's hooks", "switch the hooks on for an Agent".
- **API surface**: `AgentSpec.hooks` (an inline block), `AgentSpec.plugins` and
  `SessionSpec.plugins` (a listed plugin's hooks run), `PluginStatus.hooks`
  (what a plugin recorded at install), `HookConfig` in `plugin/v1/hooks.proto`.
  Console: the plugin's page and the Agent's page list every hook with the
  command it runs; "Add to an agent" switches a plugin's hooks on with the rest
  of the plugin. Approvals a hook decides read "decided by the agent's hook" or
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
  `GetBillingAccountInput.org`), `<role>_org` for a second one in the same
  message (`ProviderKey.inherited_from_org`), `orgs` for a list
  (`repeated string orgs`), `org_<attribute>` for something that describes one
  (`InvitationPreview.org_name`), `orgs` in a count (`max_orgs`), and `org` in a
  per-organization amount (`per_extra_org_micros`). RPCs and requests that
  filter by one say `Org` (`getForOrg`). The kind itself, and the messages that
  return it, keep the full word (`Organization`, `ListMyOrganizationsInput`), as
  `Agent` does.
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
- **Roles and policies**: Everyone in an Organization holds one role in it:
  Owner, Admin, Member or Viewer ([Role](#role)). The **Members can create
  agents** policy (`OrganizationPolicies.members_can_create_agents`, on by
  default, under **Settings > Policies**) lets members create Agents; when it is
  off, only admins do.
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
  inside names that already carry it: the `platform/v1` package, the `platform`
  authorization scope.
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

#### "Share" (the word)

"Share" means giving people access to a resource, as in Google Drive.

- **Use it for**: **Manage access** and the Grants it writes ("share the Agent
  with the Support Team"), a conversation's share dialog, and plain English that
  keeps its sense: a **shared vault**, "the share of runs that passed".
- **Say instead**: a hosted link or widget people chat with an Agent through is
  a **chat link**, a [Channel](#channel) of type `web`. Never "a share",
  `share link` or "a shared Agent".
- **Context rule**: If people can chat through it, it is a channel. If people
  gain a role on it, it is shared.

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
  Federation Issuer's `external_id_claim`; the plan feature `child_orgs` and its
  limit `included_child_orgs`.
- **Note**: One level deep: a child has no children, and is never moved to
  another parent. `parent_org` and `external_id` are fixed at create. An
  Organization that still has children cannot be deleted. Nobody owns a child
  when it is created; its parent's admins are its admins.
- **Context rule**: Use in concepts, how-to and reference. On the sales site,
  say "an organization for each of your customers". Never "platform-managed",
  "managed organization", "tenant organization" or "sub-organization".

---

#### External id

The identifier an integrator keeps for one of its customers (`cust-4411`), set
on that customer's child organization or on the vault that holds that customer's
keys.

- **Capitalize**: No.
- **API surface**: `OrganizationSpec.external_id`, unique among one parent's
  children; `getByExternalId(parent_org, external_id)`; a Federation Issuer's
  `external_id_claim` names the JWT claim that carries it.
  `VaultSpec.external_id`, unique in the vault's Organization;
  `getByExternalId(org, external_id)`.
- **Context rule**: "external id" in prose, `external_id` in identifiers. Not
  "external org id" and not "tenant id".

---

#### Parent admin

An admin of a parent organization, who is an admin in each of its child
organizations.

- **Capitalize**: No.
- **API surface**: the model relation `parent_admin` on the child
  (`fga/model/tenancy/organization.fga`), which feeds the child's `admin` role,
  and with it every permission a child's admin holds, and its `can_delete` and
  `can_assign_roles`.
- **Note**: A parent admin needs no joining step: they read and change a child's
  Agents, Skills, Plugins, shared Vaults, eval runs, teams, Federation Issuers
  and sign-in settings, grant access, and see its billing and full access
  history, as the child's own admins can; they also delete the child and make
  someone its owner. A person's conversations (Sessions), My vault and Memories
  stay private from every admin, a parent admin's included; nothing impersonates
  a child's user. The same shape as Stripe's connected accounts and Twilio's
  subaccounts.
- **Context rule**: Use in concepts and reference. In how-to, say "your
  Organization's admins" when the reader is the parent.

---

#### Agent hour

An hour an agent spends working on a Session: thinking, calling tools, writing
files. Time spent waiting for a person, for an approval or for the next message,
is never an agent hour.

- **Capitalize**: No. Write "agent hours", "working agent hours".
- **API surface**: the plan limit `included_agent_hours` on `EntitlementLimits`
  (the hours an Organization may use each month) and the plan term
  `per_agent_hour_micros` on `PlanTerms` (the price of each hour past them;
  absent, the Organization pauses at its allowance).
- **Note**: Stigmer Cloud counts agent hours, because its agents run on
  Stigmer's computers; a child organization draws on its parent's hours. A
  self-hosted deployment runs on its own computers and counts none; a license
  ignores both fields. Model tokens are never counted or priced as agent hours.
  Every edition's usage reports show each run's [working time](#working-time);
  agent hours are the working time a Stigmer Cloud plan counts, in Stigmer's
  sandboxes, never an automatic grade's. Where an Organization stands against
  its allowance is on **Settings → Billing** and in `stigmer usage hours`.
- **Context rule**: "agent hours" in every context. Never "compute hours" or
  "session hours".

---

#### Working time

How long an agent worked on a run: thinking, calling tools, writing files.
Waiting for a person is never working time. Each stretch of work is credited to
the run whose start began it.

- **Capitalize**: No.
- **API surface**: `working_seconds` on the usage reports
  (`UsageReportAggregate`, `RunUsageSummary`, `SessionUsageSummary`,
  `AgentUsageSummary`). CLI: `stigmer usage session|agent|org` (`Working time:`
  and the `WORKING` column).
- **Note**: a clock, never priced, shown in every edition. On Stigmer Cloud it
  can exceed a plan's [agent hours](#agent-hour), which count only the turns
  Stigmer's sandboxes run and never an automatic grade. Installing an
  [Environment](#environment)'s packages happens inside a turn, so it is working
  time, and agent hours on Stigmer Cloud.
- **Context rule**: "working time" in usage reports; "agent hours" for what a
  plan includes and bills. Never "agent hours" for a usage report's figure.

---

#### Edition

One of the three ways Stigmer is offered: **Stigmer** (open source, free under
Apache 2.0, run yourself), **Stigmer Enterprise** (the same server with a
license key, run on your own infrastructure on an annual license) and **Stigmer
Cloud** (the managed service, on plans). Every edition runs Agents on the
customer's own model provider key; Stigmer runs no model of its own.

- **Capitalize**: Yes. The three are names: "Stigmer Enterprise", "Stigmer
  Cloud". Say "Stigmer open source" where the first must be told apart from the
  other two. "Edition" itself is lowercase.
- **API surface**: `ServerEdition` (`oss`, `enterprise`, `cloud`; wire names
  kept); the SDK's `DeploymentMode` (`"local"`, `"enterprise"`, `"cloud"`).
- **Note**: "Enterprise Cloud" is Stigmer Cloud's quoted top plan, never an
  edition: Stigmer Enterprise is self-hosted, and Enterprise Cloud is run by
  Stigmer. The pricing page and the console name the plan "Enterprise Cloud",
  never "Enterprise" alone.
- **Context rule**: The same three names on the site, in the README, on the
  pricing page and in the docs. Never "OSS edition", "self-hosted Cloud", "EE"
  in prose, or "free model": Stigmer hosts none.

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
  `external_id`. Values are write-only: no read returns one. Each place that
  names vaults holds them in an ordered `vaults` list; a Session also sets
  `include_my_vault` to use each sender's own My vault first. An Agent names no
  vaults.
- **Where vaults are named**: a Session, a Routine (`agent.vaults`), a Channel
  (a chat link only when its audience is public: members' runs use their own)
  and an Organization's embedding settings each carry `vaults`. A run with no
  person sending (a routine's run, a Slack, WhatsApp or chat-link guest message)
  and an app user's turn use the vaults of that Routine, channel or embedding
  setting after the conversation's.
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

A named setup for the sandboxes Agents run in: the packages installed in each
one and the websites it may reach. A conversation uses the one it names, else
its routine's, else its Agent's default, else its Organization's.

- **User-facing alternative**: "the packages and network for your Agent's
  sandbox" on first use in introductory copy; "Environment" after that.

<!-- vale Stigmer.terms = NO -->

- **Capitalize**: Yes, when naming the Stigmer resource ("an Environment", "the
  data-science Environment"). Lowercase in "environment variables" (an Agent's
  `env`, the variables its tools read) and the generic "the run's environment".
  The console's Agent page has two sections side by side, **Environment** (the
  resource) and **Environment Variables** (`env`); keep the two words apart in
  prose too.

<!-- vale Stigmer.terms = YES -->

- **API surface**: `kind: Environment`, prefix `env`. proto:
  `environment/v1/spec.proto`, `environment/v1/api.proto`. Named by
  `environment_ref` on a Session, an Agent and a Routine's `agent`, and by
  `default_environment_ref` in an Organization's preferences; a Session records
  the one it runs in as `status.environment` and whose choice that was as
  `status.environment_source`. `GetServerInfoOutput.environments` says whether
  Environments apply on a server and what its sandboxes can do. CLI: the unified
  verbs (`stigmer apply`, `stigmer get environment`,
  `stigmer list environments`, `stigmer delete environment`) and
  `stigmer run --environment`.
- **Key fields**: `networking` (`type: unrestricted`, or `type: limited` with
  `allowed_hosts`, `allow_package_managers` and `allow_mcp_servers`) and
  `packages` (`apt`, `cargo`, `gem`, `go`, `npm`, `pip`), the same shape as
  Claude Managed Agents' environment config.
- **Roles**: only an Organization's admins create one. It has an owner and
  viewers, and the Organization can see it by default; naming one needs view.
- **Context rule**: An Environment holds no secret, no variable and no image.
  Never call a place where keys are saved an Environment: say vault. A file that
  used `kind: Environment` for variables and secrets, from before the kind meant
  this, now fails validation: its secrets go in a vault, its plain settings in
  the Agent's `env`. See [Environments](/docs/concepts/environments).

**Good examples**:

| Context    | Copy                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| Quickstart | "Your Agent's sandbox needs `pandas`. Ask an admin for an Environment that installs it."                    |
| Concepts   | "A conversation keeps the Environment it started with; an edit to it reaches the next sandbox that starts." |
| Reference  | "`EnvironmentSpec.networking`---`unrestricted`, or `limited` to `allowed_hosts`."                           |

**Bad examples**:

| Context | Copy                                   | Problem                                                                  |
| ------- | -------------------------------------- | ------------------------------------------------------------------------ |
| How-to  | "Put the API key in the Environment."  | An Environment holds no secrets; keys go in a vault.                     |
| Any     | "Set the environment for the sandbox." | Lowercase reads as environment variables; name the Environment you mean. |

---

#### Preference

A standing default or free-text context a user or Organization declares once,
applied to their runs automatically, and always overridable where a per-action
control exists.

- **Capitalize**: Yes, when referring to the Stigmer concept.
- **API surface**: not a resource kind — a spec message on existing kinds:
  `OrganizationSpec.preferences` (`OrganizationPreferences`: `standing_context`,
  `memory_enabled` and `default_environment_ref`, the
  [Environment](#environment) its conversations run in when nothing else names
  one) and `IdentityAccountSpec.preferences` (`IdentityAccountPreferences`),
  each with `standing_context`. The server snapshots the texts onto
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

#### Federation Issuer

An outside issuer whose tokens Stigmer accepts for its own users: your identity
provider (Auth0, Okta, …) is registered as a Federation Issuer. It holds the
issuer, its signing keys, the audience its tokens carry for Stigmer, and what
those tokens get.

- **Capitalize**: Yes, when referring to the Stigmer resource.
- **API surface**: `kind: FederationIssuer` (enum `federation_issuer`), prefix
  `fis` (ids minted before the rename keep `idp`). proto:
  `iam/federationissuer/v1/spec.proto`.
- **Key fields**: `jwks_uri`, `allowed_issuers`, `expected_audience`,
  `create_accounts_on_sign_in`, `sign_in_role`, `external_id_claim`.
- **Context rule**: Do not use on the sales site. In quickstart, say "your
  identity provider" in lowercase and gloss it once: "registered as a Federation
  Issuer". In concepts and how-to, capitalize as "Federation Issuer." In
  reference, use `FederationIssuer`. "Identity provider" in lowercase keeps its
  everyday sense: the outside provider itself (Auth0, Okta, Keycloak), whatever
  Stigmer calls its registration.
- **Note**: A Federation Issuer is not a user database---it defines how Stigmer
  validates externally issued JWTs. One Federation Issuer is one issuer and its
  key set, so a platform with a production and a staging tenant registers one of
  each. It is owned by an Organization and can route its users to that
  Organization's child organizations. Each token it vouches for is a **bound
  credential**: it works in the child organization `external_id_claim` names, or
  in the issuer's own Organization.
- **Former names**: `IdentityProvider` (`kind: IdentityProvider`, "Identity
  Provider"). Do not use it in new writing.

---

#### Identity Account

A principal that Stigmer can authenticate and authorize. Comes in five types:
Direct (user signed up on Stigmer), Federated (created via a Federation Issuer),
App user (signed in by your product's backend with a minted user token), Service
account (an Organization's own account for automation), and Machine (the hosted
platform's own service-to-service account, never created by a customer).

- **Capitalize**: Yes, when referring to the Stigmer resource.
- **API surface**: `kind: identity_account`, prefix `ida`. proto:
  `iam/identityaccount/v1/spec.proto`.
- **Key fields**: `provisioning_mode` (`direct`, `federated`, `app_user`,
  `machine`, `service_account`), `federation_issuer_ref`, `idp_id`.
- **Context rule**: Do not use on the sales site. In how-to and concept docs,
  capitalize as "Identity Account." In reference, use `IdentityAccount`. In
  quickstart, avoid unless the tutorial covers federation or minted user tokens.
- **Note**: Federated accounts can be provisioned via JIT (automatic on first
  token, when the Federation Issuer sets `create_accounts_on_sign_in`) or
  explicitly via `createFederatedAccount`. App users are created by
  `mintUserToken` when the Organization's embedding settings set
  `create_accounts_on_sign_in`, or by the integrator beforehand.

---

#### Service account

An Organization's own account for automation: a CI job, a script or a backend
that should keep working when the person who set it up leaves.

- **Capitalize**: No. "service account" in prose; "Service accounts" as a
  console heading.
- **API surface**: an Identity Account with
  `provisioning_mode: service_account`.
  `IdentityAccountCommandController.createServiceAccount`,
  `IdentityAccountQueryController.listServiceAccounts`. CLI:
  `stigmer service-account create|list`, and
  `stigmer apikey create --service-account <name>` for its key.
- **Context rule**: Point every CI and automation example at a service account,
  never at a person's API key. Never call it a "machine account" or a "bot":
  Machine is the platform's own account type.
- **Note**: It holds one Organization role (Admin, Member or Viewer, never
  Owner), acts only through API keys its Organization's admins create for it,
  and works only in its own Organization. See
  [Service accounts](/docs/guides/authentication/service-accounts).

---

#### Access history

The record of every time someone in an Organization was given or lost access,
who made the change, why, and when.

- **Capitalize**: No. "access history" in prose; "Access history" as a console
  heading.
- **API surface**: `GrantQueryController.listAccessHistory`, answering
  `AccessHistoryEntry` items; the permission `can_view_access_history`. CLI:
  `stigmer access-history list|export`.
- **Context rule**: "access history" for what people read. "Permission history"
  is the operator's word for the stored table (`grant_history`), in self-hosting
  docs only. Never "audit log": it records access changes, not everything people
  did.
- **Note**: Kept by Stigmer Enterprise and Stigmer Cloud, read by an
  Organization's owners and admins. Each Organization numbers its entries in
  order with no gaps (`sequence`), which is what lets a tool export "everything
  after N". See [Access history](/docs/guides/authentication/access-history).

---

#### API key

A static secret that authenticates calls to the Stigmer API.

- **Capitalize**: "API key" in prose; `ApiKey` in reference.
- **API surface**: `kind: api_key`, prefix `key`. proto:
  `iam/apikey/v1/spec.proto`. CLI: `stigmer apikey`.
- **Key fields**: `expires_at`, `bound_org` (limits a person's key to one
  Organization).
- **Context rule**: Say whose key it is. A key speaks for the account it is for:
  the person who created it, or the service account an admin created it for. In
  CI and automation examples, the key is a service account's.

---

#### Identity federation

The pattern of letting users from an external authentication system access
Stigmer without creating Stigmer-native accounts.

- **Capitalize**: No. "Identity federation" is a pattern, not a Stigmer resource
  type. Do not capitalize "federation" unless it starts a sentence.
- **Related resources**: Federation Issuer, Identity Account, Grant.
- **Context rule**: Use in federation guides and concept pages. On the sales
  site, say "your users sign in with their existing credentials" without naming
  the mechanism. In quickstart, avoid unless the tutorial covers federation
  setup.

---

#### Bound credential

A credential that names one Organization and works in that Organization and its
child organizations only, whatever roles its person holds elsewhere.

- **Capitalize**: No. "Bound credential" is a property of a credential, not a
  Stigmer resource type.
- **Examples**: a minted user token (bound to the Organization it was minted
  for: the minting service account's, or a child of it), a federated token
  through a Federation Issuer (bound to the child organization
  `external_id_claim` names, or the provider's own), an API key limited to an
  Organization (`ApiKeySpec.bound_org`), and the credential a runner holds for
  one run (bound to the run's Organization). A person signed in at the Stigmer
  Console with their own Stigmer sign-in is not bound and moves between all
  their Organizations.
- **Reach**: its Organization's resources; for a credential bound to a parent,
  each of that parent's child organizations, exactly as the account behind it
  would there (an admin service account's key acts as an admin in each child, a
  viewer's only reads), and minting keys limited to one of them; the person's
  own account, and their API keys limited to the same Organization; in a child
  organization, reading and running the Agents, Skills and Plugins its parent
  shares at `visibility_child_orgs`. A credential bound to a child never reaches
  the parent or another child, and the credential a runner holds for one run
  works only in the run's Organization. It cannot create an Organization, except
  a child of its own, or accept an invitation to another one. One exception: a
  platform operator's acts (plans, the model catalog, licenses) follow the
  person's platform role, so their limited key still performs them.
- **Context rule**: Use in authentication guides and reference. On the sales
  site, say "a key limited to one Organization." In quickstart, avoid unless the
  tutorial covers API keys, federation or minted user tokens.
- **Note**: a bound credential used in an Organization it does not reach gets
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
  membership is a Grant of `member` on the Team; a share with a Team names it as
  `team:<id>#member`.
- **Key fields**: `description`. The members are the access list on the Team,
  not a field.
- **Editions**: Stigmer Enterprise and Cloud. The open-source edition grants
  roles on the Organization only; granting one resource to a person or a Team is
  Enterprise and Cloud.
- **Context rule**: On the sales site, say "share with your teams." In concepts
  and how-to, capitalize as "Team." In reference, use `Team`. In quickstart,
  avoid unless the tutorial covers access management.
- **Note**: A Team's members are always members of its Organization; removing
  someone from the Organization removes them from every Team at once. Slack
  calls a workspace a "team", so a Slack channel's `status.slack.team_id` names
  a Slack workspace; it is never a Stigmer Team.

---

#### General access

Who in an Organization reaches a resource without being added to it: **Private**
(its creator, the people it is shared with, and, for an Agent, Skill or Plugin,
the Organization's admins), **Organization** (everyone in it), or **Child
organizations** (everyone in every child organization).

- **Capitalize**: The level names, when naming the setting ("set it to
  Organization"); "general access" in prose.
- **API surface**: `metadata.visibility` (`visibility_private`,
  `visibility_org`, `visibility_child_orgs`); each kind's offered levels are in
  its `kind_meta.authorization.visibility`. Agents, Skills and Plugins offer all
  three and default to Organization; a shared vault offers Private and
  Organization.
- **Context rule**: "General access" in the console and concept docs, as Google
  Drive says it; "visibility" in reference. Never "public" for a level, and
  never "Platform" (see [Public (visibility)](#public-visibility)).
- **Note**: General access widens who sees and uses a resource, never who may
  spend: starting a conversation also needs the Organization's Member role. See
  [Sharing and access](/docs/concepts/sharing-and-access).

---

#### Role

What a person, a Team or a service account may do with one resource, or in an
Organization.

- **The words**: **Viewer** sees it and changes nothing; **Editor** changes it
  and never deletes it or decides who has access; **Owner** does everything. Two
  kinds keep their own word: **Participant** on a Session or a Channel (reads
  and sends messages) or on a Routine (starts it, with a note, and reads its
  conversations), and **Can use** on a shared vault (its logins and secrets
  reach the person's runs). An Organization's roles are Owner, Admin, Member and
  Viewer.
- **Capitalize**: Yes, when naming a role ("grant Viewer", "an Organization
  Admin"). "admins" and "members" stay lowercase as plain nouns.
- **API surface**: `IamRole` (`iam/v1/enum.proto`), each value's `role_meta`
  display name, and each kind's `grantable_roles`, `team_grantable_roles` and
  `role_descriptions`. The generated
  [Roles and general access](/docs/sdk/resources/roles) page lists every kind's.
- **Context rule**: Use the kind's own sentence for what a role allows: an
  Agent's Viewer runs it, a Session's Viewer sends nothing. Never "read-only"
  for a role that runs or sends, and never a new role word without a reason the
  kind's sentence states.
- **Editions**: Every edition grants the Organization's roles. Granting a role
  on one resource is Enterprise and Cloud.

---

#### Grant

One role given to one principal on one resource: Alice is Viewer on an
Organization, a Team is Editor on an Agent. Who holds what on a resource is the
set of its grants.

- **Capitalize**: Yes, when referring to the Stigmer resource ("create a
  Grant"). "grant" in lowercase is the act ("grant Viewer").
- **API surface**: `kind: Grant` (enum `grant`), prefix `grt`. proto:
  `iam/grant/v1/spec.proto`. `GrantCommandController` creates and deletes
  grants; `GrantQueryController` reads them and answers the permission checks
  they decide (`checkMyPermission`, `checkAuthorization`). A Grant's id is
  derived from its principal, resource and role, so one grant is only ever one
  record.
- **Key fields**: `principal`, `resource`, `relation` (the role).
- **Context rule**: Google Cloud calls the same record a **binding** and the
  whole set on a resource a **policy**; Stigmer calls the record a Grant and
  never calls the set a policy. In concepts and how-to, "Grant"; in reference,
  `Grant`. On the sales site, say "give people access".
- **Note**: A Session's **grant** is another meaning: allowing every call of one
  kind for the rest of the run (`grantPermission`, the event
  `stigmer.permission.grant`, the console's approve-all button; see
  [Approval flow](#approval-flow-human-in-the-loop)). No record stores it, and
  it is never a Grant.
- **Former names**: `IamPolicy` (`kind: IamPolicy`, "IAM Policy"), whose ids
  read `iamp_`; stored grants moved to `grt_` with the rename. Do not use it in
  new writing.

---

#### Embedding settings

How an Organization's own product signs its users in: which web origins may use
the minted tokens, whether a first sign-in creates the person's account and with
which role, and which shared vaults their runs use.

- **Capitalize**: No. "Embedding settings" is a group of settings, not a Stigmer
  resource type. The console's section is **Embedding**.
- **API surface**: `OrganizationSpec.embedding` (`OrganizationEmbedding`),
  written only through `updateEmbedding`;
  `OrganizationStatus.embedding_vault_attachers`. The tokens come from
  `TokenService.mintUserToken` (`iam/token/v1/token.proto`), called with an
  admin service account's API key.
- **Key fields**: `allowed_origins`, `create_accounts_on_sign_in`,
  `sign_in_role` (never owner), `vaults` (the integrator's own keys, used by the
  runs of the users it signs in).
- **Context rule**: Do not use on the sales site---say "embed Stigmer in your
  app" or "add Stigmer to your product." In quickstart, avoid unless the
  tutorial covers signing your product's users in.
- **Former names**: the settings of a `PlatformClient`
  (`kind: platform_client`), removed with the kind. Do not use it in new
  writing.

<!-- vale Vale.Spelling = NO -->

- **Note**: the service account's key authenticates your backend, not your
  users. The backend calls `mintUserToken` to get user-scoped JWTs, each a
  **bound credential**: one minted into a child works in that child only. This
  is the same pattern used by Twilio (Access Tokens), Stream (User Tokens), and
  Liveblocks (access tokens).

<!-- vale Vale.Spelling = YES -->

---

#### App user

A person your product signs in to Stigmer with a minted user token, rather than
someone with their own Stigmer sign-in.

- **Capitalize**: No, except at the start of a sentence or as the console's
  label ("App users").
- **API surface**: an `IdentityAccount` with `provisioning_mode: app_user`.
- **Context rule**: Use in authentication guides, concepts and the console. The
  people it signs in appear as **App users** in the console's people pickers,
  apart from the Organization's own people.
- **Note**: an app user's conversations and memory are their own. An app user
  who already has an account signs in with the roles they hold now; the
  embedding settings' `sign_in_role` is granted only when a sign-in creates the
  account.

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
message, start a routine or open a chat link.

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

- **What a run did**: its Session's events with the run's `run_id`: messages,
  tool uses and answers. The run itself holds its lifecycle (phase, timing, stop
  cause) and its file record (`status.file_changes`).
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
  (`kind: AgentRun`, `Agent Run`). Do not use them in new writing.

---

#### Channel App

A customer-owned messaging-platform app (your own Slack app, or your Meta app
with WhatsApp Business access) that Slack and WhatsApp channels install through.

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

#### Score

One grade of a finished run: a person's thumbs up or down on the final answer,
the free run-health checks Stigmer runs on every completed run, an AI judge's
verdict, or an eval run's checks on one try.

- **Capitalize**: As the resource name in labels and reference pages
  (`kind: Score`). In prose say "score" in lower case, as "run".
- **API surface**: `kind: Score`, prefix `scr`. proto:
  `agentic/score/v1/spec.proto`. Written by a person rating a run in the
  console, by the platform's checks, by its AI judge or by an eval run; there is
  no `apply` and no manifest. CLI:

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
- **Boundaries**: a Score is not a usage report (tokens per run), and a
  not-graded score is never a failing one: it means the run could not be graded.
- **Note**: a score's visibility is its run's. Whoever can see the run sees its
  scores; nothing is shared on a score by itself.

---

#### Quality report

How one Agent's live runs in one Organization were graded over the last 7 to 90
days (runs, run-health, AI grading, thumbs), counted in total, per UTC day, and
per Agent version. The top of the Agent's Quality tab.

- **Capitalize**: Lower case in prose ("the Agent's quality report"); "Quality"
  only as the tab's name.
- **API surface**: not a resource. `ScoreQueryController.getAgentQualityReport`
  and `listFlaggedByAgent` (proto: `agentic/score/v1/query.proto`). CLI:

  ```bash
  stigmer agent quality <agent>
  stigmer agent quality <agent> --flagged
  stigmer agent quality <agent> --agreement
  ```

- **Key fields**: `total`, `days` and `versions`, each a summary of distinct
  `runs` and one tally per metric and evaluator version (`passed`, `failed`,
  `not_graded`, `pending`, and per criterion); `agreement`, per judge rubric
  version, people's thumbs counted against each rubric's verdict on the same
  runs.
- **Boundaries**: counts only, never a reason, a comment or an answer, so it
  counts conversations its reader cannot open. The flagged list returns whole
  scores and shows only runs the reader can open. Eval tries are not counted.
- **Note**: two versions of the same checks or rubrics are never added together;
  each is its own tally.

---

#### Scoring Rule

AI grading switched on for one Agent: how many of its runs an AI judge grades,
the monthly spending limit, and the judge's model.

- **Capitalize**: As the resource name in labels and reference pages
  (`kind: ScoringRule`, display name "Scoring Rule"). In prose say "AI grading"
  for what it does; "scoring rule" in lower case for the setting itself.
- **API surface**: `kind: ScoringRule`, prefix `srl` (ids minted while it was
  named Evaluator keep `evl`). proto: `agentic/scoringrule/v1/spec.proto`. Set
  in the Agent's Quality tab in the console; there is no `apply` and no
  manifest, so an Agent's YAML never carries grading criteria. CLI:

  ```bash
  stigmer get scoring-rule <id>
  stigmer delete scoring-rule <id>
  ```

- **Key fields**: `agent_id`, `enabled`, `sample_rate` (0 to 1: 0.1 grades one
  run in ten), `monthly_limit_usd` (estimated model spend per UTC month),
  `model_name`, and the status's `spent_usd`, `reserved_usd`, `graded`,
  `not_graded` and `last_not_graded_reason` for the current month.
- **Boundaries**: a scoring rule configures grading; the grades themselves are
  Scores on each run. The rubrics are Stigmer's, the same in every Organization:
  `did-the-task`, `made-nothing-up`, `acted-only-as-asked` and
  `asked-when-unclear`. A Score's `evaluator_version` is the version of the
  checks or rubrics that gave it, on every kind of score, not this resource.
- **Note**: other products call one judge an evaluator and the setting that
  turns judges on for live traffic a rule; this is that rule, with Stigmer's
  four judges, and beside Eval and Eval Run the name does not read as the thing
  that runs evals. It was named Evaluator until then. Access is the Agent's:
  whoever may edit the Agent configures its grading, whoever may view it sees
  the settings.

---

#### Eval

A set of test cases for an Agent: an evals/ folder in Claude Code's plugin-eval
format, pushed whole and kept with every version. Pushing the same folder again
changes nothing; a changed folder is a new version, reachable by its digest or
by a tag. An eval run on an Agent runs an eval's cases, its mocks standing in
for the Agent's own servers and its plugins'.

- **User-facing alternative**: "eval" in prose ("push the eval", "the support
  agent's evals"); its contents are "test cases". Never "eval suite" for the
  resource.
- **Capitalize**: As the resource name in labels and reference pages
  (`kind: Eval`, display name "Eval"). In prose say "eval" in lower case.
- **API surface**: `kind: Eval`, prefix `evs`. proto:
  `agentic/eval/v1/spec.proto`. Pushed as a folder; there is no `apply` and no
  manifest. Visible to its whole organization by default, or private to its
  owner. CLI:

  ```bash
  stigmer push eval <folder> --name <slug> [--tag <tag>] [-m <message>]
  stigmer get eval <slug>
  stigmer list evals
  stigmer download eval <slug>[@<digest|tag>] [-o <dir>]
  stigmer delete eval <slug>
  ```

- **Key fields**: `spec.tag` (the tag the current version holds), and the
  status's `digest`, `case_count`, `cases`, `findings` (cases that do not load)
  and `mock_servers` (the servers its mocks stand in for).

---

#### Eval Run

One run of test cases: on an Agent, the cases of the plugins it uses or of the
evals it names, tried several times on the Agent itself; or on a plugin, the
plugin's own cases, tried on the built-in assistant. Comparing a plugin tries
each case with the plugin and without it and records the difference it makes. An
eval run on an Agent is stamped with the Agent's version, so two versions
compare side by side.

- **User-facing alternative**: "eval run" in prose ("start an eval run", "the
  Agent's eval runs"); "evals" for the feature and the tab. The cases are a
  plugin's or an eval's "test cases".
- **Capitalize**: As the resource name in labels and reference pages
  (`kind: EvalRun`, display name "Eval Run"). In prose say "eval run" in lower
  case.
- **API surface**: `kind: EvalRun`, prefix `evr`. proto:
  `agentic/evalrun/v1/spec.proto`. Started from the Evals tab of an Agent or a
  plugin in the console, or with `stigmer eval run`; there is no `apply`, no
  update and no manifest. CLI:

  ```bash
  stigmer eval run --agent <agent>[@version] [--plugin <plugin>] [--cases-from <plugin>]... [--eval <eval>[@<digest|tag>]]...
  stigmer eval run --plugin <plugin>[@digest]
  stigmer eval cancel <id>
  stigmer get eval-run <id>
  stigmer delete eval-run <id>
  ```

- **Key fields**: the subject, `agent_id` or `plugin_id` (exactly one);
  `agent_version` (stamped as its hash), `compared_plugin_id` (the plugin each
  case runs with and without, on an Agent), `cases` (whose cases run, on an
  Agent), `plugin_digest` (on a plugin), `targets`, `runs`, `ablation`
  (`with_without` or `none`), `threshold`, `allow_tools`, `max_cost_usd`, and
  the status's `phase`, `agent_version_hash`, one block per plugin a try loads
  (whether the Agent attaches it, whether it is compared, the version its tries
  ran, its cases' results), one block per eval it runs (the version its tries
  ran, its cases' results), `aggregates` and `cost_usd`.
- **Boundaries**: an eval run measures an Agent or a plugin on test cases; a
  scoring rule grades an Agent's live runs. The criteria live in the plugins'
  `evals/` folders or in evals, in Claude Code's plugin-eval format, never in an
  Agent's YAML.
- **Note**: the editors of its Agent or plugin start, cancel and delete it, and
  comparing a plugin the Agent does not use takes being able to view it; the
  viewers in its own Organization read it. Its Organization pays for every try.
- **Editions**: in Stigmer Cloud every viewer of its Agent or plugin in its
  Organization opens each try's conversation, read-only. In open source the
  tries belong to the eval run's creator, who opens them; the other viewers read
  the eval run, its results and each try's scores, and cannot open a try's
  conversation.

---

#### Try

One run of one test case in an eval run, in a fresh conversation of its own:
what Claude Code calls a run of a case.

- **Capitalize**: No.
- **API surface**: `EvalRunTry` in `agentic/evalrun/v1/status.proto`, with its
  `run_id`, `score`, and `not_graded_reason`.
- **Boundaries**: a try is an ordinary run; "try" names its place in the eval
  run. Say "try" for the eval run's unit and "run" for the run itself, so "three
  tries per case" never reads as three separate commands.
- **Note**: a try the platform could not run or grade is "not graded" with a
  reason and left out of every score, never a zero.

---

#### Arm (with-arm, without-arm)

One side of an eval run's comparison: the with-arm is a case's tries with the
compared plugin, the without-arm the same number of tries with that plugin left
out of the whole turn.

- **Capitalize**: No. Write "with-arm" and "without-arm" with hyphens.
- **API surface**: `EvalRunCaseTarget.with_plugin` and `without_plugin`
  (`EvalRunArm`); `ablation: eval_run_ablation_none` runs the with-arm only; a
  without try's run carries `excluded_plugin_ids`. In the result file:
  `cases[].arms.with` and `cases[].arms.without`.
- **Note**: the difference between the two arms' scores is `Δ` ("delta"), what
  the plugin contributed. The table headers are `WITH` and `W/OUT`, as in Claude
  Code.

---

#### pass^k

Whether every one of a case's k with-arm tries scored 1.0: a case that passes^k
works every time, not only on average.

- **Capitalize**: No; written `pass^k` in prose and `PASS^k` as a table header.
- **API surface**: `EvalRunCaseTarget.pass_k`; `passK` in the result file.
- **Boundaries**: Stigmer's addition to Claude Code's format, which reports the
  mean score and "perfect runs" (the share of with-arm runs where every grader
  passed) instead.

---

### Tier 3---Technical and internal

These terms appear only in reference documentation, SDK guides, architecture
pages, and internal discussions. They should never appear on the sales site and
only in tutorials when unavoidable.

---

#### Subagent

An Agent the main Agent of a conversation hands a task to. It works in its own
context and reports back to the main Agent. A saved subagent is an Agent of its
own that another Agent lists, and runs its own instructions, model, tools,
plugins, Skills, hooks and values; a plugin subagent comes from a plugin's
`agents/` folder, and narrows the conversation's tools.

- **Capitalize**: No, one word: "subagent," as Claude Code and Claude Managed
  Agents spell it. "Subagent" only to start a sentence; never hyphenated.
- **API surface**: `AgentSpec.subagents` in `agent/v1/spec.proto`, a list of
  saved Agents by reference (`kind: agent`), each pinned to a version when the
  listing Agent is saved. A plugin's agents are named `<plugin>:<agent>`
  (`PluginStatus.agents`). A run's subagents are threads in the Session's events
  (`session.thread_created`).
- **Retired shape**: subagents written inside an Agent (`sub_agents`) are gone;
  a reader meets the field only in the sentence `stigmer apply -f` and
  `stigmer validate -f` print for a manifest that still writes it, which says to
  save each one as an Agent and list it in `subagents`.
- **Context rule**: Concepts and reference only. Never on the sales site. In
  tutorials, if needed, describe as "an Agent that hands work to another Agent."

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

Stigmer resources are declarative: a file states what a resource should be, and
the server makes it so. Every resource has the same top-level fields:
`apiVersion`, `kind`, `metadata`, `spec`, and `status` where the system records
state.

- **apiVersion**: The kind's group and version: `agentic.stigmer.ai/v1` for
  Agents, Skills, Plugins and their kin, `iam.stigmer.ai/v1` for identity kinds
  such as Federation Issuer.
- **kind**: The resource type (for example, `Agent`, `Skill`, `Plugin`).
- **metadata**: the ID, `slug`, `name`, `org`, `visibility`, `labels`, `tags`,
  and `etag`; the entries below explain each.
- **spec**: The resource-specific configuration.
- **Context rule**: Show by example in quickstart (the reader sees the YAML
  structure). Explain the pattern in concepts. Define the fields in reference.
  Never mention on the sales site.
- **Do not say**: "Kubernetes-style resources" or "CRD-like definitions" on the
  sales site or in introductory pages, where an infrastructure analogy is a
  barrier. A reference page may name the Kubernetes label syntax or the API
  design rule (AIP) a behaviour follows, as the proto comments do, because the
  reader can look the exact rule up.

---

#### Slug and ID

Every resource has two names. The ID is permanent and assigned by the server
(`agt_…`); the slug is the short name people type, unique within its
Organization, and it can be renamed.

- **Capitalize**: No. Prose writes "ID"; the field is `metadata.id`.
- **API surface**: `metadata.id`, `metadata.slug`; `rename` on every kind whose
  slug may change. After a rename the old slug keeps leading to the resource for
  reading for 30 days, and nothing else of the kind can take it then. A write
  that names the old slug is refused with `SLUG_RENAMED`, and a create or rename
  that asks for it is refused with `SLUG_RESERVED`.
- **Context rule**: "slug" in reference, concepts and how-to; in tutorials,
  gloss it on first use ("the slug, the short name in the URL"). On the sales
  site, describe the benefit: "rename anything without breaking what uses it."
- **Do not say**: "the name" for the slug where `metadata.name` (the display
  name) could be meant; "fixed once created" for a slug.

---

#### Reference

How one resource names another: an Agent's Skills, Plugins and subagents, a
Routine's Agent. A person writes a reference by slug, by ID or both; the server
stores the ID; every answer names it by the target's current slug.

- **Capitalize**: No.
- **API surface**: `ApiResourceReference`: `org`, `kind`, `slug` or the ID, and
  `version`. A renamed target keeps every reference to it working. A deleted
  target's references come back with an empty slug, and a new resource that
  takes the deleted one's name is never bound to them. A Skill or Plugin
  reference's `version` is read at the start of each turn, and the run records
  what it loaded; a subagent's is fixed when the listing Agent is saved.
- **Context rule**: Concepts and reference. In tutorials, "the Skills your Agent
  uses."
- **Do not say**: "list of Skill IDs" for `skill_refs`: a person writes slugs.

---

#### Update and apply

Two ways to change a resource. An update changes the fields it names and keeps
every other one; an apply states the whole resource, as a file does, and creates
it when it does not exist yet.

- **Capitalize**: No.
- **API surface**: `update(Update<Kind>Input)`: the resource named by
  `metadata.id`, plus an `update_mask` of paths (`spec.instructions`); `*` names
  every path. `apply(<Kind>)`: found by `metadata.id`, then by slug. Either
  carries the `metadata.etag` it read to ask for a freshness check, refused with
  `ABORTED` and `ETAG_MISMATCH` when the resource changed since; without one,
  the last write wins. A file is applied as it is written, never as a freshness
  check: an etag in it is dropped. Visibility, a slug and a vault's secrets each
  change only through their own RPC.
- **Context rule**: "apply" for files and the CLI (`stigmer apply -f`); "update"
  for SDK code that changes one field. In concepts, "a change names only the
  fields it changes."
- **Do not say**: "full spec replacement" or "always provide complete state" for
  an update.

---

#### Page

One slice of a list. Every list returns a page of entries and a token for the
next; the list is complete when the token is empty.

- **Capitalize**: No.
- **API surface**: request `page_size` (0 for the default 50, at most 100) and
  `page_token`; response `entries` and `next_page_token`. No list returns a
  total. The SDKs walk every page with an iterator.
- **Context rule**: Reference and SDK guides. Elsewhere, "the list loads more as
  you scroll."
- **Do not say**: `PageInfo`, "page number" or "total count": none exists.

---

#### Label

A key and value set on a resource to group and filter it (`team: support`). A
list filtered by labels returns only the resources that carry every one.

- **Capitalize**: No.
- **API surface**: `metadata.labels`, at most 64; the `labels` filter on every
  resource list. A key is an optional DNS-style prefix and a slash, then a name
  of at most 63 characters; a value is empty or follows the name rule. The
  `stigmer.ai/` prefix is the platform's and refused from clients.
- **Context rule**: Concepts, how-to and reference. In reference, name the
  syntax as the proto comment does (the Kubernetes label form).
- **Do not say**: "tag" for a label. "annotation": the field was retired, and
  `metadata.annotations` is reserved.

---

#### Tag

A search word on a resource (`billing`, `refunds`). Tags help people find a
resource; they never filter a list.

- **Capitalize**: No.
- **API surface**: `metadata.tags`, at most 20, each lowercase letters, digits
  and hyphens, at most 50 characters (GitHub's topic form). A Plugin's tags come
  from its manifest's `keywords`.
- **Context rule**: Concepts, how-to and reference.
- **Do not say**: "label" for a tag. A Skill version tag (`stable`, `latest`) is
  a version's name, not a search word; say "version tag" where both could be
  meant.

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
default), or to every child organization of its Organization (Child
organizations). Another Organization's work reaches yours as a Plugin you
install and own. A server upgrading from a release that still had the level
moves every row that carried it to Organization visibility.

- **Capitalize**: Yes, when naming the retired level in an upgrade note.
- **Context rule**: Do not use for a resource level in new writing. "Public"
  stays ordinary English for a chat link's audience ("anyone with the link", the
  `public` audience of a chat link) and for a public website or API. A doc
  describing "publishing to the marketplace" or "a public Skill another
  Organization can reference" is describing the retired level; point it at
  Plugin, or at Child organizations when one Organization is the other's parent.

---

#### Agent Instance

Retired term. A `kind: AgentInstance` (prefix `ain`) was a deployed copy of an
Agent bound to its own settings, and a Session named an instance rather than its
Agent; every Agent carried a default one. The kind and its CLI verbs were
removed: a Session names its Agent directly (`agent_ref`) and runs the version
it started on, and a run's keys come from vaults (the conversation's, those of
the Routine or channel that started it, or the sending person's own).

- **Capitalize**: Yes, when naming the retired kind in an upgrade note.
- **Context rule**: Do not use in new writing. A reader still meets the word in
  the sentence `stigmer apply -f` and `stigmer validate -f` print for a manifest
  that still carries `kind: AgentInstance`, which says what happened and names
  `stigmer run`.

---

#### MCP Server (the kind)

Retired term. A `kind: McpServer` was a resource of its own that described one
MCP server, and an Agent attached it through `mcp_server_usages`. The kind was
removed: an MCP server is an entry in a plugin's `mcp.json`, which an Agent or a
conversation lists in `plugins`, or an entry in an Agent's own `mcp_servers`. An
admin's one-off server to share is a plugin of one server
(`stigmer mcp add <name> <url>`). See MCP server and Plugin.

- **Capitalize**: Yes, when naming the retired kind in an upgrade note.
- **Context rule**: Do not use in new writing; write "MCP server", lowercase
  "server". A reader still meets the kind in the sentence `stigmer apply -f` and
  `stigmer validate -f` print for a manifest that still carries
  `kind: McpServer` or `mcp_server_usages`, which says what happened and names
  `stigmer mcp add`.

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

### 4. Cloud README lists "Credential" as a concept---RESOLVED

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

**Resolution**: The Cloud README no longer has an architecture table, and names
no Credential, Environment or Vault (checked 2026-10-10). Logins and secrets
live in vaults ([Vault](#vault)).

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
shorthand exists or is planned. Since the MCP server kind was removed, an Agent
lists the plugins that carry its servers in `plugins`, and `mcp_server_usages`
is a reserved field.

2026-10-15: an Agent now has a real `mcp_servers` field (#2286), a list of the
servers written in the Agent itself (`name`, `url`, `headers`). It is a new
field with its own shape, not the old `mcpServers:` shorthand, which never
pointed at a server kind's references.

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

---

### 7. Resource-contract words---RESOLVED

**What**: Pages and comments written before the one resource contract described
names, references, writes and lists in words that no longer hold.

**Resolution**: Each retired word has a replacement, defined in its entry:

- "fixed once created" for a slug: renamed through `rename` (Slug and ID).
- "list of Skill IDs" for `skill_refs`: references written by slug or ID
  (Reference).
- "full spec replacement" and "always provide complete state" for an update: an
  update changes the fields its mask names (Update and apply).
- `PageInfo`, `page_number` and `total_count` on a list: a page of `entries` and
  a `next_page_token` (Page).
- `annotations` in metadata: retired and reserved; use labels to filter and tags
  to find (Label, Tag).

---

### 8. Chat-link and channel words---RESOLVED

**What**: A hosted chat link was an `Agent Share` ("a share", `share link`, "a
shared Agent"), and a Slack or WhatsApp connection was an `Agent Channel`, two
kinds with different pages, permissions and commands. "Share" meant both a chat
link and giving access, and "surface" named whatever started a run.

**Resolution**: One `Channel` kind with a type replaced both kinds. Each retired
word has a replacement, defined in its entry:

- `Agent Share`, `share`, `share link` and `shared Agent` for a hosted chat: a
  **chat link**, a channel of type `web` (Channel).
- `Agent Channel` for Slack or WhatsApp: a **channel** (Channel).
- `share` for anything but giving access: "share" means giving access only
  (Share (the word)).
- `surface` for what started a run: name it, a Session, a Routine or a channel
  (Vault).

---

### 9. Scheduled-work words---RESOLVED

**What**: Scheduled work was a `Schedule` (`kind: Schedule`, prefix `sch`): a
cron trigger only, started by hand as a `trigger`, and on the hosted edition
every run acted as one hidden schedule account per Organization. "Owner" could
mean the person who created it or anyone who inherited the Owner role, and
"schedule" named both the resource and its timing.

**Resolution**: The `Routine` kind replaced it, shaped after Claude Code's
routines: an optional schedule, a start with an optional note, Participant to
start it, and every run acting as the person or service account that created it,
in every edition. Each retired word has a replacement, defined in its entry:

- `Schedule` and `kind: Schedule` for the resource: a **Routine** (Routine).
- `trigger` and `ScheduleFire` for starting one by hand: **start** and **Run
  now** in how-to docs, `fire` and `RoutineFire` in reference (Routine).
- the hosted edition's schedule account: the routine's **owner**, the account
  that created it; no other account acts for a routine (Routine).
- "schedule" for the resource in prose: "routine". Lowercase "schedule" keeps
  its sense of timing and the verb, and "Temporal Schedule" stays the engine's
  artifact (Routine).

---

### 10. Environment words---RESOLVED

**What**: "Environment" was reserved: the name of a retired resource that held
variables and secrets, which vaults replaced, kept only for "the sandbox a run
executes in". The Session entry named a `sandbox_id` field that no Session has.
When Environment became the kind that says which packages a sandbox installs and
which websites it may reach, the entry contradicted the product.

**Resolution**: The word names the kind again, shaped after Claude Managed
Agents' environments, and keeps its old boundary: it never holds a secret or a
variable. Each retired use has a replacement, defined in its entry:

- "Reserved" and "the sandbox a run executes in": an **Environment**, the named
  setup a conversation's sandbox gets (Environment).
- `kind: Environment` with variables and secrets: a **vault** for the secrets,
  the Agent's `env` for plain settings (Environment, Vault).
- `sandbox_id` on a Session: `environment_ref`, `status.environment` and
  `status.environment_source` (Session).
