# Stigmer vocabulary guide

This is the single source of truth for all Stigmer terminology. Every
customer-facing artifact---sales site, documentation, README, tooltips, error
messages, conference talks---draws its terms and definitions from this document.

**status**: draft, pending review **Created**: 2026-03-31 **Depends on**:
[Positioning document](../_projects/2026-03/20260331.01.content-strategy/design-decisions/positioning.md)

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
- `_roles/002_document_writer.md`---term definitions for AI writing context
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

| Term              | Sales site            | Quickstart / tutorial            | Concepts / how-to   | Reference / SDK                        | README         |
| ----------------- | --------------------- | -------------------------------- | ------------------- | -------------------------------------- | -------------- |
| **Agent**         | Agent                 | Agent                            | Agent               | Agent, `kind: Agent`                   | Agent          |
| **Skill**         | domain knowledge      | Skill ("domain knowledge")       | Skill               | Skill, `skill_refs`                    | Skill          |
| **MCP Server**    | tools                 | MCP server ("tool connection")   | MCP Server          | McpServer, `mcp_server_usages`         | MCP server     |
| **Session**       | conversation          | Session ("conversation")         | Session             | Session, `kind: Session`               | Session        |
| **Runner**        | compute               | runner ("where your Agent runs") | Runner              | Runner, `kind: Runner`                 | runner         |
| **Workflow**      | multi-step automation | Workflow                         | Workflow            | Workflow, `kind: Workflow`             | Workflow       |
| **Approval flow** | approval flow         | approval flow                    | approval flow, HITL | `ToolApprovalPolicy`, `submitApproval` | HITL, approval |
| **Organization**  | Organization          | Organization                     | Organization        | Organization, `kind: organization`     | Organization   |
| **Project**       | Project               | Project                          | Project             | Project, `kind: project`               | Project        |
| **Environment**   | Environment           | Environment                      | Environment         | Environment, `kind: Environment`       | Environment    |

<!-- vale Stigmer.terms = NO -->

| **Identity Provider** | --- | identity provider | Identity Provider |
IdentityProvider, `kind: identity_provider` | Identity Provider |

<!-- vale Stigmer.terms = YES -->

| **Identity Account** | --- | --- | Identity Account | IdentityAccount,
`kind: identity_account` | Identity Account | | **PlatformClient** | --- | --- |
PlatformClient | PlatformClient, `kind: platform_client` | PlatformClient | |
**Agent Instance** | --- | Agent Instance | Agent Instance | AgentInstance,
`kind: AgentInstance` | Agent Instance | | **Agent Execution** | --- | run,
execution | Agent Execution | AgentExecution, `kind: AgentExecution` | Agent
Execution | | **Workflow Execution** | --- | run, execution | Workflow Execution
| WorkflowExecution, `kind: WorkflowExecution` | Workflow Execution | |
**Sub-Agent** | --- | --- | Sub-Agent | SubAgent, `sub_agents` | Sub-Agent |

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
  directory), `stigmer draft skill --name <name>`.
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
  `spec.default_enabled_tools`, `spec.pinned_tool_approvals` (manual overrides),
  `status.tool_approvals` (classified automatically by Connect). Agent
  references via: `spec.mcp_server_usages` (repeated `McpServerUsage` entries
  with `mcp_server_ref` and `enabled_tools`).
- **Protocol**: MCP stands for Model Context Protocol, an open standard. Spell
  out on first use in any context. Link to `https://modelcontextprotocol.io` in
  docs.

**Good examples**:

| Context    | Copy                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sales site | "Connect your Agent to your systems. It checks inventory, creates tickets, updates records---with the same APIs your team already uses."                                                       |
| Quickstart | "Give your Agent tools by adding an MCP server---a connection to an external system like GitHub, a database, or a file store."                                                                 |
| Concepts   | "An MCP Server is a bridge between your Agent and an external system. The Agent discovers what tools are available, and Stigmer handles input validation and execution sandboxing."            |
| Reference  | "`McpServer`---a managed resource defining an MCP server connection. Supports `stdio` and `http` transport. Tools are discovered via the MCP protocol or declared in `default_enabled_tools`." |

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
- **Key fields**: `thread_id` (persists across executions), `subject` (display
  title), `workspace_entries`, `sandbox_id`. Sessions can override Agent-level
  `mcp_server_usages` and `skill_refs`.
