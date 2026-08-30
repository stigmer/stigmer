# Authorization Coverage Inventory

This document is the ratified coverage inventory for the stigmer-server authorization surface (sub-project 20260827.01, identity-context-and-authorizer, ruling Q2). It classifies EVERY entry point the server exposes — every RPC method of every registered service, plus the non-RPC HTTP lanes — by its authorization posture: whether the shared `Authorize` pipeline step (`src/pipeline/steps/authorize.ts`) runs for it, what proto method annotation it carries, and what a direct handler does instead. It is a permanent acceptance artifact: the follow-up cloud sub-projects (C1/C2) inherit this map instead of discovering gaps against FGA. It MUST be updated whenever a method is added or removed, a handler changes between pipeline and direct form, or a `(ai.stigmer.commons.rpc.config)` / `is_public` / `is_skip_authorization` annotation changes.

How to read the tables:

- **Annotation** is what the method's proto declares: a `config` summary (`permission` on `resource_kind`, the `field_path` or literal `resource_id` the target is resolved from, and whether `error_msg` is set), `is_public` (50057), `is_skip_authorization` (50058), or `none` (no option at all — the apply RPCs and the gRPC health service).
- **Handler** is what the server actually runs: `chain-with-Authorize` means the handler builds a `newPipeline(...)` whose FIRST `.addStep` is `newAuthorizeStep(<its own method descriptor>, authorizer)`; `direct: <posture>` means no pipeline is built. A direct handler marked `authorizeDirect` evaluates its annotation through the SAME exported evaluation the step runs (`authorizeDirect` in `src/pipeline/steps/authorize.ts` — identical skip arms, target resolution, and decision mapping; C2 Stage 4, 20260827.10), placed per the Java baseline's handler order (noted per row where it differs from authorize-first).
- The two columns are independent facts. A method can carry a `config` annotation and be a direct handler — since C2 Stage 4 nearly all such methods evaluate the annotation via `authorizeDirect`; the dispositions of the full set are recorded in the "Config-annotated methods served by direct handlers" section before the notes.
- Authorize step semantics (verified in `src/pipeline/steps/authorize.ts`): the step returns immediately for the `internal` caller class, then for `is_public`, then for `is_skip_authorization`, then for methods with no `config` option; only a present `config` reaches the composed Authorizer. So even on chain methods, a skip/public annotation means the Authorizer is never consulted — the step's presence still gives C1/C2 the uniform interception point.

Verification notes: every registration map in `src/boot/compose.ts`'s routes closure was cross-checked against its controller file and its proto service definition; every `newAuthorizeStep` call site was checked for descriptor/RPC agreement (all ten lifecycle RPCs pass their own descriptor through the shared `runLifecyclePipeline` builder; memory `confirm`/`reject` pass their own descriptors through the shared `runTransition` helper); a mechanical scan confirmed `newAuthorizeStep` is the first `.addStep` of every `newPipeline` in the server (zero exceptions).

## Totals

- Registered services: 29 (28 Stigmer services + the standard gRPC health service; ApiKey command + query added by O3, 20260827.06).
- Registered RPC methods: 233.
- Handler classes: 179 `chain-with-Authorize`, 54 `direct` (17 of which evaluate their annotation via `authorizeDirect` — C2 Stage 4).
- Annotation classes: 139 `config`, 74 `is_skip_authorization`, 2 `is_public`, 18 `none` (15 apply RPCs + 3 health methods).
- Config-annotated methods served by direct handlers: 30, dispositioned at the C2 Stage-4 gate (17 `authorizeDirect`, 9 on the composed channel runtime, 1 deliberate skip, 3 recorded-gap stubs) — the full table before the notes section.

## 1. Health (`grpc.health.v1.Health`, `src/transport/health.ts`)

The standard gRPC health protocol — an external proto with no Stigmer annotations.

| Method | Annotation | Handler |
|---|---|---|
| check | none (external proto) | direct: pure in-memory health-state read |
| list | none (external proto) | direct: pure in-memory health-state read |
| watch | none (external proto) | direct: server-stream over in-memory health-state notifications |

## 2. Organization (`src/domain/organization/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| OrganizationCommandController.apply | none | chain-with-Authorize |
| OrganizationCommandController.create | is_skip_authorization | chain-with-Authorize |
| OrganizationCommandController.update | config: can_edit on organization (field metadata.id), error_msg yes | chain-with-Authorize |
| OrganizationCommandController.delete | config: can_delete on organization (field value), error_msg yes | chain-with-Authorize |
| OrganizationQueryController.get | config: can_view on organization (field value), error_msg yes | chain-with-Authorize |
| OrganizationQueryController.find | is_skip_authorization | chain-with-Authorize |
| OrganizationQueryController.findMyOrganizations | is_skip_authorization | direct: full store list — single-team OSS posture, ALL organizations are "mine" (cloud filters by IAM policy instead) |

Proto method NOT registered by this server: `OrganizationQueryController.getByExternalOrgId` (is_skip_authorization) — see the unregistered-methods list.

## 2a. ApiKey (`src/domain/apikey/controller.ts` — registered by O3, 20260827.06)

The first domain registered after this inventory's O2 baseline (registration order: immediately after Organization). The identity chassis's apikey VERIFIER reads the store through `domain/apikey/lookup.ts`, never through these RPCs — verification is not an entry point here.

