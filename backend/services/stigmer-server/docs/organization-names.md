# Organization names

An organization is filed under a permanent id (`org_<ulid>`) that the server mints when it is made, and every resource it owns names it by that id in `metadata.org`. People name it by its slug: `org: acme` in a manifest, `--org acme` on the CLI, `acme` in a console URL. The serving chain turns every organization a request names into its id before authorization and the handler read the request, so everything past the edge compares and stores ids alone. A renamed organization's previous slug resolves too, until it expires (`RENAMED_SLUG_HOLD_MS`, `src/domain/organization/names.ts`).

This document is the inventory of which fields the resolver reads, one row per method the open-source server serves whose input names an organization. It is held equal to the rule by `src/pipeline/interceptors/__tests__/organization-names-inventory.test.ts`: a contract change that adds or moves an organization field fails that test with the row to write here. The rule is `src/pipeline/interceptors/organization-names.ts`; this document says it in words and lists what it answers. A composition's own services (the Cloud's billing families, for example) are resolved by the same rule; they are not listed because the open-source server does not serve them.

## The rule

- **Every field named `org` or ending `_org`, and every repeated `orgs`**, at any depth of the input: `metadata.org`, a top-level `org`, and the `org` of every reference in a spec. One spelling for an organization field is the contract's own rule (`docs/vocabulary.md`), so the name is the signal. A field that broke the rule (an `org` that names no organization) would appear here, and its review is this document's diff.
- **The field a method's authorization annotation names when its kind is `organization`**: an Organization's own id on `get`, `update`, `updatePolicies`, `delete` and `rename`. Marked `(annotation)`.
- **`ApiResourceRef.id` when the ref's kind is `organization`**: a policy grant on an organization, or one an organization holds. Marked `(kind organization)`.

What the resolver does with a value:

- a value shaped like an id (`org_` and 26 lowercase characters) passes untouched;
- any other value is looked up in the name table, and an organization's current slug, or a previous one that has not expired, becomes its id;
- a name nothing holds passes through unchanged, and authorization refuses it exactly as it refuses an organization the caller cannot see, so a caller never learns which names exist.

Serving requests only: an in-process call is server code, which passes the ids it read from storage. Content a person wrote that the server reads from something else is resolved where it is read: a plugin package's manifests at push (`resolveOrganizationNames`). Streams are not resolved; no streaming method takes an organization, which the inventory test holds.

Rows read `| Service.method | <field>, <field>, … |`.

## `ai.stigmer.activity.v1`

| Method | Organization fields |
|---|---|
| ActivityQueryController.listRecentActivity | `org` |

## `ai.stigmer.agentic.agent.v1`

| Method | Organization fields |
|---|---|
| AgentCommandController.apply | `metadata.org`, `spec.mcp_server_usages.mcp_server_ref.org`, `spec.skill_refs.org`, `spec.sub_agents.skill_refs.org`, `spec.hooks.plugin.org` |
| AgentCommandController.create | `metadata.org`, `spec.mcp_server_usages.mcp_server_ref.org`, `spec.skill_refs.org`, `spec.sub_agents.skill_refs.org`, `spec.hooks.plugin.org` |
| AgentCommandController.update | `metadata.org`, `spec.mcp_server_usages.mcp_server_ref.org`, `spec.skill_refs.org`, `spec.sub_agents.skill_refs.org`, `spec.hooks.plugin.org` |
| AgentQueryController.getByReference | `org` |
| AgentQueryController.listVersions | `org` |

## `ai.stigmer.agentic.agentchannel.v1`

| Method | Organization fields |
|---|---|
| AgentChannelCommandController.apply | `metadata.org`, `spec.agent_ref.org`, `spec.vaults.org`, `spec.app_ref.org` |
| AgentChannelCommandController.create | `metadata.org`, `spec.agent_ref.org`, `spec.vaults.org`, `spec.app_ref.org` |
| AgentChannelCommandController.update | `metadata.org`, `spec.agent_ref.org`, `spec.vaults.org`, `spec.app_ref.org` |
| AgentChannelQueryController.getByAgent | `org` |
| AgentChannelQueryController.getByReference | `org` |
| AgentChannelQueryController.list | `org` |
| ChannelConversationQueryController.listConversations | `org` |
| ChannelMessageCommandController.sendMessage | `org` |
| ChannelMessageQueryController.listTemplates | `org` |

## `ai.stigmer.agentic.run.v1`

| Method | Organization fields |
|---|---|
| RunCommandController.create | `metadata.org`, `spec.session_spec.agent_ref.org`, `spec.session_spec.mcp_server_usages.mcp_server_ref.org`, `spec.session_spec.skill_refs.org`, `spec.session_spec.vaults.org` |
| RunCommandController.update | `metadata.org`, `spec.session_spec.agent_ref.org`, `spec.session_spec.mcp_server_usages.mcp_server_ref.org`, `spec.session_spec.skill_refs.org`, `spec.session_spec.vaults.org` |
| RunQueryController.getAgentUsageReport | `org` |
| RunQueryController.getRunSummary | `org` |
| RunQueryController.getOrgUsageReport | `org` |
| RunQueryController.list | `org` |

