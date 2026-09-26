# Stigmer OpenFGA Authorization Model

This directory contains the OpenFGA authorization model for the Stigmer platform, organized as separate type definitions for maintainability.

## Core Principle: Visibility Is a Tuple

Stigmer uses a **tuple-driven visibility model** where resource visibility is controlled by which FGA tuples are written on the `viewer` relation — not by application-layer checks. The FGA model declares which principal types are accepted; the application layer decides which tuple to write based on the resource's visibility setting.

This follows the Google Zanzibar pattern used by Google Drive: "Specific people" writes individual tuples, "My organization" writes an org-group tuple, "every organization my identity provider manages" writes a platform-tenancy tuple. The model stays the same; visibility is controlled by tuple presence. There is no "anyone" tuple: the public level (a wildcard viewer under a request-time condition) was retired in stigmer#1211 (and in the cloud's model on 2026-09-23), and the model declares no wildcard subject and no condition — another organization's blueprint is reached by installing the plugin that carries it.

## The Three-Tier Authorization Model

Stigmer resources follow a three-tier hierarchy for both agents and workflows:

```
Blueprint (Agent, Workflow)       ← discoverability and usability
  └── Instance (AgentInstance, WorkflowInstance)  ← who can use this deployment
        └── Execution (AgentExecution, WorkflowExecution)  ← who can observe runs
```

Each tier has independent but composable visibility:

