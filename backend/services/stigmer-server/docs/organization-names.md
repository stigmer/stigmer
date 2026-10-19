# Organization names

An organization is filed under a permanent id (`org_<ulid>`) that the server mints when it is made, and every resource it owns names it by that id in `metadata.org`. People name it by its slug: `org: acme` in a manifest, `--org acme` on the CLI, `acme` in a console URL. The serving chain turns every organization a request names into its id before authorization and the handler read the request, so everything past the edge compares and stores ids alone. A renamed organization's previous slug resolves too, until it expires (`RENAMED_SLUG_HOLD_MS`, `src/domain/organization/names.ts`).

This document is the inventory of which fields the resolver reads, one row per method the open-source server serves whose input names an organization. It is held equal to the rule by `src/pipeline/interceptors/__tests__/organization-names-inventory.test.ts`: a contract change that adds or moves an organization field fails that test with the row to write here. The rule is `src/pipeline/interceptors/organization-names.ts`; this document says it in words and lists what it answers. A composition's own services (the Cloud's billing families, for example) are resolved by the same rule; they are not listed because the open-source server does not serve them.

## The rule

- **Every field named `org` or ending `_org`, and every repeated `orgs`**, at any depth of the input: `metadata.org`, a top-level `org`, and the `org` of every reference in a spec. One spelling for an organization field is the contract's own rule (`docs/vocabulary.md`), so the name is the signal. A field that broke the rule (an `org` that names no organization) would appear here, and its review is this document's diff.
- **The field a method's authorization annotation names when its kind is `organization`**: an Organization's own id on `get`, `update`, `updatePolicies`, `delete` and `rename`. Marked `(annotation)`.
- **`ApiResourceRef.id` when the ref's kind is `organization`**: a grant on an organization, or one an organization holds. Marked `(kind organization)`.

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
| AgentCommandController.apply | `metadata.org`, `spec.skill_refs.org`, `spec.plugins.org`, `spec.subagents.org`, `spec.environment_ref.org` |
| AgentCommandController.create | `metadata.org`, `spec.skill_refs.org`, `spec.plugins.org`, `spec.subagents.org`, `spec.environment_ref.org` |
| AgentCommandController.update | `resource.metadata.org`, `resource.spec.skill_refs.org`, `resource.spec.plugins.org`, `resource.spec.subagents.org`, `resource.spec.environment_ref.org` |
| AgentQueryController.getByReference | `org` |
| AgentQueryController.list | `org` |
| AgentQueryController.listVersions | `org` |

## `ai.stigmer.agentic.channel.v1`

| Method | Organization fields |
|---|---|
| ChannelCommandController.apply | `metadata.org`, `spec.agent_ref.org`, `spec.vaults.org`, `spec.slack.app_ref.org`, `spec.whatsapp.app_ref.org` |
| ChannelCommandController.create | `metadata.org`, `spec.agent_ref.org`, `spec.vaults.org`, `spec.slack.app_ref.org`, `spec.whatsapp.app_ref.org` |
| ChannelCommandController.update | `resource.metadata.org`, `resource.spec.agent_ref.org`, `resource.spec.vaults.org`, `resource.spec.slack.app_ref.org`, `resource.spec.whatsapp.app_ref.org` |
| ChannelQueryController.listByAgent | `org` |
| ChannelQueryController.getByReference | `org` |
| ChannelQueryController.list | `org` |
| ChannelConversationQueryController.countConversations | `org` |
| ChannelConversationQueryController.list | `org` |
| ChannelMessageCommandController.sendMessage | `org` |
| ChannelMessageQueryController.listTemplates | `org` |

## `ai.stigmer.agentic.routine.v1`

| Method | Organization fields |
|---|---|
| RoutineCommandController.apply | `metadata.org`, `spec.agent.agent_ref.org`, `spec.agent.vaults.org`, `spec.agent.environment_ref.org` |
| RoutineCommandController.create | `metadata.org`, `spec.agent.agent_ref.org`, `spec.agent.vaults.org`, `spec.agent.environment_ref.org` |
| RoutineCommandController.update | `resource.metadata.org`, `resource.spec.agent.agent_ref.org`, `resource.spec.agent.vaults.org`, `resource.spec.agent.environment_ref.org` |
| RoutineQueryController.listByAgent | `org` |
| RoutineQueryController.getByReference | `org` |
| RoutineQueryController.list | `org` |

## `ai.stigmer.agentic.run.v1`