## `ai.stigmer.agentic.agentshare.v1`

| Method | Organization fields |
|---|---|
| AgentShareCommandController.apply | `metadata.org`, `spec.agent_ref.org`, `spec.vaults.org` |
| AgentShareCommandController.create | `metadata.org`, `spec.agent_ref.org`, `spec.vaults.org` |
| AgentShareCommandController.update | `metadata.org`, `spec.agent_ref.org`, `spec.vaults.org` |
| AgentShareQueryController.getByAgent | `org` |
| AgentShareQueryController.getByReference | `org` |
| AgentShareQueryController.list | `org` |

## `ai.stigmer.agentic.channelapp.v1`

| Method | Organization fields |
|---|---|
| ChannelAppCommandController.apply | `metadata.org` |
| ChannelAppCommandController.create | `metadata.org` |
| ChannelAppCommandController.update | `metadata.org` |
| ChannelAppQueryController.getByReference | `org` |
| ChannelAppQueryController.listByOrg | `org` |

## `ai.stigmer.agentic.evaluator.v1`

| Method | Organization fields |
|---|---|
| EvaluatorCommandController.create | `metadata.org` |
| EvaluatorCommandController.update | `metadata.org` |

## `ai.stigmer.agentic.mcpserver.v1`

| Method | Organization fields |
|---|---|
| McpServerCommandController.apply | `metadata.org` |
| McpServerCommandController.connect | `org` |
| McpServerCommandController.create | `metadata.org` |
| McpServerCommandController.disconnectOAuth | `org` |
| McpServerCommandController.startConnect | `org` |
| McpServerCommandController.update | `metadata.org` |
| McpServerQueryController.getByReference | `org` |
| McpServerQueryController.getOAuthGrantStatus | `org` |

## `ai.stigmer.agentic.memory.v1`

| Method | Organization fields |
|---|---|
| MemoryCommandController.create | `metadata.org` |
| MemoryCommandController.update | `metadata.org` |
| MemoryQueryController.list | `org` |

## `ai.stigmer.agentic.plugin.v1`

| Method | Organization fields |
|---|---|
| PluginCommandController.createArtifactUploadUrl | `org` |
| PluginCommandController.push | `org` |
| PluginQueryController.getByReference | `org` |
| PluginQueryController.listVersions | `org` |

## `ai.stigmer.agentic.plugineval.v1`

| Method | Organization fields |
|---|---|
| PluginEvalCommandController.create | `metadata.org`, `spec.vaults.org` |

## `ai.stigmer.agentic.schedule.v1`

| Method | Organization fields |
|---|---|
| ScheduleCommandController.apply | `metadata.org`, `spec.agent.agent_ref.org`, `spec.agent.vaults.org` |
| ScheduleCommandController.create | `metadata.org`, `spec.agent.agent_ref.org`, `spec.agent.vaults.org` |
| ScheduleCommandController.update | `metadata.org`, `spec.agent.agent_ref.org`, `spec.agent.vaults.org` |
| ScheduleQueryController.getByAgent | `org` |
| ScheduleQueryController.getByReference | `org` |
| ScheduleQueryController.list | `org` |

## `ai.stigmer.agentic.score.v1`

| Method | Organization fields |
|---|---|
| ScoreCommandController.create | `metadata.org` |
| ScoreCommandController.update | `metadata.org` |

## `ai.stigmer.agentic.session.v1`

| Method | Organization fields |
|---|---|
| SessionCommandController.apply | `metadata.org`, `spec.agent_ref.org`, `spec.mcp_server_usages.mcp_server_ref.org`, `spec.skill_refs.org`, `spec.vaults.org` |
| SessionCommandController.create | `metadata.org`, `spec.agent_ref.org`, `spec.mcp_server_usages.mcp_server_ref.org`, `spec.skill_refs.org`, `spec.vaults.org` |
| SessionCommandController.update | `metadata.org`, `spec.agent_ref.org`, `spec.mcp_server_usages.mcp_server_ref.org`, `spec.skill_refs.org`, `spec.vaults.org` |
| SessionQueryController.list | `org` |

## `ai.stigmer.agentic.skill.v1`

| Method | Organization fields |
|---|---|
| SkillCommandController.createArtifactUploadUrl | `org` |
| SkillCommandController.push | `org` |
| SkillCommandController.pushFromRunArtifact | `org` |
| SkillQueryController.getByReference | `org` |
| SkillQueryController.listVersions | `org` |

## `ai.stigmer.agentic.vault.v1`

| Method | Organization fields |
|---|---|
| VaultCommandController.create | `metadata.org`, `spec.org` |
| VaultCommandController.createConnectLink | `org` |
| VaultCommandController.removeConnections | `vault.org` |
| VaultCommandController.removeSecrets | `vault.org` |
| VaultCommandController.setConnection | `vault.org` |
| VaultCommandController.setSecrets | `vault.org` |
| VaultCommandController.startSignIn | `vault.org` |
| VaultCommandController.update | `metadata.org`, `spec.org` |
| VaultQueryController.getByExternalId | `org` |
| VaultQueryController.getByReference | `org` |
| VaultQueryController.getMine | `org` |
| VaultQueryController.list | `org` |