| Method | Annotation | Handler |
|---|---|---|
| ApiKeyCommandController.create | is_skip_authorization | chain-with-Authorize |
| ApiKeyCommandController.update | config: can_edit on api_key (field metadata.id), error_msg yes | chain-with-Authorize |
| ApiKeyCommandController.delete | config: can_delete on api_key (field value), error_msg yes | chain-with-Authorize |
| ApiKeyQueryController.get | config: can_view on api_key (field value), error_msg yes | chain-with-Authorize |
| ApiKeyQueryController.getByKeyHash | is_skip_authorization | chain-with-Authorize (the cloud edition additionally gates this inside its handler via a platform-admin FGA check; the OSS permissive posture serves it openly — O3 ruling Q5) |
| ApiKeyQueryController.findAll | is_skip_authorization | chain-with-Authorize (returns all keys under the scope-less single-team posture — O3 ruling Q5; a composed ListReadScope narrows to the caller's authorized rows (20260830.01)) |

## 3. Environment (`src/domain/environment/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| EnvironmentCommandController.apply | none | chain-with-Authorize |
| EnvironmentCommandController.create | config: can_create_environment on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| EnvironmentCommandController.update | config: can_edit on environment (field metadata.id), error_msg yes | chain-with-Authorize |
| EnvironmentCommandController.updateVisibility | config: can_edit on environment (field resource_id), error_msg yes | chain-with-Authorize |
| EnvironmentCommandController.delete | config: can_edit on environment (field resource_id), error_msg yes | chain-with-Authorize |
| EnvironmentCommandController.updateVariables | config: can_edit on environment (field environment_id), error_msg yes | chain-with-Authorize |
| EnvironmentCommandController.removeVariables | config: can_edit on environment (field environment_id), error_msg yes | chain-with-Authorize |
| EnvironmentQueryController.get | config: can_view on environment (field value), error_msg yes | chain-with-Authorize |
| EnvironmentQueryController.getByReference | is_skip_authorization | chain-with-Authorize |
| EnvironmentQueryController.getSecretValue | config: can_read_secrets on environment (field environment_id), error_msg yes | chain-with-Authorize |
| EnvironmentQueryController.list | is_skip_authorization | chain-with-Authorize (a composed ListReadScope narrows to the caller's authorized rows (20260830.01)) |

## 4. OAuthApp (`src/domain/oauthapp/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| OAuthAppCommandController.apply | none | chain-with-Authorize |
| OAuthAppCommandController.create | config: can_create_oauth_app on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| OAuthAppCommandController.update | config: can_edit on oauth_app (field metadata.id), error_msg yes | chain-with-Authorize |
| OAuthAppCommandController.delete | config: can_delete on oauth_app (field resource_id), error_msg yes | chain-with-Authorize |
| OAuthAppQueryController.get | config: can_view on oauth_app (field value), error_msg yes | chain-with-Authorize |
| OAuthAppQueryController.getByReference | is_skip_authorization | chain-with-Authorize |
| OAuthAppQueryController.listByOrg | config: can_view on organization (field org), error_msg yes | chain-with-Authorize |

## 5. ExecutionContext (`src/domain/executioncontext/controller.ts`)

All six RPCs are chains, and the proto deliberately marks every one `is_skip_authorization` with a real handler-level check instead (the proto's own header documents this): the read RPCs redact secret values by default, and getByExecutionId's domain step verifies an execution-scoped runner token — a matching scope-bound token gets decrypted values, everyone else gets the same response shape redacted, as a SUCCESS ("redaction-as-success": no error discloses the lane).

| Method | Annotation | Handler |
|---|---|---|
| ExecutionContextCommandController.apply | none | chain-with-Authorize |
| ExecutionContextCommandController.create | is_skip_authorization | chain-with-Authorize |
| ExecutionContextCommandController.delete | is_skip_authorization | chain-with-Authorize |
| ExecutionContextQueryController.get | is_skip_authorization | chain-with-Authorize (response redacted) |
| ExecutionContextQueryController.getByReference | is_skip_authorization | chain-with-Authorize (response redacted) |
| ExecutionContextQueryController.getByExecutionId | is_skip_authorization | chain-with-Authorize (runner-token verified in domain; redaction-as-success) |

## 6. Agent (`src/domain/agent/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| AgentCommandController.apply | none | chain-with-Authorize |
| AgentCommandController.create | config: can_create_agent on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| AgentCommandController.update | config: can_edit on agent (field metadata.id), error_msg yes | chain-with-Authorize |
| AgentCommandController.updateVisibility | config: can_edit on agent (field resource_id), error_msg yes | chain-with-Authorize |
| AgentCommandController.delete | config: can_delete on agent (field value), error_msg yes | chain-with-Authorize |
| AgentQueryController.get | config: can_view on agent (field value), error_msg yes | chain-with-Authorize |
| AgentQueryController.getByReference | is_skip_authorization | chain-with-Authorize |
| AgentQueryController.getDefault | is_skip_authorization | chain-with-Authorize |

## 7. AgentInstance (`src/domain/agentinstance/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| AgentInstanceCommandController.apply | none | chain-with-Authorize |
| AgentInstanceCommandController.create | is_skip_authorization | chain-with-Authorize |
| AgentInstanceCommandController.update | config: can_edit on agent_instance (field metadata.id), error_msg yes | chain-with-Authorize |
| AgentInstanceCommandController.updateVisibility | config: can_edit on agent_instance (field resource_id), error_msg yes | chain-with-Authorize |
| AgentInstanceCommandController.delete | config: can_delete on agent_instance (field value), error_msg yes | chain-with-Authorize |
| AgentInstanceQueryController.get | config: can_view on agent_instance (field value), error_msg yes | chain-with-Authorize |
| AgentInstanceQueryController.getByAgent | is_skip_authorization | chain-with-Authorize (a composed ListReadScope narrows to the caller's authorized rows (20260830.01)) |
| AgentInstanceQueryController.getByReference | is_skip_authorization | chain-with-Authorize |
| AgentInstanceQueryController.list | is_skip_authorization | chain-with-Authorize (a composed ListReadScope narrows to the caller's authorized rows (20260830.01)) |

## 8. Session (`src/domain/session/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| SessionCommandController.apply | none | chain-with-Authorize |
| SessionCommandController.create | config: can_create_session on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| SessionCommandController.update | config: can_edit on session (field metadata.id), error_msg yes | chain-with-Authorize |
| SessionCommandController.updateSubject | config: can_edit on session (field id), error_msg yes | direct: field-level read-modify-write (ports Go update_subject.go); authorizeDirect AFTER the load — the Java load-before-authorize order (#224) |
| SessionCommandController.delete | config: can_delete on session (field value), error_msg yes | chain-with-Authorize |
| SessionQueryController.get | config: can_view on session (field value), error_msg yes | chain-with-Authorize |
| SessionQueryController.list | is_skip_authorization | chain-with-Authorize (a composed ListReadScope narrows to the caller's authorized rows (20260830.01); the guest cookie rule is driver-internal) |
| SessionQueryController.listByAgentInstance | is_skip_authorization | chain-with-Authorize (a composed ListReadScope narrows to the caller's authorized rows (20260830.01)) |
| SessionQueryController.listByChannel | is_skip_authorization | chain-with-Authorize (the AuthorizeChannelAccess mid-chain can_view on the agent_channel — the Java two-stage shape, 20260830.01 Q8; a composed ListReadScope narrows to the caller's authorized rows (20260830.01)) |

## 9. AgentShare (`src/domain/agentshare/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| AgentShareCommandController.apply | none | chain-with-Authorize |
| AgentShareCommandController.create | is_skip_authorization | chain-with-Authorize |
| AgentShareCommandController.update | config: can_edit on agent_share (field metadata.id), error_msg yes | chain-with-Authorize |
| AgentShareCommandController.rotateShareLink | config: can_edit on agent_share (field resource_id), error_msg yes | chain-with-Authorize |
| AgentShareCommandController.delete | config: can_delete on agent_share (field value), error_msg yes | chain-with-Authorize |
| AgentShareQueryController.get | config: can_view on agent_share (field value), error_msg yes | chain-with-Authorize |
| AgentShareQueryController.getByReference | is_skip_authorization | chain-with-Authorize |
| AgentShareQueryController.getByAgent | is_skip_authorization | chain-with-Authorize (a composed ListReadScope narrows to the caller's authorized rows (20260830.01)) |
| AgentShareQueryController.list | is_skip_authorization | chain-with-Authorize (a composed ListReadScope narrows to the caller's authorized rows (20260830.01)) |
| AgentShareQueryController.getSharedProfile | is_public | chain-with-Authorize (the public share-link read; the step's is_public arm skips the Authorizer) |
| AgentShareQueryController.getSharedProfileForMember | is_skip_authorization | chain-with-Authorize |

## 10. AgentChannel (`src/domain/agentchannel/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| AgentChannelCommandController.apply | none | chain-with-Authorize |
| AgentChannelCommandController.create | is_skip_authorization | chain-with-Authorize |
| AgentChannelCommandController.update | config: can_edit on agent_channel (field metadata.id), error_msg yes | chain-with-Authorize |
| AgentChannelCommandController.initiateInstall | config: can_edit on agent_channel (field resource_id), error_msg yes | direct: `authorizeDirect` AFTER the load (the Java LoadChannel-then-authorize order — missing ids answer NOT_FOUND for everyone), then refuse FAILED_PRECONDITION on the storing edition or delegate to `drivers.channelRuntime` (C2 close-out, 20260827.10 — the interim stub's owed can_edit arm) |
| AgentChannelCommandController.completeInstall | config: can_edit on agent_channel (field resource_id), error_msg yes | direct: same load → `authorizeDirect` → refuse-or-delegate |
| AgentChannelCommandController.delete | config: can_delete on agent_channel (field value), error_msg yes | chain-with-Authorize |
| AgentChannelQueryController.get | config: can_view on agent_channel (field value), error_msg yes | chain-with-Authorize |
| AgentChannelQueryController.getByReference | is_skip_authorization | chain-with-Authorize |
| AgentChannelQueryController.getByAgent | is_skip_authorization | chain-with-Authorize (a composed ListReadScope narrows to the caller's authorized rows (20260830.01)) |
| AgentChannelQueryController.list | is_skip_authorization | chain-with-Authorize (a composed ListReadScope narrows to the caller's authorized rows (20260830.01)) |

## 11. ChannelMessage (`src/domain/agentchannel/message.ts`)

The proactive-messaging surface is a cloud capability; OSS serves edition stubs, all direct.

| Method | Annotation | Handler |
|---|---|---|
| ChannelMessageCommandController.sendMessage | is_skip_authorization | direct: OSS stub — refuses FAILED_PRECONDITION (proactive messaging unavailable) |
| ChannelMessageQueryController.listTemplates | is_skip_authorization | direct: OSS stub — refuses FAILED_PRECONDITION |
| ChannelMessageQueryController.listMessagingChannels | is_skip_authorization | direct: returns an empty list |

## 12. ChannelConversation (`src/domain/agentchannel/conversation.ts`)

The conversation surface is a cloud capability; OSS serves edition stubs, all direct.

| Method | Annotation | Handler |
|---|---|---|
| ChannelConversationQueryController.listConversations | is_skip_authorization | direct: returns an empty list |
| ChannelConversationQueryController.getConversation | config: can_view on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — answers NOT_FOUND unconditionally (no load-then-miss probing) |
| ChannelConversationQueryController.getTimeline | config: can_view on agent_channel (field agent_channel_id), error_msg yes | direct: returns an empty timeline |
| ChannelConversationQueryController.getMediaDownloadUrl | config: can_view on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — byte-pinned uniform NOT_FOUND miss (a prober cannot learn which items exist) |
| ChannelConversationCommandController.reply | config: can_participate on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — refuses FAILED_PRECONDITION (participation unavailable) |
| ChannelConversationCommandController.takeOver | config: can_participate on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — refuses FAILED_PRECONDITION |
| ChannelConversationCommandController.handBack | config: can_participate on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — refuses FAILED_PRECONDITION |
| ChannelConversationCommandController.clearAttention | config: can_participate on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — refuses FAILED_PRECONDITION |
| ChannelConversationCommandController.escalate | is_skip_authorization | direct: OSS stub — refuses FAILED_PRECONDITION |

## 13. ChannelApp (`src/domain/channelapp/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| ChannelAppCommandController.apply | none | chain-with-Authorize |
| ChannelAppCommandController.create | config: can_create_channel_app on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| ChannelAppCommandController.update | config: can_edit on channel_app (field metadata.id), error_msg yes | chain-with-Authorize |
| ChannelAppCommandController.delete | config: can_delete on channel_app (field resource_id), error_msg yes | chain-with-Authorize |
| ChannelAppQueryController.get | config: can_view on channel_app (field value), error_msg yes | chain-with-Authorize |
| ChannelAppQueryController.getByReference | is_skip_authorization | chain-with-Authorize |
| ChannelAppQueryController.listByOrg | config: can_view on organization (field org), error_msg yes | chain-with-Authorize |

## 14. Schedule (`src/domain/schedule/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| ScheduleCommandController.apply | none | chain-with-Authorize |
| ScheduleCommandController.create | is_skip_authorization | chain-with-Authorize |
| ScheduleCommandController.update | config: can_edit on schedule (field metadata.id), error_msg yes | chain-with-Authorize |
| ScheduleCommandController.delete | config: can_delete on schedule (field value), error_msg yes | chain-with-Authorize |
| ScheduleCommandController.resume | config: can_edit on schedule (field value), error_msg yes | chain-with-Authorize |
| ScheduleCommandController.trigger | config: can_edit on schedule (field value), error_msg yes | chain-with-Authorize |
| ScheduleQueryController.get | config: can_view on schedule (field value), error_msg yes | chain-with-Authorize |
| ScheduleQueryController.getByReference | is_skip_authorization | chain-with-Authorize |
| ScheduleQueryController.getByAgent | is_skip_authorization | chain-with-Authorize (a composed ListReadScope narrows to the caller's authorized rows (20260830.01)) |
| ScheduleQueryController.list | is_skip_authorization | chain-with-Authorize (a composed ListReadScope narrows to the caller's authorized rows (20260830.01)) |
| ScheduleQueryController.listRuns | config: can_view on schedule (field schedule_id), error_msg yes | chain-with-Authorize |

## 15. Memory (`src/domain/memory/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| MemoryCommandController.create | is_skip_authorization | chain-with-Authorize |
| MemoryCommandController.update | config: can_edit on memory (field metadata.id), error_msg yes | chain-with-Authorize |
| MemoryCommandController.delete | config: can_delete on memory (field value), error_msg yes | chain-with-Authorize |
| MemoryCommandController.confirm | config: can_edit on memory (field value), error_msg yes | chain-with-Authorize (shared runTransition helper, own descriptor) |
| MemoryCommandController.reject | config: can_edit on memory (field value), error_msg yes | chain-with-Authorize (shared runTransition helper, own descriptor) |
| MemoryQueryController.get | config: can_view on memory (field value), error_msg yes | chain-with-Authorize |
| MemoryQueryController.list | is_skip_authorization | chain-with-Authorize (a composed ListReadScope narrows to the caller's authorized rows (20260830.01)) |

## 16. AgentExecution (`src/domain/agentexecution/controller.ts` + lifecycle.ts, update-status.ts, submit-approval.ts, submit-file-decision.ts, usage.ts, artifacts.ts, subscribe.ts)

| Method | Annotation | Handler |
|---|---|---|
| AgentExecutionCommandController.create | is_skip_authorization | chain-with-Authorize |
| AgentExecutionCommandController.update | config: can_edit on agent_execution (field metadata.id), error_msg yes | chain-with-Authorize |
| AgentExecutionCommandController.updateStatus | config: can_edit on agent_execution (field execution_id), error_msg yes | chain-with-Authorize (update-status.ts) |
| AgentExecutionCommandController.submitApproval | config: can_edit on agent_execution (field agent_execution_id), error_msg yes | chain-with-Authorize (submit-approval.ts) |
| AgentExecutionCommandController.submitFileDecision | config: can_edit on agent_execution (field agent_execution_id), error_msg yes | chain-with-Authorize (submit-file-decision.ts) |
| AgentExecutionCommandController.cancel | config: can_edit on agent_execution (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| AgentExecutionCommandController.terminate | config: can_edit on agent_execution (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| AgentExecutionCommandController.recover | config: can_edit on agent_execution (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| AgentExecutionCommandController.pause | config: can_edit on agent_execution (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| AgentExecutionCommandController.resume | config: can_edit on agent_execution (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| AgentExecutionCommandController.uploadAttachment | is_skip_authorization | direct: blob-store write; the returned storage_key acts as the capability token for the later create |
| AgentExecutionCommandController.delete | config: can_edit on agent_execution (field value), error_msg yes | chain-with-Authorize |
| AgentExecutionQueryController.get | config: can_view on agent_execution (field value), error_msg yes | chain-with-Authorize |
| AgentExecutionQueryController.list | is_skip_authorization | chain-with-Authorize (a composed ListReadScope narrows to the caller's authorized rows (20260830.01) ∩ the request org when non-blank; the guest cookie rule is driver-internal) |
| AgentExecutionQueryController.listBySession | is_skip_authorization | chain-with-Authorize (a composed ListReadScope narrows to the caller's authorized rows (20260830.01); the guest cookie rule is driver-internal) |
| AgentExecutionQueryController.subscribe | config: can_view on agent_execution (field value), error_msg yes | direct: stream subscribe over broker (register-before-snapshot; server-stream generator cannot run inside the pipeline executor); authorizeDirect once at subscription start |
| AgentExecutionQueryController.getArtifactDownloadUrl | config: can_view on agent_execution (field execution_id), error_msg yes | direct: authorizeDirect, then key-prefix / attachment-membership ownership check, then time-limited URL mint |
| AgentExecutionQueryController.getArtifactContent | config: can_view on agent_execution (field execution_id), error_msg yes | direct: authorizeDirect, then key-prefix ownership check, CAS-blob integrity check, truncated bytes in response |
| AgentExecutionQueryController.getExecutionUsageReport | config: can_view on agent_execution (field execution_id), error_msg yes | chain-with-Authorize (usage.ts) |
| AgentExecutionQueryController.getSessionUsageReport | config: can_view on session (field session_id), error_msg yes | chain-with-Authorize (usage.ts) |
| AgentExecutionQueryController.getAgentUsageReport | config: can_view on organization (field org_id), error_msg yes | chain-with-Authorize (usage.ts) |
| AgentExecutionQueryController.getOrgUsageReport | config: can_view on organization (field org_id), error_msg yes | chain-with-Authorize (usage.ts) |
| AgentExecutionQueryController.getExecutionSummary | is_skip_authorization | direct: full-scan store aggregate for the dashboard (a direct handler in Go as well); a composed ListReadScope narrows it to authorized ids ∩ requested org (C2 Stage 4's ExecutionReadScope, absorbed by 20260830.01) |

## 17. Workflow (`src/domain/workflow/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| WorkflowCommandController.apply | none | chain-with-Authorize |
| WorkflowCommandController.create | config: can_create_workflow on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| WorkflowCommandController.update | config: can_edit on workflow (field metadata.id), error_msg yes | chain-with-Authorize |
| WorkflowCommandController.updateVisibility | config: can_edit on workflow (field resource_id), error_msg yes | chain-with-Authorize |
| WorkflowCommandController.delete | config: can_delete on workflow (field value), error_msg yes | chain-with-Authorize |
| WorkflowCommandController.validateSpec | config: can_create_workflow on organization (field metadata.org), error_msg yes | direct: validation-only, nothing persisted (Layer-2 validator over the domain-owned registry store); annotation DELIBERATELY not evaluated — matches the Java handler's documented "no persist, no authorize" posture (C2 Stage-4 gate ruling; the annotation mismatch is recorded, not an omission) |
| WorkflowCommandController.tagVersion | config: can_edit on workflow (field workflow_id), error_msg yes | chain-with-Authorize |
| WorkflowQueryController.get | config: can_view on workflow (field value), error_msg yes | chain-with-Authorize |
| WorkflowQueryController.getByReference | is_skip_authorization | direct: branching slug/org read (Go's own direct-handler note) |
| WorkflowQueryController.listVersions | is_skip_authorization | chain-with-Authorize (the AuthorizeResolvedWorkflow mid-chain can_view on the resolved id — the Java handler's hand-rolled check, ported 20260830.01 Q8) |
| WorkflowQueryController.getVersion | config: can_view on workflow (field workflow_id), error_msg yes | direct: authorizeDirect, then live-then-audit version read. DELIBERATE divergence from the Java edition (C2 Stage-4 gate ruling): Java declares the annotation but never evaluates it (a cross-org version-read gap; its javadoc claims framework enforcement that does not exist) — the annotation is the contract and this server enforces it |

## 18. WorkflowInstance (`src/domain/workflowinstance/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| WorkflowInstanceCommandController.apply | none | chain-with-Authorize |
| WorkflowInstanceCommandController.create | is_skip_authorization | chain-with-Authorize |
| WorkflowInstanceCommandController.update | config: can_edit on workflow_instance (field metadata.id), error_msg yes | chain-with-Authorize |
| WorkflowInstanceCommandController.updateVisibility | config: can_edit on workflow_instance (field resource_id), error_msg yes | chain-with-Authorize |
| WorkflowInstanceCommandController.updateExecutionVisibility | config: can_grant_access on workflow_instance (field resource_id), error_msg yes | chain-with-Authorize |
| WorkflowInstanceCommandController.delete | config: can_delete on workflow_instance (field value), error_msg yes | chain-with-Authorize |
| WorkflowInstanceQueryController.get | config: can_view on workflow_instance (field value), error_msg yes | chain-with-Authorize |
| WorkflowInstanceQueryController.getByReference | is_skip_authorization | chain-with-Authorize |
| WorkflowInstanceQueryController.getByWorkflow | is_skip_authorization | chain-with-Authorize (a composed ListReadScope narrows to the caller's authorized rows (20260830.01)) |

## 19. WorkflowExecution (`src/domain/workflowexecution/controller.ts` + lifecycle.ts, update-status.ts, submit-approval.ts, submit-file-decision.ts, submit-workflow-task-approval.ts, send-signal.ts, queries.ts, subscribe.ts, subscribe-events.ts, get-event-log.ts, get-execution-summary.ts, list-pending-approvals.ts)

| Method | Annotation | Handler |
|---|---|---|
| WorkflowExecutionCommandController.create | is_skip_authorization | chain-with-Authorize |
| WorkflowExecutionCommandController.update | config: can_edit on workflow_execution (field metadata.id), error_msg yes | chain-with-Authorize |
| WorkflowExecutionCommandController.updateStatus | config: can_edit on workflow_execution (field execution_id), error_msg yes | chain-with-Authorize (update-status.ts) |
| WorkflowExecutionCommandController.submitApproval | config: can_edit on workflow_execution (field execution_id), error_msg yes | chain-with-Authorize (submit-approval.ts) |
| WorkflowExecutionCommandController.submitFileDecision | config: can_edit on workflow_execution (field execution_id), error_msg yes | chain-with-Authorize (submit-file-decision.ts) |
| WorkflowExecutionCommandController.submitWorkflowTaskApproval | config: can_edit on workflow_execution (field execution_id), error_msg yes | chain-with-Authorize (submit-workflow-task-approval.ts) |
| WorkflowExecutionCommandController.delete | config: can_edit on workflow_execution (field value), error_msg yes | chain-with-Authorize |
| WorkflowExecutionCommandController.sendSignal | config: can_edit on workflow_execution (field execution_id), error_msg yes | chain-with-Authorize (send-signal.ts) |
| WorkflowExecutionCommandController.cancel | config: can_edit on workflow_execution (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| WorkflowExecutionCommandController.terminate | config: can_edit on workflow_execution (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| WorkflowExecutionCommandController.recover | config: can_edit on workflow_execution (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| WorkflowExecutionCommandController.pause | config: can_edit on workflow_execution (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| WorkflowExecutionCommandController.resume | config: can_edit on workflow_execution (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| WorkflowExecutionQueryController.get | config: can_view on workflow_execution (field value), error_msg yes | chain-with-Authorize |
| WorkflowExecutionQueryController.list | is_skip_authorization | direct: full-scan store read (malformed rows skipped; a composed ListReadScope narrows to the caller's authorized rows (20260830.01) ∩ the request org when non-blank) |
| WorkflowExecutionQueryController.listByWorkflow | is_skip_authorization | direct: full-scan store read filtered by workflow (a composed ListReadScope narrows to the caller's authorized rows (20260830.01)) |
| WorkflowExecutionQueryController.subscribe | config: can_view on workflow_execution (field execution_id), error_msg yes | direct: stream subscribe over broker; authorizeDirect once at subscription start |
| WorkflowExecutionQueryController.getEventLog | config: can_view on workflow_execution (field execution_id), error_msg yes | direct: authorizeDirect, then cursor-paginated read over the event side table (no existence check by contract) |
| WorkflowExecutionQueryController.subscribeEvents | config: can_view on workflow_execution (field execution_id), error_msg yes | direct: authorizeDirect at subscription start, then event-log replay + poll stream (existence-checked NotFound before streaming) |
| WorkflowExecutionQueryController.getExecutionSummary | is_skip_authorization | direct: full-scan store aggregate for the dashboard; a composed ListReadScope narrows it to authorized ids ∩ requested org, empty set = the default instance (C2 Stage 4's ExecutionReadScope, absorbed by 20260830.01) |
| WorkflowExecutionQueryController.listPendingApprovals | is_skip_authorization | direct: scan of IN_PROGRESS executions for waiting-approval tasks (a composed ListReadScope narrows to the caller's authorized rows (20260830.01) ∩ the request org, applied before the approvals projection) |

## 20. McpServer (`src/domain/mcpserver/controller.ts` + connect.ts, start-connect.ts, initiate-oauth-connect.ts, complete-oauth-connect.ts, disconnect-oauth.ts, get-oauth-grant-status.ts)

| Method | Annotation | Handler |
|---|---|---|
| McpServerCommandController.apply | none | chain-with-Authorize |
| McpServerCommandController.create | is_skip_authorization | chain-with-Authorize |
| McpServerCommandController.update | config: can_edit on mcp_server (field metadata.id), error_msg yes | chain-with-Authorize |
| McpServerCommandController.updateVisibility | config: can_edit on mcp_server (field resource_id), error_msg yes | chain-with-Authorize |
| McpServerCommandController.delete | config: can_delete on mcp_server (field resource_id), error_msg yes | chain-with-Authorize |
| McpServerCommandController.connect | config: can_connect on mcp_server (field mcp_server_id), error_msg yes | direct: blocking connect flow over the engine seam (ephemeral ExecutionContext, decrypt-lane token mint, runner workflow start); authorizeDirect AFTER the load (#224) |
| McpServerCommandController.startConnect | config: can_connect on mcp_server (field mcp_server_id), error_msg yes | direct: async connect lane over the engine seam; authorizeDirect AFTER the load (#224) |
| McpServerCommandController.initiateOAuthConnect | config: can_connect on mcp_server (field mcp_server_id), error_msg yes | direct: OAuth authorize-URL mint (refuses FAILED_PRECONDITION without a configured redirect URI); authorizeDirect AFTER the load (#224) |
| McpServerCommandController.completeOAuthConnect | config: can_connect on mcp_server (field mcp_server_id), error_msg yes | direct: OAuth code exchange + grant persistence; authorizeDirect against the PENDING RECORD's server id (target override — the Java confused-deputy discipline; the single-use state is burned before a denial lands) |
| McpServerCommandController.disconnectOAuth | config: can_connect on mcp_server (field resource_id), error_msg yes | direct: grant teardown; authorizeDirect after input validation (no load step — the Java order) |
| McpServerCommandController.setOrgOAuthApp | config: can_create_oauth_app on organization (field org), error_msg yes | direct: OSS stub — throws Unimplemented (org OAuth-app overrides are cloud-only) |
| McpServerCommandController.deleteOrgOAuthApp | config: can_create_oauth_app on organization (field org), error_msg yes | direct: OSS stub — throws Unimplemented |
| McpServerQueryController.get | config: can_view on mcp_server (field value), error_msg yes | chain-with-Authorize |
| McpServerQueryController.getByReference | is_skip_authorization | chain-with-Authorize |
| McpServerQueryController.getOAuthGrantStatus | config: can_view on mcp_server (field resource_id), error_msg yes | direct: authorizeDirect after input validation, then grant-store read |
| McpServerQueryController.getOrgOAuthApp | config: can_view on mcp_server (field resource_id), error_msg yes | direct: OSS stub — throws Unimplemented |

## 21. Skill (`src/domain/skill/controller.ts` + push.ts)

| Method | Annotation | Handler |
|---|---|---|
| SkillCommandController.push | config: can_create_skill on organization (field org), error_msg yes | chain-with-Authorize |
| SkillCommandController.createArtifactUploadUrl | config: can_create_skill on organization (field org), error_msg yes | chain-with-Authorize |
| SkillCommandController.pushFromExecutionArtifact | config: can_create_skill on organization (field org), error_msg yes | chain-with-Authorize BY DELEGATION: the handler validates the storage-key ownership prefix directly, downloads the execution artifact, then calls the shared push pipeline WITH ITS OWN method descriptor (the runLifecyclePipeline pattern — the pipeline's authorizing descriptor is a caller-supplied parameter), so this method's own annotation is the one evaluated. |
| SkillCommandController.updateVisibility | config: can_edit on skill (field resource_id), error_msg yes | chain-with-Authorize |
| SkillCommandController.delete | config: can_delete on skill (field value), error_msg yes | chain-with-Authorize |
| SkillQueryController.get | config: can_view on skill (field value), error_msg yes | chain-with-Authorize |
| SkillQueryController.getByReference | is_skip_authorization | chain-with-Authorize |
| SkillQueryController.getArtifact | is_skip_authorization | chain-with-Authorize |
| SkillQueryController.getArtifactDownloadUrl | is_skip_authorization | chain-with-Authorize |
| SkillQueryController.listVersions | is_skip_authorization | chain-with-Authorize (the AuthorizeResolvedSkill mid-chain can_view on the resolved id — the Java handler's hand-rolled check, ported 20260830.01 Q8) |

## 22. Artifact (`src/domain/artifact/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| ArtifactCommandController.create | is_skip_authorization | direct: content-addressed blob write + metadata row persist |
| ArtifactCommandController.delete | config: can_edit on artifact (field value), error_msg yes | direct: soft delete — storage_state transition, never a row removal; authorizeDirect AFTER the load (#224) |
| ArtifactQueryController.get | config: can_view on artifact (field value), error_msg yes | chain-with-Authorize |
| ArtifactQueryController.listByExecution | is_skip_authorization | chain-with-Authorize (the AuthorizeParentExecution mid-chain can_view on the named execution — the Java handler's two-field dispatch, ported 20260830.01 Q8) |
| ArtifactQueryController.getDownloadUrl | config: can_view on artifact (field value), error_msg yes | direct: time-limited URL mint against the blob store; authorizeDirect AFTER the load (#224) |
| ArtifactQueryController.getContent | config: can_view on artifact (field artifact_id), error_msg yes | direct: truncated bytes in the response (512KB default cap); authorizeDirect AFTER the load (#224) |

## 23. Project (`src/domain/project/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| ProjectCommandController.apply | none | chain-with-Authorize |
| ProjectCommandController.create | config: can_create_project on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| ProjectCommandController.update | config: can_edit on project (field metadata.id), error_msg yes | chain-with-Authorize |
| ProjectCommandController.delete | config: can_delete on project (field value), error_msg yes | chain-with-Authorize |
| ProjectQueryController.get | config: can_view on project (field value), error_msg yes | chain-with-Authorize |
| ProjectQueryController.getByReference | is_skip_authorization | chain-with-Authorize |

## 24. Search (`src/query/search/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| SearchService.search | is_skip_authorization | direct: CQRS read over the search query store (cross-aggregate; carries no api_resource_kind option; a composed ListReadScope feeds a per-effective-kind authorized-id allowlist into the engine query, crossOrgPublic bypassing FGA verbatim — 20260830.01) |

## 25. Activity (`src/query/activity/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| ActivityQueryController.listRecentActivity | is_skip_authorization | direct: CQRS recents read over listResources (the request's org merely narrows the result; a composed ListReadScope narrows both kinds to the caller's authorized ids — 20260830.01) |

## 26. GitHub (`src/domain/github/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| GitHubService.getOAuthAuthorizeUrl | is_skip_authorization | direct: stateless OAuth broker — authorize-URL mint from config, nothing persisted |
| GitHubService.exchangeOAuthCode | is_skip_authorization | direct: stateless OAuth broker — code-for-token exchange, token returned to the caller, never stored |

## 27. Platform (`src/domain/platform/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| PlatformQueryController.getServerInfo | is_public | direct: static edition + version read |
| PlatformQueryController.getRunnerBootstrapConfig | is_skip_authorization | direct: publishes the Temporal coordinates for embedded runners (token fields deliberately empty on OSS) |
| PlatformQueryController.getRunnerScopedToken | is_skip_authorization | direct: mints the execution-scoped runner token for the ExecutionContext decrypt lane; fail-soft (empty id, keyless service, or mint error answer the not-minted shape). On OSS there is no caller credential to verify — the token is the lane discriminator, not a trust boundary (DD-004). |

## Config-annotated methods served by direct handlers

These 30 methods declare a `(ai.stigmer.commons.rpc.config)` annotation and run no pipeline. All 30 were dispositioned at the C2 Stage-4 gate (20260827.10); the enforcement state per bucket:

**Evaluated via `authorizeDirect` (19)** — the exported Authorize evaluation, called by the handler itself at the Java baseline's position (each table row notes load-first `#224` order where it applies):

- Session: updateSubject
- AgentChannel: initiateInstall, completeInstall (moved here at the C2 close-out — the Stage-4 "rides the C3 installer stage" deferral shipped without the arm on either side; the OSS lane now enforces after its load, so every composed runtime receives a pre-authorized caller)
- AgentExecution: subscribe, getArtifactDownloadUrl, getArtifactContent
- Workflow: getVersion (a ruled DELIBERATE divergence — the Java edition never evaluates this annotation; see the table row)
- WorkflowExecution: subscribe, getEventLog, subscribeEvents
- McpServer: connect, startConnect, initiateOAuthConnect, completeOAuthConnect, disconnectOAuth, getOAuthGrantStatus
- Artifact: delete, getDownloadUrl, getContent

**Enforced by the composed channel runtime (7)** — this server's handlers delegate whole-method to `drivers.channelRuntime` (DD-004); the OSS default serves the byte-pinned refusal/stub postures with nothing to protect, and the cloud runtime's served arms gate on the composed Authorizer as their first act (its own suite pins the deny paths):

- ChannelConversation: getConversation, getTimeline, getMediaDownloadUrl, reply, takeOver, handBack, clearAttention

**Deliberately not evaluated (1)** — Workflow.validateSpec: matches the Java handler's documented "no persist, no authorize" posture (nothing loaded or persisted); the annotation mismatch is a recorded ruling, not an omission.

**Recorded-gap stubs (3)** — the org-OAuth-app (BYOA) surface answers UNIMPLEMENTED on this server (stigmer/stigmer#558) and is cloud-real in Java with dual authorization; the feature port is an unowned convergence gap recorded in the program's parent project, and enforcing an annotation on an Unimplemented stub protects nothing:

- McpServer: setOrgOAuthApp, deleteOrgOAuthApp, getOrgOAuthApp

## Descriptor mismatches found

- `SkillCommandController.pushFromExecutionArtifact` delegates into the shared push pipeline. This WAS a descriptor mismatch (the delegated pipeline hardcoded `method.push`); the inventory pass caught it and the pipeline now takes the authorizing descriptor from its caller, so each of the two RPCs authorizes under its own annotation. Recorded here because the trap shape — shared pipeline, hardcoded descriptor — is the one thing a future delegating handler must not reintroduce.

No other mismatch exists: every other `newAuthorizeStep` call site passes the descriptor of the RPC it serves, including all ten lifecycle RPCs (shared builder, per-method descriptor) and memory confirm/reject (shared transition helper, per-method descriptor).

## Unregistered proto methods and services

- `OrganizationQueryController.getByExternalOrgId` (is_skip_authorization) exists in the proto but is not in the server's registration map — the only partially-registered service.
- `TaskKindRegistryQueryController.getTaskKindRegistry` is a proto service the server never registers as an RPC; the task-kind registry is served over the HTTP registry lane instead (below).
- Entire proto service families exist under `apis/ai/stigmer/` that this server does not register at all — they are cloud-edition surfaces: Billing (command + query), CursorAccount (command + query), ProviderStanding (query), and the remaining IAM family: IamPolicy, IdentityAccount, IdentityProvider, Invitation, PlatformClient (command + query each, plus PlatformClientTokenController with the two `is_public` mint RPCs). ApiKey left this list with O3 (20260827.06 — section 2a; DD-003: the apikey contract is wholly OSS). The remaining families' annotations (including the `resource_id = "stigmer"` platform-operator checks and the config-without-resource_kind IamPolicy arms) are already declared in the protos for C1/C2 to consume.
  - **Composition-side annotation (2026-08-30, C5 stage 1 — 20260830.02.sp.billing-facade)**: the cloud composition registers BOTH Billing services as a descriptor-driven pass-through to the Java billing service (`src/billing/passthrough.ts` in stigmer-cloud), forwarding the caller's bearer token verbatim. Their authorization is DELEGATED: the composition's verifier chain still authenticates the caller first, then Java's own per-RPC FGA checks decide on the forwarded token — the annotations these proto files declare are enforced by the Java edition, not re-evaluated by the composition. This row disposition holds until C5 stage 2 replaces the pass-through with a native extension, which will evaluate the annotations through the composed Authorizer like every other registered service.

## Non-RPC HTTP lanes

### taskKindRegistryLane (`src/transport/registry/lanes.ts`)

`GET /v1/proxy/task-kind-registry` on the unified port. Unauthenticated by design: serves the bundled, static-per-release task-kind registry JSON with the fixed registry CORS contract (allow-origin `*`, `Cache-Control: public, max-age=3600`; OPTIONS 204, other methods 405).

### modelRegistryLane (`src/transport/registry/lanes.ts`)

`GET /v1/proxy/model-registry` on the unified port. Same unauthenticated CORS/caching posture; serves from the domain-owned model-registry store (bundled document plus optional upstream refresh).

### skillTransferLane (`src/domain/skill/transfer/handler.ts`)

`PUT /v1/skill-artifacts/uploads/{ref}` and `GET /v1/skill-artifacts/{storage_key}` on the unified port. Deliberately URL-as-credential — the handler header documents this: neither route carries bearer auth, mirroring cloud's pre-signed R2 URLs. Minting an upload URL requires the same gRPC authorization as push (createArtifactUploadUrl's chain); download keys are unguessable content hashes handed out by authorized skill reads.

### consoleLane (`src/transport/console/handler.ts`)

Static web-console assets on the unified port, present only when a console export is bundled or configured. GET/HEAD only; never claims `/v1/*` or service-shaped RPC paths. Unauthenticated static-asset serving plus a synthesized `/config.json`.

### Artifact HTTP file server (`src/domain/artifact/file-server.ts`)

A SECOND listener, not a unified-port lane: `GET /<storage_key>` on `127.0.0.1:ARTIFACT_HTTP_PORT` (default grpcPort+1), started only when artifact storage is local. Serves the exact bytes local artifact storage wrote; the loopback bind is the posture (download URLs are minted for the local machine; 0.0.0.0 only inside the official container).

## Notes for C1/C2

- (a) The interceptor-level protovalidate interceptor runs at position 3 of the chain (`src/pipeline/chain.ts`, ratified D2 §2 order: identity source → logging → protovalidate → apiresource), before any handler or pipeline — a malformed request answers INVALID_ARGUMENT before the Authorize step ever runs. Pre-existing, ratified ordering.
- (b) The in-process router transport (`src/boot/inprocess.ts`) runs the same chain except position 1, which stamps the `internal` caller class only that chain can mint (ruling Q4). The Authorize step returns immediately for `callerClass === "internal"`, so cross-domain in-process calls skip the authorization decision while still traversing validation, logging, and kind-tagging.
- (c) The Temporal worker's status-merge activity (`src/temporal/agentexecution/activities.ts`) calls the domain `updateStatus` — the full pipeline, Authorize step included — with `trustedLocalIdentity()`; no wire request exists at that point, so the trusted-local identity is the caller.
- (d) Methods with NO config annotation skip the authorizer by design (`authorize.ts`: no `config` option → the step returns before consulting the Authorizer), and every such method is visible in the tables above — the annotation column says `none`, `is_public`, or `is_skip_authorization`.