- **Related terms**: A Session contains multiple Agent Executions. Each message
  exchange within a Session is one execution. The proto also uses `MessageType`
  (HUMAN, AI, TOOL, SYSTEM) for individual messages.

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
- **Capitalize**: Yes, when referring to the Stigmer resource. Lowercase
  "runner" when used generically ("start a runner").
- **API surface**: `kind: Runner`, prefix `rnr`. proto: `runner/v1/api.proto`,
  `runner/v1/spec.proto`, `runner/v1/enum.proto`. CLI: `stigmer up` /
  `stigmer up runner`, `stigmer down runner`.
- **Key fields**: `status.phase` (Pending, Ready, Busy, Stopped, Failed),
  `status.task_queue` (immutable routing address), `status.connection_info`
  (host name, OS, architecture, runner version), `status.current_executions`.
- **Two types**: Local runners (user-started via CLI or desktop app, persistent)
  and cloud runners (platform-provisioned, ephemeral, labeled
  `stigmer.ai/system-managed: "true"`).
- **Related terms**: Sessions bind to a runner via `SessionSpec.runner_id`.
  Executions record which runner handled them via
  `AgentExecutionStatus.runner_id`. Do not confuse with "Agent Runner" (the
  Python Temporal worker binary---architecture docs only).

**Good examples**:

| Context    | Copy                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Sales site | "Run Agents on your machine or let the platform handle it."                                                                               |
| Quickstart | "Start a runner---the process that runs your Agent on your machine."                                                                      |
| Concepts   | "A Runner is the process that picks up executions, calls the LLM, runs tools, and reports results back to the server."                    |
| Reference  | "`Runner`---a Node-like resource with thin spec and rich status. Phases: PENDING, READY, BUSY, STOPPED, FAILED. Routes via `task_queue`." |

**Bad examples**:

| Context    | Copy                                                                 | Problem                                                                   |
| ---------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Sales site | "Provision a Runner resource to execute Agent workloads."            | Resource-model language in a business context.                            |
| Quickstart | "The Agent Runner connects via bidirectional gRPC every 30 seconds." | Internal architecture detail. The quickstart should say "start a runner." |

---

#### Workflow

A step-by-step automation that runs tasks in a defined order.

- **User-facing alternative**: "multi-step automation" on the sales site.
  "Workflow" works across all other contexts---the word is widely understood.
- **Capitalize**: Yes, when referring to the Stigmer resource.
- **API surface**: `kind: Workflow`, prefix `wfl`. proto:
  `workflow/v1/api.proto`, `workflow/v1/spec.proto`. CLI:
  `stigmer apply -f workflow.yaml`, `stigmer run <name>`.
- **Key fields**: `spec.document` (contains the Workflow DSL definition),
  `spec.tasks` (the task list). Task kinds include `set_vars`, `http_call`,
  `agent_call`, `wait`, and control flow via `flow.then`.
- **Pattern**: Workflows follow the Template → Instance → Execution pattern. A
  Workflow is the template. A WorkflowInstance is a configured deployment. A
  WorkflowExecution is one run.
- **DSL**: Based on CNCF Serverless Workflow specification. Only mention the
  spec name in reference docs---it adds no value for the general audience.

**Good examples**:

| Context    | Copy                                                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sales site | "Automate multi-step processes. Your Agent checks, decides, acts, and reports---reliably, every time."                                                                           |
| Quickstart | "Create a Workflow---a series of steps that run in order. Workflows keep running even if something crashes."                                                                     |
| Concepts   | "A Workflow chains tasks together: call an API, run an Agent, wait for approval, send a notification. Stigmer runs each step reliably and recovers automatically from failures." |
| Reference  | "`Workflow`---a managed resource defining a multi-step automation. Uses CNCF Serverless Workflow DSL. Tasks support `http_call`, `agent_call`, `set_vars`, and `wait` kinds."    |