## `ai.stigmer.iam.apikey.v1`

| Method | Organization fields |
|---|---|
| ApiKeyCommandController.create | `metadata.org`, `spec.bound_org` |
| ApiKeyCommandController.update | `metadata.org`, `spec.bound_org` |

## `ai.stigmer.iam.iampolicy.v1`

| Method | Organization fields |
|---|---|
| IamPolicyCommandController.bootstrapPolicy | `principal.id (kind organization)`, `resource.id (kind organization)` |
| IamPolicyCommandController.bootstrapRevokeOrgAccess | `org` |
| IamPolicyCommandController.cleanupResourcePolicies | `id (kind organization)` |
| IamPolicyCommandController.create | `principal.id (kind organization)`, `resource.id (kind organization)` |
| IamPolicyCommandController.delete | `principal.id (kind organization)`, `resource.id (kind organization)` |
| IamPolicyCommandController.revokeOrgAccess | `org` |
| IamPolicyQueryController.checkAuthorization | `policy.principal.id (kind organization)`, `policy.resource.id (kind organization)`, `contextual_policies.principal.id (kind organization)`, `contextual_policies.resource.id (kind organization)` |
| IamPolicyQueryController.checkMyPermission | `resource.id (kind organization)`, `contextual_policies.principal.id (kind organization)`, `contextual_policies.resource.id (kind organization)` |
| IamPolicyQueryController.getPrincipalResourceRoles | `principal.id (kind organization)`, `resource.id (kind organization)` |
| IamPolicyQueryController.getPrincipalsCount | `org` |
| IamPolicyQueryController.listAuthorizedPrincipalIds | `resource.id (kind organization)`, `contextual_policies.principal.id (kind organization)`, `contextual_policies.resource.id (kind organization)` |
| IamPolicyQueryController.listAuthorizedResourceIds | `principal.id (kind organization)`, `contextual_policies.principal.id (kind organization)`, `contextual_policies.resource.id (kind organization)` |
| IamPolicyQueryController.listResourceAccessByPrincipal | `resource.id (kind organization)` |

## `ai.stigmer.iam.identityaccount.v1`

| Method | Organization fields |
|---|---|
| IdentityAccountCommandController.create | `metadata.org`, `spec.identity_provider_ref.org` |
| IdentityAccountCommandController.createFederatedAccount | `org`, `identity_provider_ref.org` |
| IdentityAccountCommandController.createServiceAccount | `org` |
| IdentityAccountCommandController.deprovisionFederatedAccount | `org`, `identity_provider_ref.org` |
| IdentityAccountCommandController.update | `metadata.org`, `spec.identity_provider_ref.org` |
| IdentityAccountCommandController.updateFederatedAccount | `org`, `identity_provider_ref.org` |
| IdentityAccountQueryController.getByExternalSub | `org`, `identity_provider_ref.org` |
| IdentityAccountQueryController.listServiceAccounts | `org` |

## `ai.stigmer.iam.oauthapp.v1`

| Method | Organization fields |
|---|---|
| OAuthAppCommandController.apply | `metadata.org` |
| OAuthAppCommandController.create | `metadata.org` |
| OAuthAppCommandController.update | `metadata.org` |
| OAuthAppQueryController.getByReference | `org` |
| OAuthAppQueryController.listByOrg | `org` |

## `ai.stigmer.iam.platformclient.v1`

| Method | Organization fields |
|---|---|
| PlatformClientCommandController.create | `metadata.org`, `spec.vaults.org` |
| PlatformClientCommandController.update | `metadata.org`, `spec.vaults.org` |
| PlatformClientQueryController.getByReference | `org` |
| PlatformClientQueryController.listByOrg | `org` |
| PlatformClientTokenController.mintUserToken | `org` |

## `ai.stigmer.platform.github.v1`

| Method | Organization fields |
|---|---|
| GitHubQueryController.getFileContent | `org` |
| GitHubQueryController.getTree | `org` |
| GitHubQueryController.listBranches | `org` |
| GitHubQueryController.listRepositories | `org` |
| GitHubQueryController.searchRepositories | `org` |

## `ai.stigmer.search.v1`

| Method | Organization fields |
|---|---|
| SearchService.search | `org` |

## `ai.stigmer.tenancy.organization.v1`

| Method | Organization fields |
|---|---|
| OrganizationCommandController.apply | `metadata.org`, `spec.parent_org` |
| OrganizationCommandController.create | `metadata.org`, `spec.parent_org` |
| OrganizationCommandController.delete | `value (annotation)` |
| OrganizationCommandController.rename | `resource_id (annotation)` |
| OrganizationCommandController.update | `metadata.org`, `spec.parent_org`, `metadata.id (annotation)` |
| OrganizationCommandController.updatePolicies | `org_id (annotation)` |
| OrganizationQueryController.find | `org` |
| OrganizationQueryController.get | `value (annotation)` |
| OrganizationQueryController.getByExternalId | `parent_org` |
| OrganizationQueryController.listChildOrgs | `org` |