| Tier | Default Visibility | Supports Platform | Inheritance |
|------|-------------------|-------------------|-------------|
| **Blueprint** | Org members | Yes (`platform_viewer`) | — |
| **Instance** | Private (owner only) | No (a default instance inherits its blueprint's) | — |
| **Execution** | Inherited from parent | No (inherited) | Workflow: from instance. Agent: from session |

## The Visibility Spectrum

Instances support configurable visibility controlled by which tuples are written:

| Visibility | Tuple Written | Who Can View |
|---|---|---|
| **Private** | (none beyond owner) | Owner only |
| **Org** | `resource#viewer@organization:<org>#viewer` | Everyone in the org (all roles incl. read-only viewers) + owner. `#member` is the legacy pre-2026-08-11 shape, still resolving until backfilled |
| **Platform** (blueprints only) | `resource#platform_viewer@identity_provider:<idp>#platform_user`, beside the org tuple | Every member of every organization the owning organization's identity provider manages |

Individual grants (`resource#viewer@identity_account:<user>`) work at any visibility level.

## Agent vs Workflow Asymmetry

```
Agent Path:     Agent → AgentInstance → Session (personal) → AgentExecution
Workflow Path:  Workflow → WorkflowInstance → WorkflowExecution
```

- **Agent executions** inherit from sessions. Sessions are always personal — even if the agent instance is org-visible, conversations remain private. Sharing a session requires explicit viewer grants.
- **Workflow executions** inherit directly from the workflow instance. If the instance has ORG visibility, all org members see all executions. Zero per-execution tuples needed.

This asymmetry is intentional: agents are conversational (privacy by default), workflows are operational (observability by default when org-shared).

## What the model deliberately cannot say: the runtime lanes' blueprint reads

Guest, channel and schedule sessions run as per-org system accounts that hold exactly `organization#guest` (`can_create_session`, `can_create_execution_in`) and are no agent's viewer, by design: a viewer tuple for the guest account on a shared agent would let every guest token in the org read that agent's full blueprint (see `agent_share.fga`). Yet the runner serving such a session must read the session's agent instance and agent. The model answers `deny`, and the hosted edition's composition refines that denial app-level: its blueprint-read admission admits a session-scoped sandbox credential to exactly its session's graph while the surface that created the session (the share, the channel, the schedule) is still serving the agent, each surface answering through a port its own domain owns. The schedule lane's port reads the `session#schedule` link this model composes for observability, so that link is load-bearing for a scheduled run. This is the read-side twin of the run-gate lane admission (`src/authorizer/lane-admission.ts`); the chain's order lives in `src/authorizer/cloud-authorizer.ts`. An assertion suite cannot pin it — it is not a tuple — so `src/authorizer/__tests__/blueprint-read-admission.openfga.test.ts` runs the composed chain against this model on a real engine instead.

## Access Patterns

### Open Access (Blueprints)

Templates discoverable by all org members, with optional platform visibility:

```fga
define viewer: [identity_account, organization#member, organization#viewer] or owner or platform_viewer
```

Resources: `agent`, `workflow`, `skill`, `mcp_server`, `plugin`

### Personal Resource (Sessions, Environments)

Owner-only access. Org admins explicitly excluded (personal secrets/conversations):

```fga
define owner: [identity_account]
define viewer: [identity_account] or owner
```

Resources: `session`, `environment`

### Configurable Visibility (Instances)

Private by default, expandable to org via an additional tuple:

```fga
define viewer: [identity_account, organization#member, organization#viewer] or owner or viewer from default_of
```

Resources: `agent_instance`, `workflow_instance`

### Inherited Visibility (Executions)

Permissions inherited from parent resource:

```fga
# Workflow execution inherits from instance
define viewer: [identity_account] or owner or viewer from workflow_instance

# Agent execution inherits from session
define viewer: viewer from session or owner
```

Resources: `workflow_execution`, `agent_execution`

### Bounded Membership (Teams)

A group that access is shared with as one, whose members must still belong to the group's organization:

```fga
define member: [identity_account] and viewer from organization
```

This is the model's one intersection, and the bound is load-bearing: someone who leaves the organization stops being a member on the next check, with no cleanup, because no application step can express "lost the last organization role". Two rules keep it readable by both editions' model readers: the `and` stands at the top level of its line, and it never shares a line with `or` (a line that would need parentheses is refused). A resource grants the group through the userset `team#member` on the relations its kind lists in `team_grantable_roles`, never on `owner` or an organization role.

Resources: `team`

## Default Instances

Every agent and workflow auto-creates a default instance on creation. Default instances are:

- **System-managed**: Tagged with `stigmer.ai/system-managed: "true"` and `stigmer.ai/default-instance: "true"`
- **Private visibility**: No viewer expansion tuples. Only the execution triggerer sees their runs
- **Owned by the creator**: The blueprint creator owns the default instance

Organizations that want shared execution observability create their own instance with ORG visibility:

```
# Org creates an instance with ORG visibility
workflow_instance:acme-triage#viewer@organization:acme#viewer
```

This ensures that a shared blueprint's users only see their own executions, while org-managed instances provide shared observability.

## Permission Hierarchy

For most resources:

```
owner ⊆ admin ⊆ member ⊆ viewer (organization roles)
```

Permission checks reference the bottom of the hierarchy:
- `can_view: viewer` (viewer includes owner)
- `can_edit: owner`
- `can_delete: owner`

Authority to spend or create comes from an explicit permission checked at the door (`can_create_execution_in` on the organization, `can_create_<kind>`), never from the accidental shape of a read tuple: a read userset that happens to imply membership must not become the thing that lets a read-only viewer spend the organization's credits.

Platform capabilities live on `platform:stigmer`: one `operator` role and one explicit `can_*` per platform-level act. Operator access does not propagate to organizations or resources, and no resource type carries an `operator` relation; a support path is an explicit platform permission checked at the door, never an implicit owner.

## Shapes to Avoid

- A relation used as a tupleset (`admin from organization` reads `organization`) must be direct: only `[type]` references, no `or`, `from` or `and`. Put a computed arm on each permission instead. OpenFGA refuses the model otherwise.
- A tuple-to-userset (`viewer from workflow_instance`) works only if the parent type defines that relation; read the parent's file first.
- A mid-chain role in a read grant is accepted and wrong: `resource#viewer@organization:acme#member` excludes every viewer-role user, and single sign-on provisions the viewer role by default. A read grant names the widest audience, `organization#viewer`.
- A new file must be listed in `fga.mod`, in dependency order; the generator refuses a `.fga` file that `fga.mod` does not list.
- A suite holds `check` and `list_objects` assertions only: the built-in evaluator's kit refuses any other key (`list_users` included), and an assertion it cannot run would be proven on one engine only.

## One Model, Every Edition

These files are the authorization model of every Stigmer edition. They are compiled once, by OpenFGA's own parser (`make gen-authorization-model`), into one JSON file: `src/authorization/model/data/authorization-model.json`. Every edition reads those bytes:

- the server's built-in evaluator runs them (`src/authorization/model/index.ts` reads the file at load; a model it cannot evaluate fails the boot, never an answer);
- the suites under `../tests/` run them on the real engine (each suite's `model_file` names the compiled file) and, through the same evaluator the server runs, on every `make test-server`;
- an edition that runs OpenFGA applies them as they are, from the published package's data subpath `@stigmer/server/authorization-model.json`.

The model defines every type, whichever edition serves it. Which kinds an edition evaluates is the tier's question (`kind_meta.tier`), answered before any evaluation: the open-source server refuses a check on `platform`, `identity_provider`, `invitation` or `team`, and a tuple that names one of those types matches nothing it stores.

### The compiled file's contract

- It is generated, never edited by hand. `make gen-authorization-model-check` compiles the `.fga` files in memory and fails when the committed bytes differ, and CI runs it.
- It is canonical JSON, so that any two renderings of the model can be compared byte for byte: proto3 JSON with unpopulated fields omitted (empty strings, nulls, empty lists and empty maps), empty messages kept (`"this": {}` means "the relation's direct tuples", and a relation's metadata `{}` says it lists no direct types), keys sorted at every level, arrays in their order (a union's children are evaluated in order). It is pretty-printed with two spaces and a trailing newline, so a model change reads as a line diff. Minified, it equals `fga model transform --output-format json` of these files; OpenFGA's stored read-back, canonicalised the same way, equals it too.
- It uses what the built-in evaluator runs: direct relations with type restrictions, computed relations, tuple-to-userset, union and intersection, nested to any depth. `but not`, wildcard subjects (`type:*`) and conditions are refused by the evaluator's reader, so a model that needs one is a design change of the evaluator first.

### Changing the model

A change edits a `.fga` file and the suite under `../tests/` that pins it (a new relation, a new type or a new path gets its assertions), runs `make test-authorization-model` (it regenerates the JSON, runs every suite on the engine at the pinned `fga` CLI version, then through the built-in evaluator), and commits the regenerated JSON with the source. The engine version is pinned to the one production runs, and moves with it.

A model change's note is its pull request and its commit: what changed, why, and the suite that pins it. The release that carries it names it in its notes. The model's history is `git log` of this folder; it moved here from the hosted edition's private repository on 2026-09-26, and its history before that is not public.

## FGA Tuple Examples

### Blueprint (Platform-Visible Agent)

```
agent:pr-reviewer#organization@organization:stigmer
agent:pr-reviewer#owner@identity_account:alice
agent:pr-reviewer#viewer@organization:stigmer#viewer     ← the org floor
agent:pr-reviewer#platform_viewer@identity_provider:idp1#platform_user
```

### Instance (Org-Visible Workflow Instance)

```
workflow_instance:acme-triage#organization@organization:acme
workflow_instance:acme-triage#workflow@workflow:support-triage
workflow_instance:acme-triage#owner@identity_account:alice
workflow_instance:acme-triage#viewer@organization:acme#viewer  ← ORG visibility
```

### Execution (Inherits from Instance)

```
workflow_execution:ticket-4567#organization@organization:acme
workflow_execution:ticket-4567#workflow_instance@workflow_instance:acme-triage
workflow_execution:ticket-4567#owner@identity_account:support-agent-1
```

Everyone in the Acme org can view — IF the instance opted into org run
observability (`execution_viewer@organization:acme#viewer`; instance
visibility alone never exposes run history):
```
can_view → viewer → execution_viewer from workflow_instance → organization:acme#viewer
```

### Session (Personal)

```
session:chat-123#organization@organization:acme
session:chat-123#agent_instance@agent_instance:pr-reviewer-default
session:chat-123#owner@identity_account:bob
```

Only Bob can view. To share: `session:chat-123#viewer@identity_account:alice`

### Team (Shared With as One)

```
team:tm-sre#organization@organization:acme
team:tm-sre#member@identity_account:vic         ← membership, an IamPolicy row
agent:pr-reviewer#viewer@team:tm-sre#member     ← a share with the team
```

Vic views the agent while she is one of Acme's viewers:
```
can_view → viewer → team:tm-sre#member → [identity_account:vic] and viewer from organization:acme
```

## File Organization

```
fga/
├── model/
│   ├── fga.mod                     # Schema version and the files, in load order
│   ├── README.md                   # This file
│   ├── platform.fga                # Root singleton (operators)
│   ├── iam/
│   │   ├── identity_account.fga    # User accounts
│   │   ├── identity_provider.fga   # An organization's own identity providers
│   │   ├── iam_policy.fga          # Access policies
│   │   ├── api_key.fga             # User API keys
│   │   ├── oauth_app.fga           # OAuth client registrations
│   │   ├── platform_client.fga     # Platform builder credentials
│   │   ├── invitation.fga          # Org membership invitations
│   │   └── team.fga                # Enterprise teams (bounded membership)
│   ├── tenancy/
│   │   └── organization.fga        # Root-level containers (role hierarchy)
│   └── agentic/
│       ├── agent.fga               # Agent blueprints (open access)
│       ├── agent_channel.fga       # An agent's distribution channels (owner-scoped)
│       ├── agent_share.fga         # An agent's shared pages (owner-scoped)
│       ├── channel_app.fga         # Bring-your-own channel provider apps (restricted)
│       ├── agent_instance.fga      # Agent deployments (configurable visibility)
│       ├── agent_execution.fga     # Agent runs (inherits from session)
│       ├── artifact.fga            # Files a run produces (org and owner)
│       ├── environment.fga         # Config and secrets (personal)
│       ├── execution_context.fga   # Ephemeral runtime contexts (owner-only)
│       ├── mcp_server.fga          # MCP tool servers (open access)
│       ├── memory.fga              # An identity's memories (subject-only)
│       ├── plugin.fga              # Installed plugins, the unit of install
│       ├── schedule.fga            # Scheduled agent runs (owner-scoped)
│       ├── session.fga             # Conversations (personal)
│       ├── skill.fga               # Knowledge bases (open access)
│       ├── workflow.fga            # Workflow blueprints (open access)
│       ├── workflow_instance.fga   # Workflow deployments (configurable visibility)
│       └── workflow_execution.fga  # Workflow runs (inherits from instance)
└── tests/                          # The suites: `fga model test` documents, one per behaviour
```

## References

- [OpenFGA Documentation](https://openfga.dev/docs)
- [OpenFGA Modeling Guide](https://openfga.dev/docs/modeling)
- [Zanzibar Paper](https://research.google/pubs/pub48190/) - Google's authorization system
