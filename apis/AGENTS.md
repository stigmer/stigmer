# Agent guide: apis

The protobuf contract, published as the Buf module buf.build/stigmer/stigmer,
and the committed generated stubs under `stubs/`. Every resource, RPC,
validation rule and authorization annotation the platform serves is declared
here first and generated outward. This guide is an index; the protos and the
generator are the truth.

## Read in this order

- `README.md`: the directory layout and the build targets.
- `buf.yaml`: the lint and breaking configuration; comment ignores are
  disallowed, so a rule is satisfied or the rule set is changed.
- `ai/stigmer/commons/apiresource/`: the resource envelope every kind shares
  (metadata, status, io shapes, the `ApiResourceKind` enum, the
  `api_resource_kind` service option).
- `ai/stigmer/commons/rpc/`: method options and the authorization config
  annotation.
- `ai/stigmer/agentic/agent/`: the reference resource, its versioned file split
  and its `docs/` folder.
- `tools/codegen/README.md` and
  `tools/codegen/src/internalcomment/internalcomment.ts`: how the generators
  read the protos and the one owner of the `@internal` comment convention.

## Laws

- A new kind is placed before it is written: its bounded context is the
  directory under `ai/stigmer/` it belongs to, its aggregate and owner are
  named, and it is registered in `ApiResourceKind`. The server and every SDK
  mirror this structure.
- Blueprint kinds (Agent, Skill, Plugin) carry no secrets and no
  environment-specific values; runtime kinds do. A declared variable's plain
  default is a fixed setting, the same wherever the blueprint runs; a value that
  differs per deployment lives in a vault.
- Every RPC declares its authorization posture through the commons annotations
  (`config`, `is_public`, `is_skip_authorization`); the server's
  `backend/services/stigmer-server/docs/authorization-coverage.md` inventories
  the result and changes with it.
- The contract stays as small as it can be, so a reader needs no explanation of
  why a field exists. A field lands with its first reader, never ahead of it. A
  field that governs what an agent's tools may do exists only if a Claude Code
  or Cursor plugin can express it; Stigmer adds no tool-policy knob of its own.
- Agent output is never a Stigmer-invented format. `README.md`, "Agent output
  formats", has the rule, its scope and what predates it.
- Every kind meets one resource contract: a claimed slug, references by id,
  masked updates, one list shape. Inventories in
  `backend/services/stigmer-server/docs/` refuse what breaks it; the
  model-proto-resource skill is the procedure.
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
- A removed field or enum value keeps its number and name `reserved`.
- After any `.proto` change, `make codegen` from the repository root, and the
  generated output is committed. Hand edits under `stubs/` or any `gen`
  directory are defects.

## Skills

- `.agents/skills/model-proto-resource/SKILL.md`: the procedure for adding or
  reshaping a resource and its contract. Load it before a new kind or RPC.

## Verify

The root map's rows, plus `make -C apis fmt` before committing and
`make stubs-internal-check` (no `@internal` text in a stub).
