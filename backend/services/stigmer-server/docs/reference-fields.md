# Reference fields

A field that names another resource names it in one of six ways, and this document is the inventory of which way each field of the contract takes. The rule this record of the contract serves: a reference a person writes is held by id. A reference written by name (`org` and `slug`) is resolved to its resource's id when the referring resource is written, the id is stored and the slug is not, and every response names the reference again with its target's current slug (`src/pipeline/steps/references.ts` and `src/pipeline/interceptors/resource-references.ts`). So a reference keeps meaning the resource it meant when that resource is renamed, and never means a new resource that takes a deleted one's name.

It is held equal to the contract by `src/pipeline/steps/__tests__/reference-fields-inventory.test.ts`, which reads every message the open-source server's methods can carry: a field that names a resource and has no row here fails that test with the row to write, and a row whose class does not fit the field's shape fails too. A composition's own services are not listed because the open-source server does not serve them.

## The classes

- **manifest reference**: an `ApiResourceReference` a person writes in a resource's spec. Resolved to the id at write, stored as `{org, kind, id, version}`, returned with the current slug.
- **request reference**: a reference a request carries to name the resource it acts on: the federated-account inputs' `identity_provider_ref`, resolved the same way before the edition's arm runs, and the requests that name a resource by `org` and `slug` strings, which stay names a person types and resolve through the name table. Every `getByReference` takes an `ApiResourceReference` as its whole input: by `id` (a point read, then a check that the organization and kind agree) or by `org` and `slug`, and both must agree when both are given.
- **stamped reference**: an `ApiResourceReference` the server or the runner writes, never a person: held by id like any stored reference.
- **stamped id**: a `<kind>_id` string the server writes or a request names the resource by: an id already.
- **display slug**: a slug kept beside an id for people to read, never resolved.
- **create-time selector**: names a person writes that choose among a resource's own references once, at create, after which the server stamps ids: `AgentEvalSpec.plugins` chooses among the evaluated agent's attached plugins, and the eval stamps each one's id and digest.
- **not a resource**, with why: a field whose name reads like a resource's but names something else.

Rows read `| \`Message.field\` | class |`.

## `ai.stigmer.agentic.agent.v1`

| Field | Class |
|---|---|
| `ai.stigmer.agentic.agent.v1.AgentSpec.plugins` | manifest reference |
| `ai.stigmer.agentic.agent.v1.AgentSpec.skill_refs` | manifest reference |
| `ai.stigmer.agentic.agent.v1.AgentSpec.subagents` | manifest reference |
| `ai.stigmer.agentic.agent.v1.GetAgentVersionInput.agent_id` | stamped id |
| `ai.stigmer.agentic.agent.v1.ListAgentVersionsInput.slug` | request reference |
| `ai.stigmer.agentic.agent.v1.TagAgentVersionInput.agent_id` | stamped id |

## `ai.stigmer.agentic.agentchannel.v1`

| Field | Class |
|---|---|
| `ai.stigmer.agentic.agentchannel.v1.AgentChannelSpec.agent_ref` | manifest reference |
| `ai.stigmer.agentic.agentchannel.v1.AgentChannelSpec.app_ref` | manifest reference |
| `ai.stigmer.agentic.agentchannel.v1.AgentChannelSpec.vaults` | manifest reference |
| `ai.stigmer.agentic.agentchannel.v1.ChannelConversation.agent_channel_id` | stamped id |
| `ai.stigmer.agentic.agentchannel.v1.ConversationControlInput.agent_channel_id` | stamped id |
| `ai.stigmer.agentic.agentchannel.v1.GetAgentChannelsByAgentRequest.agent_id` | stamped id |
| `ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput.agent_channel_id` | stamped id |
| `ai.stigmer.agentic.agentchannel.v1.GetConversationMediaDownloadUrlInput.agent_channel_id` | stamped id |
| `ai.stigmer.agentic.agentchannel.v1.GetConversationTimelineInput.agent_channel_id` | stamped id |
| `ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput.agent_channel_id` | stamped id |
| `ai.stigmer.agentic.agentchannel.v1.ReplyToConversationInput.agent_channel_id` | stamped id |
| `ai.stigmer.agentic.agentchannel.v1.SlackInstallStatus.channel_app_id` | stamped id |
| `ai.stigmer.agentic.agentchannel.v1.SlackInstallStatus.team_id` | stamped id |
| `ai.stigmer.agentic.agentchannel.v1.WhatsAppInstallStatus.channel_app_id` | stamped id |

