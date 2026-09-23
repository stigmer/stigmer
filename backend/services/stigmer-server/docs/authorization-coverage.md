# Authorization Coverage Inventory

This document is the ratified coverage inventory for the stigmer-server authorization surface (sub-project 20260827.01, identity-context-and-authorizer, ruling Q2). It classifies EVERY entry point the server exposes — every RPC method of every registered service, plus the non-RPC HTTP lanes — by its authorization posture: whether the shared `Authorize` pipeline step (`src/pipeline/steps/authorize.ts`) runs for it, what proto method annotation it carries, and what a direct handler does instead. It is a permanent acceptance artifact: the follow-up cloud sub-projects (C1/C2) inherit this map instead of discovering gaps against FGA. It MUST be updated whenever a method is added or removed, a handler changes between pipeline and direct form, or a `(ai.stigmer.commons.rpc.config)` / `is_public` / `is_skip_authorization` annotation changes.

How to read the tables:

- **Annotation** is what the method's proto declares: a `config` summary (`permission` on `resource_kind`, the `field_path` or literal `resource_id` the target is resolved from, and whether `error_msg` is set), `is_public` (50057), `is_skip_authorization` (50058), or `none` (no option at all — the apply RPCs and the gRPC health service).
- **Handler** is what the server actually runs: `chain-with-Authorize` means the handler builds a `newPipeline(...)` whose FIRST `.addStep` is `newAuthorizeStep(<its own method descriptor>, authorizer)`; `direct: <posture>` means no pipeline is built. A direct handler marked `authorizeDirect` evaluates its annotation through the SAME exported evaluation the step runs (`authorizeDirect` in `src/pipeline/steps/authorize.ts` — identical skip arms, target resolution, and decision mapping; C2 Stage 4, 20260827.10), placed per the Java baseline's handler order (noted per row where it differs from authorize-first).
- The two columns are independent facts. A method can carry a `config` annotation and be a direct handler — since C2 Stage 4 nearly all such methods evaluate the annotation via `authorizeDirect`; the dispositions of the full set are recorded in the "Config-annotated methods served by direct handlers" section before the notes.
- **Every `is_skip_authorization` row names what guards it**, in its Handler cell, with one of three markers — the inventory's own rule, enforced by `src/authorization/__tests__/skip-lane-inventory.test.ts`, which also holds this table's skip rows equal to the served descriptors' skip set: `guard: <Name>` names the mid-chain pipeline step, or the handler's guard function, that authorizes the lane (it must exist by that name in `src/`; the shared one is `AuthorizeResolvedTarget`, `src/pipeline/steps/authorize-resolved-target.ts`, for every lane whose target is a loaded row or a stashed parent rather than a request field); `driver: <Seam>` names the composed seam that decides (the `ListReadScope` on every list lane, the `OrganizationDirectory`, the `RunnerCredentialProvider`); `by design: <reason>` says the lane is open to every authenticated caller and why. A skip row carrying none of the three is a defect: that lane is open in every edition and nobody has said so.
- Authorize step semantics (verified in `src/pipeline/steps/authorize.ts`): the step returns immediately for the `internal` caller class, then for `is_public`, then for `is_skip_authorization`, then for methods with no `config` option; only a present `config` reaches the composed Authorizer. So even on chain methods, a skip/public annotation means the Authorizer is never consulted — the step's presence still gives C1/C2 the uniform interception point.

Verification notes: every registration map in `src/boot/compose.ts`'s routes closure was cross-checked against its controller file and its proto service definition; every `newAuthorizeStep` call site was checked for descriptor/RPC agreement (all ten lifecycle RPCs pass their own descriptor through the shared `runLifecyclePipeline` builder; memory `confirm`/`reject` pass their own descriptors through the shared `runTransition` helper); a mechanical scan confirmed `newAuthorizeStep` is the first `.addStep` of every `newPipeline` in the server (zero exceptions).

## Totals