| Method | Organization fields |
|---|---|
| RunCommandController.create | `metadata.org`, `spec.session_spec.agent_ref.org`, `spec.session_spec.skill_refs.org`, `spec.session_spec.vaults.org`, `spec.session_spec.plugins.org`, `spec.session_spec.environment_ref.org`, `status.loaded_versions.skills.org`, `status.loaded_versions.plugins.org` |
| RunCommandController.update | `resource.metadata.org`, `resource.spec.session_spec.agent_ref.org`, `resource.spec.session_spec.skill_refs.org`, `resource.spec.session_spec.vaults.org`, `resource.spec.session_spec.plugins.org`, `resource.spec.session_spec.environment_ref.org`, `resource.status.loaded_versions.skills.org`, `resource.status.loaded_versions.plugins.org` |
| RunCommandController.updateStatus | `status.loaded_versions.skills.org`, `status.loaded_versions.plugins.org` |
| RunQueryController.getAgentUsageReport | `org` |
| RunQueryController.getRunSummary | `org` |
| RunQueryController.getOrgUsageReport | `org` |
| RunQueryController.list | `org` |

## `ai.stigmer.agentic.channelapp.v1`

| Method | Organization fields |
|---|---|
| ChannelAppCommandController.apply | `metadata.org` |
| ChannelAppCommandController.create | `metadata.org` |
| ChannelAppCommandController.update | `resource.metadata.org` |
| ChannelAppQueryController.getByReference | `org` |
| ChannelAppQueryController.list | `org` |
| EnvironmentCommandController.apply | `metadata.org` |
| EnvironmentCommandController.create | `metadata.org` |
| EnvironmentCommandController.update | `resource.metadata.org` |
| EnvironmentQueryController.getByReference | `org` |
| EnvironmentQueryController.list | `org` |

## `ai.stigmer.agentic.eval.v1`

| Method | Organization fields |
|---|---|
| EvalCommandController.addCaseFromRun | `eval.org` |
| EvalCommandController.createArtifactUploadUrl | `org` |
| EvalCommandController.push | `org` |
| EvalQueryController.download | `org` |
| EvalQueryController.getByReference | `org` |
| EvalQueryController.getDownloadUrl | `org` |
| EvalQueryController.list | `org` |
| EvalQueryController.listVersions | `org` |

## `ai.stigmer.agentic.evalrun.v1`

| Method | Organization fields |
|---|---|
| EvalRunCommandController.create | `metadata.org`, `spec.cases.plugin.org`, `spec.cases.eval.org`, `spec.vaults.org` |

## `ai.stigmer.agentic.file.v1`

| Method | Organization fields |
|---|---|
| FileCommandController.createUploadUrl | `org` |
| FileCommandController.update | `resource.metadata.org` |
| FileCommandController.upload | `org` |
| FileQueryController.list | `org` |

## `ai.stigmer.agentic.scoringrule.v1`

| Method | Organization fields |
|---|---|
| ScoringRuleCommandController.create | `metadata.org` |
| ScoringRuleCommandController.update | `resource.metadata.org` |

## `ai.stigmer.agentic.memory.v1`

| Method | Organization fields |
|---|---|
| MemoryCommandController.create | `metadata.org` |
| MemoryCommandController.update | `resource.metadata.org` |
| MemoryQueryController.list | `org` |

## `ai.stigmer.agentic.plugin.v1`

| Method | Organization fields |
|---|---|
| PluginCommandController.createArtifactUploadUrl | `org` |
| PluginCommandController.listTools | `org` |
| PluginCommandController.push | `org` |
| PluginQueryController.getByReference | `org` |
| PluginQueryController.list | `org` |
| PluginQueryController.listVersions | `org` |

## `ai.stigmer.agentic.score.v1`

| Method | Organization fields |
|---|---|
| ScoreCommandController.create | `metadata.org` |
| ScoreCommandController.update | `resource.metadata.org` |
| ScoreQueryController.getAgentQualityReport | `org` |
| ScoreQueryController.listFlaggedByAgent | `org` |

## `ai.stigmer.agentic.session.v1`

| Method | Organization fields |
|---|---|
| SessionCommandController.apply | `metadata.org`, `spec.agent_ref.org`, `spec.skill_refs.org`, `spec.vaults.org`, `spec.plugins.org`, `spec.environment_ref.org`, `status.environment.org` |
| SessionCommandController.create | `metadata.org`, `spec.agent_ref.org`, `spec.skill_refs.org`, `spec.vaults.org`, `spec.plugins.org`, `spec.environment_ref.org`, `status.environment.org` |
| SessionCommandController.update | `resource.metadata.org`, `resource.spec.agent_ref.org`, `resource.spec.skill_refs.org`, `resource.spec.vaults.org`, `resource.spec.plugins.org`, `resource.spec.environment_ref.org`, `resource.status.environment.org` |
| SessionQueryController.list | `org` |

## `ai.stigmer.agentic.skill.v1`

