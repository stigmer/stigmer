# Authorization Coverage Inventory

This document is the coverage inventory for the stigmer-server authorization surface. It classifies EVERY entry point the server exposes — every RPC method of every registered service, plus the non-RPC HTTP lanes — by its authorization posture: whether the shared `Authorize` pipeline step (`src/pipeline/steps/authorize.ts`) runs for it, what proto method annotation it carries, and what a direct handler does instead. It is a permanent acceptance artifact: an edition that composes its own Authorizer inherits this map instead of discovering gaps against its authorization model. It MUST be updated whenever a method is added or removed, a handler changes between pipeline and direct form, or a `(ai.stigmer.commons.rpc.config)` / `is_public` / `is_skip_authorization` annotation changes.

How to read the tables:

- **Annotation** is what the method's proto declares: a `config` summary (`permission` on `resource_kind`, the `field_path` or literal `resource_id` the target is resolved from, and whether `error_msg` is set), `is_public` (50057), `is_skip_authorization` (50058), or `none` (no option at all — the apply RPCs and the gRPC health service).
- **Handler** is what the server actually runs: `chain-with-Authorize` means the handler builds a `newPipeline(...)` whose FIRST `.addStep` is `newAuthorizeStep(<its own method descriptor>, authorizer)`; `direct: <posture>` means no pipeline is built. A direct handler marked `authorizeDirect` evaluates its annotation through the SAME exported evaluation the step runs (`authorizeDirect` in `src/pipeline/steps/authorize.ts` — identical skip arms, target resolution, and decision mapping), placed in the handler's own order (noted per row where it differs from authorize-first).
- The two columns are independent facts. A method can carry a `config` annotation and be a direct handler — nearly all such methods evaluate the annotation via `authorizeDirect`; the dispositions of the full set are recorded in the "Config-annotated methods served by direct handlers" section before the notes.
- **Every `is_skip_authorization` row names what guards it**, in its Handler cell, with one of three markers — the inventory's own rule, enforced by `src/authorization/__tests__/skip-lane-inventory.test.ts`, which also holds this table's skip rows equal to the served descriptors' skip set: `guard: <Name>` names the mid-chain pipeline step, or the handler's guard function, that authorizes the lane (it must exist by that name in `src/`; the shared one is `AuthorizeResolvedTarget`, `src/pipeline/steps/authorize-resolved-target.ts`, for every lane whose target is a loaded row or a stashed parent rather than a request field); `driver: <Seam>` names the composed seam that decides (the `ListReadScope` on every list lane, the `OrganizationDirectory`, the `RunnerCredentialProvider`); `by design: <reason>` says the lane is open to every authenticated caller and why. A skip row carrying none of the three is a defect: that lane is open in every edition and nobody has said so.
- **Every `is_skip_authorization` row whose request names no organization says how an organization being deleted is refused there**, with a fourth marker in its Handler cell. Deleting an organization marks it, and from then until its purge finishes it answers as if it did not exist (`src/domain/organization/lifecycle.ts`): a request that names it is refused by the deleting rule's interceptor on both chains, and a check on a row it owns is answered not-found by the composed Authorizer's credential-binding seat, so a skip row whose request names an organization (by the organization-name resolver's own field rule) or whose guard asks the Authorizer needs nothing more. A skip lane whose request names none reaches neither, so its row carries `deleting: <Name>`, the step or function that refuses or leaves out a deleting organization's rows on that lane (it must exist by that name in `src/`; `bindListReadScope` for the list lanes, whose composed scope drops such rows for every caller), or `deleting: inert, <reason>`, why the lane cannot act inside one. The same inventory test computes which skip lanes name no organization and refuses such a row without the marker. A trusted-local server composes no list scope, so its list lanes keep listing a deleting organization's rows until its purge removes them; that server's one operator holds every organization, and a server that declares one organization never deletes it.
- Authorize step semantics (verified in `src/pipeline/steps/authorize.ts`): the step returns immediately for the `internal` caller class, then for `is_public`, then for `is_skip_authorization`, then for methods with no `config` option; only a present `config` reaches the composed Authorizer. So even on chain methods, a skip/public annotation means the Authorizer is never consulted — the step's presence still gives a composed Authorizer the uniform interception point.
- Credential binding (`src/authorization/credential-binding.ts`): a credential that names one organization (`CallerIdentity.boundOrg` — a PlatformClient user token, an API key limited with `spec.bound_org`, a run's credential, a composition's bound lane) works in that organization only. The composition wraps the composed Authorizer, ListReadScope and OrganizationDirectory with that rule in every posture, so every `config` lane, every skip lane whose guard asks the Authorizer and every `driver:` lane is bound by construction, and no row below names it again. A bound credential also manages its organization's child organizations (the management permissions only, never a child's rows), which is the binding's own rule too. Only the lanes that act on an organization without any of the three carry their own marker: organization create (`RefuseBoundCredential`, which admits exactly a child of the bound organization), API key create (`BindApiKeyOrganization`), the three self-query lanes that hand the query engine a caller's question (`bindingReaches`, `driver: CredentialBinding`), the runner exchange, and the lanes that authorize on something else and take the organization they write into from the request (`RefuseBoundElsewhere`: run create, MCP connect, the OAuth grant lanes and the channel lanes that name an organization). The persist step refuses any row a bound caller would file in another organization, under them all. One reach is not bound: a check that targets the platform itself (`platform:stigmer` — credits, plans, pricing, licenses) is decided by the person's platform role, so a platform operator's key limited to one organization still performs platform acts, which change other organizations' state.

Verification notes: every registration map in `src/boot/compose.ts`'s routes closure was cross-checked against its controller file and its proto service definition; every `newAuthorizeStep` call site was checked for descriptor/RPC agreement (all five lifecycle RPCs pass their own descriptor through the shared `runLifecyclePipeline` builder; memory `confirm`/`reject` pass their own descriptors through the shared `runTransition` helper); a mechanical scan confirmed `newAuthorizeStep` is the first `.addStep` of every `newPipeline` in the server (zero exceptions).

## Totals