**Bad examples**:

| Context    | Copy                                                  | Problem                                                                                                 |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Sales site | "Orchestrate CNCF Serverless Workflows."              | The specification name is meaningless to founders.                                                      |
| Quickstart | "The Zigflow engine executes your Temporal Workflow." | Internal implementation details. Readers don't need to know about Zigflow or Temporal to use Workflows. |

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
- **API surface**: There is no single `ApprovalFlow` resource. Approvals are
  configured through two mechanisms:
  1. **Tool-call approval**---configured via `ToolApprovalPolicy` on McpServer
     or `tool_approval_overrides` on Agent. Submitted via
     `AgentExecutionCommandController.submitApproval`. Statuses:
     `TOOL_CALL_WAITING_APPROVAL`, `TOOL_CALL_SKIPPED`. Actions: `APPROVE`,
     `SKIP`, `REJECT`.
  2. **Workflow-task approval**---a dedicated task kind `WORKFLOW_TASK_APPROVAL`
     within a Workflow definition, with structured input (approvers, message,
     timeout).
- **Important**: These are two different mechanisms that share the word
  "approval." See the [inconsistency register](#6-two-approval-models) for
  details and recommended resolution.

**Good examples**:

| Context    | Copy                                                                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sales site | "Your Agent handles routine requests on its own. For anything sensitive, it asks a human first. You set the rules."                                                                                                                              |
| Quickstart | "Add an approval flow---tell your Agent which actions need human approval before it proceeds."                                                                                                                                                   |
| Concepts   | "An approval flow is a checkpoint. The Agent pauses, presents what it wants to do and why, and waits for a human to approve or reject. The Agent's execution is durable---it waits indefinitely without losing state."                           |
| Reference  | "Tool-call approvals are configured via `ToolApprovalPolicy` on the `McpServer` resource or overridden per-Agent via `tool_approval_overrides`. The policy chain is: McpServer defaults → Agent overrides → Execution-level `auto_approve_all`." |

**Bad examples**:

| Context    | Copy                                    | Problem                                                                    |
| ---------- | --------------------------------------- | -------------------------------------------------------------------------- |
| Sales site | "Enable HITL for sensitive operations." | "HITL" is internal jargon.                                                 |
| Quickstart | "Configure the ToolApprovalPolicy."     | API-level detail in a tutorial. Say "add an approval rule."                |
| Any        | "Set up human-in-the-loop."             | Hyphenated compound used as an instruction. Prefer "add an approval flow." |

---

### Tier 2---Platform structure

These terms describe how the platform is organized. The user-facing and internal
names are usually the same---the main concern is consistent capitalization and
clear definitions.

---

#### Organization

A Workspace that groups people, Agents, Workflows, and settings together.

- **Capitalize**: Yes, when referring to the Stigmer concept.
- **API surface**: `kind: organization`, prefix `org`. proto:
  `tenancy/organization/v1/spec.proto`. CLI: `--org` flag.
- **Key fields**: `management_mode`, `identity_provider_ref`, `external_org_id`,
  `is_personal`.
- **Note**: Local mode has no Organization concept---it uses an implicit
  single-user context. Organizations appear in Stigmer Cloud.

---

#### Project

A container within an Organization that groups related Agents, Workflows, and
resources together.

- **Capitalize**: Yes, when referring to the Stigmer concept.
- **API surface**: `kind: project`, prefix `prj`. proto:
  `tenancy/project/v1/spec.proto`.
- **Key fields**: `entry_point`, `members`.

---

#### Environment

A named space (like "testing" or "production") where the same Agent can run with
different settings and secrets.

<!-- vale Stigmer.terms = NO -->

- **Capitalize**: Yes, when referring to the Stigmer concept. Lowercase when
used generically ("environment variables").
<!-- vale Stigmer.terms = YES -->
- **API surface**: `kind: Environment`, prefix `env`. proto:
  `environment/v1/spec.proto`. CLI: `stigmer get environment`,
  `stigmer list environment`.
- **Key fields**: Environments hold secrets and variables. The `getSecretValue`
  query retrieves secrets at runtime.
- **Note**: Do not confuse with "Execution Context" (`kind: execution_context`,
  prefix `ectx`), which provides ephemeral runtime secrets to a specific
  execution. See [Execution Context](#execution-context).

---

#### Identity Provider

An external trust relationship that tells Stigmer how to validate tokens from
your authentication system.

- **Capitalize**: Yes, when referring to the Stigmer resource.
- **API surface**: `kind: identity_provider`, prefix `idp`. proto:
  `iam/identityprovider/v1/spec.proto`.
- **Key fields**: `jwks_uri`, `allowed_issuers`, `expected_audience`,
  `is_sso_provider`, `oidc_client_id`.
- **Context rule**: Do not use on the sales site. In quickstart, say "identity
  provider" in lowercase on first use with a brief gloss. In concepts and
  how-to, capitalize as "Identity Provider." In reference, use
  `IdentityProvider`.
- **Note**: An Identity Provider is not a user database---it defines how Stigmer
  validates externally issued JWTs. It is owned by an Organization and can
  authenticate users across multiple platform-managed Organizations.

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
  token) or explicitly via `createFederatedAccount`. Platform accounts are
  always provisioned automatically via `mintUserToken`.

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

#### PlatformClient

An OAuth2 credential pair (`client_id` + `client_secret`) that lets your backend
mint Stigmer-signed user tokens for embedding Stigmer in your product.

- **Capitalize**: Yes, as one word: "PlatformClient." Do not split into
  "Platform Client" in prose---the API surface uses the compound form.
- **API surface**: `kind: platform_client`, prefix `pc`. proto:
  `iam/platformclient/v1/spec.proto`, `iam/platformclient/v1/token.proto`.
- **Key fields**: `client_id`, `client_secret_hash`, `auto_provision_accounts`,
  `auto_grant_on_org`, `auto_grant_role`, `allowed_origins`.
- **Context rule**: Do not use on the sales site---say "embed Stigmer in your
app" or "add Stigmer to your product." In quickstart, avoid unless the tutorial
covers PlatformClient setup. In concepts and how-to, capitalize as
"PlatformClient." In reference, use `PlatformClient`.
<!-- vale Vale.Spelling = NO -->

- **Note**: PlatformClient credentials authenticate your backend, not your
  users. The backend calls `mintUserToken` to get user-scoped JWTs. This is the
  same pattern used by Twilio (Access Tokens), Stream (User Tokens), and
  Liveblocks (access tokens).

<!-- vale Vale.Spelling = YES -->

---

#### Agent Instance

A deployed copy of an Agent running in a specific Environment with its own
configuration and secrets.

- **Capitalize**: Yes.
- **API surface**: `kind: AgentInstance`, prefix `ain`. proto:
  `agentinstance/v1/spec.proto`.
- **Key fields**: `agent_id`, `environment_refs`.
- **Context rule**: Do not use on the sales site or in quickstart. Introduce in
  concepts docs as part of the Agent lifecycle. Explain in reference docs.

---

#### Agent Execution

One run of an Agent from start to finish.

- **User-facing alternative**: "run" or "execution" in tutorials. Avoid the
  compound "Agent Execution" until concept or reference pages.
- **Capitalize**: Yes, as a compound proper noun.
- **API surface**: `kind: AgentExecution`, prefix `aex`. proto:
  `agentexecution/v1/api.proto`. CLI:

  ```bash
  stigmer run <agent_name> "<prompt>"
  ```

- **Message types**: `HUMAN`, `AI`, `TOOL`, `SYSTEM` (from
  `agentexecution/v1/enum.proto`).
- **Phases**: `EXECUTION_WAITING_FOR_APPROVAL` is a notable phase---the
  execution pauses during an approval flow.

---

#### Workflow Execution

One run of a Workflow from start to finish.

- **User-facing alternative**: "run" in tutorials, "Workflow Execution" in
  concepts and reference.
- **Capitalize**: Yes, as a compound proper noun.
- **API surface**: `kind: WorkflowExecution`, prefix `wex`. proto:
  `workflowexecution/v1/api.proto`.
- **Pattern**: Follows Workflow → WorkflowInstance → WorkflowExecution. The
  Instance (`kind: WorkflowInstance`, prefix `win`) sits between the template
  and the execution, holding deployment configuration.

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
- **API surface**: `SubAgent` message in `agent/v1/spec.proto`. Fields:
  `mcp_access`, `skill_refs`, `model_override`. Execution tracking:
  `agentexecution/v1/subagent.proto`.
- **Context rule**: Concepts and reference only. Never on the sales site. In
  tutorials, if needed, describe as "an Agent that calls another Agent."

---

#### Durable Execution

The ability for Agent and Workflow executions to survive crashes, restart
automatically, and resume exactly where they left off.

- **Capitalize**: Yes, as a Stigmer concept.
- **Implementation**: Powered by Temporal. Do not mention Temporal on the sales
  site or in quickstart. Name it in architecture docs and reference pages.
- **Sales-site phrasing**: "Agents that keep running even if something crashes."
  or "Your Workflows resume where they left off---automatically."
- **Context rule**: "Durable Execution" as a term belongs in concepts and
  reference. On the sales site and in quickstart, describe the benefit without
  naming the mechanism.

---

#### Resource model (apiVersion, kind, metadata, spec)

Stigmer resources follow a declarative model inspired by Kubernetes resource
conventions. Every resource has four top-level fields: `apiVersion`, `kind`,
`metadata`, and `spec`.

- **apiVersion**: Always `agentic.stigmer.ai/v1` for current resources.
- **kind**: The resource type (for example, `Agent`, `Workflow`, `Skill`).
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

#### CNCF Serverless Workflow

The open specification that Stigmer's Workflow DSL is based on.

- **Context rule**: Reference docs only. Link to `https://serverlessworkflow.io`
  when mentioned. In all other contexts, just say "Workflow" and describe the
  capabilities.
- **Do not say**: "CNCF Serverless Workflow" on the sales site or in tutorials.

---

#### Graphton

<!-- vale Stigmer.terms = NO -->

The Agent framework used internally by the agent-runner service.

<!-- vale Stigmer.terms = YES -->

- **Context rule**: Architecture docs and contributor guides only. Never in
  customer-facing documentation. Customers do not interact with Graphton
  directly.

---

#### Stigmer Server

The Go gRPC API server that powers the local development experience.

- **Capitalize**: Yes.
- **CLI**: `stigmer server`, `stigmer server status`, `stigmer server stop`,
  `stigmer server setup`, `stigmer server reset`.
- **Context rule**: Quickstart and docs (it's the command they run). Not on the
  sales site.

---

#### Agent Runner

The Python Temporal worker that executes AI Agent tasks.

- **Capitalize**: Yes.
- **Context rule**: Architecture docs only. Customers do not start or configure
  the Agent Runner directly---it is embedded in `stigmer server`.

---

#### Workflow Runner

The Go Temporal worker that executes Workflow tasks.

- **Capitalize**: Yes.
- **Context rule**: Architecture docs only. Same as Agent Runner---embedded in
  `stigmer server`.

---

#### Execution Context

Ephemeral runtime secrets and variables scoped to a specific execution.

- **API surface**: `kind: execution_context`, prefix `ectx`. proto:
  `executioncontext/v1/api.proto`.
- **Context rule**: Reference docs only. Do not confuse with Environment
  (persistent, named) vs Execution Context (ephemeral, per-execution).

---

#### Seedpack

A pre-built starter package containing Agent definitions, Skills, and MCP Server
configurations.

- **Capitalize**: Yes.
- **Context rule**: Mentioned in STYLE.md's capitalization list. Use when the
  feature is documented. Currently low-priority for customer-facing copy.

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
Define Agents and Workflows as code."

---

### 3. Audience definition conflict between document writer role and STYLE.md---RESOLVED

**What**: The document writer role (`_roles/002_document_writer.md`, line 3)
says "Write for a smart person who is not technical." The style guide
(`docs/STYLE.md`, line 14) says "Assume readers are comfortable with APIs, CLIs,
and infrastructure concepts."

**Resolution**: The document writer role has been rewritten with a
context-sensitive register framework (Session 9). It now references the
vocabulary guide's five writing contexts. Plain language remains the default for
sales site and introductory docs; reference and SDK docs use precise technical
language. See `_roles/002_document_writer.md` "Match your register to the
context" section.

---

### 4. Cloud README lists "Credential" as a concept

**What**: The Cloud README architecture table includes "Credential" as a
resource type with the description "Encrypted credentials---AWS keys, GitHub
tokens." No `Credential` kind exists in `api_resource_kind.proto`. The closest
resources are `Environment` (holds secrets and variables) and `ApiKey` (IAM
authentication tokens).

**Where**:

- `stigmer-cloud/README.md` architecture table (line 45)
- `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto`
  (no `Credential` kind)

**Recommendation**: Determine whether "Credential" was a planned resource that
hasn't been implemented, or whether it's a misnomer for Environment secrets.
Update the Cloud README accordingly. If credentials are managed through
Environments, remove the "Credential" row and clarify in the Environment
description.

---

### 5. YAML shorthand vs proto field names---RESOLVED

**What**: The OSS README showed `mcpServers:` as a YAML field on Agent
definitions. The proto field is `mcp_server_usages` (a repeated `McpServerUsage`
message containing `mcp_server_ref` and `enabled_tools`).

**Investigation**: The CLI Agent loader (`agent/loader.go`) uses strict
`protojson` `Unmarshal` with `DiscardUnknown: false`. There is no alias or
remapping for `mcpServers`. The field would be rejected as unknown. `mcpServers`
was a documentation simplification, not a supported alias.

**Resolution**: The README and this vocabulary guide have been updated to show
the real YAML structure (`mcp_server_usages` with `McpServerUsage` entries). No
shorthand exists or is planned.

---

### 6. Two approval models

**What**: The word "approval" refers to two distinct mechanisms:

1. **Tool-call approval**---an Agent pauses before executing a tool and asks a
   human to approve. Configured via `ToolApprovalPolicy` on McpServer or
   overridden per-Agent. Submitted via
   `AgentExecutionCommandController.submitApproval`.

2. **Workflow-task approval**---a dedicated Workflow task kind
   (`WORKFLOW_TASK_APPROVAL`) that pauses Workflow Execution and waits for human
   input. Has structured parameters: approvers, message, timeout.

These are different mechanisms with different APIs, different configuration
surfaces, and different runtime behaviors. Using the same word "approval" for
both creates ambiguity in documentation.

**Where**:

- `agentexecution/v1/approval.proto`, `agentexecution/v1/command.proto`
- `workflowexecution/v1/api.proto` (WorkflowTask with WORKFLOW_TASK_APPROVAL)
- `mcpserver/v1/spec.proto` (ToolApprovalPolicy)
- `agent/v1/spec.proto` (`tool_approval_overrides`)

**Recommendation**: In customer-facing documentation, distinguish between:

- "Tool approval"---the Agent asks before using a tool (Pillar 3: "Asks Before
  Acting")
- "Workflow approval"---a Workflow pauses at a checkpoint and asks a human to
  approve before continuing

Both are approval flows, but they should be documented as distinct topics with
clear names. The sales site can use the umbrella term "approval flows" since the
distinction doesn't matter at that level.
