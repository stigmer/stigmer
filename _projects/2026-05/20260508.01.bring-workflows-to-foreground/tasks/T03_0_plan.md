# Task T03: P0 New Task Types — Proto Definitions

**Created**: 2026-05-12
**Status**: APPROVED
**Type**: Feature Development (Batched)
**Depends On**: T02 (Structured Agent Output Model) — COMPLETE
**Research**: `_projects/2026-05/research.workflow-domain-foreground-strategy/04.report.gpt.md`

## Objective

Add the missing AI-native task types to the workflow domain as proto definitions, codegen schemas, and validation wiring. These task types close the gap between "cloud workflow" and "AI workflow" identified in the deep research report.

## Context

The existing 13 task kinds cover CNCF Serverless Workflow primitives well (set, call, switch, for, fork, try, listen, wait, raise, run) plus two Stigmer-specific kinds (activity_call, agent_call). What's missing are the primitives that make workflows **AI-native**: direct LLM calls, deterministic data transformation, schema validation, workflow-level human approvals, event emission, and notifications.

T02 added structured output contracts to `agent_call`, proving that agents can produce typed JSON for routing. T03 adds the remaining building blocks so that workflows can: classify without an agent, reshape data without an agent, validate outputs before acting on them, ask humans for approval at the workflow level, emit events for external consumers, and notify humans through channels.

## Scope

**T03 is proto + codegen + validation wiring only.** Runtime implementation of these task types (Go Temporal activities, Java service handlers) is T13. T03 defines the contracts; T13 implements the engines.

### What "adding a task type" means (the full checklist)

Each new task type requires changes in these files:

1. **Proto file**: `apis/ai/stigmer/agentic/workflow/v1/tasks/<name>.proto` — message definition with `discriminator_value`, buf.validate rules, YAML examples
2. **Enum entry**: `apis/ai/stigmer/agentic/workflow/v1/enum.proto` — new `WorkflowTaskKind` value
3. **Spec comment**: `apis/ai/stigmer/agentic/workflow/v1/spec.proto` — add kind→config mapping to `WorkflowTask.task_config` comment
4. **Codegen JSON schema**: `tools/codegen/schemas/tasks/<name>.json` — task schema for codegen
5. **Type schemas**: `tools/codegen/schemas/tasks/types/*.json` — for any new sub-messages
6. **Unmarshal switch**: `backend/services/workflow-runner/pkg/validation/unmarshal.go` — add case to `UnmarshalTaskConfig`
7. **Run `make codegen`** (stigmer) — regenerates Go stubs, MCP server codegen (`workflow_gen.go`), TypeScript/Python/Dart stubs
8. **Run `make protos`** (stigmer-cloud) — regenerates Java, Go, Python, TypeScript, Dart stubs
9. **Verify**: `buf lint`, `buf breaking`, `go vet`

## Design Decision: `transform` — Keep It

**Decision**: Add `transform` as a distinct task type. Do not fold it into `set_vars`.

**Rationale**: The research report identifies `transform` as "the most obvious missing primitive," citing AWS Step Functions (JSONata transforms) and Conductor (JSON JQ Transform) as direct precedents. The distinction from `set_vars` is real and important:

| Concern | `set_vars` | `transform` |
|---------|-----------|-------------|
| **Purpose** | Mutate workflow state variables | Compute a shaped output from an input expression |
| **Mental model** | Imperative assignment ("set X to Y") | Functional transformation ("reshape this data") |
| **Engine** | Built-in expression evaluation (`${ ... }`) | Explicit engine choice: `jq`, `jsonata`, `template` |
| **Output** | Written directly into workflow context | Produced as task output, consumed via `export` |
| **Composability** | Variables are side effects | Output flows through export/flow like any other task |
| **Inspectability** | Variable mutations are implicit | Input/output visible in execution viewer as a distinct step |