## `ai.stigmer.agentic.agenteval.v1`

| Field | Class |
|---|---|
| `ai.stigmer.agentic.agenteval.v1.AgentEvalPlugin.plugin_id` | stamped id |
| `ai.stigmer.agentic.agenteval.v1.AgentEvalPlugin.plugin_slug` | display slug |
| `ai.stigmer.agentic.agenteval.v1.AgentEvalSpec.agent_id` | stamped id |
| `ai.stigmer.agentic.agenteval.v1.AgentEvalSpec.plugins` | create-time selector |
| `ai.stigmer.agentic.agenteval.v1.AgentEvalSpec.vaults` | manifest reference |
| `ai.stigmer.agentic.agenteval.v1.ListAgentEvalsByAgentRequest.agent_id` | stamped id |

## `ai.stigmer.agentic.agentshare.v1`

| Field | Class |
|---|---|
| `ai.stigmer.agentic.agentshare.v1.AgentShareSpec.agent_ref` | manifest reference |
| `ai.stigmer.agentic.agentshare.v1.AgentShareSpec.vaults` | manifest reference |
| `ai.stigmer.agentic.agentshare.v1.AgentShareStatus.agent_id` | stamped id |
| `ai.stigmer.agentic.agentshare.v1.GetAgentSharesByAgentRequest.agent_id` | stamped id |
| `ai.stigmer.agentic.agentshare.v1.SharedAgentProfile.agent_ref` | stamped reference |
| `ai.stigmer.agentic.agentshare.v1.SharedAgentProfile.slug` | not a resource: the share's own name, beside its org |

## `ai.stigmer.agentic.evaluator.v1`

| Field | Class |
|---|---|
| `ai.stigmer.agentic.evaluator.v1.EvaluatorSpec.agent_id` | stamped id |
| `ai.stigmer.agentic.evaluator.v1.GetEvaluatorByAgentRequest.agent_id` | stamped id |

## `ai.stigmer.agentic.memory.v1`

| Field | Class |
|---|---|
| `ai.stigmer.agentic.memory.v1.MemoryProvenance.agent_id` | stamped id |
| `ai.stigmer.agentic.memory.v1.MemoryProvenance.run_id` | stamped id |
| `ai.stigmer.agentic.memory.v1.MemoryProvenance.session_id` | stamped id |

## `ai.stigmer.agentic.plugin.v1`

| Field | Class |
|---|---|
| `ai.stigmer.agentic.plugin.v1.ListPluginToolsInput.plugin_id` | stamped id |
| `ai.stigmer.agentic.plugin.v1.ListPluginVersionsInput.slug` | request reference |
| `ai.stigmer.agentic.plugin.v1.PluginAgent.skills` | not a resource: the plugin's own skills, parts of its package, by name |

## `ai.stigmer.agentic.plugineval.v1`

| Field | Class |
|---|---|
| `ai.stigmer.agentic.plugineval.v1.ListPluginEvalsByPluginRequest.plugin_id` | stamped id |
| `ai.stigmer.agentic.plugineval.v1.PluginEvalSpec.plugin_id` | stamped id |
| `ai.stigmer.agentic.plugineval.v1.PluginEvalSpec.vaults` | manifest reference |
| `ai.stigmer.agentic.plugineval.v1.PluginEvalTry.run_id` | stamped id |
| `ai.stigmer.agentic.plugineval.v1.PluginEvalTry.session_id` | stamped id |

## `ai.stigmer.agentic.run.v1`

