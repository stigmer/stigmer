# Agent guide: apis

The protobuf contract, published as the Buf module buf.build/stigmer/stigmer,
and the committed generated stubs under `stubs/`. Every resource, RPC,
validation rule and authorization annotation the platform serves is declared
here first and generated outward to the server, the SDKs, the CLI, the MCP
server and the docs. This guide is an index; the protos and the generator are
the truth.

## Read in this order

- `README.md`: the directory layout and the build targets.
- `buf.yaml`: the lint and breaking configuration; comment ignores are
  disallowed, so a rule is satisfied or the rule set is changed.
- `ai/stigmer/commons/apiresource/`: the resource envelope every kind shares
  (metadata, status, io shapes, the `ApiResourceKind` enum, the
  `api_resource_kind` service option).
- `ai/stigmer/commons/rpc/`: method options, the authorization config
  annotation, pagination.
- `ai/stigmer/agentic/agent/`: the reference resource, its versioned file split
  and its `docs/` folder.
- `_rules/model-stigmer-oss-protos/`: the procedure and checklist for adding a
  resource, with its learning log.
- `tools/codegen/README.md` and
  `tools/codegen/src/internalcomment/internalcomment.ts`: how the generators
  read the protos and the one owner of the `@internal` comment convention.

## Laws

- A new kind is placed before it is written: its bounded context is the
  directory under `ai/stigmer/` it belongs to, its aggregate and owner are
  named, and it is registered in `ApiResourceKind`. The server and every SDK
  mirror this structure.
- Blueprint kinds (Agent, Workflow, McpServer, Skill) carry no secrets and no
  environment-specific values; runtime kinds do.
- Every RPC declares its authorization posture through the commons annotations
  (`config`, `is_public`, `is_skip_authorization`); the server's
  `backend/services/stigmer-server/docs/authorization-coverage.md` inventories
  the result and changes with it.
- Validation is protovalidate rules on the message, not prose in a comment.
- Comments are generated surface. The first sentence of an RPC comment is a
  standalone summary, verb first, naming the resource; the first sentence of a
  message or field comment stands alone in a type table. Authorization detail,
  storage strategy and implementation notes go below a full-line `@internal`
  marker, which the generators strip from every SDK, doc, schema and stub. No
  YAML examples, decorative dividers or Markdown headers in proto comments.
- A resource's `<resource>/docs/overview.md` beside its protos is the
  hand-written first section of its generated SDK reference page: two or three
  sentences and one representative YAML block, in the reference register.
- Proto field names, enum values and service names are wire bytes.
  `buf breaking` runs in CI; a rename is a protocol break with a migration plan,
  never a cleanup.
- After any `.proto` change, `make codegen` from the repository root, and the
  generated output is committed. Hand edits under `stubs/` or any `gen`
  directory are defects.

## Verify

The root map's rows (`make -C apis lint`, then for `.proto` changes
`make check-docs-yaml gen-proto-sdk-docs-check gen-task-docs-check gen-task-registry-check`),
plus `make -C apis fmt` before committing and `make stubs-internal-check` to
prove no `@internal` text reached a stub.
