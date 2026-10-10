# Stigmer OpenFGA Authorization Model

This directory contains the OpenFGA authorization model for the Stigmer platform, organized as separate type definitions for maintainability.

## Core Principle: Visibility Is a Tuple

Stigmer uses a **tuple-driven visibility model** where resource visibility is controlled by which FGA tuples are written on the `viewer` relation — not by application-layer checks. The FGA model declares which principal types are accepted; the application layer decides which tuple to write based on the resource's visibility setting.

This follows the Google Zanzibar pattern used by Google Drive: "Specific people" writes individual tuples, "My organization" writes an org-group tuple, "every organization under mine" writes a child-organization tuple. The model stays the same; visibility is controlled by tuple presence. There is no "anyone" tuple: the public level (a wildcard viewer under a request-time condition) was retired in stigmer#1211 (and in the cloud's model on 2026-09-23), and the model declares no wildcard subject and no condition — another organization's blueprint is reached by installing the plugin that carries it.

## The Authorization Tiers

An agent is a blueprint; a person talks to it in a session, and every turn of that conversation is a run. The session names its agent directly, and a run answers exactly what its session answers:

```
Blueprint (Agent)                 ← discoverability and usability
  └── Session → Run               ← a person's conversation and its turns
```

Each has its own visibility:

| Tier | Default Visibility | Supports Child Orgs | Inheritance |
|------|-------------------|-------------------|-------------|
| **Blueprint** | Org members | Yes (`child_org_viewer`) | — |
| **Session** | Owner only, widened by explicit grants or the channel or schedule that runs it | No | — |
| **Run** | Whatever its session answers | No | From session |

## The Visibility Spectrum

Resources support configurable visibility controlled by which tuples are written:

| Visibility | Tuple Written | Who Can View |
|---|---|---|
| **Private** | (none beyond owner) | Owner only |
| **Org** | `resource#viewer@organization:<org>#viewer` | Everyone in the org (all roles incl. read-only viewers) + owner |
| **Child orgs** (blueprints only) | `resource#child_org_viewer@organization:<org>#child_org_viewer`, beside the org tuple | Everyone in every child organization of the owning organization |

Individual grants (`resource#viewer@identity_account:<user>`) work at any visibility level.

### Roles on blueprints: viewer, editor, owner

A blueprint (`agent`, `mcp_server`) is granted to a person or a team in one of three roles:

| Role | Can | Cannot |
|---|---|---|
| `viewer` | read it and use it: run an agent, use an MCP server, clone it | change it |
| `editor` | everything a viewer can, and change its definition (`can_edit`): update, tag a version, schedule an agent | delete it, or decide who else reaches it |
| `owner` | everything (the creator, and the organization's admins by inheritance) | |

Who else reaches a resource is the owner's, through two permissions. `can_grant_access` is granting and revoking. `can_manage_audience` is every act that changes the audience without a grant: `updateVisibility` on every kind, publishing an agent on a share link and binding it to a channel. They are two permissions because the self-check answers `can_grant_access` false wherever the edition grants no roles on the kind (the console then hides grant controls), while every edition lets an owner change an audience. An editor is a viewer (`viewer: ... or editor`), so the model's invariant "you can run what you can read" holds for editors too. The open-source server grants no per-resource role (its policy grant scope is the organization only); the hosted edition and Enterprise grant these.

## Agents, Sessions and Runs

```
Agent (blueprint) → Session (personal) → Run
```

- **An agent's audience is not its conversations' audience.** An org-visible agent lets every member read and run it; each member's conversation with it stays private to that member.
- **Sessions** are personal: the owner sees one, and nobody else does until an explicit grant shares it. A participant reads the conversation and sends messages (`can_create_run_in: participant`); a viewer only reads it (owner ⊆ participant ⊆ viewer, the `agent_channel` ladder). A session started by a channel or a schedule is also visible to whoever can view that channel or schedule (`viewer from channel`, `viewer from schedule`). The agent a session names is not a relation: the server asks `can_execute` on it when a session names or changes it, and on every turn.
- **Runs** hold nothing of their own. A run answers exactly what its session answers, so sharing a session shares its whole history, past turns included, with zero per-run tuples.

## What the model deliberately cannot say: the runtime lanes' blueprint reads

Guest, channel and schedule sessions run as per-org system accounts that hold exactly `organization#guest` (`can_create_session`, `can_create_run_in`) and are no agent's viewer, by design: a viewer tuple for the guest account on a shared agent would let every guest token in the org read that agent's full blueprint (see `agent_share.fga`). Yet the runner serving such a session must read the session's agent. The model answers `deny`, and the hosted edition's composition refines that denial app-level: its blueprint-read admission admits a session-scoped sandbox credential to exactly its session's graph while the surface that created the session (the share, the channel, the schedule) is still serving the agent, each surface answering through a port its own domain owns. The schedule lane's port reads the `session#schedule` link this model composes for observability, so that link is load-bearing for a scheduled run. This is the read-side twin of the run-gate lane admission (`src/authorizer/lane-admission.ts`); the chain's order lives in `src/authorizer/cloud-authorizer.ts`. An assertion suite cannot pin it — it is not a tuple — so `src/authorizer/__tests__/blueprint-read-admission.openfga.test.ts` runs the composed chain against this model on a real engine instead.

## Access Patterns

### Open Access (Blueprints)

Templates discoverable by all org members, with optional child-organization visibility:

```fga
define viewer: ([identity_account, organization#viewer, team#member] and affiliated from organization) or owner or editor or child_org_viewer
```

Resources: `agent`, `skill`, `mcp_server`, `plugin`

### Personal Resource (Sessions)

Owner-only access. Org admins explicitly excluded (personal conversations):

```fga
define owner: [identity_account] and affiliated from organization
define viewer: ([identity_account] and affiliated from organization) or owner
```

Resources: `session`

### Configurable Visibility (Personal Resources)

Private by default, expandable to org via an additional tuple:

```fga
define viewer: ([identity_account, organization#viewer] and affiliated from organization) or owner
```

Resources: none since vaults replaced environments. A vault (`agentic/vault.fga`) is either a person's own My vault, which nobody else reaches (its organization's admins included), or the organization's shared vault, which its admins manage and let people use through `user` grants or org visibility.

### Inherited Visibility (Runs)

Permissions inherited from the parent resource:

```fga
# A run inherits from its session
define owner: owner from session
define viewer: viewer from session or owner
define can_view: viewer or can_view from session
```

Resources: `run`

A run holds nothing of its own: its one direct relation is the `session` link, every other relation is read through it, and its `can_view` answers exactly what the session's does. That is what lets a list ask about the session in the run's place, and `src/authorization/model/__tests__/registry.test.ts` holds it for every kind whose `kind_meta` makes its authorization its parent's. A relation that would give a run something of its own is a design change of the list read scope first.

A score (`agentic/score.fga`) is seen through its run (`can_view: can_view from run`) but is not its run's whole: the person who rated owns the rating (`OWNER_ATTRIBUTION_TYPE_DIRECT`), edits it while they can still see the run (`can_edit: owner and can_view`), and the run's owner deletes any score on it. Its lists are asked on the run or the session, never through the list read scope.

An evaluator (`agentic/evaluator.fga`) has no relation of its own but its `agent` link: it is viewed, edited and deleted by whoever views or edits its agent (`can_view from agent`, `can_edit from agent`), and has no owner (`OWNER_ATTRIBUTION_TYPE_NONE`), because the agent's owner already includes the organization's admins. It is read by its id or by its agent, never through the list read scope.

### Bounded by the Organization (every direct grant)

Every organization-scoped type admits its direct subjects only while they belong to the object's organization:

```fga
# organization.fga: one stored tuple per person and organization
define affiliated: [identity_account]

# every relation with a direct list, on every organization-scoped type
define owner: ([identity_account] and affiliated from organization) or admin from organization
```