In a workflow like "call an agent, extract fields, reshape for an API call, then POST," the reshaping step should be an explicit, named, inspectable task — not a `set_vars` side effect. This matters for the execution viewer (T09), where every task shows input/output/timing. A `set_vars` assignment is invisible in the trace; a `transform` step is a visible data operation.

The CNCF Serverless Workflow DSL itself does not have a separate "transform" concept because its `set` is already expression-rich. But Stigmer's `set_vars` is simpler (string key→expression value), and adding a full JQ/JSONata engine to `set_vars` would blur its purpose. Better to keep `set_vars` simple and add `transform` for when you need real data reshaping.

## Design Decision: `extract` — Defer

**Decision**: Do not add `extract` in T03. Revisit after `llm_call` and `transform` are in use.

**Rationale**: The research recommends `extract` as a task that "converts text/artifact output into typed JSON." But T02 already added `AgentCallOutputContract` (JSON Schema on `agent_call` output), and `llm_call` (which we're adding here) will support `response_schema` for direct LLM-based extraction. Meanwhile, `transform` with JQ handles deterministic structural extraction. The two new types together cover the same use cases `extract` was designed for:

- **LLM-based extraction** (unstructured text → typed JSON): Use `llm_call` with a `response_schema`
- **Deterministic extraction** (JSON → reshaped JSON): Use `transform` with JQ

If real usage reveals a gap that `llm_call` + `transform` doesn't cover, `extract` can be added in a later batch. Adding it now risks creating confusion about when to use `extract` vs `llm_call` vs `agent_call` with output schema — three different ways to do essentially the same thing.

## Design Decision: `batch` — Enhance `for_each` Instead

**Decision**: Do not add a separate `batch` task type. Instead, enhance `ForTaskConfig` with `max_parallelism`, `continue_on_error`, and `batch_size` fields in a future PR.

**Rationale**: The research recommends: "You likely do not need a separate `batch` task if `for_each` can express `max_parallelism`, `batch_size`, `continue_on_error`, and result aggregation." This is a better design — one iteration primitive with full control, rather than two similar concepts that confuse users. This enhancement is out of scope for T03 (it modifies an existing type, not a new one) but should be tracked separately.

## Batched Sub-Tasks

T03 is split into three batches, each independently deliverable and reviewable. Each batch can be picked up in a separate session.

---

### Batch 1: AI-Native Task Types (T03.1 + T03.2)

> Enable AI decisioning and data transformation without agent overhead.

These two types are the most universally useful and have the smallest risk. No external system dependencies. Pure computational primitives.

#### T03.1: `llm_call` — Direct LLM Call

**Why it's needed**: Many workflow decisions are too small for a full agent: classification, extraction, moderation, summarization, scoring, routing. An agent carries overhead (system prompt, tool resolution, MCP server setup, session management). `llm_call` is a lightweight, deterministic, cheaper alternative for focused LLM tasks.

**Enum value**: `llm_call = 14`

**Proto file**: `apis/ai/stigmer/agentic/workflow/v1/tasks/llm_call.proto`

**Config message**: `LlmCallTaskConfig`
- `discriminator_value` = `"llm_call"`

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | `string` | yes | Model reference (e.g., "claude-sonnet-4-5", "gpt-4o"). Resolved via model registry. |
| `system_prompt` | `string` | no | System prompt for the LLM call. Supports `${ }` expressions. |
| `prompt` | `string` | yes | User prompt / instruction. Supports `${ }` expressions. |
| `response_schema` | `google.protobuf.Struct` | no | JSON Schema for structured output. When set, the runner requests structured output from the provider. |
| `temperature` | `float` | no | Sampling temperature (0.0–2.0). Default: provider default. |
| `max_tokens` | `int32` | no | Maximum tokens in response. |
| `timeout` | `int32` | no | Timeout in seconds. Default: 60. Max: 600. |
| `on_invalid` | `OnInvalidOutputPolicy` | no | Policy when response fails schema validation. Reuses T02's enum. |
| `max_retries` | `int32` | no | Max schema-validation retries. Default: 1. Range: 1–5. |
| `fallback_task` | `string` | no | Task to branch to on exhausted retries. |

**Design notes**:
- Reuses `OnInvalidOutputPolicy` from T02 (`agent_call.proto`). This enum should be extracted to a shared file if it isn't already co-located well.
- Does NOT include `provider_override` or `fallback_model` — those are runtime/policy concerns for T05 (budget) and T13 (runtime).
- `response_schema` uses the same `google.protobuf.Struct` + JSON Schema pattern as `AgentCallOutputContract.schema` for consistency.

**YAML example**:
```yaml
- classify_severity:
    call: llm
    with:
      model: "gpt-4o-mini"
      system_prompt: "You are a support ticket classifier."
      prompt: "Classify this ticket: ${ $context.ticket.description }"
      response_schema:
        type: object
        required: [severity, category]
        properties:
          severity:
            type: string
            enum: [low, medium, high, critical]
          category:
            type: string
      on_invalid: ON_INVALID_RETRY
      max_retries: 2
    export:
      as: "${ . }"
```

#### T03.2: `transform` — Deterministic Data Transformation

**Why it's needed**: Workflows need to reshape data between tasks — projecting fields, joining objects, converting formats, building API payloads. This should be a cheap, deterministic, inspectable step — not an LLM call and not a side-effectful `set_vars` mutation.

**Enum value**: `transform = 15`

**Proto file**: `apis/ai/stigmer/agentic/workflow/v1/tasks/transform.proto`

**Config message**: `TransformTaskConfig`
- `discriminator_value` = `"transform"`

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `engine` | `TransformEngine` (enum) | yes | Transformation engine: `jq`, `jsonata`, or `template`. |
| `expression` | `string` | yes | The transformation expression in the chosen engine's syntax. Supports `${ }` for input references when engine is `template`. |
| `input` | `string` | no | Expression selecting the input data. Default: entire workflow context. Supports `${ }` expressions. |

**Supporting enum**: `TransformEngine`
- `TRANSFORM_ENGINE_UNSPECIFIED = 0`
- `TRANSFORM_ENGINE_JQ = 1`
- `TRANSFORM_ENGINE_JSONATA = 2`
- `TRANSFORM_ENGINE_TEMPLATE = 3`

**Design notes**:
- Output is the result of applying the expression to the input. Consumed via `export`.
- No `output_schema` field — the transform expression defines the shape. Validation belongs in a separate `validate` task if needed.
- `template` engine uses Go's `text/template` (or equivalent) with `${ }` expression interpolation for simple string-building use cases (e.g., building email bodies, API payloads from templates).
- The input field defaults to the full context when omitted, matching how `switch_case` expressions work.

**YAML example**:
```yaml
- build_api_payload:
    transform:
      engine: jq
      expression: '{name: .customer.full_name, severity: .triage.severity, summary: .agent_analysis.structured.summary}'
      input: "${ $context }"
    export:
      as: "${ . }"

- render_notification:
    transform:
      engine: template
      expression: "Ticket {{ .ticket_id }} classified as {{ .severity }} — {{ .summary }}"
      input: "${ $context.build_api_payload }"
    export:
      as: "${ . }"
```

---

### Batch 2: Governance & Safety (T03.3 + T03.4)

> Enable workflow-level human approvals and schema validation checkpoints.

These types are architecturally significant. `human_input` is the most complex proto in this entire task because it models a multi-party, timeout-aware, form-driven interaction. `validate` is simpler but closes an important safety gap.

#### T03.3: `human_input` — Workflow-Level Approval Gate

**Why it's needed**: The research identifies this as a critical gap: "Workflows need a first-class way to stop, collect typed input or approval, and resume safely. This should not be hidden inside agent-level HITL only. It belongs in the workflow domain." Currently, approval gates only exist inside agents (tool approval). Workflows need approvals before API calls, publishing, customer messages, transactions, or expensive operations.

**Enum value**: `human_input = 16`

**Proto file**: `apis/ai/stigmer/agentic/workflow/v1/tasks/human_input.proto`

**Config message**: `HumanInputTaskConfig`
- `discriminator_value` = `"human_input"`

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | `string` | yes | Message shown to the reviewer explaining what needs approval/input. Supports `${ }` expressions. |
| `form_schema` | `google.protobuf.Struct` | no | JSON Schema defining the input form. When set, the UI renders a typed form. When absent, the reviewer sees approve/deny buttons only. |
| `outcomes` | `repeated HumanInputOutcome` | no | Named outcomes with routing. Default: approve (continue) / deny (fail). |
| `approvers` | `repeated string` | no | List of approver identifiers (user IDs, team slugs, role names). Empty = any authenticated user. |
| `timeout` | `int32` | no | Timeout in seconds before `on_timeout` policy applies. Default: 0 (no timeout). Max: 2592000 (30 days). |
| `on_timeout` | `HumanInputTimeoutPolicy` (enum) | no | What happens when timeout expires. Default: fail. |
| `notification_channels` | `repeated string` | no | Channel identifiers for approval request notifications (e.g., "slack:#approvals", "email:ops@acme.com"). |

**Supporting messages and enums**:

`HumanInputOutcome`:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Outcome identifier (e.g., "approve", "deny", "needs_revision"). |
| `label` | `string` | no | Human-readable label for the button/action. Default: capitalized name. |
| `then` | `string` | no | Task to branch to when this outcome is selected. Empty = continue to next task. |

`HumanInputTimeoutPolicy` (enum):
- `HUMAN_INPUT_TIMEOUT_POLICY_UNSPECIFIED = 0` — default: fail
- `HUMAN_INPUT_TIMEOUT_FAIL = 1` — task fails with timeout error
- `HUMAN_INPUT_TIMEOUT_APPROVE = 2` — auto-approve (continue)
- `HUMAN_INPUT_TIMEOUT_DENY = 3` — auto-deny (branch to deny outcome)
- `HUMAN_INPUT_TIMEOUT_ESCALATE = 4` — branch to a named escalation task

**Design notes**:
- Runtime implementation (T13) will use Temporal signals for resumption. The proto definition is intentionally runtime-agnostic.
- `form_schema` uses the same JSON Schema in `google.protobuf.Struct` pattern as `AgentCallOutputContract.schema` and `LlmCallTaskConfig.response_schema`.
- The reviewer's form response becomes the task output, accessible via `export`.
- `outcomes` enable rich branching: not just approve/deny but also "needs_revision", "escalate", "defer", etc. Each outcome can route to a different task.
- When `outcomes` is empty, the default is binary: approve (task output = `{"outcome": "approve"}`, continue) or deny (task fails or routes to error handler).
- `notification_channels` is a list of strings — the format and routing is a runtime concern. The proto just carries the identifiers.

**YAML example**:
```yaml
- manager_approval:
    human_input:
      prompt: "Customer-impacting incident classified as ${ $context.triage.severity }. Approve escalation?"
      form_schema:
        type: object
        properties:
          notes:
            type: string
            description: "Optional notes for the engineering team"
          priority_override:
            type: string
            enum: [P1, P2, P3]
      outcomes:
        - name: approve
          label: "Approve Escalation"
        - name: deny
          label: "Reject — Not Customer-Impacting"
          then: re_classify
        - name: needs_revision
          label: "Needs More Info"
          then: gather_more_context
      approvers:
        - "team:engineering-leads"
      timeout: 86400
      on_timeout: HUMAN_INPUT_TIMEOUT_ESCALATE
      notification_channels:
        - "slack:#incident-approvals"
    export:
      as: "${ . }"
```

#### T03.4: `validate` — Schema and Rules Validation

**Why it's needed**: Explicit validation checkpoints prevent bad data from flowing downstream. The research says: "Workflows benefit from explicit validation nodes that verify properties before downstream actions occur. This is how you distinguish 'the API call succeeded' from 'the model answer is safe and complete enough to continue.'" While `switch_case` + `raise_error` can approximate validation, a dedicated `validate` task makes the intent explicit, the error messages richer, and the execution trace clearer.

**Enum value**: `validate = 17`

**Proto file**: `apis/ai/stigmer/agentic/workflow/v1/tasks/validate.proto`

**Config message**: `ValidateTaskConfig`
- `discriminator_value` = `"validate"`

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `input` | `string` | yes | Expression selecting the data to validate. Supports `${ }` expressions. |
| `schema` | `google.protobuf.Struct` | no | JSON Schema to validate against. At least one of `schema` or `rules` must be set. |
| `rules` | `repeated ValidationRule` | no | Business rules to evaluate. At least one of `schema` or `rules` must be set. |
| `on_fail` | `ValidationFailPolicy` (enum) | no | What happens when validation fails. Default: fail. |
| `fallback_task` | `string` | no | Task to branch to when on_fail is BRANCH. |

**Supporting messages and enums**:

`ValidationRule`:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Rule identifier for error reporting. |
| `expression` | `string` | yes | Boolean expression that must evaluate to true. Supports `${ }` expressions. |
| `message` | `string` | no | Error message when the rule fails. Supports `${ }` expressions. |

`ValidationFailPolicy` (enum):
- `VALIDATION_FAIL_POLICY_UNSPECIFIED = 0` — default: fail
- `VALIDATION_FAIL_RAISE = 1` — task fails with validation error (enters try_catch or EXECUTION_FAILED)
- `VALIDATION_FAIL_BRANCH = 2` — branch to `fallback_task`
- `VALIDATION_FAIL_WARN = 3` — log warnings but continue (validation errors available in task output)

**Design notes**:
- The task output includes the validation result: `{"valid": true/false, "errors": [...], "data": <original input>}`. This enables downstream tasks to inspect what failed.
- `schema` uses the same JSON Schema pattern as all other schema fields in the workflow domain.
- `rules` provide business-rule validation that JSON Schema can't express (e.g., "severity must be critical if customer_impact is true").
- CEL-based validation via `rules` expressions: the validation should use the same expression engine as `switch_case.when` for consistency.

**YAML example**:
```yaml
- check_triage_quality:
    validate:
      input: "${ $context.triage }"
      schema:
        type: object
        required: [severity, category, customer_impact]
        properties:
          severity:
            type: string
            enum: [low, medium, high, critical]
          category:
            type: string
            minLength: 1
          customer_impact:
            type: boolean
      rules:
        - name: critical_needs_rationale
          expression: "${ .severity != 'critical' || (.rationale != null && .rationale != '') }"
          message: "Critical severity requires a rationale"
        - name: customer_impact_needs_severity
          expression: "${ .customer_impact != true || .severity in ['high', 'critical'] }"
          message: "Customer-impacting issues must be high or critical severity"
      on_fail: VALIDATION_FAIL_BRANCH
      fallback_task: human_review
    export:
      as: "${ . }"
```

---

### Batch 3: Event & Notification (T03.5 + T03.6)

> Close the event symmetry gap and enable operational notification workflows.

These types are straightforward structurally but fill important product gaps. `emit_event` completes the listen/emit duality from the CNCF spec. `notification` provides a user-friendly abstraction for operational workflows.

#### T03.5: `emit_event` — Event Emission

**Why it's needed**: The research notes: "Stigmer currently has `listen` but no matching event-emission primitive. Adding `emit_event` closes the loop for event-driven orchestration and aligns better with the reference spec." CNCF Serverless Workflow includes `Emit`; Stigmer should have it too. Workflows need to publish events for: other workflows to listen on, external systems to consume, audit trails, and metrics.

**Enum value**: `emit_event = 18`

**Proto file**: `apis/ai/stigmer/agentic/workflow/v1/tasks/emit_event.proto`

**Config message**: `EmitEventTaskConfig`
- `discriminator_value` = `"emit_event"`

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event` | `EmitEventSpec` | yes | Event specification to emit. |

`EmitEventSpec`:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | yes | Event type identifier (CloudEvents `type` field). E.g., "stigmer.workflow.ticket.classified". |
| `source` | `string` | no | Event source identifier. Default: workflow execution URI. Supports `${ }` expressions. |
| `data` | `google.protobuf.Struct` | no | Event payload data. Supports expression values. |
| `subject` | `string` | no | Event subject (CloudEvents `subject` field). Supports `${ }` expressions. |

**Design notes**:
- Follows CloudEvents envelope semantics (type, source, subject, data) because: (1) CloudEvents is a graduated CNCF project, (2) the CNCF Serverless Workflow spec already uses CloudEvents, (3) it provides a standard envelope that external consumers can parse.
- The `id`, `specversion`, and `time` fields are generated at runtime — not authored by the user.
- `emit_event` is the complement to `listen`. A workflow can `emit_event` → another workflow's `listen` picks it up via Temporal signals.
- The runtime implementation (T13) decides how events are delivered: Temporal signals, message queues, webhooks, etc.

**YAML example**:
```yaml
- notify_classified:
    emit_event:
      event:
        type: "stigmer.workflow.ticket.classified"
        subject: "${ $context.ticket.id }"
        data:
          ticket_id: "${ $context.ticket.id }"
          severity: "${ $context.triage.severity }"
          category: "${ $context.triage.category }"
          classified_by: "${ $context.workflow_instance_id }"
```

#### T03.6: `notification` — Channel-Based Notifications

**Why it's needed**: Operational workflows need to notify humans through channels: Slack messages, emails, Discord posts, Teams notifications. While `emit_event` can technically trigger notifications via downstream consumers, a first-class `notification` task provides a simpler, more intuitive UX for the most common notification patterns. The research recommends it as a P0 task type.

**Enum value**: `notification = 19`

**Proto file**: `apis/ai/stigmer/agentic/workflow/v1/tasks/notification.proto`

**Config message**: `NotificationTaskConfig`
- `discriminator_value` = `"notification"`

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `channel` | `string` | yes | Notification channel identifier (e.g., "slack", "email", "discord", "teams", "webhook"). |
| `recipients` | `repeated string` | yes | Recipient identifiers. Format depends on channel (e.g., "#channel" for Slack, "user@example.com" for email). Supports `${ }` expressions in values. |
| `subject` | `string` | no | Notification subject/title. Supports `${ }` expressions. |
| `body` | `string` | yes | Notification body/message. Supports `${ }` expressions. |
| `template` | `string` | no | Named template reference (e.g., "incident-alert", "approval-request"). When set, `body` is used as fallback. |
| `metadata` | `map<string, string>` | no | Channel-specific metadata (e.g., thread_ts for Slack threading, priority for email). |

**Design notes**:
- `channel` is a string rather than an enum to allow extensibility — new notification channels can be added without proto changes.
- The runtime implementation (T13) resolves channel identifiers to actual notification providers configured in the workflow instance's environment.
- `notification` is intentionally simpler than `emit_event`. It's a convenience abstraction for "send a message to humans" rather than a system-level event primitive.
- Notifications are fire-and-forget by default. For notifications that require acknowledgment, use `human_input` instead.

**YAML example**:
```yaml
- alert_slack:
    notification:
      channel: "slack"
      recipients:
        - "#incident-response"
        - "@oncall-lead"
      subject: "P${ $context.triage.severity } Incident: ${ $context.ticket.title }"
      body: |
        *Severity*: ${ $context.triage.severity }
        *Category*: ${ $context.triage.category }
        *Customer Impact*: ${ $context.triage.customer_impact }
        *Summary*: ${ $context.agent_analysis.structured.summary }
      metadata:
        thread_ts: "${ $context.slack_thread_id }"
```

---

## Enum Summary

New entries added to `WorkflowTaskKind` in `enum.proto`:

| Value | Name | Batch |
|-------|------|-------|
| 14 | `llm_call` | 1 |
| 15 | `transform` | 1 |
| 16 | `human_input` | 2 |
| 17 | `validate` | 2 |
| 18 | `emit_event` | 3 |
| 19 | `notification` | 3 |

## Naming Conventions (Following Existing Patterns)

| Convention | Examples (existing) | New types follow same pattern |
|-----------|-------------------|-------------------------------|
| Invocations: `_call` suffix | `http_call`, `grpc_call`, `agent_call` | `llm_call` |
| Control flow: semantic suffix | `switch_case`, `for_each`, `try_catch` | (none in T03) |
| Self-descriptive verbs | `fork`, `listen`, `wait` | `transform`, `validate` |
| Verb + object | `set_vars`, `run_workflow`, `raise_error` | `emit_event`, `human_input`, `notification` |

## Implementation Order

Each batch is independently deliverable. Within a batch, the two types should be implemented together in one session because they share the same codegen/verify cycle.

```
Batch 1 (T03.1 + T03.2) — llm_call + transform
  → Can be picked up immediately. No dependencies beyond T02.
  → Highest standalone value: enables AI decisioning and data reshaping.

Batch 2 (T03.3 + T03.4) — human_input + validate
  → Can be picked up after Batch 1, or in parallel.
  → human_input is the most complex proto. validate is straightforward.

Batch 3 (T03.5 + T03.6) — emit_event + notification
  → Can be picked up after Batch 1, or in parallel.
  → Smallest risk. Straightforward structural additions.
```

## Per-Batch Deliverables

For each batch, the session should:

1. Create the proto files with full documentation and YAML examples
2. Add enum entries (contiguous values, no gaps)
3. Update `spec.proto` task_config comment with kind→config mapping
4. Create codegen JSON schemas
5. Add `UnmarshalTaskConfig` switch cases
6. Run `buf lint` + `buf breaking` — zero errors
7. Run `make codegen` (stigmer) — all stubs regenerate
8. Run `make protos` (stigmer-cloud) — all stubs regenerate
9. Run `go vet` on affected packages
10. Commit with conventional commit: `feat(workflow): add <task_types> task kinds (T03.<batch>)`

## Out of Scope for T03

- **Runtime implementation** — T13 handles Go Temporal activities and Java service handlers
- **`extract` task type** — Deferred (see Design Decision above)
- **`batch` / `for_each` concurrency enhancements** — Separate future task
- **`budget_guard` task type** — T05 (Workflow-Level Budget Primitives)
- **`artifact_store` task type** — T07 (Artifact Store Integration)
- **Task schema registry entries** — T04 (Task Schema Registry)
- **UI task forms/editors** — Phase 1 UI tasks
- **`semantic_switch` / `classify`** — Can be achieved via `llm_call` + `switch_case`; a dedicated type is Phase 4

## Risks

| Risk | Mitigation |
|------|-----------|
| Enum value conflicts if parallel work adds other kinds | Assigned contiguous block 14–19; communicate reservation |
| `human_input` proto may need revision during T13 runtime implementation | Proto is designed to be runtime-agnostic; runtime-specific fields belong in T13's implementation, not the proto |
| `notification` channel format may vary across providers | Channel is a string, not an enum — extensible by design |
| `transform` engine choice (JQ vs JSONata) may need runtime libraries | T03 defines the proto; engine implementation is T13's concern |
| `OnInvalidOutputPolicy` is reused from `agent_call.proto` — may need extraction to a shared file | Acceptable coupling for now; extract if a third consumer appears |

## Suggested Starting Point

Begin with **Batch 1 (T03.1 + T03.2)** — `llm_call` and `transform` — because they have the highest standalone value, the smallest architectural complexity, and no dependencies on external systems.

---

**Please review this plan and provide your feedback. I will not proceed to execution until you explicitly approve a batch.**