- Registered services: 36 (35 Stigmer services + the standard gRPC health service; PlatformClient command, query and token with the open-source PlatformClient domain, section 29; ApiKey command + query added by O3, 20260827.06; Plugin command + query with the Plugin kind; Project command + query removed with the Project kind; IdentityAccount and IamPolicy command + query with the open-source identity domain, sections 27 and 28).
- Registered RPC methods: 271 (Agent getDefault removed with the default-agent lookup: a session with no agent runs the built-in assistant; `OrganizationQueryController.getByExternalOrgId` is served only when a composed directory carries the lookup, so it is not counted here — the unregistered-methods list).
- Handler classes: 199 `chain-with-Authorize`, 72 `direct` (28 of which evaluate their annotation via `authorizeDirect` — C2 Stage 4 and the identity domain; Workflow getByReference became a chain to carry the resolved-target check).
- Annotation classes: 171 `config`, 79 `is_skip_authorization`, 4 `is_public`, 17 `none` (14 apply RPCs + 3 health methods). Three skip lanes became `config` when their targets turned out to be request fields after all: McpServer create (`can_create_mcp_server` on `metadata.org`), ExecutionContext get and delete (`can_view` / `can_edit` on the row's id).
- What the classes mean under each open-source posture: on a trusted-local server (no authentication) the composed Authorizer is the permissive single-team default and no list scope is composed, so every class admits every caller. Under an authentication posture with no unit Authorizer (`STIGMER_OIDC_ISSUER` set; `src/authorization/posture.ts`) the server composes its BUILT-IN Authorizer and ListReadScope — the cloud's OpenFGA model evaluated over tuples derived from the row — so every `config` lane enforces the model and every list lane marked "a composed ListReadScope narrows" below narrows to the caller's rows. `is_skip_authorization` lanes reach neither Authorizer in either posture: what guards each is the mid-chain step or driver its Handler column names with the `guard:` / `driver:` / `by design:` markers above, and a skip lane whose column names nothing is open to every authenticated caller in every edition — which is why the inventory test refuses one.
- Config-annotated methods served by direct handlers: 41 — 30 dispositioned at the C2 Stage-4 gate (the table before the notes section: `authorizeDirect`, the composed channel runtime, one deliberate skip, three recorded-gap stubs) and the 11 lookup-then-authorize and federation lanes of the identity domain (sections 27 and 28), every one of them `authorizeDirect`.

## 1. Health (`grpc.health.v1.Health`, `src/transport/health.ts`)

The standard gRPC health protocol — an external proto with no Stigmer annotations. Because it cannot carry `is_public`, the require-authentication posture exempts it BY SERVICE NAME (`AUTHENTICATION_EXEMPT_SERVICES` in `src/pipeline/interceptors/auth.ts`, the Java interceptor's by-name skip; entry 20260904.02, stigmer#974): a Kubernetes `grpc:` probe is a tokenless `check`, and a refused probe is a pod that never becomes Ready. The three methods stay authorization-`none` — the exemption is an authentication fact, not an authorization one.

| Method | Annotation | Handler |
|---|---|---|
| check | none (external proto) | direct: pure in-memory health-state read |
| list | none (external proto) | direct: pure in-memory health-state read |
| watch | none (external proto) | direct: server-stream over in-memory health-state notifications |

## 2. Organization (`src/domain/organization/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| OrganizationCommandController.apply | none | chain-with-Authorize |
| OrganizationCommandController.create | is_skip_authorization | chain-with-Authorize (by design: any authenticated person may found an organization and becomes its owner; there is no organization yet to hold a permission on) |
| OrganizationCommandController.update | config: can_edit on organization (field metadata.id), error_msg yes | chain-with-Authorize |
| OrganizationCommandController.delete | config: can_delete on organization (field value), error_msg yes | chain-with-Authorize |
| OrganizationQueryController.get | config: can_view on organization (field value), error_msg yes | chain-with-Authorize |
| OrganizationQueryController.find | is_skip_authorization | chain-with-Authorize (driver: OrganizationDirectory — the composed directory's `refusesEnumeration` answers UNIMPLEMENTED before any work under the built-in posture and on the cloud; trusted-local enumerates) |
| OrganizationQueryController.findMyOrganizations | is_skip_authorization | direct (driver: OrganizationDirectory — trusted-local answers ALL organizations (single-team); the built-in directory answers the organizations the caller holds a role on; the cloud filters by IAM policy the same way) |

Proto method NOT registered by this server: `OrganizationQueryController.getByExternalOrgId` (is_skip_authorization) — see the unregistered-methods list.

## 2a. ApiKey (`src/domain/apikey/controller.ts` — registered by O3, 20260827.06)

The first domain registered after this inventory's O2 baseline (registration order: immediately after Organization). The identity chassis's apikey VERIFIER reads the store through `domain/apikey/lookup.ts`, never through these RPCs — verification is not an entry point here.

| Method | Annotation | Handler |
|---|---|---|
| ApiKeyCommandController.create | is_skip_authorization | chain-with-Authorize (by design: a person mints keys for their own identity; the row's owner is the caller and no other principal is named) |
| ApiKeyCommandController.update | config: can_edit on api_key (field metadata.id), error_msg yes | chain-with-Authorize |
| ApiKeyCommandController.delete | config: can_delete on api_key (field value), error_msg yes | chain-with-Authorize |
| ApiKeyQueryController.get | config: can_view on api_key (field value), error_msg yes | chain-with-Authorize |
| ApiKeyQueryController.getByKeyHash | is_skip_authorization | chain-with-Authorize (by design: a hash lookup the verifier does not use — O3 ruling Q5; the cloud edition gates it inside its handler with a platform-admin check, open source serves it under the permissive posture) |
| ApiKeyQueryController.findAll | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows; the scope-less single-team posture returns all keys — O3 ruling Q5) |

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
| EnvironmentQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy; response redacted) |
| EnvironmentQueryController.getSecretValue | config: can_read_secrets on environment (field environment_id), error_msg yes | chain-with-Authorize |
| EnvironmentQueryController.list | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |

## 4. OAuthApp (`src/domain/oauthapp/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| OAuthAppCommandController.apply | none | chain-with-Authorize |
| OAuthAppCommandController.create | config: can_create_oauth_app on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| OAuthAppCommandController.update | config: can_edit on oauth_app (field metadata.id), error_msg yes | chain-with-Authorize |
| OAuthAppCommandController.delete | config: can_delete on oauth_app (field resource_id), error_msg yes | chain-with-Authorize |
| OAuthAppQueryController.get | config: can_view on oauth_app (field value), error_msg yes | chain-with-Authorize |
| OAuthAppQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy; response redacted) |
| OAuthAppQueryController.listByOrg | config: can_view on organization (field org), error_msg yes | chain-with-Authorize |

## 5. ExecutionContext (`src/domain/executioncontext/controller.ts`)

All six RPCs are chains, and the proto deliberately marks every one `is_skip_authorization` with a real handler-level check instead (the proto's own header documents this): the read RPCs redact secret values by default, and getByExecutionId's domain step verifies an execution-scoped runner token — a matching scope-bound token gets decrypted values, everyone else gets the same response shape redacted, as a SUCCESS ("redaction-as-success": no error discloses the lane).

| Method | Annotation | Handler |
|---|---|---|
| ExecutionContextCommandController.apply | none | chain-with-Authorize |
| ExecutionContextCommandController.create | is_skip_authorization | chain-with-Authorize (guard: AuthorizeCreate — can_create_execution_in on the organization for a wire caller, before the duplicate check (the Java AuthorizeCreate order, stigmer-cloud#297); a server-composed request is trusted, the entry-point request having passed its own gate. The MCP connect lane creates its ephemeral EC through this chain AS THE CONNECTING PERSON (`boot/inprocess.ts`, the in-process `asCaller` lane), so the row's creator stamp is the connect token's person under the built-in posture) |
| ExecutionContextCommandController.delete | config: can_edit on execution_context (field resource_id), error_msg yes | chain-with-Authorize |
| ExecutionContextQueryController.get | config: can_view on execution_context (field value), error_msg yes | chain-with-Authorize (response redacted) |
| ExecutionContextQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy; response redacted) |
| ExecutionContextQueryController.getByExecutionId | is_skip_authorization | chain-with-Authorize (driver: RunnerCredentialProvider — the runner token is verified in the domain, redaction-as-success; under the built-in posture the runner-subject verifier admits the bearer of a RUN credential as the run's person and the bearer of a CONNECT token as the person the connect's EC was created by — `src/runnerauth/bound-execution.ts`, the three bindings; a clockless token bound to a connect falls closed to redaction through the same `bindsARun` predicate the verifier refuses it with) |

## 6. Agent (`src/domain/agent/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| AgentCommandController.apply | none | chain-with-Authorize |
| AgentCommandController.create | config: can_create_agent on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| AgentCommandController.update | config: can_edit on agent (field metadata.id), error_msg yes | chain-with-Authorize |
| AgentCommandController.updateVisibility | config: can_edit on agent (field resource_id), error_msg yes | chain-with-Authorize |
| AgentCommandController.delete | config: can_delete on agent (field value), error_msg yes | chain-with-Authorize |
| AgentQueryController.get | config: can_view on agent (field value), error_msg yes | chain-with-Authorize |
| AgentQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy) |

## 7. AgentInstance (`src/domain/agentinstance/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| AgentInstanceCommandController.apply | none | chain-with-Authorize |
| AgentInstanceCommandController.create | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — can_create_agent_instance on metadata.org, then can_create_instance on the parent agent LoadParentAgent stashed; a default instance the server composed in-process for the parent's organization asks nothing) |
| AgentInstanceCommandController.update | config: can_edit on agent_instance (field metadata.id), error_msg yes | chain-with-Authorize |
| AgentInstanceCommandController.updateVisibility | config: can_edit on agent_instance (field resource_id), error_msg yes | chain-with-Authorize |
| AgentInstanceCommandController.delete | config: can_delete on agent_instance (field value), error_msg yes | chain-with-Authorize |
| AgentInstanceQueryController.get | config: can_view on agent_instance (field value), error_msg yes | chain-with-Authorize |
| AgentInstanceQueryController.getByAgent | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |
| AgentInstanceQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy) |
| AgentInstanceQueryController.list | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |

## 8. Session (`src/domain/session/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| SessionCommandController.apply | none | chain-with-Authorize |
| SessionCommandController.create | config: can_create_session on organization (field metadata.org), error_msg yes | chain-with-Authorize (plus the AuthorizeRunTarget mid-chain can_execute on the agent_instance the session binds to — the caller's or the resolved default — right after ResolveDefaultAgentInstance; P1 sp.run-gate, stigmer-cloud#709. `apply` routes here on the create arm.) |
| SessionCommandController.update | config: can_edit on session (field metadata.id), error_msg yes | chain-with-Authorize |
| SessionCommandController.updateSubject | config: can_edit on session (field id), error_msg yes | direct: field-level read-modify-write (ports Go update_subject.go); authorizeDirect AFTER the load — the Java load-before-authorize order (#224) |
| SessionCommandController.delete | config: can_delete on session (field value), error_msg yes | chain-with-Authorize |
| SessionQueryController.get | config: can_view on session (field value), error_msg yes | chain-with-Authorize |
| SessionQueryController.list | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows; the guest cookie rule is driver-internal) |
| SessionQueryController.listByAgentInstance | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |
| SessionQueryController.listByChannel | is_skip_authorization | chain-with-Authorize (guard: AuthorizeChannelAccess — can_view on the agent_channel before any session work, the Java two-stage shape; driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |

## 9. AgentShare (`src/domain/agentshare/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| AgentShareCommandController.apply | none | chain-with-Authorize |
| AgentShareCommandController.create | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — can_edit on the referenced agent, then can_create_agent_share on the share's organization; the resolve step refuses an agent outside that organization before either is asked) |
| AgentShareCommandController.update | config: can_edit on agent_share (field metadata.id), error_msg yes | chain-with-Authorize |
| AgentShareCommandController.rotateShareLink | config: can_edit on agent_share (field resource_id), error_msg yes | chain-with-Authorize |
| AgentShareCommandController.delete | config: can_delete on agent_share (field value), error_msg yes | chain-with-Authorize |
| AgentShareQueryController.get | config: can_view on agent_share (field value), error_msg yes | chain-with-Authorize |
| AgentShareQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy) |
| AgentShareQueryController.getByAgent | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |
| AgentShareQueryController.list | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |
| AgentShareQueryController.getSharedProfile | is_public | chain-with-Authorize (the public share-link read; the step's is_public arm skips the Authorizer) |
| AgentShareQueryController.getSharedProfileForMember | is_skip_authorization | chain-with-Authorize (guard: AuthorizeMemberAudience — can_view on the reference's organization BEFORE the share is loaded, the Java order; a non-member hears the same NOT_FOUND as a missing share, the proto's contract) |

## 10. AgentChannel (`src/domain/agentchannel/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| AgentChannelCommandController.apply | none | chain-with-Authorize |
| AgentChannelCommandController.create | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — can_edit on the referenced agent ResolveChannelDefaults stashed) |
| AgentChannelCommandController.update | config: can_edit on agent_channel (field metadata.id), error_msg yes | chain-with-Authorize |
| AgentChannelCommandController.initiateInstall | config: can_edit on agent_channel (field resource_id), error_msg yes | direct: `authorizeDirect` AFTER the load (the Java LoadChannel-then-authorize order — missing ids answer NOT_FOUND for everyone), then refuse FAILED_PRECONDITION on the storing edition or delegate to `drivers.channelRuntime` (C2 close-out, 20260827.10 — the interim stub's owed can_edit arm) |
| AgentChannelCommandController.completeInstall | config: can_edit on agent_channel (field resource_id), error_msg yes | direct: same load → `authorizeDirect` → refuse-or-delegate |
| AgentChannelCommandController.delete | config: can_delete on agent_channel (field value), error_msg yes | chain-with-Authorize |
| AgentChannelQueryController.get | config: can_view on agent_channel (field value), error_msg yes | chain-with-Authorize |
| AgentChannelQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy) |
| AgentChannelQueryController.getByAgent | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |
| AgentChannelQueryController.list | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |

## 11. ChannelMessage (`src/domain/agentchannel/message.ts`)

The proactive-messaging surface is a cloud capability; OSS serves edition stubs, all direct.

| Method | Annotation | Handler |
|---|---|---|
| ChannelMessageCommandController.sendMessage | is_skip_authorization | direct (by design: the OSS handler is a stub that refuses FAILED_PRECONDITION and touches no row — proactive messaging is unavailable here) |
| ChannelMessageQueryController.listTemplates | is_skip_authorization | direct (by design: the OSS handler is a stub that refuses FAILED_PRECONDITION and touches no row) |
| ChannelMessageQueryController.listMessagingChannels | is_skip_authorization | direct (by design: the OSS handler answers an empty list and touches no row) |

## 12. ChannelConversation (`src/domain/agentchannel/conversation.ts`)

The conversation surface is a cloud capability; OSS serves edition stubs, all direct.

| Method | Annotation | Handler |
|---|---|---|
| ChannelConversationQueryController.listConversations | is_skip_authorization | direct (by design: the OSS handler answers an empty list and touches no row) |
| ChannelConversationQueryController.getConversation | config: can_view on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — answers NOT_FOUND unconditionally (no load-then-miss probing) |
| ChannelConversationQueryController.getTimeline | config: can_view on agent_channel (field agent_channel_id), error_msg yes | direct: returns an empty timeline |
| ChannelConversationQueryController.getMediaDownloadUrl | config: can_view on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — byte-pinned uniform NOT_FOUND miss (a prober cannot learn which items exist) |
| ChannelConversationCommandController.reply | config: can_participate on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — refuses FAILED_PRECONDITION (participation unavailable) |
| ChannelConversationCommandController.takeOver | config: can_participate on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — refuses FAILED_PRECONDITION |
| ChannelConversationCommandController.handBack | config: can_participate on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — refuses FAILED_PRECONDITION |
| ChannelConversationCommandController.clearAttention | config: can_participate on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — refuses FAILED_PRECONDITION |
| ChannelConversationCommandController.escalate | is_skip_authorization | direct (by design: the OSS handler is a stub that refuses FAILED_PRECONDITION and touches no row) |

## 13. ChannelApp (`src/domain/channelapp/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| ChannelAppCommandController.apply | none | chain-with-Authorize |
| ChannelAppCommandController.create | config: can_create_channel_app on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| ChannelAppCommandController.update | config: can_edit on channel_app (field metadata.id), error_msg yes | chain-with-Authorize |
| ChannelAppCommandController.delete | config: can_delete on channel_app (field resource_id), error_msg yes | chain-with-Authorize |
| ChannelAppQueryController.get | config: can_view on channel_app (field value), error_msg yes | chain-with-Authorize |
| ChannelAppQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy; response redacted) |
| ChannelAppQueryController.listByOrg | config: can_view on organization (field org), error_msg yes | chain-with-Authorize |

## 14. Schedule (`src/domain/schedule/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| ScheduleCommandController.apply | none | chain-with-Authorize |
| ScheduleCommandController.create | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — can_edit on the referenced agent ResolveScheduleDefaults stashed; before the duplicate check and before ArmSchedule) |
| ScheduleCommandController.update | config: can_edit on schedule (field metadata.id), error_msg yes | chain-with-Authorize |
| ScheduleCommandController.delete | config: can_delete on schedule (field value), error_msg yes | chain-with-Authorize |
| ScheduleCommandController.resume | config: can_edit on schedule (field value), error_msg yes | chain-with-Authorize |
| ScheduleCommandController.trigger | config: can_edit on schedule (field value), error_msg yes | chain-with-Authorize |
| ScheduleQueryController.get | config: can_view on schedule (field value), error_msg yes | chain-with-Authorize |
| ScheduleQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy) |
| ScheduleQueryController.getByAgent | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |
| ScheduleQueryController.list | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |
| ScheduleQueryController.listRuns | config: can_view on schedule (field schedule_id), error_msg yes | chain-with-Authorize |