| Field | Class |
|---|---|
| `ai.stigmer.agentic.run.v1.AgentFailureRank.agent_slug` | display slug |
| `ai.stigmer.agentic.run.v1.AgentInvocation.agent_ref` | manifest reference |
| `ai.stigmer.agentic.run.v1.AgentInvocation.vaults` | manifest reference |
| `ai.stigmer.agentic.run.v1.AgentUsageSummary.agent_id` | stamped id |
| `ai.stigmer.agentic.run.v1.ApprovalEventStream.run_id` | stamped id |
| `ai.stigmer.agentic.run.v1.ApprovalRequest.mcp_server_slug` | not a resource: an MCP server's tool-name segment, plugin_<plugin>_<server> |
| `ai.stigmer.agentic.run.v1.FileReviewEventStream.run_id` | stamped id |
| `ai.stigmer.agentic.run.v1.GetAgentUsageReportInput.agent_id` | stamped id |
| `ai.stigmer.agentic.run.v1.GetAgentUsageReportOutput.agent_id` | stamped id |
| `ai.stigmer.agentic.run.v1.GetArtifactContentRequest.run_id` | stamped id |
| `ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlRequest.run_id` | stamped id |
| `ai.stigmer.agentic.run.v1.GetRunUsageReportInput.run_id` | stamped id |
| `ai.stigmer.agentic.run.v1.GetSessionUsageReportInput.session_id` | stamped id |
| `ai.stigmer.agentic.run.v1.GetSessionUsageReportOutput.session_id` | stamped id |
| `ai.stigmer.agentic.run.v1.ListRunsBySessionRequest.session_id` | stamped id |
| `ai.stigmer.agentic.run.v1.LoadedVersions.plugins` | stamped reference |
| `ai.stigmer.agentic.run.v1.LoadedVersions.skills` | stamped reference |
| `ai.stigmer.agentic.run.v1.PendingApproval.mcp_server_slug` | not a resource: an MCP server's tool-name segment, plugin_<plugin>_<server> |
| `ai.stigmer.agentic.run.v1.PluginEvalCaseContext.plugin_id` | stamped id |
| `ai.stigmer.agentic.run.v1.RecalledMemoryFact.memory_id` | stamped id |
| `ai.stigmer.agentic.run.v1.RunSpec.session_id` | stamped id |
| `ai.stigmer.agentic.run.v1.RunStatus.agent_id` | stamped id |
| `ai.stigmer.agentic.run.v1.RunUpdateStatusInput.run_id` | stamped id |
| `ai.stigmer.agentic.run.v1.RunUsageSummary.run_id` | stamped id |
| `ai.stigmer.agentic.run.v1.RunValueDeclarer.plugin_id` | stamped id |
| `ai.stigmer.agentic.run.v1.RunValueSource.vault_id` | stamped id |
| `ai.stigmer.agentic.run.v1.SessionUsageSummary.session_id` | stamped id |
| `ai.stigmer.agentic.run.v1.SubmitApprovalInput.run_id` | stamped id |
| `ai.stigmer.agentic.run.v1.SubmitFileDecisionInput.run_id` | stamped id |
| `ai.stigmer.agentic.run.v1.ToolCall.mcp_server_slug` | not a resource: an MCP server's tool-name segment, plugin_<plugin>_<server> |

## `ai.stigmer.agentic.schedule.v1`

| Field | Class |
|---|---|
| `ai.stigmer.agentic.schedule.v1.GetSchedulesByAgentRequest.agent_id` | stamped id |
| `ai.stigmer.agentic.schedule.v1.ListScheduleFiresRequest.schedule_id` | stamped id |
| `ai.stigmer.agentic.schedule.v1.ScheduleFire.run_id` | stamped id |
| `ai.stigmer.agentic.schedule.v1.ScheduleFire.schedule_id` | stamped id |
| `ai.stigmer.agentic.schedule.v1.ScheduleTriggerResult.run_id` | stamped id |

## `ai.stigmer.agentic.score.v1`

| Field | Class |
|---|---|
| `ai.stigmer.agentic.score.v1.GetAgentQualityReportRequest.agent_id` | stamped id |
| `ai.stigmer.agentic.score.v1.ListFlaggedScoresByAgentRequest.agent_id` | stamped id |
| `ai.stigmer.agentic.score.v1.ListScoresByRunRequest.run_id` | stamped id |
| `ai.stigmer.agentic.score.v1.ListScoresBySessionRequest.session_id` | stamped id |
| `ai.stigmer.agentic.score.v1.ScoreSpec.run_id` | stamped id |
| `ai.stigmer.agentic.score.v1.ScoreSpec.session_id` | stamped id |
| `ai.stigmer.agentic.score.v1.ScoreStatus.agent_id` | stamped id |

