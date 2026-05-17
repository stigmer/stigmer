# Task T17: Notification & Event Delivery Providers

**Created**: 2026-05-17
**Status**: PENDING
**Type**: Feature Development
**Depends On**: T03 (P0 Task Types) -- COMPLETE
**Phase**: Phase 4 -- Advanced Agentic Orchestration

## Objective

Implement channel-specific notification providers (Slack, email) and cross-workflow event delivery for the `notification` and `emit_event` task kinds. Both task kinds have working runtime plumbing (builder, Temporal activity, config parsing, placeholder resolution) but lack the last-mile delivery to external services.

## Context

The notification and emit_event task kinds were introduced in T03 with the full runtime wiring in the workflow-runner. The proto design intentionally used `string channel` (not an enum) for extensibility, deferring provider implementations to a follow-up task. The workflow-runner currently has:

- A pluggable **Provider registry** (`Register()` / `Get()`) at `workflow-runner/pkg/notification/provider.go`
- A single **`webhook`** provider that does HTTP POST to recipient URLs (`webhook.go`)
- Full placeholder resolution for `${.secrets.*}` and `${.env_vars.*}` in all notification fields

This gap prevents seedpack workflows from showcasing external integrations (Slack alerts, email notifications) and limits the `notification` task kind to raw webhooks.

## Gap 1: Notification Providers

### Current State

| File | Role |
|------|------|
| `workflow-runner/pkg/notification/provider.go` | Provider interface + global registry (`map[string]Provider`) |
| `workflow-runner/pkg/notification/webhook.go` | Only registered provider -- HTTP POST to recipient URLs |
| `workflow-runner/pkg/zigflow/tasks/task_builder_notification.go` | Temporal workflow step -- calls `notification.Get(channel)` |
| `workflow-runner/pkg/zigflow/tasks/task_builder_notification_activities.go` | Temporal activity -- resolves placeholders, dispatches to provider |
| `apis/.../workflow/v1/tasks/notification.proto` | Proto -- `NotificationTaskConfig` with `string channel` field |

The `Get()` function returns an explicit error for unknown channels:
```
notification channel 'slack' is not implemented; available channels: webhook
```

### What Needs to Be Built

#### T17.1: Slack Notification Provider

Add `workflow-runner/pkg/notification/slack.go` implementing `Provider`:

- `Channel()` returns `"slack"`
- `Send()` calls Slack Web API (`chat.postMessage`) using a bot token from `runtimeEnv`
- Token resolution: read `SLACK_BOT_TOKEN` from the env map passed to the activity (sourced from workflow instance's Environment resources via the standard `envmerge` pipeline)
- Recipients are Slack channel names (`#general`) or user handles (`@alice`)
- Subject maps to a bold header line; body is the message content
- `metadata` supports Slack-specific fields like `thread_ts`, `unfurl_links`
- Register via `init()` like the webhook provider

Credential flow (already works, no changes needed):
```
Environment resource (SLACK_BOT_TOKEN) 
  -> WorkflowInstance.environment_refs 
  -> envmerge 
  -> ExecutionContext 
  -> TemporalWorkflowInput.EnvVars 
  -> activity runtimeEnv 
  -> provider reads env["SLACK_BOT_TOKEN"]
```

#### T17.2: Email Notification Provider

Add `workflow-runner/pkg/notification/email.go` implementing `Provider`:

- `Channel()` returns `"email"`
- `Send()` uses SMTP or a transactional email API (Resend, SendGrid)
- Token/config resolution from `runtimeEnv`: `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_FROM`, `EMAIL_API_KEY` (for API-based)
- Recipients are email addresses
- Subject and body map directly
- `metadata` supports `reply_to`, `cc`, `priority`

#### T17.3: Seedpack Integration Workflows

Once Slack/email providers exist, add seedpack workflows that demonstrate external integrations:

- A support triage workflow that sends Slack alerts after classification
- A content pipeline that emails approved content to a distribution list
- These workflows declare required env vars (e.g., `SLACK_BOT_TOKEN`) so the WorkflowRunDialog prompts for them

### Estimated Scope

- T17.1 (Slack): ~100-150 lines of Go + tests. The Slack Web API `chat.postMessage` is a single HTTP POST.
- T17.2 (Email): ~100-150 lines of Go + tests. SMTP or API call.
- T17.3 (Seedpack): 2-3 workflow YAML files, following the pattern in `seedpack/workflows/`.

## Gap 2: emit_event Cross-Workflow Delivery

### Current State

| File | Role |
|------|------|
| `workflow-runner/pkg/zigflow/tasks/task_builder_emit_event.go` | Temporal workflow step |
| `workflow-runner/pkg/zigflow/tasks/task_builder_emit_event_activities.go` | Constructs a CloudEvents envelope and **returns it as task output** |
| `apis/.../workflow/v1/tasks/emit_event.proto` | Proto -- `EmitEventTaskConfig` with CloudEvents fields |

The activity comment explicitly states: *"Cross-workflow delivery is deferred to Phase 2."*

Currently, `emit_event` constructs a valid CloudEvents JSON object (`id`, `specversion`, `type`, `source`, `time`, `data`) and returns it as the task output. It does not:

- Publish to any event bus or message broker
- Trigger `listen` tasks in other running workflow executions
- Persist the event for later consumption

### What Needs to Be Built

#### T17.4: Event Bus for Cross-Workflow Delivery

This is a larger design question with multiple approaches:

- **Option A**: Use Temporal signals -- `emit_event` signals target workflow executions by type/ID, `listen` tasks receive via signal channels (already implemented in listen builder)
- **Option B**: Use an external event bus (Redis Streams, NATS, CloudEvents-compatible broker) -- `emit_event` publishes, `listen` subscribes
- **Option C**: Use stigmer-server as the broker -- `emit_event` calls a gRPC endpoint, server fans out to matching `listen` tasks

This requires a design decision before implementation. The `listen` task builder already supports signal/query/update reception via Temporal -- the gap is on the publishing side.

### Estimated Scope

- Needs a design decision document first
- Implementation depends on chosen approach (Temporal signals is simplest, ~200 lines)

## Priority

T17.1 (Slack provider) is the highest-priority item -- it unblocks the most common integration use case and enables seedpack showcase workflows. T17.2 (email) is secondary. T17.4 (event delivery) is a larger effort and can be deferred further.

## Files to Modify

- `workflow-runner/pkg/notification/slack.go` (new)
- `workflow-runner/pkg/notification/email.go` (new)
- `workflow-runner/pkg/notification/BUILD.bazel` (add new files)
- `seedpack/workflows/` (new integration workflow YAMLs after providers exist)

## Testing

- Unit tests for each provider with mock HTTP clients
- Integration test: workflow with `notification` task using `channel: "slack"` against a mock Slack API
- E2E test: extend the existing workflow testing infrastructure (project `20260514.01`) with a notification canary