## 15. Memory (`src/domain/memory/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| MemoryCommandController.create | is_skip_authorization | chain-with-Authorize (guard: GuardMemoryCapture — decides WHO may capture, through the composed `RunnerCredentialProvider.authorizeMemoryCapture`: under the built-in posture an agent-bound runner's capture is admitted as the run's person with the run's session as the proved provenance and scoped to the run's organization, a workflow- or connect-bound runner is refused, and a person's own create carries no capture credential and so no subject — `src/pipeline/steps/guard-memory-capture.ts`, `src/runnerauth/built-in-runner-credential-provider.ts`; guard: AuthorizeResolvedTarget — decides WHERE, can_create_session on metadata.org for a wire caller, after ResolveMemoryDefaults and before the enablement check) |
| MemoryCommandController.update | config: can_edit on memory (field metadata.id), error_msg yes | chain-with-Authorize |
| MemoryCommandController.delete | config: can_delete on memory (field value), error_msg yes | chain-with-Authorize |
| MemoryCommandController.confirm | config: can_edit on memory (field value), error_msg yes | chain-with-Authorize (shared runTransition helper, own descriptor) |
| MemoryCommandController.reject | config: can_edit on memory (field value), error_msg yes | chain-with-Authorize (shared runTransition helper, own descriptor) |
| MemoryQueryController.get | config: can_view on memory (field value), error_msg yes | chain-with-Authorize |
| MemoryQueryController.list | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |

