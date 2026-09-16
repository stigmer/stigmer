# Architecture principles

What this codebase optimises for, and the reasons behind the laws in the guides.
Read this before proposing a new concept, a new layer or a new copy of anything.

## Principles

- The resource model is declarative and Kubernetes-shaped. Every concept is a
  resource with `apiVersion`, `kind`, `metadata`, `spec` and `status`; a user
  applies a definition and the platform reconciles it. Names are the ubiquitous
  language: an Agent is a blueprint, an AgentExecution is one run, a Session is
  a conversation context. Never introduce a synonym.
- Blueprints and runtime are separated by a hard line. Agent, Workflow,
  McpServer and Skill definitions carry no secrets and no environment-specific
  values; AgentInstance, Session and executions do. A design that bleeds runtime
  state into a blueprint is wrong.
- The contract comes first and is generated outward. `apis/` is the single
  source of truth; every change starts as a proto, passes `buf lint` and
  `buf breaking`, and reaches the SDKs, the CLI, the MCP server and the docs
  through `make codegen`. Hand-written copies of generated types are defects.
- One implementation of the core, extended at seams. The control plane is one
  library; edition-specific behaviour composes onto it through explicit
  extension points, never through a second implementation of a core step.
  `test/conformance/` runs the same suite against every edition and is the
  arbiter of whether the contract holds.
- The UI is SDK-first. Features are built in the React SDK as data hooks,
  behaviour hooks and themed components, and the console and desktop app consume
  them as thin shells. If a platform builder embedding Stigmer would need it, it
  belongs in the SDK.
- One experience across surfaces. The CLI, the console, the desktop app and the
  SDKs use the same word for the same thing, group resources the same way, and
  ask the same confirmation for the same destructive act. An error message on
  any surface says what happened, why, and what to do next. A difference between
  surfaces that has no platform reason is a defect, not a style.
- Storage sits behind one interface. Domain code depends on the store contract,
  never on a driver; SQLite and Postgres are interchangeable behind it, and a
  behavioural contract test proves they agree.
- Durable execution is Temporal's job and Temporal's rules apply: deterministic
  workflows, idempotent activities, explicit timeouts, and wire vocabulary
  (workflow, activity and queue names) pinned as bytes.
- Every fact has one home and one writer. Data that exists in two places will
  drift; a payload carries only what its consumer cannot already read; derived
  state is computed on read, not stored. When a sync step appears between two
  copies, delete a copy.
- Delete over refactor. A design element that exists only to compensate for
  complexity elsewhere is removed, not polished. A change measured in lines
  deleted is a good sign.
- Research the framework before building on top of it. LangGraph, MCP, Temporal,
  protobuf and React already provide identity, scoping and lifecycle primitives
  that are easy to miss; a workaround that reimplements one is debt.

## Practical defaults for agents

- Before adding a field, an option or an enum member to a shared contract, ask
  whether the vocabulary already there expresses the need.
- Before adding a cache, a projection or a second store of the same fact, ask
  who writes it and what happens when the two disagree.
- Before implementing a cloud-only behaviour in the open-source server, or an
  open-source convenience in the cloud, classify the change: core, cloud-only or
  OSS-only. Parity for its own sake is maintenance without value.
- Before adding a component to a client app, ask whether it belongs in the SDK.
  Default to the SDK.
- Before writing a comment that cites a decision, write the reason in words a
  stranger can act on; cite a PR, an issue or a file, never a private record.
- Before declaring work done, name what could regress unnoticed and show the
  test or check that would catch it.
