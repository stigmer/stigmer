# The single-organization fill

A server composed to hold one organization (`ServerExtension.orgLimit: 1`, the open-source edition, `src/editions/open-source.ts`) fills that organization into every serving request that names none. A person on a laptop, a script and an agent calling back never pass `org`; an explicit `org` is always honoured and judged by authorization as on every server. `GetServerInfoOutput.single_org` tells clients the fill is on.

This document is the inventory of which field the fill sets, one row per method the open-source server serves that takes an organization. It is held equal to the rule by `src/pipeline/interceptors/__tests__/single-organization-inventory.test.ts`: a contract change that adds, moves or re-scopes an organization field fails that test with the row to write here. The rule is `fillRuleFor` in `src/pipeline/interceptors/single-organization.ts`; this document says it in words and lists what it answers.

## The rule

- **`org`**: the input has a top-level `string org`. Filled on every service but the Organization service's own.
- **`vault.org`**: otherwise, the input's `vault` is a `VaultTarget`: the vault entry writes (`setSecrets`, `removeSecrets`, `setConnection`, `removeConnections`) name the vault they change, and its organization, inside that target.
- **`metadata.org`**: otherwise, the input carries an `ApiResourceMetadata` and its service's `api_resource_kind` is scoped to an organization (`AUTHORIZATION_SCOPE_TYPE_ORGANIZATION`), or to a parent (`AUTHORIZATION_SCOPE_TYPE_PARENT`: an agent run's organization is its session's).
- **Not filled**:
  - the Organization service's own methods, because an organization's own `metadata.org` stays empty;
  - the kinds that belong to no organization (`AUTHORIZATION_SCOPE_TYPE_OWNER_ONLY` and `AUTHORIZATION_SCOPE_TYPE_NONE`: identity accounts, API keys, execution contexts, the platform, plans and licences);
  - nested messages other than a `VaultTarget`, because a spec reference with no organization takes its resource's own (`NormalizeReferences`, `src/pipeline/steps/references.ts`);
  - streams, because no streaming method takes an organization.

Why every plain `org` and not only the ones an authorization annotation names: on a server that holds one organization, every meaning an empty `org` has elsewhere gives the same answer as "the one organization". "The parent's organization", "every organization the caller can see" and "the one organization" are the same set, and the cross-organization probe an anti-enumeration refusal guards cannot exist. The two meanings that differ, a platform-scoped write and a resource that belongs to no organization, are excluded by kind. One read differs and is filled anyway: a search with no `org` that asks for organizations (`kinds` empty, the discover mode, or naming the organization kind) used to answer the organization rows the caller can see, whose index entries carry no organization; filled, it answers none. On a server that holds one organization that row is the one nobody names, so leaving it out of search is what the console wants. In-process calls are never filled: server code names its organization, and three in-process lanes rely on an empty one's other meanings.

Rows read `| Service.method | org |`, `| Service.method | vault.org |`, `| Service.method | metadata.org |` or `| Service.method | not filled: <reason> |`.


## `ai.stigmer.activity.v1`

| Method | Fills |
|---|---|
| ActivityQueryController.listRecentActivity | org |

## `ai.stigmer.agentic.agent.v1`

| Method | Fills |
|---|---|
| AgentCommandController.apply | metadata.org |
| AgentCommandController.create | metadata.org |
| AgentCommandController.update | metadata.org |
| AgentQueryController.getByReference | org |
| AgentQueryController.listVersions | org |

## `ai.stigmer.agentic.agentchannel.v1`

| Method | Fills |
|---|---|
| AgentChannelCommandController.apply | metadata.org |
| AgentChannelCommandController.create | metadata.org |
| AgentChannelCommandController.update | metadata.org |
| AgentChannelQueryController.getByAgent | org |
| AgentChannelQueryController.getByReference | org |
| AgentChannelQueryController.list | org |
| ChannelConversationQueryController.listConversations | org |
| ChannelMessageCommandController.sendMessage | org |
| ChannelMessageQueryController.listTemplates | org |

## `ai.stigmer.agentic.run.v1`

| Method | Fills |
|---|---|
| RunCommandController.create | metadata.org |
| RunCommandController.update | metadata.org |
| RunQueryController.getAgentUsageReport | org |
| RunQueryController.getRunSummary | org |
| RunQueryController.getOrgUsageReport | org |
| RunQueryController.list | org |

## `ai.stigmer.agentic.agentshare.v1`

| Method | Fills |
|---|---|
| AgentShareCommandController.apply | metadata.org |
| AgentShareCommandController.create | metadata.org |
| AgentShareCommandController.update | metadata.org |
| AgentShareQueryController.getByAgent | org |
| AgentShareQueryController.getByReference | org |
| AgentShareQueryController.list | org |

## `ai.stigmer.agentic.channelapp.v1`

| Method | Fills |
|---|---|
| ChannelAppCommandController.apply | metadata.org |
| ChannelAppCommandController.create | metadata.org |
| ChannelAppCommandController.update | metadata.org |
| ChannelAppQueryController.getByReference | org |
| ChannelAppQueryController.listByOrg | org |

## `ai.stigmer.agentic.mcpserver.v1`

| Method | Fills |
|---|---|
| McpServerCommandController.apply | metadata.org |
| McpServerCommandController.connect | org |
| McpServerCommandController.create | metadata.org |
| McpServerCommandController.deleteOrgOAuthApp | org |
| McpServerCommandController.disconnectOAuth | org |
| McpServerCommandController.initiateOAuthConnect | org |
| McpServerCommandController.setOrgOAuthApp | org |
| McpServerCommandController.startConnect | org |
| McpServerCommandController.update | metadata.org |
| McpServerQueryController.getByReference | org |
| McpServerQueryController.getOAuthGrantStatus | org |
| McpServerQueryController.getOrgOAuthApp | org |