- Registered services: 52 (51 Stigmer services, each command, query or token controller counted once, + the standard gRPC health service; the ExecutionContext command and query services removed and the vault's VaultValueController added when a run's values were fetched from their vaults; Evaluator command + query with the Evaluator kind, section 16b; Score command + query with the Score kind, section 16a; the vault's public ConnectLinkController added and the GitHub sign-in service removed when a sign-in moved to the vault; PlatformClient command, query and token with the open-source PlatformClient domain, section 29; ApiKey command + query, section 2a; Plugin command + query with the Plugin kind; IdentityAccount and IamPolicy command + query with the open-source identity domain, sections 27 and 28).
- Registered RPC methods: 235, counted from the served descriptors (the six ExecutionContext methods removed and VaultValueController.fetchValues added when a run's values were fetched from their vaults; the Evaluator kind added five; the Score kind added six; a sign-in starts from an address on the vault: VaultCommandController gained startSignIn, completeSignIn and createConnectLink and ConnectLinkController serves three public methods, while McpServer's initiateOAuthConnect, completeOAuthConnect and the three org-OAuth-app stubs and GitHub's getOAuthAuthorizeUrl and exchangeOAuthCode were removed; the Vault kind replaced Environment, two methods more; GitHubQueryController added five server-side repository reads; Agent getDefault removed with the default-agent lookup: a session with no agent runs the built-in assistant; `OrganizationQueryController.getByExternalId` and `listChildOrgs` added with child organizations, replacing the identity-provider lookup that only a composed directory served).
- Handler classes: 163 `chain-with-Authorize`, 72 `direct` (28 of which evaluate their annotation via `authorizeDirect` — the 17 direct-handler dispositions and the 11 lanes of the identity domain).
- Annotation classes: 144 `config`, 72 `is_skip_authorization`, 7 `is_public`, 12 `none` (9 apply RPCs + 3 health methods). A skip lane became `config` when its target turned out to be a request field after all: McpServer create (`can_create_mcp_server` on `metadata.org`).
- What the classes mean under each open-source posture: on a trusted-local server (no authentication) the composed Authorizer is the permissive trusted-local driver (`src/authorization/trusted-local-authorizer.ts`) and no list scope is composed, so every class admits every caller, with one answer shared with the other postures: a `config` lane whose target is an Organization the server does not hold is NOT_FOUND with the load-first copy (`Organization not found: <slug>`), so nothing is written or read under a slug no Organization holds (stigmer#1163). Under an authentication posture with no unit Authorizer (`STIGMER_OIDC_ISSUER` set; `src/authorization/posture.ts`) the server composes its BUILT-IN Authorizer and ListReadScope — the authorization model every edition reads (`fga/model`) evaluated over tuples derived from the row — so every `config` lane enforces the model and every list lane marked "a composed ListReadScope narrows" below narrows to the caller's rows. `is_skip_authorization` lanes reach neither Authorizer in either posture: what guards each is the mid-chain step or driver its Handler column names with the `guard:` / `driver:` / `by design:` markers above, and a skip lane whose column names nothing is open to every authenticated caller in every edition — which is why the inventory test refuses one.
- Config-annotated methods served by direct handlers: 35 — the 24 dispositioned before the notes section (`authorizeDirect` and the composed channel runtime) and the 11 lookup-then-authorize and federation lanes of the identity domain (sections 27 and 28), every one of them `authorizeDirect`.

## 1. Health (`grpc.health.v1.Health`, `src/transport/health.ts`)

The standard gRPC health protocol — an external proto with no Stigmer annotations. Because it cannot carry `is_public`, the require-authentication posture exempts it BY SERVICE NAME (`AUTHENTICATION_EXEMPT_SERVICES` in `src/pipeline/interceptors/auth.ts`; stigmer#974): a Kubernetes `grpc:` probe is a tokenless `check`, and a refused probe is a pod that never becomes Ready. The three methods stay authorization-`none` — the exemption is an authentication fact, not an authorization one.

| Method | Annotation | Handler |
|---|---|---|
| check | none (external proto) | direct: pure in-memory health-state read |
| list | none (external proto) | direct: pure in-memory health-state read |
| watch | none (external proto) | direct: server-stream over in-memory health-state notifications |

## 2. Organization (`src/domain/organization/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| OrganizationCommandController.apply | none | chain-with-Authorize |
| OrganizationCommandController.create | is_skip_authorization | chain-with-Authorize (by design: any authenticated person may found an organization and becomes its owner; there is no organization yet to hold a permission on; guard: RefuseBoundCredential — a credential bound to one organization (`CallerIdentity.boundOrg`: a limited API key, a PlatformClient user token, a composition's bound lane) is refused PERMISSION_DENIED before the request is read, since it works in its organization only and never founds another, except a child of that organization; `src/authorization/credential-binding.ts`; guard: ValidateChildOrganization — a create that names `spec.parent_org` needs `can_manage_child_orgs` on that parent, asked through `authorizeResolvedResource` before anything is written, a parent that does not exist refused as one the caller may not manage, and writes no owner for the child; `src/domain/organization/children.ts`) |
| OrganizationCommandController.update | config: can_edit on organization (field metadata.id), error_msg yes | chain-with-Authorize |
| OrganizationCommandController.updatePolicies | config: can_edit on organization (field org_id), error_msg yes | chain-with-Authorize (the only writer of `spec.policies`: update and apply keep the stored policies; a change that closes an act is announced to the lifecycle's `onOrganizationPoliciesChanged` before the row persists, one that opens an act after; `src/domain/organization/policies.ts`) |
| OrganizationCommandController.rename | config: can_delete on organization (field resource_id), error_msg yes | chain-with-Authorize (owners only: a rename moves every member's links and scripts) |
| OrganizationCommandController.delete | config: can_delete on organization (field value), error_msg yes | chain-with-Authorize |
| OrganizationQueryController.get | config: can_view_settings on organization (field value), error_msg yes | chain-with-Authorize (the organization's people and its parent's admins, who manage a child without holding `can_view` on it) |
| OrganizationQueryController.find | is_skip_authorization | chain-with-Authorize (driver: OrganizationDirectory — the composed directory's `refusesEnumeration` answers UNIMPLEMENTED before any work under the built-in posture and on the cloud; trusted-local enumerates) |
| OrganizationQueryController.findMyOrganizations | is_skip_authorization | direct (driver: OrganizationDirectory — trusted-local answers ALL organizations (single-team); the built-in directory answers the organizations the caller holds a role on; the cloud filters by IAM policy the same way; deleting: deletingOrganizationIds) |
| OrganizationQueryController.getByExternalId | config: can_manage_child_orgs on organization (field parent_org), error_msg yes | chain-with-Authorize (the child is read through the name table under that parent alone, so another parent's external ids answer nothing) |
| OrganizationQueryController.listChildOrgs | config: can_manage_child_orgs on organization (field org), error_msg yes | chain-with-Authorize (the organization list index pages the parent's children; no per-row read scope runs, because the parent's admins manage every child and hold `can_view` on none) |

## 2a. ApiKey (`src/domain/apikey/controller.ts`)

Registered immediately after Organization. The identity chassis's apikey VERIFIER reads the store through `domain/apikey/lookup.ts`, never through these RPCs — verification is not an entry point here.

| Method | Annotation | Handler |
|---|---|---|
| ApiKeyCommandController.create | is_skip_authorization | chain-with-Authorize (by design: a person mints keys for their own identity; the row's owner is the caller and no other principal is named; guard: BindApiKeyOrganization — a key limited to an organization (`spec.bound_org`) is refused unless its owner has can_view there, and a caller whose credential is bound to one organization creates only keys limited to it: an empty `spec.bound_org` takes the caller's organization and any other value is PERMISSION_DENIED) |
| ApiKeyCommandController.update | config: can_edit on api_key (field metadata.id), error_msg yes | chain-with-Authorize |
| ApiKeyCommandController.delete | config: can_delete on api_key (field value), error_msg yes | chain-with-Authorize |
| ApiKeyQueryController.get | config: can_view on api_key (field value), error_msg yes | chain-with-Authorize |
| ApiKeyQueryController.getByKeyHash | is_skip_authorization | chain-with-Authorize (by design: a hash lookup the verifier does not use, served to any authenticated caller in every edition; deleting: inert, a person's own key belongs to no organization; a key bound to an organization being deleted is refused wherever it would work, and the purge removes it) |
| ApiKeyQueryController.findAll | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows; the scope-less single-team posture returns all keys; deleting: inert, a person's own keys belong to no organization; a key bound to an organization being deleted is refused wherever it would work, and the purge removes it) |

## 3. Vault (`src/domain/vault/controller.ts`)

Values are write-only: every response passes through `redactVault`, and no RPC returns a value. My vault is created by the vault service on its person's first entry write (`mine`), never by `create`.

| Method | Annotation | Handler |
|---|---|---|
| VaultCommandController.create | config: can_create_shared_vault on organization (field metadata.org), error_msg yes | chain-with-Authorize (a shared vault, owned by its organization: StampSharedOwner refuses a person owner and entries; ClaimExternalId takes the external id's name claim) |
| VaultCommandController.update | config: can_edit on vault (field metadata.id), error_msg yes | chain-with-Authorize (KeepStoredOwnerAndEntries: the stored owner and entries win; the stored visibility stands, so My vault stays private) |
| VaultCommandController.updateVisibility | config: can_manage_audience on vault (field resource_id), error_msg yes | chain-with-Authorize (RefuseMyVaultWidening: My vault is always private) |
| VaultCommandController.delete | config: can_delete on vault (field resource_id), error_msg yes | chain-with-Authorize (the delete tail destroys every sealed value and releases the vault's names) |
| VaultCommandController.setSecrets | is_skip_authorization | direct (guard: resolveWriteTarget — `mine` asks can_create_vault on the organization, then finds or creates the caller's My vault; an id asks can_edit on the vault, and a vault outside the request's organization is NOT_FOUND) |
| VaultCommandController.removeSecrets | is_skip_authorization | direct (guard: resolveWriteTarget — as setSecrets; `mine` with no My vault is NOT_FOUND) |
| VaultCommandController.setConnection | is_skip_authorization | direct (guard: resolveWriteTarget — as setSecrets) |
| VaultCommandController.removeConnections | is_skip_authorization | direct (guard: resolveWriteTarget — as removeSecrets) |
| VaultCommandController.startSignIn | is_skip_authorization | direct (guard: authorizeSignInVault — as setConnection's target rule: `mine` asks can_create_vault on the organization, an id asks can_edit on the vault, a vault outside the request's organization is NOT_FOUND; a caller with no identity is UNAUTHENTICATED; refuseBoundElsewhere on the vault's organization. Every login server is dialled through the composed egress guard.) |
| VaultCommandController.completeSignIn | is_skip_authorization | direct (guard: completePersonSignIn — the single-use pending state is consumed, refused unless the caller is the signer it recorded and it was not started by a Connect link, then authorizeSignInVault asks the start's vault rule again before the code is exchanged; deleting: authorizeSignInVault, which asks the Authorizer on the pending state's organization or vault) |
| VaultCommandController.createConnectLink | config: can_edit on vault (field vault_id), error_msg yes | direct: authorizeDirect, then the vault must be in the request's organization (NOT_FOUND otherwise) and shared (My vault refused), the return URL https (http only for localhost, 127.0.0.1 or [::1]), and the address one the organization's own approved login app lists, that app's client id not one Stigmer signs in with (a link never lends Stigmer's apps or clients); only the link secret's SHA-256 is stored; the link records its maker's caller class and bound organization, and the maker's can_edit is asked again as that caller when the link starts and completes; guard: refuseBoundElsewhere |
| ConnectLinkController.getConnectLink | is_public | direct: the link's secret is the authority (an unknown, expired or used link answers NOT_FOUND alike); answers the provider name, address and organization name only; connect-link.ts |
| ConnectLinkController.startConnectLink | is_public | direct: the link's secret is the authority; the link's creator must still hold can_edit on the vault (asked of the Authorizer as that person), else NOT_FOUND; the pending state is bound to the link and to no signer |
| ConnectLinkController.completeConnectLink | is_public | direct: the link's secret is the authority and the state must be the one this link started; the creator's can_edit is asked again, the link is spent before the code is exchanged (made usable again if the save then fails), and the login is saved into the link's vault as its creator |
| VaultQueryController.get | config: can_view on vault (field value), error_msg yes | chain-with-Authorize |
| VaultQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy) |
| VaultQueryController.getMine | is_skip_authorization | direct (guard: findMine — the vault is found by the caller's own identity through its name claim, then authorizeResolvedResource asks can_view on it) |
| VaultQueryController.getByExternalId | is_skip_authorization | direct (guard: findByExternalId — authorizeResolvedResource asks can_view on the organization first, then the external id's name claim resolves the vault and can_view is asked on it, a denial answered NOT_FOUND as for a missing id, so the reply never tells which external ids exist) |
| VaultQueryController.list | is_skip_authorization | direct (driver: ListReadScope — a composed scope narrows to the caller's authorized rows; another person's My vault is dropped before the scope is asked, in every posture) |
| VaultValueController.fetchValues | is_skip_authorization | direct (driver: RunnerCredentialProvider — the bearer must be a runner credential bound to the requested execution, verified in the domain (`src/domain/vault/values.ts`), and the bound execution live: a run not terminal or ended within the grace, a connect's attempt row present and unexpired (`src/runnerauth/bound-execution.ts`); a clockless token binds only a run (`bindsARun`); a composed `authorizeExecutionValuesRead` decides whose credential it is, and the bound execution must still be live after it; every other caller is PERMISSION_DENIED, never answered redacted. A run's values are its source manifest's entries, each named vault checked again (a My vault only for its person, `can_use` for the run's person or the recorded attacher), a tool's login only while the tool is at the login's address; deleting: the purge's quiesce stage terminates the organization's runs and deletes its connect attempts, so no credential stays bound to a live execution there) |

## 4. OAuthApp (`src/domain/oauthapp/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| OAuthAppCommandController.apply | none | chain-with-Authorize |
| OAuthAppCommandController.create | config: can_create_oauth_app on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| OAuthAppCommandController.update | config: can_edit on oauth_app (field metadata.id), error_msg yes | chain-with-Authorize |
| OAuthAppCommandController.delete | config: can_delete on oauth_app (field resource_id), error_msg yes | chain-with-Authorize |
| OAuthAppQueryController.get | config: can_view on oauth_app (field value), error_msg yes | chain-with-Authorize |
| OAuthAppQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy; response redacted) |
| OAuthAppQueryController.listByOrg | config: can_view on organization (field org), error_msg yes | chain-with-Authorize (a composed ListReadScope narrows to the apps the caller may view) |

## 6. Agent (`src/domain/agent/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| AgentCommandController.apply | none | chain-with-Authorize |
| AgentCommandController.create | config: can_create_agent on organization (field metadata.org), error_msg yes | chain-with-Authorize (`can_create_agent` is the organization's admins, and its members while its policy "Members can create agents" is on; guard: RequireChildOrgsAuthority — a create at visibility_child_orgs also needs `can_manage_child_orgs` on the organization, so sharing with child organizations stays an admin's act) |
| AgentCommandController.update | config: can_edit on agent (field metadata.id), error_msg yes | chain-with-Authorize |
| AgentCommandController.updateVisibility | config: can_manage_audience on agent (field resource_id), error_msg yes | chain-with-Authorize (guard: RequireChildOrgsAuthority — a change to visibility_child_orgs also needs `can_manage_child_orgs` on the agent's organization) |
| AgentCommandController.delete | config: can_delete on agent (field value), error_msg yes | chain-with-Authorize |
| AgentCommandController.tagVersion | config: can_edit on agent (field agent_id), error_msg yes | chain-with-Authorize (guard: GuardPluginManaged — a plugin-managed agent's tags are its plugin's) |
| AgentQueryController.get | config: can_view on agent (field value), error_msg yes | chain-with-Authorize |
| AgentQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy; the ladder is LoadAgentByReference, the shared version ladder, and an archived version shares the head's id) |
| AgentQueryController.listVersions | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedAgent — can_view on the resolved id) |
| AgentQueryController.getVersion | config: can_view on agent (field agent_id), error_msg yes | direct: authorizeDirect, then live-then-audit version read. The runner's read of the version a turn recorded goes out under the run's own credential, so it asks what `get` asks |

## 8. Session (`src/domain/session/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| SessionCommandController.apply | none | chain-with-Authorize |
| SessionCommandController.create | config: can_create_session on organization (field metadata.org), error_msg yes | chain-with-Authorize (plus the AuthorizeRunTarget mid-chain can_execute on the agent spec.agent_ref names, by the id ResolveSessionAgent pinned right before it; none for the built-in assistant. `apply` routes here on the create arm.) |
| SessionCommandController.update | config: can_edit on session (field metadata.id), error_msg yes | chain-with-Authorize (plus the AuthorizeRunTarget mid-chain can_execute on the pinned agent when the update introduces or changes it, after ValidateReferences and ResolveSessionAgent; an unchanged agent is not re-asked, since every turn asks) |
| SessionCommandController.updateSubject | config: can_edit on session (field id), error_msg yes | direct: field-level read-modify-write (ports Go update_subject.go); authorizeDirect AFTER the load — the Java load-before-authorize order (#224) |
| SessionCommandController.delete | config: can_delete on session (field value), error_msg yes | chain-with-Authorize |
| SessionQueryController.get | config: can_view on session (field value), error_msg yes | chain-with-Authorize |
| SessionQueryController.list | is_skip_authorization | chain-with-Authorize (the request org through the list index, paged; driver: ListReadScope — a composed scope narrows each batch to the caller's authorized rows; the guest cookie rule is driver-internal) |
| SessionQueryController.listByAgent | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows; deleting: bindListReadScope) |
| SessionQueryController.listByChannel | is_skip_authorization | chain-with-Authorize (guard: AuthorizeChannelAccess — can_view on the agent_channel before any session work, the Java two-stage shape; driver: ListReadScope — a composed scope narrows to the caller's authorized rows; deleting: AuthorizeChannelAccess) |

## 9. AgentShare (`src/domain/agentshare/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| AgentShareCommandController.apply | none | chain-with-Authorize |
| AgentShareCommandController.create | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — can_manage_audience on the referenced agent, then can_create_agent_share on the share's organization; the resolve step refuses an agent outside that organization before either is asked) |
| AgentShareCommandController.update | config: can_edit on agent_share (field metadata.id), error_msg yes | chain-with-Authorize |
| AgentShareCommandController.rotateShareLink | config: can_edit on agent_share (field resource_id), error_msg yes | chain-with-Authorize |
| AgentShareCommandController.delete | config: can_delete on agent_share (field value), error_msg yes | chain-with-Authorize |
| AgentShareQueryController.get | config: can_view on agent_share (field value), error_msg yes | chain-with-Authorize |
| AgentShareQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy) |
| AgentShareQueryController.getByAgent | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |
| AgentShareQueryController.list | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |
| AgentShareQueryController.getSharedProfile | is_public | chain-with-Authorize (the public share-link read; the step's is_public arm skips the Authorizer) |
| AgentShareQueryController.getSharedProfileForMember | is_skip_authorization | chain-with-Authorize (guard: AuthorizeMemberAudience — can_view on the loaded share's organization, after the share loads by the id the link carries, which names no organization; a non-member hears the same NOT_FOUND as a missing share, the proto's contract; deleting: loadLinkedShare) |

## 10. AgentChannel (`src/domain/agentchannel/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| AgentChannelCommandController.apply | none | chain-with-Authorize |
| AgentChannelCommandController.create | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — can_manage_audience on the referenced agent ResolveChannelDefaults stashed) |
| AgentChannelCommandController.update | config: can_edit on agent_channel (field metadata.id), error_msg yes | chain-with-Authorize |
| AgentChannelCommandController.initiateInstall | config: can_edit on agent_channel (field resource_id), error_msg yes | direct: `authorizeDirect` AFTER the load (missing ids answer NOT_FOUND for everyone), then refuse FAILED_PRECONDITION on the storing edition or delegate to `drivers.channelRuntime` |
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
| ChannelMessageCommandController.sendMessage | is_skip_authorization | direct (by design: the OSS handler is a stub that refuses FAILED_PRECONDITION and touches no row — proactive messaging is unavailable here; guard: refuseBoundElsewhere — a credential bound to one organization names no other to the composed runtime (`src/pipeline/steps/refuse-bound-elsewhere.ts`)) |
| ChannelMessageQueryController.listTemplates | is_skip_authorization | direct (by design: the OSS handler is a stub that refuses FAILED_PRECONDITION and touches no row; guard: refuseBoundElsewhere — as sendMessage) |
| ChannelMessageQueryController.listMessagingChannels | is_skip_authorization | direct (by design: the OSS handler answers an empty list and touches no row; deleting: inert, the stub touches no row) |

## 12. ChannelConversation (`src/domain/agentchannel/conversation.ts`)

The conversation surface is a cloud capability; OSS serves edition stubs, all direct.

| Method | Annotation | Handler |
|---|---|---|
| ChannelConversationQueryController.listConversations | is_skip_authorization | direct (by design: the OSS handler answers an empty list and touches no row; guard: refuseBoundElsewhere — as sendMessage) |
| ChannelConversationQueryController.getConversation | config: can_view on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — answers NOT_FOUND unconditionally (no load-then-miss probing) |
| ChannelConversationQueryController.getTimeline | config: can_view on agent_channel (field agent_channel_id), error_msg yes | direct: returns an empty timeline |
| ChannelConversationQueryController.getMediaDownloadUrl | config: can_view on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — byte-pinned uniform NOT_FOUND miss (a prober cannot learn which items exist) |
| ChannelConversationCommandController.reply | config: can_participate on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — refuses FAILED_PRECONDITION (participation unavailable) |
| ChannelConversationCommandController.takeOver | config: can_participate on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — refuses FAILED_PRECONDITION |
| ChannelConversationCommandController.handBack | config: can_participate on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — refuses FAILED_PRECONDITION |
| ChannelConversationCommandController.clearAttention | config: can_participate on agent_channel (field agent_channel_id), error_msg yes | direct: OSS stub — refuses FAILED_PRECONDITION |
| ChannelConversationCommandController.escalate | is_skip_authorization | direct (by design: the OSS handler is a stub that refuses FAILED_PRECONDITION and touches no row; deleting: inert, the stub touches no row) |

## 13. ChannelApp (`src/domain/channelapp/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| ChannelAppCommandController.apply | none | chain-with-Authorize |
| ChannelAppCommandController.create | config: can_create_channel_app on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| ChannelAppCommandController.update | config: can_edit on channel_app (field metadata.id), error_msg yes | chain-with-Authorize |
| ChannelAppCommandController.delete | config: can_delete on channel_app (field resource_id), error_msg yes | chain-with-Authorize |
| ChannelAppQueryController.get | config: can_view on channel_app (field value), error_msg yes | chain-with-Authorize |
| ChannelAppQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy; response redacted) |
| ChannelAppQueryController.listByOrg | config: can_view on organization (field org), error_msg yes | chain-with-Authorize (a composed ListReadScope narrows to the apps the caller may view) |

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
| ScheduleQueryController.listFires | config: can_view on schedule (field schedule_id), error_msg yes | chain-with-Authorize |

## 15. Memory (`src/domain/memory/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| MemoryCommandController.create | is_skip_authorization | chain-with-Authorize (guard: GuardMemoryCapture — decides WHO may capture, through the composed `RunnerCredentialProvider.authorizeMemoryCapture`: under the built-in posture an agent-bound runner's capture is admitted as the run's person with the run's session as the proved provenance and scoped to the run's organization, a connect-bound runner is refused, and a person's own create carries no capture credential and so no subject; every caller the provider does not classify must be a first-party human operator, the allow-list recall reads (`isFirstPartyHumanOperator`, `src/extensions/identity.ts`) — `src/pipeline/steps/guard-memory-capture.ts`, `src/runnerauth/built-in-runner-credential-provider.ts`; guard: AuthorizeResolvedTarget — decides WHERE, can_create_session on metadata.org for a wire caller, after ResolveMemoryDefaults and before the enablement check) |
| MemoryCommandController.update | config: can_edit on memory (field metadata.id), error_msg yes | chain-with-Authorize |
| MemoryCommandController.delete | config: can_delete on memory (field value), error_msg yes | chain-with-Authorize |
| MemoryCommandController.confirm | config: can_edit on memory (field value), error_msg yes | chain-with-Authorize (shared runTransition helper, own descriptor) |
| MemoryCommandController.reject | config: can_edit on memory (field value), error_msg yes | chain-with-Authorize (shared runTransition helper, own descriptor) |
| MemoryQueryController.get | config: can_view on memory (field value), error_msg yes | chain-with-Authorize |
| MemoryQueryController.list | is_skip_authorization | chain-with-Authorize (driver: ListReadScope — a composed scope narrows to the caller's authorized rows) |

## 16. Run (`src/domain/run/controller.ts` + lifecycle.ts, update-status.ts, submit-approval.ts, submit-file-decision.ts, usage.ts, artifacts.ts, subscribe.ts)

| Method | Annotation | Handler |
|---|---|---|
| RunCommandController.create | is_skip_authorization | chain-with-Authorize (guard: AuthorizeRunTarget — can_create_run_in on the session a turn continues, before anything about it is read; then guard: AuthorizeRunAgent — can_execute on the agent ResolveRunAgent stamped, the session's pinned agent or the new session_spec's agent_ref, none for the built-in assistant. The annotation cannot express either. Under the built-in posture every caller is checked as the person it acts for; guard: RefuseBoundElsewhere — a credential bound to one organization files no run in another (`src/pipeline/steps/refuse-bound-elsewhere.ts`; the run credential would be bound there).) |
| RunCommandController.update | config: can_edit on run (field metadata.id), error_msg yes | chain-with-Authorize |
| RunCommandController.updateStatus | config: can_edit on run (field run_id), error_msg yes | chain-with-Authorize (update-status.ts) |
| RunCommandController.submitApproval | config: can_edit on run (field run_id), error_msg yes | chain-with-Authorize (submit-approval.ts) |
| RunCommandController.submitFileDecision | config: can_edit on run (field run_id), error_msg yes | chain-with-Authorize (submit-file-decision.ts) |
| RunCommandController.cancel | config: can_edit on run (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| RunCommandController.terminate | config: can_edit on run (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| RunCommandController.recover | config: can_edit on run (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| RunCommandController.pause | config: can_edit on run (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| RunCommandController.resume | config: can_edit on run (field id), error_msg yes | chain-with-Authorize (lifecycle.ts, own descriptor) |
| RunCommandController.uploadAttachment | is_skip_authorization | direct (by design: a blob-store write whose returned storage_key is the capability token for the later create, which is where the run is authorized; deleting: inert, a blob write that names no organization and files no row; the run create that would name the stored key names its organization and is refused) |
| RunCommandController.delete | config: can_edit on run (field value), error_msg yes | chain-with-Authorize |
| RunQueryController.get | config: can_view on run (field value), error_msg yes | chain-with-Authorize |
| RunQueryController.list | is_skip_authorization | chain-with-Authorize (the request org through the list index, paged, phase filter per batch; driver: ListReadScope — a composed scope narrows each batch to the caller's authorized rows; the guest cookie rule is driver-internal) |
| RunQueryController.listBySession | is_skip_authorization | chain-with-Authorize (the session's runs through the list index's session key, whole; driver: ListReadScope — a composed scope narrows to the caller's authorized rows; the guest cookie rule is driver-internal; deleting: bindListReadScope) |
| RunQueryController.subscribe | config: can_view on run (field value), error_msg yes | direct: stream subscribe over broker (register-before-snapshot; server-stream generator cannot run inside the pipeline executor); authorizeDirect once at subscription start |
| RunQueryController.getArtifactDownloadUrl | config: can_view on run (field run_id), error_msg yes | direct: authorizeDirect, then key-prefix / attachment-membership ownership check, then time-limited URL mint |
| RunQueryController.getArtifactContent | config: can_view on run (field run_id), error_msg yes | direct: authorizeDirect, then key-prefix ownership check, CAS-blob integrity check, truncated bytes in response |
| RunQueryController.getRunUsageReport | config: can_view on run (field run_id), error_msg yes | chain-with-Authorize (usage.ts) |
| RunQueryController.getSessionUsageReport | config: can_view on session (field session_id), error_msg yes | chain-with-Authorize (usage.ts) |
| RunQueryController.getAgentUsageReport | config: can_view on organization (field org), error_msg yes | chain-with-Authorize (usage.ts) |
| RunQueryController.getOrgUsageReport | config: can_view on organization (field org), error_msg yes | chain-with-Authorize (usage.ts) |
| RunQueryController.getRunSummary | is_skip_authorization | direct: the requested org's runs within the window, read through the list index, aggregated for the dashboard (driver: ListReadScope's restrict verb — a composed scope keeps the caller's authorized rows; none kept = the default instance) |

## 16a. Score (`src/domain/score/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| ScoreCommandController.create | is_skip_authorization | chain-with-Authorize (guard: GuardScoreSource — decides WHO may give the source: a person's feedback only from a first-party person, their sign-in or their own API key (`isFirstPartyHumanOperator`, `src/extensions/identity.ts`), a run-health check or an AI judge's verdict only from the server's own `internal` caller, anything else refused; guard: AuthorizeResolvedTarget — can_view on the run named in spec.run_id, before the run is read; the run must then be completed and in metadata.org, which the request names) |
| ScoreCommandController.update | config: can_edit on score (field metadata.id), error_msg yes | chain-with-Authorize (ValidateScoreUpdate refuses any score that is not a person's feedback, and any change but its value and comment) |
| ScoreCommandController.delete | config: can_delete on score (field value), error_msg yes | chain-with-Authorize (also reached through the in-process deleter by the run's delete and its session's cascade, `src/domain/score/cascade.ts`) |
| ScoreQueryController.get | config: can_view on score (field value), error_msg yes | chain-with-Authorize |
| ScoreQueryController.listByRun | config: can_view on run (field run_id), error_msg yes | chain-with-Authorize (the run's scores through the score list index, whole; a score's visibility is its run's, so no row is filtered) |
| ScoreQueryController.listBySession | config: can_view on session (field session_id), error_msg yes | chain-with-Authorize (the session's scores through the score list index, whole; a run's visibility is its session's, so no row is filtered) |

## 16b. Evaluator (`src/domain/evaluator/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| EvaluatorCommandController.create | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — can_edit on the agent named in spec.agent_id, before the agent is read; metadata.org must then be the agent's organization, which the request names; one evaluator per agent) |
| EvaluatorCommandController.update | config: can_edit on evaluator (field metadata.id), error_msg yes | chain-with-Authorize (ValidateEvaluatorUpdate keeps spec.agent_id; the write keeps the live row's spend and counts) |
| EvaluatorCommandController.delete | config: can_delete on evaluator (field value), error_msg yes | chain-with-Authorize (the agent's delete removes its evaluator through `src/domain/evaluator/cascade.ts`) |
| EvaluatorQueryController.get | config: can_view on evaluator (field value), error_msg yes | chain-with-Authorize |
| EvaluatorQueryController.getByAgent | config: can_view on agent (field agent_id), error_msg yes | chain-with-Authorize (the agent's evaluator through the evaluator list index; NOT_FOUND when grading is off) |

## 20. McpServer (`src/domain/mcpserver/controller.ts` + connect.ts, start-connect.ts, disconnect-oauth.ts, get-oauth-grant-status.ts)

| Method | Annotation | Handler |
|---|---|---|
| McpServerCommandController.apply | none | chain-with-Authorize |
| McpServerCommandController.create | config: can_create_mcp_server on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| McpServerCommandController.update | config: can_edit on mcp_server (field metadata.id), error_msg yes | chain-with-Authorize |
| McpServerCommandController.updateVisibility | config: can_manage_audience on mcp_server (field resource_id), error_msg yes | chain-with-Authorize |
| McpServerCommandController.delete | config: can_delete on mcp_server (field resource_id), error_msg yes | chain-with-Authorize |
| McpServerCommandController.connect | config: can_connect on mcp_server (field mcp_server_id), error_msg yes | direct: blocking connect flow over the engine seam (the connect attempt, the runner credential's mint, runner workflow start); authorizeDirect AFTER the load (#224). The attempt records the caller, and the connect token, under the built-in posture, admits the runner as that caller for the values fetch (`src/domain/mcpserver/connect-attempt.ts`; `src/runnerauth/bound-execution.ts` `mcp-connect`); a `run_id` (the runner's backfill) is accepted only from a runner credential bound to that live run in the connect's organization, the values fetch's own gate; the discovery's McpServer read rides the runner's own credential, an organization admin's key under the chart's install, whom the model makes an owner of every McpServer in the organization; guard: refuseBoundElsewhere — a credential bound to one organization connects in no other (its vault, grant and connect attempt are that organization's; `src/pipeline/steps/refuse-bound-elsewhere.ts`). |
| McpServerCommandController.startConnect | config: can_connect on mcp_server (field mcp_server_id), error_msg yes | direct: async connect lane over the engine seam; authorizeDirect AFTER the load (#224; guard: refuseBoundElsewhere — as connect, through the same prepareConnect.) |
| McpServerCommandController.disconnectOAuth | config: can_connect on mcp_server (field resource_id), error_msg yes | direct: removes the sign-in saved at the server's address from the caller's own My vault (a pasted login stays); authorizeDirect after input validation (guard: refuseBoundElsewhere — a credential bound to one organization removes no login in another.) |
| McpServerQueryController.get | config: can_view on mcp_server (field value), error_msg yes | chain-with-Authorize |
| McpServerQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy; before EnrichOAuthStatus) |
| McpServerQueryController.getOAuthGrantStatus | config: can_view on mcp_server (field resource_id), error_msg yes | direct: authorizeDirect after input validation, then the connection at the server's address in the caller's own My vault (metadata only, never the token); guard: refuseBoundElsewhere — a credential bound to one organization reads no login in another. |

## 21. Skill (`src/domain/skill/controller.ts` + push.ts)

| Method | Annotation | Handler |
|---|---|---|
| SkillCommandController.push | config: can_create_skill on organization (field org), error_msg yes | chain-with-Authorize |
| SkillCommandController.createArtifactUploadUrl | config: can_create_skill on organization (field org), error_msg yes | chain-with-Authorize |
| SkillCommandController.pushFromRunArtifact | config: can_create_skill on organization (field org), error_msg yes | chain-with-Authorize BY DELEGATION: the handler validates the storage-key ownership prefix directly, downloads the run artifact, then calls the shared push pipeline WITH ITS OWN method descriptor (the runLifecyclePipeline pattern — the pipeline's authorizing descriptor is a caller-supplied parameter), so this method's own annotation is the one evaluated. |
| SkillCommandController.updateVisibility | config: can_manage_audience on skill (field resource_id), error_msg yes | chain-with-Authorize |
| SkillCommandController.delete | config: can_delete on skill (field value), error_msg yes | chain-with-Authorize |
| SkillQueryController.get | config: can_view on skill (field value), error_msg yes | chain-with-Authorize |
| SkillQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedTarget — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy; the ladder is LoadSkillByReference) |
| SkillQueryController.getArtifact | is_skip_authorization | chain-with-Authorize (by design: the artifact key is a content hash — unguessable, deliberately immutable (a deleted skill's artifact keeps working by contract) and possibly shared by several skills — so the key itself is the capability; the way to learn a private skill's key is the skill row, whose reads are authorized; deleting: inert, a content-addressed archive read by its hash, no organization's row) |
| SkillQueryController.getArtifactDownloadUrl | is_skip_authorization | chain-with-Authorize (by design: the same content-hash capability as getArtifact; deleting: inert, a content-addressed archive read by its hash, no organization's row) |
| SkillQueryController.listVersions | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedSkill — can_view on the resolved id, the Java handler's check) |

## 21a. Plugin (`src/domain/plugin/controller.ts` + push.ts)

| Method | Annotation | Handler |
|---|---|---|
| PluginCommandController.push | config: can_create_plugin on organization (field org), error_msg yes | chain-with-Authorize (two chains over one context, plan then install; the plan chain additionally pre-authorises the caller for every member kind's create permission — can_create_skill, can_create_agent — before any write, and each member's own chain evaluates it again in-process as the caller) |
| PluginCommandController.createArtifactUploadUrl | config: can_create_plugin on organization (field org), error_msg yes | chain-with-Authorize |
| PluginCommandController.updateVisibility | config: can_manage_audience on plugin (field resource_id), error_msg yes | chain-with-Authorize (the fan-out to members rides each member kind's own updateVisibility chain in-process as the caller) |
| PluginCommandController.delete | config: can_delete on plugin (field value), error_msg yes | chain-with-Authorize (members are deleted through their own delete chains in-process as the caller) |
| PluginQueryController.get | config: can_view on plugin (field value), error_msg yes | chain-with-Authorize |
| PluginQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedPlugin — the loaded row authorized exactly as `get` is: can_view with the get annotation's copy) |
| PluginQueryController.listMembers | config: can_view on plugin (field value), error_msg yes | chain-with-Authorize |
| PluginQueryController.listVersions | is_skip_authorization | chain-with-Authorize (guard: AuthorizeResolvedPlugin — can_view on the resolved id) |
| PluginQueryController.getArtifact | is_skip_authorization | chain-with-Authorize (by design: the archive key is a content hash, unguessable and immutable, so the key itself is the capability, as for SkillQueryController.getArtifact; the way to learn a private plugin's key is the plugin row, whose reads are authorized; a key outside the plugin store's `plugins/` prefix is not found, so this lane never reads another kind's archive on the shared driver; deleting: inert, a content-addressed archive read by its hash, no organization's row) |
| PluginQueryController.getArtifactDownloadUrl | is_skip_authorization | chain-with-Authorize (by design: the same content-hash capability as getArtifact; the OSS transfer lane serves `plugins/` keys beside `skills/` ones; deleting: inert, a content-addressed archive read by its hash, no organization's row) |

## 23. Search (`src/query/search/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| SearchService.search | is_skip_authorization | direct: CQRS read over the search query store, cross-aggregate, no api_resource_kind option (driver: ListReadScope — a composed scope narrows to the caller's authorized rows, fed as a per-effective-kind authorized-id allowlist into the engine query on every request shape) |

## 24. Activity (`src/query/activity/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| ActivityQueryController.listRecentActivity | is_skip_authorization | direct: CQRS recents read of the request org's sessions through the list index (driver: ListReadScope's restrict verb — a composed scope keeps the caller's authorized rows) |

## 25. GitHub (`src/domain/github/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| GitHubQueryController.listRepositories | config: can_create_vault on organization (field org), error_msg yes | direct: authorizeDirect, then a server-side GitHub read with the caller's own github.com connection from My vault; FAILED_PRECONDITION without one |
| GitHubQueryController.searchRepositories | config: can_create_vault on organization (field org), error_msg yes | direct: as listRepositories |
| GitHubQueryController.listBranches | config: can_create_vault on organization (field org), error_msg yes | direct: as listRepositories |
| GitHubQueryController.getTree | config: can_create_vault on organization (field org), error_msg yes | direct: as listRepositories |
| GitHubQueryController.getFileContent | config: can_create_vault on organization (field org), error_msg yes | direct: as listRepositories |

## 26. Platform (`src/domain/platform/controller.ts`)

| Method | Annotation | Handler |
|---|---|---|
| PlatformQueryController.getServerInfo | is_public | direct: static edition + version read, and the resolved authentication posture |
| PlatformQueryController.getLicenseStatus | is_skip_authorization | direct (by design: the state of the license this server holds, answered by the composed `licenseStatus` driver (`src/extensions/license-status.ts`) or the built-in `absent` provider when none is registered, with `checked_at` stamped from the same instant the provider evaluated against. Authenticated, no permission: the answer feeds the console banner every signed-in person sees, and it is not public because a license names its customer. Open source and the cloud always answer `absent`; deleting: inert, the server's license, no organization's row) |
| PlatformQueryController.getRunnerBootstrapConfig | is_skip_authorization | direct (by design: publishes the Temporal coordinates for embedded runners; token fields empty on OSS — the runner's process credential is the operator's API key it already holds, and its per-run credential arrives in the workflow input, not here; deleting: inert, the server's engine coordinates, no organization's row) |
| PlatformQueryController.getRunnerScopedToken | is_skip_authorization | direct (driver: RunnerCredentialProvider — mints the execution-scoped runner token, fail-soft (empty id, keyless service, or mint error answer the not-minted shape). Under trusted-local the token is the ExecutionContext decrypt-lane discriminator and nothing more, minted for any caller naming a run. Under the built-in authorization posture the same token is also an identity: the runner-subject verifier (`src/runnerauth/runner-subject-verifier.ts`, composed between `apikey` and `oidc`) admits its bearer as the human whose run it is, for as long as the run lives — so there the exchange is a MINT GATE: the built-in provider's `exchangeScopedToken` (`src/runnerauth/built-in-runner-credential-provider.ts`) mints the run credential for the run's own person only; a missing run is NOT_FOUND with the load-first copy, anyone else is PERMISSION_DENIED, and so is a caller bound to another organization than the run's. The verifier admits the run credential's person bound to the run's organization (`CallerIdentity.boundOrg`), so a credential limited to one organization never widens itself through a run. Runs receive their credential from the dispatch itself (the agent-run engine client puts `execution_context_token` on the workflow input); the exchange is the runner's fallback; deleting: inert, the credential it mints is bound to the run's organization, where every request then answers not-found, and the purge terminates the run) |

## 27. IdentityAccount (`src/domain/identityaccount/controller.ts`)

The open-source identity domain (accounts and organization roles landed with it), served over the generic store; the cloud edition serves the same domain over its own table. Registered after Organization. Three lanes are skips: `create` is the platform's own pipelines' RPC (the hook that JIT-provisions an OIDC subject and the trusted-local boot ensure are in-process; a person never creates an account row directly), `provisionMyAccount` and `whoAmI` act on the caller's own account and nothing else. The three federated RPCs and `getByExternalSub` need a composed identity federation and answer UNIMPLEMENTED without one, before the annotation is evaluated (the capability is consulted first, `domain/identityaccount/controller.ts` `federated`).

| Method | Annotation | Handler |
|---|---|---|
| IdentityAccountCommandController.create | is_skip_authorization | chain-with-Authorize (guard: guardInternalRpc — before the chain, the platform's own pipelines only (`isPlatformPipelineCaller`: a machine account, the internal class, or any request that entered in-process); a wire person is refused PERMISSION_DENIED with the domain's copy. There is no row yet to hold a permission on, and the account's roles are written by the create chain itself) |
| IdentityAccountCommandController.update | config: can_edit on identity_account (field metadata.id), error_msg yes | chain-with-Authorize |
| IdentityAccountCommandController.delete | config: can_delete on identity_account (field value), error_msg yes | chain-with-Authorize |
| IdentityAccountCommandController.createFederatedAccount | config: can_create_identity_account on organization (field org), error_msg yes | direct: authorizeDirect, then the composed federation (UNIMPLEMENTED without one) |
| IdentityAccountCommandController.updateFederatedAccount | config: can_create_identity_account on organization (field org), error_msg yes | direct: authorizeDirect, then the composed federation |
| IdentityAccountCommandController.deprovisionFederatedAccount | config: can_create_identity_account on organization (field org), error_msg yes | direct: authorizeDirect, then the composed federation |
| IdentityAccountCommandController.provisionMyAccount | is_skip_authorization | direct (by design: the caller provisions their OWN account from the identity-provider subject their token carries — a token with no such subject is UNAUTHENTICATED; a caller the platform's own sign-in did not vouch for (another lane's account, or a class other than `user`) is PERMISSION_DENIED before the subject is read, `mayProvisionDirectAccount` in domain/identityaccount/resolve.ts; the row that results is the caller's, and the composed post-persist gates run on every call; deleting: scanOrganizations) |
| IdentityAccountQueryController.get | config: can_view on identity_account (field value), error_msg yes | chain-with-Authorize |
| IdentityAccountQueryController.whoAmI | is_skip_authorization | direct (by design: answers the caller's own account, resolved from their identity by id then by subject; no other row is reachable through this lane; deleting: inert, the caller's own account, which belongs to no organization) |
| IdentityAccountQueryController.getByEmail | config: can_view on identity_account (field value), error_msg yes | direct: lookup first, then authorizeDirect on the FOUND id as the target override (the annotation's `value` is the email) |
| IdentityAccountQueryController.getByIdpId | config: can_view on identity_account (field value), error_msg yes | direct: lookup first, then authorizeDirect on the FOUND id as the target override |
| IdentityAccountQueryController.getByExternalSub | config: can_create_identity_account on organization (field org), error_msg yes | direct: authorizeDirect, then the composed federation |
| IdentityAccountQueryController.getActorInfo | config: can_view on identity_account (field value), error_msg yes | chain-with-Authorize |

## 28. IamPolicy (`src/domain/iampolicy/controller.ts`)

The IamPolicy row half in open source: the grant path (`create`, `delete`, `revokeOrgAccess`) is annotation-driven on the policy's RESOURCE (`resource_kind_path`), and a change to an organization's `owner` role also needs `can_assign_roles` there (owner is assigned by owners; an admin grants every role up to admin), the three system RPCs admit the platform's own pipelines only before their chain, and the three query lanes that IAM cannot authorize with IAM (it would recurse) are skips whose trust is authentication plus the principal-trust rule. `checkMyPermission` is the console's one permission question. Every kind string that comes off the wire passes the domain's wire refusals (`src/domain/iampolicy/wire-refusals.ts`) before position 1: a kind that names nothing names no authorization target, so it is INVALID_ARGUMENT in every edition. `create` grants to people and teams only (`USER_GRANT_PRINCIPAL_KINDS`, `src/domain/iampolicy/constants.ts`): a team only as `team:<id>#member` on the roles its kind's `team_grantable_roles` lists (none on `organization`, so open source grants a team nothing), with the team's existence and organization checked at the `iam-policy-create:pre-side-effect-gate` slot. With no driver composed, the rows are written by the built-in role lifecycle and the membership rules (`src/domain/iampolicy/role-lifecycle.ts`, `src/domain/iampolicy/membership.ts`).

| Method | Annotation | Handler |
|---|---|---|
| IamPolicyCommandController.create | config: can_grant_access on resource_kind_path resource.kind (field resource.id), error_msg yes | chain-with-Authorize (then AuthorizeOwnerAssignment: granting `owner` on an organization also asks `can_assign_roles` there, its owners, with the owner copy; steps.ts) |
| IamPolicyCommandController.delete | config: can_grant_access on resource_kind_path resource.kind (field resource.id), error_msg yes | chain-with-Authorize (then AuthorizeOwnerAssignment for a revoke of `owner` on an organization, and KeepOneOwner: the organization's last owner is FAILED_PRECONDITION; steps.ts) |
| IamPolicyCommandController.bootstrapPolicy | config: can_bootstrap_iam on platform (resource_id stigmer), error_msg yes | chain-with-Authorize (guardSystemRpc before the chain: the platform's own pipelines only, `isPlatformPipelineCaller`; a wire person is refused with the annotation's own copy, because under the permissive Authorizer the annotation alone would admit anyone) |
| IamPolicyCommandController.cleanupResourcePolicies | config: can_bootstrap_iam on platform (resource_id stigmer), error_msg yes | chain-with-Authorize (guardSystemRpc before the chain, as above) |
| IamPolicyCommandController.revokeOrgAccess | config: can_grant_access on organization (field org), error_msg yes | chain-with-Authorize (then AuthorizeOwnerAssignment when the account holds `owner` there, and KeepOneOwner; the system twin runs neither; steps.ts) |
| IamPolicyCommandController.bootstrapRevokeOrgAccess | config: can_bootstrap_iam on platform (resource_id stigmer), error_msg yes | chain-with-Authorize (guardSystemRpc before the chain, as above) |
| IamPolicyQueryController.get | config: can_view_access on the loaded row's resource (no static kind or field; the target is the policy's own resource), error_msg yes | direct: load first, then authorizeDirect with the row's resource kind and id as the target override |
| IamPolicyQueryController.checkMyPermission | is_skip_authorization | direct (by design: asks about the CALLER themself — an authenticated caller's own standing on a named resource, answered as a boolean; an unknown permission name or kind is INVALID_ARGUMENT before any evaluation, and IAM authorizing IAM would recurse; guard: bindingReaches — with contextual policies the question goes to the query engine, so a bound caller's question about a resource outside its organization answers `is_authorized: false` first; without them the composed, bound Authorizer answers) |
| IamPolicyQueryController.checkAuthorization | is_skip_authorization | direct (guard: enforcePrincipalTrust — the platform's own pipelines (machine, internal) may ask about any principal; a person only about their own account, PERMISSION_DENIED otherwise; then the composed query engine; guard: bindingReaches — for a caller whose credential is bound to one organization, a resource outside it answers `is_authorized: false` without asking the engine, which takes no caller (`src/authorization/credential-binding.ts`)) |
| IamPolicyQueryController.listAuthorizedResourceIds | is_skip_authorization | direct (guard: enforcePrincipalTrust — as checkAuthorization; the lane names no resource, so trust is on the principal; driver: CredentialBinding — a bound caller's ids are narrowed to the ones its credential may reach) |
| IamPolicyQueryController.listAuthorizedPrincipalIds | config: can_view_access on resource_kind_path resource.kind (field resource.id), error_msg yes | direct: authorizeDirect |
| IamPolicyQueryController.listResourceAccessByPrincipal | config: can_view_access on resource_kind_path resource.kind (field resource.id), error_msg yes | direct: authorizeDirect |
| IamPolicyQueryController.getPrincipalResourceRoles | config: can_view_access on resource_kind_path resource.kind (field resource.id), error_msg yes | direct: authorizeDirect |
| IamPolicyQueryController.getPrincipalsCount | config: can_view_access on organization (field org), error_msg yes | direct: authorizeDirect |

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

These 24 methods declare a `(ai.stigmer.commons.rpc.config)` annotation and run no pipeline. Each is dispositioned below, by enforcement state:

**Evaluated via `authorizeDirect` (17)** — the exported Authorize evaluation, called by the handler itself at its own position (each table row notes load-first `#224` order where it applies):

- Agent: getVersion
- Session: updateSubject
- AgentChannel: initiateInstall, completeInstall (the OSS lane enforces after its load, so every composed runtime receives a pre-authorized caller)
- Run: subscribe, getArtifactDownloadUrl, getArtifactContent
- Vault: createConnectLink
- McpServer: connect, startConnect, disconnectOAuth, getOAuthGrantStatus
- GitHub: listRepositories, searchRepositories, listBranches, getTree, getFileContent

**Enforced by the composed channel runtime (7)** — this server's handlers delegate whole-method to `drivers.channelRuntime`; the OSS default serves the byte-pinned refusal/stub postures with nothing to protect, and the cloud runtime's served arms gate on the composed Authorizer as their first act (its own suite pins the deny paths):

- ChannelConversation: getConversation, getTimeline, getMediaDownloadUrl, reply, takeOver, handBack, clearAttention

**Conformance coverage (2026-09-04; contract-only since 2026-09-10)** — `test/conformance/src/suites/direct-handler-authorization.conformance.test.ts` pins the outsider contract of the evaluated methods on every multi-tenant target. One of its arms pins a choice the retired Java edition made differently, and is plain contract now: unknown ids on the authorize-first family answer the uniform NOT_FOUND (Java answered PERMISSION_DENIED). The unknown-id arm observes every lane before asserting so a divergence shows as the whole table, not the first lane. While both editions served behind the one `cloud` target, the suite selected which contract to assert — first through the `STIGMER_CONFORMANCE_DIRECT_HANDLER_AUTHZ_CONTRACT` knob (stigmer#972), then from the implementation the environment declared (stigmer#1014); the selector retired with the Java service (stigmer#1023).

## Descriptor mismatches found

- `SkillCommandController.pushFromRunArtifact` delegates into the shared push pipeline. This WAS a descriptor mismatch (the delegated pipeline hardcoded `method.push`); the inventory pass caught it and the pipeline now takes the authorizing descriptor from its caller, so each of the two RPCs authorizes under its own annotation. Recorded here because the trap shape — shared pipeline, hardcoded descriptor — is the one thing a future delegating handler must not reintroduce.

No other mismatch exists: every other `newAuthorizeStep` call site passes the descriptor of the RPC it serves, including all five lifecycle RPCs (shared builder, per-method descriptor) and memory confirm/reject (shared transition helper, per-method descriptor).

## Unregistered proto methods and services

- Entire proto service families exist under `apis/ai/stigmer/` that this server does not register at all. Their annotations are declared in their protos for the editions that serve them:
  - Billing (command + query; an organization's own billing RPCs on `organization` by `org`, the credit mutations `adjustCredits` and `grantCredits` on the static `platform:stigmer` target with `can_manage_credits`, which an operator or a credit issuer holds and an organization's owner never does);
  - the three `billing` envelope kinds Plan, Subscription and License (command + query each; `Plan` writes and every `License` RPC on the static `platform:stigmer` target with `can_manage_plans` and `can_issue_license`, `Plan` reads `is_skip_authorization` because the kind has no authorization scope and the catalog is readable by every signed-in caller, `Subscription` RPCs on `organization` with the billing permissions by `org`);
  - CursorAccount (command + query) and ProviderStanding (query);
  - IdentityProvider (command + query; `apply` carries no annotation: its handler asks `can_create_idp` on the organization the provider names, then runs `create` or `update` with its own annotation; `create` on `organization` with `can_create_idp` by `metadata.org`, `get`, `update` and `delete` on the provider with `can_view`, `can_edit` and `can_delete`, `listByOrg` on `organization` with `can_view` by `org` and then narrowed by the list read scope to the providers the caller may view, `getByReference` an `is_skip_authorization` lane whose handler resolves the slug and authorizes a found row as `get` does, and answers a missing slug with `get`'s denial unless the caller holds `can_create_idp` on the organization, so only someone who could see the provider learns it is absent, and `getSsoProvider` `is_public`, the login page's tokenless SSO discovery, which answers only the safe projection and never reads the caller; the kind is `enterprise`);
  - Invitation (command + query; `create` on `organization` with `can_grant_access` by `metadata.org`, `get` on the invitation with `can_view` by `value`, `revoke` on the invitation with `can_edit` by `value`, asked before the row is read, as `get` asks `can_view`, `listByOrg` on `organization` with `can_view_access` by `org`, `redeem` an `is_skip_authorization` lane whose token is the authorization and which a person alone may call, and `getByToken` `is_public`, the acceptance page's preview of the invitation its token names; the kind is `enterprise`);
  - Team (command + query; `create` on `organization` with `can_create_team` by `metadata.org`, `get`, `update` and `delete` on the team with `can_view`, `can_edit` and `can_delete`, `listByOrg` on `organization` with `can_view` by `org`, `getByReference` an `is_skip_authorization` lane whose handler resolves the slug and authorizes a found row as `get` does, and answers a missing slug with `get`'s denial unless the caller holds `can_view` on the organization; the kind is `enterprise`, and its membership is IamPolicy rows granted through the family below).
  - The hosted edition serves both Billing services natively in its own composition, where each RPC runs the Authorize step from its proto annotation like every other registered service.

## Non-RPC HTTP lanes

### modelRegistryLane (`src/transport/registry/lanes.ts`)

`GET /v1/proxy/model-registry` on the unified port. Unauthenticated by design, with the fixed registry CORS contract (allow-origin `*`, `Cache-Control: public, max-age=3600`; OPTIONS 204, other methods 405); serves from the domain-owned model-registry store (bundled document plus optional upstream refresh).

### skillTransferLane (`src/domain/skill/transfer/handler.ts`)

`PUT /v1/skill-artifacts/uploads/{ref}` and `GET /v1/skill-artifacts/{storage_key}` on the unified port. Deliberately URL-as-credential — the handler header documents this: neither route carries bearer auth, mirroring cloud's pre-signed R2 URLs. Minting an upload URL requires the same gRPC authorization as push (createArtifactUploadUrl's chain), and the slot it names is single-use and short-lived. A download URL is signed by the local skill driver and expires (`src/artifactstorage/url-signer.ts`: HMAC-SHA256 over the key, the expiry and the filename, under the server's download-URL key); it is handed out by authorized skill and plugin reads, and the GET route verifies it before reading, answering an unsigned, tampered or expired link the 404 a missing key gets. With both stores on buckets the lane holds a key no link was signed with and refuses every download.

### oauthClientDocumentLane (`src/transport/oauth-client/lane.ts`)

`GET /v1/oauth/client.json` on the unified port, present only when the port has a public `https` origin (`SKILL_TRANSFER_BASE_URL`). Unauthenticated by design: it is Stigmer's OAuth Client ID Metadata Document, which a login server fetches when a sign-in presents the document's URL as its client id (`src/domain/vault/sign-in/client-document.ts`). It names a public client and the deployment's redirect URIs, and holds nothing secret. GET/HEAD 200 with `Cache-Control: public, max-age=3600`; other methods 405.

### consoleLane (`src/transport/console/handler.ts`)

Static web-console assets on the unified port, present only when a console export is bundled or configured. GET/HEAD only; never claims `/v1/*` or service-shaped RPC paths. Unauthenticated static-asset serving plus a synthesized `/config.json`.

### Artifact HTTP file server (`src/artifactstorage/file-server.ts`)

A SECOND listener, not a unified-port lane: `GET /<storage_key>` on `127.0.0.1:ARTIFACT_HTTP_PORT` (unset: the unified port + 1, or ephemeral beside an ephemeral unified port; `src/boot/artifact-lane.ts`), started only when artifact storage is local, before the server reports SERVING; a lane that cannot bind fails the boot. Serves the exact bytes local artifact storage wrote, to a link that storage signed: the URL's signature and expiry are the credential (`src/artifactstorage/url-signer.ts`), checked before the disk is touched, and an unsigned, tampered, expired or re-named link is answered the 404 a missing key gets. The loopback bind is the default (0.0.0.0 inside the official container; the Helm chart exposes the lane through its artifacts host).

## Notes on the authorization chain

- (a) The interceptor-level protovalidate interceptor runs at position 3 of the chain (`src/pipeline/chain.ts`, in the order identity source → logging → protovalidate → apiresource), before any handler or pipeline — a malformed request answers INVALID_ARGUMENT before the Authorize step ever runs. The ordering is deliberate.
- (b) The in-process router transport (`src/boot/inprocess.ts`) runs the same chain except position 1, which stamps the `internal` caller class only that chain can mint (`src/pipeline/interceptors/auth.ts`, the in-process caller interceptor). The Authorize step returns immediately for `callerClass === "internal"`, so cross-domain in-process calls skip the authorization decision while still traversing validation, logging, and kind-tagging. The list lanes keep the same rule in their own shape (stigmer#1207): `restrictListByReadScope` (`src/extensions/list-read-scope.ts`) returns the org-narrowed rows for the `internal` class before any composed ListReadScope is consulted, so a server-internal list read — a composition's own in-process readers — sees what a trusted read sees (a run's and an MCP connect's vault lookups never list at all: they read the person's My vault through its name claim and named vaults by reference, `src/domain/vault/resolve.ts`); a caller propagated through the in-process header keeps its own class and is narrowed like a wire caller. The enumeration verb (`authorizedResourceIds`) has no helper in front of it and no in-process edge reaches it; its internal arm is the driver's.
- (c) The Temporal worker's status-merge activity (`src/temporal/agentexecution/activities.ts`) reaches the domain `updateStatus` through the in-process transport of note (b) — the `InProcessClients.executionStatusWriter` edge — so its writes carry the `internal` caller class and skip the authorization decision exactly like every other server-internal call. (Corrected 2026-09-05, stigmer#979: the activity previously called the domain function directly with `trustedLocalIdentity()`, the chassis's WIRE fallback — a `user`-class identity an enforcing Authorizer has no grant for, so on the cloud composition every runner failure left a hung, never-FAILED run. No server code constructs a `CallerIdentity` outside `pipeline/interceptors/auth.ts` any more.)
- (d) Methods with NO config annotation skip the authorizer by design (`authorize.ts`: no `config` option → the step returns before consulting the Authorizer), and every such method is visible in the tables above — the annotation column says `none`, `is_public`, or `is_skip_authorization`.