The bound is what makes leaving an organization mean what it says. A person who loses their last role in the organization reaches nothing it holds on the next check, whichever way the grant was made: shared with them directly, recorded as its author (open source derives an author's `owner` tuple from the row's creator stamp; the hosted edition stores it), or through a team. No cleanup has to run first and none can be missed. Rejoining gives back what the person authored, because authorship is a fact about the row; the IamPolicy grant path deletes the shares and team memberships the person held when they left, so those do not come back.

`affiliated` is stored so the bound costs one read: a computed `viewer or guest` would walk the role chain again for every object a list checks. It is derived, never granted. The tuple stands exactly while the person holds at least one role row on the organization, a guest included. The IamPolicy grant path refuses it as a grant, and announces every change of a person's organization rows through the resource-authorization lifecycle (`onOrganizationAffiliationChanging` before a row goes, `onOrganizationAffiliationChanged` after any write or delete). The hosted edition re-derives the tuple from those announcements; open source derives it from the rows at check time, so it needs no migration.

`affiliated` includes `guest` because the organization's system accounts (the guest, channel and schedule sessions) hold only `guest` and own the sessions they create. The usersets on the same direct list (`organization#viewer`, `team#member`) are already inside the organization, so bounding them changes nothing. Child-organization visibility (`child_org_viewer`) sits outside the bound: it is the one arm that crosses organizations by design, from a parent to its children. A relation that is the kind's structural parent link stays a direct relation, and the bound goes on the permissions that read it instead (`memory.subject_in_organization`).

Resources: every type with an `organization` relation and a direct `identity_account` list

### Bounded Membership (Teams)

A group that access is shared with as one, whose members must still belong to the group's organization:

```fga
define member: [identity_account] and viewer from organization
```

A team's bound is `viewer`, not `affiliated`: a guest is never a team's member. Someone who leaves the organization stops being a member on the next check. A resource grants the group through the userset `team#member` on the relations its kind lists in `team_grantable_roles`, never on `owner` or an organization role.

Resources: `team`

## Permission Hierarchy

For most resources:

```
owner ⊆ admin ⊆ member ⊆ viewer (organization roles)
```

Permission checks reference the bottom of the hierarchy:
- `can_view: viewer` (viewer includes owner)
- `can_edit: owner` (`owner or editor` on the blueprints an editor can be granted)
- `can_delete: owner`

Authority to spend or create comes from an explicit permission checked at the door (`can_create_run_in` on the organization, `can_create_<kind>`), never from the accidental shape of a read tuple: a read userset that happens to imply membership must not become the thing that lets a read-only viewer spend the organization's credits.

Platform capabilities live on `platform:stigmer`: one `operator` role, narrow roles for machine lanes that must never hold the whole platform (`credit_issuer`), and one explicit `can_*` per platform-level act. Operator access does not propagate to organizations or resources, and no resource type carries an `operator` relation; a support path is an explicit platform permission checked at the door, never an implicit owner.

## Shapes to Avoid

- A relation used as a tupleset (`admin from organization` reads `organization`) must be direct: only `[type]` references, no `or`, `from` or `and`. Put a computed arm on each permission instead. OpenFGA refuses the model otherwise.
- A tuple-to-userset (`viewer from session`) works only if the parent type defines that relation; read the parent's file first.
- A mid-chain role in a read grant is wrong, and no type admits one: `resource#viewer@organization:acme#member` would exclude every viewer-role user, and single sign-on provisions the viewer role by default. A read grant names the widest audience, `organization#viewer`.
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

A permission is added when something asks it and deleted when nothing does. Every `can_*` relation is an `IamPermission` value (so an RPC, a pipeline step or the self-check can ask it) or is named by the rewrite of a relation that is itself reachable, and every `IamPermission` value is defined by some type; `src/authorization/__tests__/wire-permissions.test.ts` fails otherwise. A role, a structural link or a type stays while code writes or reads it, and the model declares every open-source kind whether or not anything is granted on it. Removing a relation must change no answer anywhere: every edition answers a permission a kind's type does not define as a denial, never an engine error, and the IamPolicy conformance suite holds each edition to that by asking such a permission on a run.