| Method | Organization fields |
|---|---|
| SkillCommandController.createArtifactUploadUrl | `org` |
| SkillCommandController.push | `org` |
| SkillCommandController.pushFromRunArtifact | `org` |
| SkillQueryController.getByReference | `org` |
| SkillQueryController.list | `org` |
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
| VaultCommandController.update | `resource.metadata.org`, `resource.spec.org` |
| VaultQueryController.getByExternalId | `org` |
| VaultQueryController.getByReference | `org` |
| VaultQueryController.getMine | `org` |
| VaultQueryController.list | `org` |

## `ai.stigmer.iam.apikey.v1`

| Method | Organization fields |
|---|---|
| ApiKeyCommandController.create | `metadata.org`, `spec.bound_org` |
| ApiKeyCommandController.update | `resource.metadata.org`, `resource.spec.bound_org` |

## `ai.stigmer.iam.grant.v1`

| Method | Organization fields |
|---|---|
| GrantCommandController.bootstrapGrant | `principal.id (kind organization)`, `resource.id (kind organization)` |
| GrantCommandController.bootstrapRevokeOrgAccess | `org` |
| GrantCommandController.cleanupResourceGrants | `id (kind organization)` |
| GrantCommandController.create | `principal.id (kind organization)`, `resource.id (kind organization)` |
| GrantCommandController.delete | `principal.id (kind organization)`, `resource.id (kind organization)` |
| GrantCommandController.revokeOrgAccess | `org` |
| GrantQueryController.checkAuthorization | `grant.principal.id (kind organization)`, `grant.resource.id (kind organization)`, `contextual_grants.principal.id (kind organization)`, `contextual_grants.resource.id (kind organization)` |
| GrantQueryController.checkMyPermission | `resource.id (kind organization)`, `contextual_grants.principal.id (kind organization)`, `contextual_grants.resource.id (kind organization)` |
| GrantQueryController.getPrincipalResourceRoles | `principal.id (kind organization)`, `resource.id (kind organization)` |
| GrantQueryController.getPrincipalsCount | `org` |
| GrantQueryController.listAccessHistory | `org` |
| GrantQueryController.listAuthorizedPrincipalIds | `resource.id (kind organization)`, `contextual_grants.principal.id (kind organization)`, `contextual_grants.resource.id (kind organization)` |
| GrantQueryController.listAuthorizedResourceIds | `principal.id (kind organization)`, `contextual_grants.principal.id (kind organization)`, `contextual_grants.resource.id (kind organization)` |
| GrantQueryController.listResourceAccessByPrincipal | `resource.id (kind organization)` |

## `ai.stigmer.iam.identityaccount.v1`

| Method | Organization fields |
|---|---|
| IdentityAccountCommandController.create | `metadata.org`, `spec.federation_issuer_ref.org` |
| IdentityAccountCommandController.createFederatedAccount | `org`, `federation_issuer_ref.org` |
| IdentityAccountCommandController.createServiceAccount | `org` |
| IdentityAccountCommandController.deprovisionFederatedAccount | `org`, `federation_issuer_ref.org` |
| IdentityAccountCommandController.update | `resource.metadata.org`, `resource.spec.federation_issuer_ref.org` |
| IdentityAccountCommandController.updateFederatedAccount | `org`, `federation_issuer_ref.org` |
| IdentityAccountQueryController.getByExternalSub | `org`, `federation_issuer_ref.org` |
| IdentityAccountQueryController.listServiceAccounts | `org` |

## `ai.stigmer.iam.oauthapp.v1`

| Method | Organization fields |
|---|---|
| OAuthAppCommandController.apply | `metadata.org` |
| OAuthAppCommandController.create | `metadata.org` |
| OAuthAppCommandController.update | `resource.metadata.org` |
| OAuthAppQueryController.getByReference | `org` |
| OAuthAppQueryController.list | `org` |

## `ai.stigmer.iam.token.v1`

| Method | Organization fields |
|---|---|
| TokenService.mintUserToken | `org` |

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
| OrganizationCommandController.apply | `metadata.org`, `spec.parent_org`, `spec.preferences.default_environment_ref.org`, `spec.embedding.vaults.org` |
| OrganizationCommandController.create | `metadata.org`, `spec.parent_org`, `spec.preferences.default_environment_ref.org`, `spec.embedding.vaults.org` |
| OrganizationCommandController.delete | `value (annotation)` |
| OrganizationCommandController.rename | `resource_id (annotation)` |
| OrganizationCommandController.update | `resource.metadata.org`, `resource.spec.parent_org`, `resource.spec.preferences.default_environment_ref.org`, `resource.spec.embedding.vaults.org`, `resource.metadata.id (annotation)` |
| OrganizationCommandController.updateEmbedding | `embedding.vaults.org`, `org_id (annotation)` |
| OrganizationCommandController.updatePolicies | `org_id (annotation)` |
| OrganizationQueryController.get | `value (annotation)` |
| OrganizationQueryController.getByExternalId | `parent_org` |
| OrganizationQueryController.listChildOrgs | `org` |