## `ai.stigmer.agentic.memory.v1`

| Method | Fills |
|---|---|
| MemoryCommandController.create | metadata.org |
| MemoryCommandController.update | metadata.org |
| MemoryQueryController.list | org |

## `ai.stigmer.agentic.plugin.v1`

| Method | Fills |
|---|---|
| PluginCommandController.createArtifactUploadUrl | org |
| PluginCommandController.push | org |
| PluginQueryController.getByReference | org |
| PluginQueryController.listVersions | org |

## `ai.stigmer.agentic.schedule.v1`

| Method | Fills |
|---|---|
| ScheduleCommandController.apply | metadata.org |
| ScheduleCommandController.create | metadata.org |
| ScheduleCommandController.update | metadata.org |
| ScheduleQueryController.getByAgent | org |
| ScheduleQueryController.getByReference | org |
| ScheduleQueryController.list | org |

## `ai.stigmer.agentic.session.v1`

| Method | Fills |
|---|---|
| SessionCommandController.apply | metadata.org |
| SessionCommandController.create | metadata.org |
| SessionCommandController.update | metadata.org |
| SessionQueryController.list | org |

## `ai.stigmer.agentic.skill.v1`

| Method | Fills |
|---|---|
| SkillCommandController.createArtifactUploadUrl | org |
| SkillCommandController.push | org |
| SkillCommandController.pushFromRunArtifact | org |
| SkillQueryController.getByReference | org |
| SkillQueryController.listVersions | org |

## `ai.stigmer.agentic.vault.v1`

| Method | Fills |
|---|---|
| VaultCommandController.create | metadata.org |
| VaultCommandController.removeConnections | vault.org |
| VaultCommandController.removeSecrets | vault.org |
| VaultCommandController.setConnection | vault.org |
| VaultCommandController.setSecrets | vault.org |
| VaultCommandController.update | metadata.org |
| VaultQueryController.getByExternalId | org |
| VaultQueryController.getByReference | org |
| VaultQueryController.getMine | org |
| VaultQueryController.list | org |

## `ai.stigmer.iam.iampolicy.v1`

| Method | Fills |
|---|---|
| IamPolicyCommandController.bootstrapRevokeOrgAccess | org |
| IamPolicyCommandController.revokeOrgAccess | org |
| IamPolicyQueryController.getPrincipalsCount | org |

## `ai.stigmer.iam.oauthapp.v1`

| Method | Fills |
|---|---|
| OAuthAppCommandController.apply | metadata.org |
| OAuthAppCommandController.create | metadata.org |
| OAuthAppCommandController.update | metadata.org |
| OAuthAppQueryController.getByReference | org |
| OAuthAppQueryController.listByOrg | org |

## `ai.stigmer.iam.platformclient.v1`

| Method | Fills |
|---|---|
| PlatformClientCommandController.create | metadata.org |
| PlatformClientCommandController.update | metadata.org |
| PlatformClientQueryController.getByReference | org |
| PlatformClientQueryController.listByOrg | org |
| PlatformClientTokenController.mintUserToken | org |

## `ai.stigmer.platform.github.v1`

| Method | Fills |
|---|---|
| GitHubQueryController.getFileContent | org |
| GitHubQueryController.getTree | org |
| GitHubQueryController.listBranches | org |
| GitHubQueryController.listRepositories | org |
| GitHubQueryController.searchRepositories | org |
| GitHubService.exchangeOAuthCode | org |
| GitHubService.getOAuthAuthorizeUrl | org |

## `ai.stigmer.search.v1`

| Method | Fills |
|---|---|
| SearchService.search | org |

## Kinds that belong to no organization, whose request names one

These kinds are owned by a person, not an organization, yet these methods take a top-level `org` that names an organization the request acts in: the organization that owns the identity provider a federated account belongs to (its authorization scope), or the organization a reference lives in. On a server that holds one organization, that is the one.

| Method | Fills |
|---|---|
| ExecutionContextQueryController.getByReference | org |
| IdentityAccountCommandController.createFederatedAccount | org |
| IdentityAccountCommandController.deprovisionFederatedAccount | org |
| IdentityAccountCommandController.updateFederatedAccount | org |
| IdentityAccountQueryController.getByExternalSub | org |

## Not filled

One of these still needs its organization named. An execution context belongs to no organization, but an outside caller's `create` or `apply` of one is permitted by the organization it will run in, read from `metadata.org` (`AuthorizeCreate`, `src/domain/executioncontext/steps.ts`), so on this server too a request that names none is refused. No shipped client makes that call: the agent run machinery creates execution contexts in-process, authorized by the run it serves.

| Method | Fills |
|---|---|
| ExecutionContextCommandController.apply | not filled: kind belongs to no organization |
| ExecutionContextCommandController.create | not filled: kind belongs to no organization |
| ApiKeyCommandController.create | not filled: kind belongs to no organization |
| ApiKeyCommandController.update | not filled: kind belongs to no organization |
| IdentityAccountCommandController.create | not filled: kind belongs to no organization |
| IdentityAccountCommandController.update | not filled: kind belongs to no organization |
| OrganizationCommandController.apply | not filled: organization service |
| OrganizationCommandController.create | not filled: organization service |
| OrganizationCommandController.update | not filled: organization service |
| OrganizationQueryController.find | not filled: organization service |
| OrganizationQueryController.listChildOrgs | not filled: organization service |