## `ai.stigmer.agentic.session.v1`

| Field | Class |
|---|---|
| `ai.stigmer.agentic.session.v1.AppendSessionEventsInput.run_id` | stamped id |
| `ai.stigmer.agentic.session.v1.ListSessionEventsRequest.run_id` | stamped id |
| `ai.stigmer.agentic.session.v1.ListSessionEventsRequest.session_id` | stamped id |
| `ai.stigmer.agentic.session.v1.ListSessionsByAgentRequest.agent_id` | stamped id |
| `ai.stigmer.agentic.session.v1.SessionEvent.run_id` | stamped id |
| `ai.stigmer.agentic.session.v1.SessionEvent.session_id` | stamped id |
| `ai.stigmer.agentic.session.v1.SessionSpec.agent_ref` | manifest reference |
| `ai.stigmer.agentic.session.v1.SessionSpec.plugins` | manifest reference |
| `ai.stigmer.agentic.session.v1.SessionSpec.skill_refs` | manifest reference |
| `ai.stigmer.agentic.session.v1.SessionSpec.vaults` | manifest reference |
| `ai.stigmer.agentic.session.v1.SessionStatus.agent_id` | stamped id |
| `ai.stigmer.agentic.session.v1.StreamSessionEventsRequest.session_id` | stamped id |

## `ai.stigmer.agentic.skill.v1`

| Field | Class |
|---|---|
| `ai.stigmer.agentic.skill.v1.ListSkillVersionsInput.slug` | request reference |
| `ai.stigmer.agentic.skill.v1.PushSkillFromRunArtifactRequest.run_id` | stamped id |

## `ai.stigmer.agentic.vault.v1`

| Field | Class |
|---|---|
| `ai.stigmer.agentic.vault.v1.CreateConnectLinkInput.vault_id` | stamped id |
| `ai.stigmer.agentic.vault.v1.PluginValues.plugin_id` | stamped id |
| `ai.stigmer.agentic.vault.v1.ToolValues.plugin_id` | stamped id |

## `ai.stigmer.commons.apiresource`

| Field | Class |
|---|---|
| `ai.stigmer.commons.apiresource.ApiResourceAuditActor.platform_client_id` | stamped id |
| `ai.stigmer.commons.apiresource.ApiResourceMetadata.slug` | not a resource: the resource's own name |

## `ai.stigmer.iam.iampolicy.v1`

| Field | Class |
|---|---|
| `ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput.identity_account_id` | stamped id |

## `ai.stigmer.iam.identityaccount.v1`

| Field | Class |
|---|---|
| `ai.stigmer.iam.identityaccount.v1.CreateFederatedAccountInput.identity_provider_ref` | request reference |
| `ai.stigmer.iam.identityaccount.v1.DeprovisionFederatedAccountInput.identity_provider_ref` | request reference |
| `ai.stigmer.iam.identityaccount.v1.ExternalSubLookup.identity_provider_ref` | request reference |
| `ai.stigmer.iam.identityaccount.v1.IdentityAccountSpec.identity_provider_ref` | stamped reference |
| `ai.stigmer.iam.identityaccount.v1.UpdateFederatedAccountInput.identity_provider_ref` | request reference |

## `ai.stigmer.iam.platformclient.v1`

| Field | Class |
|---|---|
| `ai.stigmer.iam.platformclient.v1.PlatformClientSpec.vaults` | manifest reference |

## `ai.stigmer.platform.v1`

| Field | Class |
|---|---|
| `ai.stigmer.platform.v1.GetRunnerScopedTokenInput.run_id` | stamped id |
| `ai.stigmer.platform.v1.LicenseClaims.license_id` | stamped id |
| `ai.stigmer.platform.v1.PoolClaim.session_id` | stamped id |

## `ai.stigmer.search.v1`

| Field | Class |
|---|---|
| `ai.stigmer.search.v1.SearchResult.qualified_slug` | display slug |
| `ai.stigmer.search.v1.SearchResult.slug` | not a resource: the hit's own name |