A model change's note is its pull request and its commit: what changed, why, and the suite that pins it. The release that carries it names it in its notes. The model's history is `git log` of this folder; it moved here from the hosted edition's private repository on 2026-09-26, and its history before that is not public.

## FGA Tuple Examples

### Blueprint (Agent Shared With Child Organizations)

```
agent:pr-reviewer#organization@organization:stigmer
agent:pr-reviewer#owner@identity_account:alice
agent:pr-reviewer#viewer@organization:stigmer#viewer     ← the org floor
agent:pr-reviewer#child_org_viewer@organization:stigmer#child_org_viewer
```

### Parent and Child Organizations

```
organization:acme-cust#parent_org@organization:stigmer   ← on the child
organization:stigmer#child_org@organization:acme-cust    ← on the parent
```

Both edges are written once, when the child is created; a child has no `owner` tuple. The parent's admins hold `parent_admin` on the child, which feeds only the management permissions (`can_view_settings`, `can_edit`, `can_delete`, `can_grant_access`, `can_view_access`, `can_assign_roles`, `can_view_billing`) and the child's invitations, which they create and list through those permissions and so view and revoke too, never a role: they manage the child and read none of its resources. A parent admin who needs to look inside grants themselves a role in the child, which the child's members and access history show.

### Organization Policies

```
organization:acme#agent_creation_open@organization:acme   ← while members may create agents
```

An organization's policy (`spec.policies`) that decides who may do what is an edge from the organization to itself, written while the policy is on and removed while it is off, only by the organization's create and its `updatePolicies`: `can_create_agent: admin or member from agent_creation_open`. Open source derives the edge from the row at check time (`src/authorization/model/organization-policies.ts`); an edition that stores tuples writes it from the authorization lifecycle's `onOrganizationPoliciesChanged`. It is not a cycle, because `member` never reads it.

### Session (Personal)

```
session:chat-123#organization@organization:acme
session:chat-123#owner@identity_account:bob
```

Only Bob can view. To let Alice read it: `session:chat-123#viewer@identity_account:alice`. To let her send messages too: `session:chat-123#participant@identity_account:alice`.

### Run (Inherits Its Session)

```
run:turn-7#session@session:chat-123
```

Whoever can view the session views the run, and nobody else:
```
can_view → can_view from session:chat-123 → owner (bob), a viewer grant, or the session's channel or schedule
```

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

### Editor (Edits, Never Decides Who Reaches It)

```
agent:pr-reviewer#editor@identity_account:dan   ← an IamPolicy row
agent:pr-reviewer#editor@team:tm-sre#member     ← or a team
```

Dan edits the agent while he is in Acme, and cannot delete it or share it on:
```
can_edit → owner or editor → [identity_account:dan] and affiliated from organization:acme
can_grant_access → owner      (never an editor)
can_manage_audience → owner   (never an editor)
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
│       ├── evaluator.fga           # An agent's AI grading settings (the agent's access)
│       ├── mcp_server.fga          # MCP tool servers (open access)
│       ├── memory.fga              # An identity's memories (subject-only)
│       ├── plugin.fga              # Installed plugins, the unit of install
│       ├── run.fga                 # Runs (inherits from session)
│       ├── schedule.fga            # Scheduled runs (owner-scoped)
│       ├── score.fga               # A finished run's grades (seen through the run)
│       ├── session.fga             # Conversations (personal)
│       ├── skill.fga               # Knowledge bases (open access)
│       └── vault.fga               # Logins and secrets runs use (My vault, shared vaults)
└── tests/                          # The suites: `fga model test` documents, one per behaviour
```

## References

- [OpenFGA Documentation](https://openfga.dev/docs)
- [OpenFGA Modeling Guide](https://openfga.dev/docs/modeling)
- [Zanzibar Paper](https://research.google/pubs/pub48190/) - Google's authorization system