## 16. AgentExecution (`src/domain/agentexecution/controller.ts` + lifecycle.ts, update-status.ts, submit-approval.ts, submit-file-decision.ts, usage.ts, artifacts.ts, subscribe.ts)

| Method | Annotation | Handler |
|---|---|---|
| AgentExecutionCommandController.create | is_skip_authorization | chain-with-Authorize (guard: AuthorizeRunTarget — by request shape, right after EnsureSessionOrAgentResolved: can_create_execution_in on the session (session_id), can_execute on the agent_instance (session_spec.agent_instance_id) or on the agent (agent_id) — the annotation cannot express the three-shape dispatch; P1 sp.run-gate, stigmer-cloud#709; under the built-in posture these five run-gate checks are answered `allow` for a WORKFLOW-bound runner before the Authorizer is asked, so a shared workflow's `agent_call` creates its child as the person who ran the workflow — `src/authorization/lane-admission.ts`, composed in `boot/compose.ts`; an agent-bound runner and every person are checked as themselves) |
| AgentExecutionCommandController.update | config: can_edit on agent_execution (field metadata.id), error_msg yes | chain-with-Authorize |
| AgentExecutionCommandController.updateStatus | config: can_edit on agent_execution (field execution_id), error_msg yes | chain-with-Authorize (update-status.ts) |
| AgentExecutionCommandController.submitApproval | config: can_edit on agent_execution (field agent_execution_id), error_msg yes | chain-with-Authorize (submit-approval.ts) |
| AgentExecutionCommandController.submitFileDecision | config: can_edit on agent_execution (field agent_execution_id), error_msg yes | chain-with-Authorize (submit-file-decision.ts) |
| AgentExecutionCommandController.cancel | config: can_edit on agent_execution (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| AgentExecutionCommandController.terminate | config: can_edit on agent_execution (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| AgentExecutionCommandController.recover | config: can_edit on agent_execution (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| AgentExecutionCommandController.pause | config: can_edit on agent_execution (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| AgentExecutionCommandController.resume | config: can_edit on agent_execution (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| AgentExecutionCommandController.uploadAttachment | is_skip_authorization | direct (by design: a blob-store write whose returned storage_key is the capability token for the later create, which is where the execution is authorized) |
| AgentExecutionCommandController.delete | config: can_edit on agent_execution (field value), error_msg yes | chain-with-Authorize |
| AgentExecutionQueryController.get | config: can_view on agent_execution (field value), error_msg yes | chain-with-Authorize |
| AgentExecutionQueryController.list | is_skip_authorization | direct (driver: ListReadScope — a composed scope narrows to the caller's authorized rows ∩ the request org when non-blank; the guest cookie rule is driver-internal) |
| AgentExecutionQueryController.listBySession | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows; the guest cookie rule is driver-internal) |
| AgentExecutionQueryController.subscribe | config: can_view on agent_execution (field value), error_msg yes | direct: stream subscribe over broker (register-before-snapshot; server-stream generator cannot run inside the pipeline executor); authorizeDirect once at subscription start |
| AgentExecutionQueryController.getArtifactDownloadUrl | config: can_view on agent_execution (field execution_id), error_msg yes | direct: authorizeDirect, then key-prefix / attachment-membership ownership check, then time-limited URL mint |
| AgentExecutionQueryController.getArtifactContent | config: can_view on agent_execution (field execution_id), error_msg yes | direct: authorizeDirect, then key-prefix ownership check, CAS-blob integrity check, truncated bytes in response |
| AgentExecutionQueryController.getExecutionUsageReport | config: can_view on agent_execution (field execution_id), error_msg yes | chain-with-Authorize (usage.ts) |
| AgentExecutionQueryController.getSessionUsageReport | config: can_view on session (field session_id), error_msg yes | chain-with-Authorize (usage.ts) |
| AgentExecutionQueryController.getAgentUsageReport | config: can_view on organization (field org_id), error_msg yes | chain-with-Authorize (usage.ts) |
| AgentExecutionQueryController.getOrgUsageReport | config: can_view on organization (field org_id), error_msg yes | chain-with-Authorize (usage.ts) |
| AgentExecutionQueryController.getExecutionSummary | is_skip_authorization | direct: full-scan store aggregate for the dashboard, a direct handler in Go as well (driver: ListReadScope — a composed scope narrows to the caller's authorized rows ∩ the requested org — C2 Stage 4's ExecutionReadScope, absorbed by 20260830.01) |

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
| WorkflowQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy; the ladder is LoadWorkflowByReference, version-resolution.ts) |
| WorkflowQueryController.listVersions | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedWorkflow — can_view on the resolved id, the Java handler's check) |
| WorkflowQueryController.getVersion | config: can_view on workflow (field workflow_id), error_msg yes | direct: authorizeDirect, then live-then-audit version read. DELIBERATE divergence from the Java edition (C2 Stage-4 gate ruling): Java declares the annotation but never evaluates it (a cross-org version-read gap; its javadoc claims framework enforcement that does not exist) — the annotation is the contract and this server enforces it |

## 18. WorkflowInstance (`src/domain/workflowinstance/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| WorkflowInstanceCommandController.apply | none | chain-with-Authorize |
| WorkflowInstanceCommandController.create | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — can_execute on the parent workflow LoadParentWorkflow stashed, before the same-org rule; a default instance the server composed in-process for the parent's organization asks nothing) |
| WorkflowInstanceCommandController.update | config: can_edit on workflow_instance (field metadata.id), error_msg yes | chain-with-Authorize |
| WorkflowInstanceCommandController.updateVisibility | config: can_edit on workflow_instance (field resource_id), error_msg yes | chain-with-Authorize |
| WorkflowInstanceCommandController.updateExecutionVisibility | config: can_grant_access on workflow_instance (field resource_id), error_msg yes | chain-with-Authorize |
| WorkflowInstanceCommandController.delete | config: can_delete on workflow_instance (field value), error_msg yes | chain-with-Authorize |
| WorkflowInstanceQueryController.get | config: can_view on workflow_instance (field value), error_msg yes | chain-with-Authorize |
| WorkflowInstanceQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy) |
| WorkflowInstanceQueryController.getByWorkflow | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |

## 19. WorkflowExecution (`src/domain/workflowexecution/controller.ts` + lifecycle.ts, update-status.ts, submit-approval.ts, submit-file-decision.ts, submit-workflow-task-approval.ts, send-signal.ts, queries.ts, subscribe.ts, subscribe-events.ts, get-event-log.ts, get-execution-summary.ts, list-pending-approvals.ts)

| Method | Annotation | Handler |
|---|---|---|
| WorkflowExecutionCommandController.create | is_skip_authorization | chain-with-Authorize (guard: AuthorizeRunTarget — by request shape, right after ValidateWorkflowOrInstance: can_execute on the workflow_instance (workflow_instance_id) or on the workflow (workflow_id); P1 sp.run-gate, stigmer-cloud#709) |
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
| WorkflowExecutionQueryController.list | is_skip_authorization | direct: full-scan store read, malformed rows skipped (driver: ListReadScope — a composed scope narrows to the caller's authorized rows ∩ the request org when non-blank) |
| WorkflowExecutionQueryController.listByWorkflow | is_skip_authorization | direct: full-scan store read filtered by workflow (driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |
| WorkflowExecutionQueryController.subscribe | config: can_view on workflow_execution (field execution_id), error_msg yes | direct: stream subscribe over broker; authorizeDirect once at subscription start |
| WorkflowExecutionQueryController.getEventLog | config: can_view on workflow_execution (field execution_id), error_msg yes | direct: authorizeDirect, then cursor-paginated read over the event side table (no existence check by contract) |
| WorkflowExecutionQueryController.subscribeEvents | config: can_view on workflow_execution (field execution_id), error_msg yes | direct: authorizeDirect at subscription start, then event-log replay + poll stream (existence-checked NotFound before streaming) |
| WorkflowExecutionQueryController.getExecutionSummary | is_skip_authorization | direct: full-scan store aggregate for the dashboard (driver: ListReadScope — a composed scope narrows to the caller's authorized rows ∩ the requested org, empty set = the default instance — C2 Stage 4's ExecutionReadScope, absorbed by 20260830.01) |
| WorkflowExecutionQueryController.listPendingApprovals | is_skip_authorization | direct: scan of IN_PROGRESS executions for waiting-approval tasks (driver: ListReadScope — a composed scope narrows to the caller's authorized rows ∩ the request org, applied before the approvals projection) |

## 20. McpServer (`src/domain/mcpserver/controller.ts` + connect.ts, start-connect.ts, initiate-oauth-connect.ts, complete-oauth-connect.ts, disconnect-oauth.ts, get-oauth-grant-status.ts)

| Method | Annotation | Handler |
|---|---|---|
| McpServerCommandController.apply | none | chain-with-Authorize |
| McpServerCommandController.create | config: can_create_mcp_server on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| McpServerCommandController.update | config: can_edit on mcp_server (field metadata.id), error_msg yes | chain-with-Authorize |
| McpServerCommandController.updateVisibility | config: can_edit on mcp_server (field resource_id), error_msg yes | chain-with-Authorize |
| McpServerCommandController.delete | config: can_delete on mcp_server (field resource_id), error_msg yes | chain-with-Authorize |
| McpServerCommandController.connect | config: can_connect on mcp_server (field mcp_server_id), error_msg yes | direct: blocking connect flow over the engine seam (ephemeral ExecutionContext, decrypt-lane token mint, runner workflow start); authorizeDirect AFTER the load (#224). The ephemeral EC is created as the caller and the connect token, under the built-in posture, admits the runner as that caller for the EC read (`src/domain/mcpserver/connect-execution-id.ts`; `src/runnerauth/bound-execution.ts` `mcp-connect`); the discovery's McpServer read rides the runner's own credential, an organization admin's key under the chart's install, whom the model makes an owner of every McpServer in the organization |
| McpServerCommandController.startConnect | config: can_connect on mcp_server (field mcp_server_id), error_msg yes | direct: async connect lane over the engine seam; authorizeDirect AFTER the load (#224) |
| McpServerCommandController.initiateOAuthConnect | config: can_connect on mcp_server (field mcp_server_id), error_msg yes | direct: OAuth authorize-URL mint (refuses FAILED_PRECONDITION without a configured redirect URI); authorizeDirect AFTER the load (#224) |
| McpServerCommandController.completeOAuthConnect | config: can_connect on mcp_server (field mcp_server_id), error_msg yes | direct: OAuth code exchange + grant persistence; authorizeDirect against the PENDING RECORD's server id (target override — the Java confused-deputy discipline; the single-use state is burned before a denial lands) |
| McpServerCommandController.disconnectOAuth | config: can_connect on mcp_server (field resource_id), error_msg yes | direct: grant teardown; authorizeDirect after input validation (no load step — the Java order) |
| McpServerCommandController.setOrgOAuthApp | config: can_create_oauth_app on organization (field org), error_msg yes | direct: OSS stub — throws Unimplemented (org OAuth-app overrides are cloud-only) |
| McpServerCommandController.deleteOrgOAuthApp | config: can_create_oauth_app on organization (field org), error_msg yes | direct: OSS stub — throws Unimplemented |
| McpServerQueryController.get | config: can_view on mcp_server (field value), error_msg yes | chain-with-Authorize |
| McpServerQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy; before EnrichOAuthStatus) |
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
| SkillQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy; the ladder is LoadSkillByReference) |
| SkillQueryController.getArtifact | is_skip_authorization | chain-with-Authorize (by design: the artifact key is a content hash — unguessable, deliberately immutable (a deleted skill's artifact keeps working by contract) and possibly shared by several skills — so the key itself is the capability; the way to learn a private skill's key is the skill row, whose reads are authorized) |
| SkillQueryController.getArtifactDownloadUrl | is_skip_authorization | chain-with-Authorize (by design: the same content-hash capability as getArtifact) |
| SkillQueryController.listVersions | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedSkill — can_view on the resolved id, the Java handler's check) |

## 21a. Plugin (`src/domain/plugin/controller.ts` + push.ts)

| Method | Annotation | Handler |
|---|---|---|
| PluginCommandController.push | config: can_create_plugin on organization (field org), error_msg yes | chain-with-Authorize (two chains over one context, plan then install; the plan chain additionally pre-authorises the caller for every member kind's create permission — can_create_skill, can_create_agent, can_create_workflow — before any write, and each member's own chain evaluates it again in-process as the caller) |
| PluginCommandController.createArtifactUploadUrl | config: can_create_plugin on organization (field org), error_msg yes | chain-with-Authorize |
| PluginCommandController.updateVisibility | config: can_edit on plugin (field resource_id), error_msg yes | chain-with-Authorize (the fan-out to members rides each member kind's own updateVisibility chain in-process as the caller) |
| PluginCommandController.delete | config: can_delete on plugin (field value), error_msg yes | chain-with-Authorize (members are deleted through their own delete chains in-process as the caller) |
| PluginQueryController.get | config: can_view on plugin (field value), error_msg yes | chain-with-Authorize |
| PluginQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedPlugin — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy) |
| PluginQueryController.listMembers | config: can_view on plugin (field value), error_msg yes | chain-with-Authorize |
| PluginQueryController.listVersions | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedPlugin — can_view on the resolved id) |

## 22. Artifact (`src/domain/artifact/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| ArtifactCommandController.create | is_skip_authorization | direct (by design: the runner's content-addressed blob write plus the metadata row for its execution; the execution the artifact belongs to was authorized when it was created) |
| ArtifactCommandController.delete | config: can_edit on artifact (field value), error_msg yes | direct: soft delete — storage_state transition, never a row removal; authorizeDirect AFTER the load (#224) |
| ArtifactQueryController.get | config: can_view on artifact (field value), error_msg yes | chain-with-Authorize |
| ArtifactQueryController.listByExecution | is_skip_authorization | chain-with-Authorize (guard: AuthorizeParentExecution — can_view on the named execution, the Java handler's two-field dispatch) |
| ArtifactQueryController.getDownloadUrl | config: can_view on artifact (field value), error_msg yes | direct: time-limited URL mint against the blob store; authorizeDirect AFTER the load (#224) |
| ArtifactQueryController.getContent | config: can_view on artifact (field artifact_id), error_msg yes | direct: truncated bytes in the response (512KB default cap); authorizeDirect AFTER the load (#224) |

## 23. Search (`src/query/search/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| SearchService.search | is_skip_authorization | direct: CQRS read over the search query store, cross-aggregate, no api_resource_kind option (driver: ListReadScope — a composed scope narrows to the caller's authorized rows, fed as a per-effective-kind authorized-id allowlist into the engine query on every request shape) |

## 24. Activity (`src/query/activity/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| ActivityQueryController.listRecentActivity | is_skip_authorization | direct: CQRS recents read over listResources, the request's org merely narrowing (driver: ListReadScope — a composed scope narrows to the caller's authorized rows, both kinds narrowed to the caller's authorized ids) |

## 25. GitHub (`src/domain/github/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| GitHubService.getOAuthAuthorizeUrl | is_skip_authorization | direct (by design: a stateless OAuth broker — an authorize-URL mint from config, nothing persisted, no row read) |
| GitHubService.exchangeOAuthCode | is_skip_authorization | direct (by design: a stateless OAuth broker — the code-for-token exchange returns the token to the caller and stores nothing) |

## 26. Platform (`src/domain/platform/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| PlatformQueryController.getServerInfo | is_public | direct: static edition + version read, and the resolved authentication posture |
| PlatformQueryController.getLicenseStatus | is_skip_authorization | direct (by design: the state of the license this server holds, answered by the composed `licenseStatus` driver (`src/extensions/license-status.ts`) or the built-in `absent` provider when none is registered, with `checked_at` stamped from the same instant the provider evaluated against. Authenticated, no permission: the answer feeds the console banner every signed-in person sees, and it is not public because a license names its customer. Open source and the cloud always answer `absent`) |
| PlatformQueryController.getRunnerBootstrapConfig | is_skip_authorization | direct (by design: publishes the Temporal coordinates for embedded runners; token fields empty on OSS — the runner's process credential is the operator's API key it already holds, and its per-run credential arrives in the workflow input, not here) |
| PlatformQueryController.getRunnerScopedToken | is_skip_authorization | direct (driver: RunnerCredentialProvider — mints the execution-scoped runner token, fail-soft (empty id, keyless service, or mint error answer the not-minted shape). Under trusted-local the token is the ExecutionContext decrypt-lane discriminator and nothing more, minted for any caller naming an execution. Under the built-in authorization posture the same token is also an identity: the runner-subject verifier (`src/runnerauth/runner-subject-verifier.ts`, composed between `apikey` and `oidc`) admits its bearer as the human whose run it is, for as long as the run lives — so there the exchange is a MINT GATE: the built-in provider's `exchangeScopedToken` (`src/runnerauth/built-in-runner-credential-provider.ts`) mints the run credential for the run's own person only; a missing run is NOT_FOUND with the load-first copy, anyone else is PERMISSION_DENIED. Runs receive their credential from the dispatch itself (both engine clients put `execution_context_token` on the workflow input); the exchange is the runner's fallback) |

## 27. IdentityAccount (`src/domain/identityaccount/controller.ts`)

The open-source identity domain (accounts and organization roles landed with it), served over the generic store; the cloud edition serves the same domain over its own table. Registered after Organization. Three lanes are skips: `create` is the platform's own pipelines' RPC (the hook that JIT-provisions an OIDC subject and the trusted-local boot ensure are in-process; a person never creates an account row directly), `provisionMyAccount` and `whoAmI` act on the caller's own account and nothing else. The three federated RPCs and `getByExternalSub` need a composed identity federation and answer UNIMPLEMENTED without one, after the annotation is evaluated.

| Method | Annotation | Handler |
|---|---|---|
| IdentityAccountCommandController.create | is_skip_authorization | chain-with-Authorize (guard: guardInternalRpc — before the chain, the platform's own pipelines only (`isPlatformPipelineCaller`: a machine account, the internal class, or any request that entered in-process); a wire person is refused PERMISSION_DENIED with the domain's copy. There is no row yet to hold a permission on, and the account's roles are written by the create chain itself) |
| IdentityAccountCommandController.update | config: can_edit on identity_account (field metadata.id), error_msg yes | chain-with-Authorize |
| IdentityAccountCommandController.delete | config: can_delete on identity_account (field value), error_msg yes | chain-with-Authorize |
| IdentityAccountCommandController.createFederatedAccount | config: can_create_identity_account on organization (field org), error_msg yes | direct: authorizeDirect, then the composed federation (UNIMPLEMENTED without one) |
| IdentityAccountCommandController.updateFederatedAccount | config: can_create_identity_account on organization (field org), error_msg yes | direct: authorizeDirect, then the composed federation |
| IdentityAccountCommandController.deprovisionFederatedAccount | config: can_create_identity_account on organization (field org), error_msg yes | direct: authorizeDirect, then the composed federation |
| IdentityAccountCommandController.provisionMyAccount | is_skip_authorization | direct (by design: the caller provisions their OWN account from the identity-provider subject their token carries — a token with no such subject is UNAUTHENTICATED; the row that results is the caller's, and the composed post-persist gates run on every call) |
| IdentityAccountQueryController.get | config: can_view on identity_account (field value), error_msg yes | chain-with-Authorize |
| IdentityAccountQueryController.whoAmI | is_skip_authorization | direct (by design: answers the caller's own account, resolved from their identity by id then by subject; no other row is reachable through this lane) |
| IdentityAccountQueryController.getByEmail | config: can_view on identity_account (field value), error_msg yes | direct: lookup first, then authorizeDirect on the FOUND id as the target override (the annotation's `value` is the email) |
| IdentityAccountQueryController.getByIdpId | config: can_view on identity_account (field value), error_msg yes | direct: lookup first, then authorizeDirect on the FOUND id as the target override |
| IdentityAccountQueryController.getByExternalSub | config: can_create_identity_account on organization (field org), error_msg yes | direct: authorizeDirect, then the composed federation |
| IdentityAccountQueryController.getActorInfo | config: can_view on identity_account (field value), error_msg yes | chain-with-Authorize |

## 28. IamPolicy (`src/domain/iampolicy/controller.ts`)

The IamPolicy row half in open source: the grant path (`create`, `delete`, `revokeOrgAccess`) is annotation-driven on the policy's RESOURCE (`resource_kind_path`), the three system RPCs admit the platform's own pipelines only before their chain, and the three query lanes that IAM cannot authorize with IAM (it would recurse) are skips whose trust is authentication plus the principal-trust rule. `checkMyPermission` is the console's one permission question.

| Method | Annotation | Handler |
|---|---|---|
| IamPolicyCommandController.create | config: can_grant_access on resource_kind_path resource.kind (field resource.id), error_msg yes | chain-with-Authorize |
| IamPolicyCommandController.delete | config: can_grant_access on resource_kind_path resource.kind (field resource.id), error_msg yes | chain-with-Authorize |
| IamPolicyCommandController.bootstrapPolicy | config: can_bootstrap_iam on platform (resource_id stigmer), error_msg yes | chain-with-Authorize (guardSystemRpc before the chain: the platform's own pipelines only, `isPlatformPipelineCaller`; a wire person is refused with the annotation's own copy, because under the permissive Authorizer the annotation alone would admit anyone) |
| IamPolicyCommandController.cleanupResourcePolicies | config: can_bootstrap_iam on platform (resource_id stigmer), error_msg yes | chain-with-Authorize (guardSystemRpc before the chain, as above) |
| IamPolicyCommandController.revokeOrgAccess | config: can_grant_access on organization (field organization_id), error_msg yes | chain-with-Authorize |
| IamPolicyCommandController.bootstrapRevokeOrgAccess | config: can_bootstrap_iam on platform (resource_id stigmer), error_msg yes | chain-with-Authorize (guardSystemRpc before the chain, as above) |
| IamPolicyQueryController.get | config: can_view_access on the loaded row's resource (no static kind or field; the target is the policy's own resource), error_msg yes | direct: load first, then authorizeDirect with the row's resource kind and id as the target override |
| IamPolicyQueryController.checkMyPermission | is_skip_authorization | direct (by design: asks about the CALLER themself — an authenticated caller's own standing on a named resource, answered as a boolean; an unknown permission name or kind is INVALID_ARGUMENT before any evaluation, and IAM authorizing IAM would recurse) |
| IamPolicyQueryController.checkAuthorization | is_skip_authorization | direct (guard: enforcePrincipalTrust — the platform's own pipelines (machine, internal) may ask about any principal; a person only about their own account, PERMISSION_DENIED otherwise; then the composed query engine) |
| IamPolicyQueryController.listAuthorizedResourceIds | is_skip_authorization | direct (guard: enforcePrincipalTrust — as checkAuthorization; the lane names no resource, so trust is on the principal) |
| IamPolicyQueryController.listAuthorizedPrincipalIds | config: can_view_access on resource_kind_path resource.kind (field resource.id), error_msg yes | direct: authorizeDirect |
| IamPolicyQueryController.listResourceAccessByPrincipal | config: can_view_access on resource_kind_path resource.kind (field resource.id), error_msg yes | direct: authorizeDirect |
| IamPolicyQueryController.getPrincipalResourceRoles | config: can_view_access on resource_kind_path resource.kind (field resource.id), error_msg yes | direct: authorizeDirect |
| IamPolicyQueryController.getPrincipalsCount | config: can_view_access on organization (field org_id), error_msg yes | direct: authorizeDirect |

## 29. PlatformClient (`src/domain/platformclient/controller.ts` + token-controller.ts, mint.ts)

Served by open source in every edition over the `PlatformClientStore` port (`drivers.platformClientStore`; the cloud serves the same chains over its own table). Every response clears the stored secret hash. `getByReference` is the one skip lane and authorizes the loaded client as `get` does; `listByOrg` narrows to the clients a `get` would return, because the model gives organization members no access to a credential. The token service is public: `mintUserToken` authenticates the client by its credentials in the request body (never the chain's caller, which is the trusted-local operator on a tokenless request), refuses FAILED_PRECONDITION on a server without an authentication posture, and writes the end user's account and auto-grant role as the client (`serverActingFor`); `mintGuestToken` is served by the composed `guestTokenMinting` capability and answers UNIMPLEMENTED without one. The tokens it mints are verified by the platform-client verifier (`src/domain/platformclient/verifier.ts`, composed between `apikey` and `oidc` under an authentication posture, liveness included) and bounded by the origin caller guard (`src/domain/platformclient/origin-guard.ts`).

| Method | Annotation | Handler |
|---|---|---|
| PlatformClientCommandController.create | config: can_create_platform_client on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| PlatformClientCommandController.update | config: can_edit on platform_client (field metadata.id), error_msg yes | chain-with-Authorize |
| PlatformClientCommandController.delete | config: can_delete on platform_client (field resource_id), error_msg yes | chain-with-Authorize |
| PlatformClientCommandController.rotateSecret | config: can_edit on platform_client (field value), error_msg yes | chain-with-Authorize |
| PlatformClientQueryController.get | config: can_view on platform_client (field value), error_msg yes | chain-with-Authorize |
| PlatformClientQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded client authorized exactly as `get` is: can_view with the get annotation's copy; response redacted) |
| PlatformClientQueryController.listByOrg | config: can_view on organization (field org), error_msg yes | chain-with-Authorize (a composed ListReadScope narrows to the clients the caller may view) |
| PlatformClientTokenController.mintUserToken | is_public | direct: the client's credentials in the request body; mint.ts |
| PlatformClientTokenController.mintGuestToken | is_public | direct: the composed guest-token capability, UNIMPLEMENTED without one |

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

**Conformance coverage (2026-09-04; contract-only since 2026-09-10)** — `test/conformance/src/suites/direct-handler-authorization.conformance.test.ts` pins the outsider contract of the 19 evaluated methods on every multi-tenant target. Three of its arms sit exactly where the Java edition diverged by ruling (recorded above) and are plain contract now: getVersion refuses an outsider with its annotation copy (Java never evaluated the annotation — stigmer-cloud#562); initiateOAuthConnect authorizes before the auth-block precondition (Java checked the precondition first); unknown ids on the authorize-first family answer the uniform NOT_FOUND (Java answered PERMISSION_DENIED). The unknown-id arm observes all six lanes before asserting so a divergence shows as the whole table, not the first lane. While both editions served behind the one `cloud` target, the suite selected which contract to assert — first through the `STIGMER_CONFORMANCE_DIRECT_HANDLER_AUTHZ_CONTRACT` knob (stigmer#972), then from the implementation the environment declared (stigmer#1014); the selector retired with the Java service (stigmer#1023).

## Descriptor mismatches found

- `SkillCommandController.pushFromExecutionArtifact` delegates into the shared push pipeline. This WAS a descriptor mismatch (the delegated pipeline hardcoded `method.push`); the inventory pass caught it and the pipeline now takes the authorizing descriptor from its caller, so each of the two RPCs authorizes under its own annotation. Recorded here because the trap shape — shared pipeline, hardcoded descriptor — is the one thing a future delegating handler must not reintroduce.

No other mismatch exists: every other `newAuthorizeStep` call site passes the descriptor of the RPC it serves, including all ten lifecycle RPCs (shared builder, per-method descriptor) and memory confirm/reject (shared transition helper, per-method descriptor).

## Unregistered proto methods and services

- `OrganizationQueryController.getByExternalOrgId` (is_skip_authorization) exists in the proto but is not in the server's registration map — the only partially-registered service.
- `TaskKindRegistryQueryController.getTaskKindRegistry` is a proto service the server never registers as an RPC; the task-kind registry is served over the HTTP registry lane instead (below).
- Entire proto service families exist under `apis/ai/stigmer/` that this server does not register at all — they are cloud-edition surfaces: Billing (command + query), the three `billing` envelope kinds Plan, Subscription and License (command + query each; `Plan` writes and every `License` RPC on the static `platform:stigmer` target with `can_manage_plans` and `can_issue_license`, `Plan` reads `is_skip_authorization` because the kind has no authorization scope and the catalog is readable by every signed-in caller, `Subscription` RPCs on `organization` with the billing permissions by `org_id`), CursorAccount (command + query), ProviderStanding (query), and the remaining IAM family: IdentityProvider and Invitation (command + query each). PlatformClient left this list when open source began serving it (section 29). ApiKey left this list with O3 (20260827.06 — section 2a; DD-003: the apikey contract is wholly OSS). The remaining families' annotations (including the `resource_id = "stigmer"` platform-operator checks) are already declared in the protos for C1/C2 to consume. The IamPolicy annotations name their targets since 20260913.01 slice 1: six RPCs resolve by annotation (`create`, `delete`, `listResourceAccessByPrincipal`, `getPrincipalResourceRoles`, `listAuthorizedPrincipalIds` through `resource_kind_path = "resource.kind"` — a STRING the resolver reads by enum member name — plus `field_path = "resource.id"`; `revokeOrgAccess` and `getPrincipalsCount` statically on `organization`); `get(IamPolicyId)` names no kind by design and is the load-then-authorize lane (`authorizeDirect` with the override's kind and id, the loaded row's resource); `listAuthorizedResourceIds` is an `is_skip_authorization` lane whose handler enforces `checkAuthorization`'s principal-trust rule (it names a principal and no resource). The family is registered by slice 5; its write half (the `IamPolicyStore` port, the OSS adapter over `resources`, and the one grant/revoke path in `domain/iampolicy/grant-path.ts`) landed in slice 2, together with the two policy hooks on `ResourceAuthorizationLifecycle` (`onPolicyGranted` after the row persist, `onPolicyRevoked` before the row delete — the cloud#425 orderings a composition mirrors as tuples) and the grant path's gate, which refuses an unknown resource or principal kind and an ambiguous triple INVALID_ARGUMENT before any read or write; the three registry points the family is served through — `drivers.iamPolicyStore` (the port's driver), `drivers.policyGrantScope` (which kinds an edition grants on; open source's default is the organization alone) and `drivers.authorizationQueries` (the tuple-half engine behind `checkAuthorization`, the two `listAuthorized*Ids` and a contextual `checkMyPermission`; absent, those arms are UNIMPLEMENTED with the edition reason) — landed in slice 3, with the proto's `grantable_roles` read (`grantableRolesFor`) that `ValidateGrantableRole` consults before any scope. Slice 4 landed the rows' first WRITERS under the built-in authorization posture (`boot/compose.ts` `builtInAuthorization`: no unit registered an Authorizer): the built-in role lifecycle (`domain/iampolicy/role-lifecycle.ts`, installed as the `ResourceAuthorizationLifecycle` when no driver is composed — the organization creator's `owner` row, resolved to the creator's ACCOUNT through `accountForCaller`; cleanup on organization and account deletes) and the membership rules (`domain/iampolicy/membership.ts`, run once per person on the call that created their account: founder → owner, blueprint author → admin, the operator's email → admin, the first caller of an unclaimed organization → admin, everyone else → member; the trusted-local operator ensured `owner` at boot wherever no owner row exists; and, under the built-in authorization posture, a database whose accounts were provisioned before the rules existed reconciled ONCE at boot — `ensureRolesForExistingAccounts`, the same arms for every person account in creation order, then a `bootstrap_state` marker so a reboot never hands a revoked role back). So on an open-source server the rows the family's read RPCs list exist from that slice on; nothing enforces them until entry 3. **IdentityAccount left this list with 20260911.11 (both services, served by `domain/identityaccount/controller.ts`; recorded here at slice 5 of 20260913.01, which also registers IamPolicy).** **IamPolicy is registered since 20260913.01 slice 5** (`domain/iampolicy/controller.ts`, all fourteen RPCs, `boot/compose.ts` in the IAM family block): the six command RPCs are chains, each `Authorize → ValidateProto → <one domain step>` (`create`: `ValidateGrantableRole → Grant`, the cloud's validate-before-write order; `bootstrapPolicy`: `Grant` alone, the structural lane; `delete`: `Revoke`, authorize-before-load — a caller without `can_grant_access` on the spec-named resource is PERMISSION_DENIED even for an absent triple, the ruled Q-OR-2 divergence from the cloud's silent default instance; `revokeOrgAccess` and `bootstrapRevokeOrgAccess`: `RevokeOrgAccess`; `cleanupResourcePolicies`: `CleanupResource`); the three system RPCs run an admission guard BEFORE the chain (`isPlatformPipelineCaller` in `extensions/identity.ts` — machine, internal or in-process only; a wire user is PERMISSION_DENIED with the annotation's own `error_msg`), because under the permissive Authorizer the static `platform:stigmer` annotation alone would admit anyone; no IamPolicy chain splices a tuple step (a policy is the authorization record, not a protected resource — the ts-server guideline records the exception). The eight query RPCs are direct handlers: `get` loads then `authorizeDirect`s with the row's kind and id as the override; `checkMyPermission` (skip lane) is UNAUTHENTICATED for an empty identity, INVALID_ARGUMENT for a relation that is no `IamPermission` name or a resource kind that is no enum member name, rides `drivers.authorizationQueries` when contextual policies are present (UNIMPLEMENTED when absent), and otherwise answers `false` for a kind the edition does not serve (`kindServedByEdition`, the server twin of the SDK's tier table), `false` for `can_grant_access` on a kind outside the composed grant scope, and the composed Authorizer's decision (allow → true; deny and not-found → false; unavailable → INTERNAL, never softened) for everything else; `checkAuthorization` and `listAuthorizedResourceIds` (skip lanes) enforce the principal-trust rule against the caller's ACCOUNT (`accountForCaller`, else the stamped identity) before the engine; `listAuthorizedPrincipalIds`, `listResourceAccessByPrincipal`, `getPrincipalResourceRoles` and `getPrincipalsCount` are annotation-driven `authorizeDirect` then the row functions. Every kind string that came off the wire — a ref's kind, `resource_kind`, `principal_kind` — passes `domain/iampolicy/wire-refusals.ts` (INVALID_ARGUMENT with the pinned copy) on every lane, the one home the grant path and the `ValidateGrantableRole` step share — and on the annotated lanes it runs BEFORE position 1 (slice 6, Q-S6-1, 2026-09-14): a kind string that names no kind names no authorization target, so no Authorizer in any edition is asked about it, the order the cloud's retiring handlers kept (`kindFromSpecString` before `authorizeRpc`) and so one wire answer in every edition. The resolver's unknown-kind arm (denied by an enforcing Authorizer, the A28 class) is thereby a backstop no wire caller reaches; it stands for a stored row on `get`. `create` grants to PEOPLE only (the security read, 2026-09-14, Q-S9-2): `ValidateGrantableRole`'s last arm refuses a principal outside `USER_GRANT_PRINCIPAL_KINDS` (the identity account) INVALID_ARGUMENT in every edition — a row whose principal is a resource is the structural link `findScopeTuple` reads and the hierarchy walk follows, `bootstrapPolicy`'s to write, and through the user lane it would have let `can_grant_access` on one organization list another's members; the store derives its non-structural exclusion from the same constant so writer and reader cannot drift.
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
- (b) The in-process router transport (`src/boot/inprocess.ts`) runs the same chain except position 1, which stamps the `internal` caller class only that chain can mint (ruling Q4). The Authorize step returns immediately for `callerClass === "internal"`, so cross-domain in-process calls skip the authorization decision while still traversing validation, logging, and kind-tagging. The list lanes keep the same rule in their own shape (stigmer#1207): `restrictListByReadScope` (`src/extensions/list-read-scope.ts`) returns the org-narrowed rows for the `internal` class before any composed ListReadScope is consulted, so a server-internal list read — the personal-environment lookups at execution-context creation and MCP connect, a composition's own in-process readers — sees what a trusted read sees; a caller propagated through the in-process header keeps its own class and is narrowed like a wire caller. The enumeration verb (`authorizedResourceIds`) has no helper in front of it and no in-process edge reaches it; its internal arm is the driver's.
- (c) The Temporal worker's status-merge activity (`src/temporal/agentexecution/activities.ts`) reaches the domain `updateStatus` through the in-process transport of note (b) — the `InProcessClients.executionStatusWriter` edge — so its writes carry the `internal` caller class and skip the authorization decision exactly like every other server-internal call. (Corrected 2026-09-05, stigmer#979: the activity previously called the domain function directly with `trustedLocalIdentity()`, the chassis's WIRE fallback — a `user`-class identity an enforcing Authorizer has no grant for, so on the cloud composition every runner failure left a hung, never-FAILED execution. No server code constructs a `CallerIdentity` outside `pipeline/interceptors/auth.ts` any more.)
- (d) Methods with NO config annotation skip the authorizer by design (`authorize.ts`: no `config` option → the step returns before consulting the Authorizer), and every such method is visible in the tables above — the annotation column says `none`, `is_public`, or `is_skip_authorization`.
