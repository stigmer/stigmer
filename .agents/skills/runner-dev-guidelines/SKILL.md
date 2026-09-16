---
name: runner-dev-guidelines
description:
  The design procedure for the agent runner (backend/services/runner): map the
  data flow, find the framework's own primitive before building one, carry
  identity not copies, and test LLM-dependent behaviour deterministically. Use
  when changing how the runner executes turns, handles approvals and
  interrupts, talks to MCP servers or Temporal, or adds a harness.
paths:
  - backend/services/runner/**
---

# Runner development guidelines

The package guide (`backend/services/runner/AGENTS.md`) carries the laws; this
skill carries the procedure that produces code obeying them, and the history
that explains why they are laws. LangGraph, LangChain, MCP and the Cursor SDK
produce inherently complex data: nested messages, denormalised tool calls,
layered checkpoints, streaming event hierarchies. The runner's job is to
simplify that data, not to mirror its complexity. Every design decision here
passes one test: does this make the data flow simpler or more complex? If more
complex, the design is wrong even when it is technically correct.

## The procedure, before any runtime code

1. **Research the framework first.** Trace the invocation path through the
   framework source before assuming what is available at tool-execution time:
   how LangGraph's `interrupt()` resumes (it restarts the node and returns the
   decision, so the gate must be idempotent;
   `backend/services/runner/src/middleware/approval-gate.ts` states the
   contract), how a `ToolMessage` carries its `tool_call_id`, what the MCP
   client exposes for a tool's identity, what `@cursor/sdk` reports for a turn.
   The frameworks have identity primitives that are routinely underused; a
   matching layer built before this step is usually a primitive nobody looked
   for.
2. **Map the data flow.** For every datum that crosses a component boundary
   (runner to server, workflow to activity, harness to runtime, runner to MCP
   server), write down who creates it, who reads it, who mutates it and where it
   is stored. Count the copies. Two copies of one fact is a drift waiting to
   happen; a "sync" step between them is the symptom, not the fix.
3. **Apply the simplicity test to each element.** Can this be eliminated by
   using an existing identity, by computing it on read, or by a framework
   primitive? Iterate until nothing more can be removed. Delete over refactor:
   an element that exists only to compensate for complexity elsewhere is
   deleted, not improved.
4. **Scope the change.** List explicitly what this change does not touch. The
   smallest change that solves the problem is the correct one; proto changes,
   new RPCs and new tables are expensive decisions taken only after field
   ownership, atomic operations and computed projections have been exhausted. A
   short "does not change" list is a sign the scope is too broad.
5. **Compare with the market, briefly.** The products that face the same
   problems at scale (IDE agents, coding assistants, agent platforms) have
   public designs for approvals, checkpoint and resume, streaming and sub-agent
   delegation. If the proposed design is much more complex than theirs for the
   same problem, that is a signal to revisit steps 1 to 3. Extract the pattern,
   never the code.
6. **Propose with the map.** Present the data-flow map, the copies before and
   after, who writes each field, and what can drift. The repository's rules of
   engagement decide how a proposal is confirmed; this skill decides what it
   contains.

## The laws, with their reasons

- **One home per fact.** Every piece of data has one canonical location. If a
  field exists on a structure, do not duplicate it into a payload, a signal or a
  cache; reference the original. Data needed in two contexts is computed from
  the one source on read.
- **One writer per field.** Each mutable field in a shared record has exactly
  one writer. If "who writes this?" has no single-component answer, the design
  has a race waiting for load. A merge respects ownership: a non-owner's stale
  value never overwrites the owner's.
- **Minimal payloads.** Interrupt values, Temporal signals, gRPC messages and
  IPC messages carry only what the consumer cannot already read. For each field
  ask "does this already exist somewhere the consumer can reach?"; if yes,
  remove it and reference the location. Redundant payload data is the single
  most common source of runner bugs.
- **Direct identity.** Explicit framework-provided identifiers for every
  cross-component reference; never fingerprints, name-based fallbacks or alias
  maps when an id exists or can be threaded through.
- **Derived state over stored state.** Computed derived state is consistent by
  construction; stored derived state must be kept in sync and eventually is not.
  "All approved?" is a query at decision time, never a counter.
- **Capability flags, never harness names.** A phase that must differ per engine
  asks `backend/services/runner/src/harness/capabilities.ts`; the harness table
  and the contract kit (`backend/services/runner/src/harness/README.md`) are how
  a harness is added.

The worked cases behind these laws are in
[references/simplification-cases.md](references/simplification-cases.md).

## Runtime code is production code

- Strict TypeScript, no `any`, no `@ts-expect-error` or `@ts-ignore` without a
  one-line reason. Small functions: a body that builds a graph, configures MCP
  servers, injects skills and starts streaming is not "AI code that has to be
  complex"; it is a function that has not been split.
- Magic strings, hard-coded model names and inline prompt fragments are defects.
  Constants, configuration objects and prompt modules.
- Prompt templates are code: version-controlled, reviewed, tested. A prompt
  change is a behaviour change and its pull request shows before and after
  output.
- Every design choice that is not obvious from the code (graph topology, retry
  strategy, truncation policy, delimiter strategy in a composed prompt) says why
  in the module header. AI systems are uniquely prone to "works but nobody knows
  why".
- Never inject unstructured user content into a system prompt; user input goes
  in user messages.
- Every LLM call, tool invocation and checkpoint event is observable as a
  structured event, with token usage per call and latency by phase (model, tool,
  MCP overhead).

## Tests ship with the feature

- Unit tests for all non-LLM logic: state transitions, checkpoint serialisation,
  context-window arithmetic, token budgets, approval policy, MCP lifecycle.
- LLM-dependent behaviour is tested against deterministic mocks and scripted
  turns: the harness contract kit's scripted adapter
  (`backend/services/runner/src/__test-utils__/harness-contract/scripted-adapter.ts`)
  inside this package, and the conformance suite's scripted model
  (`test/conformance/src/harness/mock-llm.ts`) across the wire. A test that
  makes a live model call is an experiment, not a test.
- Assert on structure and side effects, never on prose.
- Edge cases are where incidents hide: context overflow, an MCP server crashing
  mid-call, provider rate limiting, a malformed tool response. Test them by
  name.
- Concurrency gets its own tests: two approvals at once, an approval during
  streaming, a status write racing an approval write.
- The contract kit is the definition of a working harness; a new adapter is done
  when the kit is green against it, not when a demo runs.

## Review posture

A pull request that deletes state, removes a redundant copy and simplifies a
flow is a better pull request than one that adds an abstraction layer. Measure
progress in copies removed and lines deleted. Refuse fuzzy matching, shadow
state and multi-step synchronisation between parallel representations: when a
solution needs them, the architecture underneath is wrong, and that is what to
fix.
