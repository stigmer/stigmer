---
name: model-proto-resource
description:
  The procedure for adding or reshaping an API resource in the protobuf contract
  under apis, covering the file layout, the resource envelope, kind registration
  with its metadata, the authorization annotation on every RPC, validation,
  comments, the overview file, and the codegen that follows. Use when creating a
  resource, adding an RPC, or changing a generated message.
paths:
  - apis/**
---

# Modelling a proto resource

The contract under `apis/ai/stigmer/` is the single source of truth for the
resource model: the server, every SDK, the CLI, the MCP server and the reference
docs are generated from it. This skill is the procedure for changing it. The
package guide (`apis/AGENTS.md`) carries the laws; the reference resource to
copy from is `apis/ai/stigmer/agentic/agent/v1/`, and the commons packages it
imports are the truth for every shape named here.

## 1. Place the kind before writing it

A resource lives in a bounded context, a directory under `apis/ai/stigmer/`:
`agentic` (agents, executions, sessions, workflows, MCP servers, skills and
their supporting kinds), `iam` (identity, keys, policies, invitations),
`tenancy` (organizations, projects), `platform`, `billing`, `search`,
`activity`. Name its aggregate and its owner (which organization or parent it
belongs to, who may grant roles on it) before a field is written; the
authorization metadata in step 3 asks for both.

## 2. The files

A resource directory is `<context>/<resource>/v1/`. The split by responsibility
is the convention, not a fixed count of files:

- `api.proto`: the resource message (the envelope below) and its list message.
- `spec.proto`: the user-provided configuration, with its supporting messages
  and enums.
- `status.proto`: the system-managed state, when the kind has any.
- `command.proto` and `query.proto`: one service each, write side and read side,
  and nothing but services.
- `io.proto`: the request and response messages both services use (the id
  message, list inputs, and so on).
- Further files as the kind needs them: an `enum.proto` for shared enums, a
  `version.proto` for versioned kinds, topic files for large sub-shapes
  (`apis/ai/stigmer/agentic/agentexecution/v1/` has `approval.proto`,
  `message.proto`, `usage.proto`), the overview file of step 7, and for kinds
  with a curl walkthrough a folder of scripts
  (`apis/ai/stigmer/iam/apikey/v1/curl/`).

Messages never live in the service files; services never live in the message
files. A request message belongs in `io.proto`, not beside the RPC that takes
it.

## 3. The envelope, and the kind's registration

Every resource message has the same five fields, in this order, with these
constraints (`apis/ai/stigmer/agentic/agent/v1/api.proto` is the model):

```protobuf
message Agent {
  string api_version = 1 [(buf.validate.field).string.const = 'agentic.stigmer.ai/v1'];
  string kind = 2 [(buf.validate.field).string.const = 'Agent'];
  ai.stigmer.commons.apiresource.ApiResourceMetadata metadata = 3 [(buf.validate.field).required = true];
  AgentSpec spec = 4;
  AgentStatus status = 5;
}
```

`api_version` is the bounded context's group followed by the version; `kind` is
the message name exactly. The metadata message, the shared status shapes and the
io shapes are in `apis/ai/stigmer/commons/apiresource/`.

The kind is registered in
`apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto` as
an enum value carrying `kind_meta`: its group and version, its `name` and
`display_name`, the `id_prefix` its ids mint with, whether it is versioned and
search-indexed, its `tier` (open source or cloud), and its `authorization`
block: the scope type, how ownership is attributed, which visibilities it
supports and the default, and the `grantable_roles`. The server reads this
metadata by reflection for id minting, search, visibility and the
authorization-tuple lifecycle, so a kind that is not registered here does not
exist to the platform. Read the entries around yours for the shape a similar
kind chose, and keep enum numbers unique and never reused.

Each service names its kind once with the service option
`(ai.stigmer.commons.apiresource.api_resource_kind)`.

## 4. Authorization on every RPC

Every RPC declares its posture with the options in
`apis/ai/stigmer/commons/rpc/method_options.proto`; the server's `Authorize`
step evaluates the declaration, so an RPC without one is refused, not open.

```protobuf
rpc get(AgentId) returns (Agent) {
  option (ai.stigmer.commons.rpc.config).resource_kind = agent;
  option (ai.stigmer.commons.rpc.config).permission = can_view;
  option (ai.stigmer.commons.rpc.config).field_path = "value";
  option (ai.stigmer.commons.rpc.config).error_msg = "unauthorized to get agent";
}
```

The `config` message (`apis/ai/stigmer/commons/rpc/authorization_config.proto`)
names the kind the permission is checked on, the permission, and where in the
request the target's id is:

- An id message: `field_path = "value"`.
- A full resource on update: `field_path = "metadata.id"`.
- Create: the check is on the parent, so `resource_kind` is the parent kind
  (`organization`), the permission is the parent's (`can_create_agent`), and
  `field_path` is `"metadata.org"`.
- A request whose target kind varies per call (an `ApiResourceRef`):
  `resource_kind_path` names the field carrying the kind and `field_path` the
  field carrying the id; exactly one of `resource_kind` and `resource_kind_path`
  is set.

Two other postures exist and each is a deliberate statement:

- `is_public = true`: anyone may call, signed in or not (an invitation lookup by
  token, the server-info endpoint). The server's require-authentication posture
  honours it.
- `is_skip_authorization = true`: the handler authorizes itself after loading
  what it needs, because the request carries no target id (a list filtered by
  what the caller may see, a lookup by hash or by token). Never on an RPC whose
  request carries the target's id, with one exception: a kind whose `kind_meta`
  declares `scope_type: AUTHORIZATION_SCOPE_TYPE_NONE` has no tuple to check a
  caller against, so a signed-in read of it (`Plan.get`) is
  `is_skip_authorization` even when the request names the row, and the handler
  adds no check. The RPC comment says so.

An RPC that needs more than one check (a parent's permission and a membership,
for instance) declares the check the annotation can express and performs the
rest in its handler, with a comment on the RPC saying so.
`backend/services/stigmer-server/docs/authorization-coverage.md` inventories
every RPC's posture and changes in the same pull request.

## 5. Spec against status

User-provided configuration is spec; system-managed state is status. A field the
user cannot supply (a workflow id the engine minted, a callback token, an
execution timestamp) belongs in the status message, never in the spec or in a
request message. The test: can the user provide this value, or is it created
during execution? This separation is what lets a retry reuse the same spec and
lets the system update state without touching the user's input. When a field
seems out of place in a request or a spec, look for the precedent in a similar
kind before adding it.

## 6. Validation and comments

Constraints are protovalidate rules on the field (the `buf.validate` import
every spec file carries), never prose. `buf lint` runs with comment ignores
disallowed (`apis/buf.yaml`), so a rule is satisfied or the rule set changes.

Comments are generated surface. The `apis/AGENTS.md` laws state the contract:
first sentence standalone, verb first for an RPC; implementation and
authorization detail below a full-line `@internal` marker that
`tools/codegen/src/internalcomment/internalcomment.ts` strips from every output;
no YAML, dividers or Markdown headers. `make stubs-internal-check` proves no
`@internal` text reached a stub.

## 7. The overview file

`<resource>/docs/overview.md` beside the protos is the hand-written first
section of the kind's generated SDK reference page: two or three sentences on
what the resource is and configures, then one representative YAML block. Its
register and shape are in `.agents/skills/docs-writing/SKILL.md` under
"Reference pages generated from protos". Twenty-five kinds have one today; a new
user-facing kind gets one in the same pull request.

## 8. Generate, then verify

From the repository root, `make codegen` regenerates every stub under
`apis/stubs/`, every SDK's `gen` directory, the validation helpers, the SDK docs
and the task registry; all of it is committed and none of it is hand-edited.
Then the checks the root guide's verification map names for `apis/**`:
`make -C apis lint`, and for a `.proto` change
`make check-docs-yaml gen-proto-sdk-docs-check gen-task-docs-check gen-task-registry-check`;
`make -C apis fmt` before committing. `buf breaking` runs in CI: a renamed
field, enum value or service is a wire break and needs a migration plan, not a
cleanup commit.

## Checklist

- Placed in its bounded context; aggregate and owner named.
- Envelope fields in order with their constraints; kind registered with complete
  `kind_meta`, including the authorization block.
- Services only in `command.proto` and `query.proto`; requests in `io.proto`.
- Every RPC carries `config`, `is_public` or `is_skip_authorization`, each a
  deliberate choice; the coverage document updated.
- System-generated fields in status, user-provided in spec.
- protovalidate on every constrained field; comments follow the `@internal`
  contract.
- An overview file for a user-facing kind.
- `make codegen` run and its output committed; the `apis/**` checks green.
