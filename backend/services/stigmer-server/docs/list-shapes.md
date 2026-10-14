# How lists page

Every list pages one way. A request takes `page_size` and `page_token` beside
its filters; a response returns `entries` and `next_page_token`, and nothing
else about the list. `page_size` 0 asks for the default page of 50, a size above
100 is read as 100, and a negative size is refused. A page may be short, even
empty, and still carry a token; the list is complete when the token is empty. A
token is opaque and valid only for the request it was issued to: every other
field must be the same, or the call is refused. No list carries a total: a count
a person sees is its own answer (search's `counts_by_kind`, the inbox's
`countConversations`). The rule is `listPageSizeOf` and the page loop in
`src/pipeline/steps/list-page.ts`.

A list of resources (entries carrying `ApiResourceMetadata`) also takes a
`labels` map: only resources carrying every label given, each matched exactly.
The filter runs inside the page loop, so a selective filter answers short
pages, even empty ones, that still carry a token.

This document is the inventory of every list-shaped method of the contract, in
every edition, classed `paged` or `exempt` with why. It is held equal to the
contract by `src/pipeline/steps/__tests__/list-shapes-inventory.test.ts`, which
reads every service the stubs export. A method is list-shaped when its name
begins with `list`, `search` or `find`; when its request carries `page_size` or
`page_token` or its response `next_page_token`; or when its response has a
top-level repeated message field that holds a stored resource or is named
`entries` or `items`. A list-shaped method with no row here fails that test with
the row to write; a `paged` row whose request or response leaves the shape, or
whose response carries a total, fails too; and no message the contract carries
may be a `PageInfo`.

A get whose answer holds a breakdown is not a list: the usage reports, the agent
quality report, the run summary and the period estimate answer one total over a
range, and their repeated fields belong to that total. Evaluator `getByAgent`
answers one evaluator.

## The classes

- **paged**: the one shape above.
- **exempt**, with why: an answer computed by code rather than read from stored
  rows; an answer from an outside system, which keeps that system's own paging;
  a bounded window by design; or the session's event stream, which keeps its own
  `events` shape and a maximum of 1,000.

Rows read `| \`package.Service.method\` | class |`.

| Method | Class |
|---|---|
| `ai.stigmer.activity.v1.ActivityQueryController.listRecentActivity` | exempt: the recent activity window, the caller's most recent sessions by last activity, at most `page_size` of them by design, with no second page |
| `ai.stigmer.agentic.agent.v1.AgentQueryController.list` | paged |
| `ai.stigmer.agentic.agent.v1.AgentQueryController.listVersions` | paged |
| `ai.stigmer.agentic.agentchannel.v1.AgentChannelQueryController.list` | paged |
| `ai.stigmer.agentic.agentchannel.v1.AgentChannelQueryController.listByAgent` | paged |
| `ai.stigmer.agentic.agentchannel.v1.ChannelConversationQueryController.list` | paged |
| `ai.stigmer.agentic.agentchannel.v1.ChannelConversationQueryController.listTimeline` | paged |
| `ai.stigmer.agentic.agentchannel.v1.ChannelMessageQueryController.listMessagingChannels` | exempt: computed, the channels the calling agent may send business-initiated messages on, derived from its credential |
| `ai.stigmer.agentic.agentchannel.v1.ChannelMessageQueryController.listTemplates` | exempt: an outside system's answer, the channel provider's message templates, read live from its registry |
| `ai.stigmer.agentic.agenteval.v1.AgentEvalQueryController.listByAgent` | paged |
| `ai.stigmer.agentic.agentshare.v1.AgentShareQueryController.list` | paged |
| `ai.stigmer.agentic.agentshare.v1.AgentShareQueryController.listByAgent` | paged |
| `ai.stigmer.agentic.channelapp.v1.ChannelAppQueryController.list` | paged |
| `ai.stigmer.agentic.memory.v1.MemoryQueryController.list` | paged |
| `ai.stigmer.agentic.plugin.v1.PluginCommandController.listTools` | exempt: computed, the tools one server of a plugin offers, asked of the server through a runner |
| `ai.stigmer.agentic.plugin.v1.PluginQueryController.list` | paged |
| `ai.stigmer.agentic.plugin.v1.PluginQueryController.listVersions` | paged |
| `ai.stigmer.agentic.plugineval.v1.EvalRunQueryController.listByPlugin` | paged |
| `ai.stigmer.agentic.run.v1.RunQueryController.list` | paged |
| `ai.stigmer.agentic.run.v1.RunQueryController.listBySession` | paged |
| `ai.stigmer.agentic.schedule.v1.ScheduleQueryController.list` | paged |
| `ai.stigmer.agentic.schedule.v1.ScheduleQueryController.listByAgent` | paged |
| `ai.stigmer.agentic.schedule.v1.ScheduleQueryController.listFires` | paged |
| `ai.stigmer.agentic.score.v1.ScoreQueryController.listByRun` | paged |
| `ai.stigmer.agentic.score.v1.ScoreQueryController.listBySession` | paged |
| `ai.stigmer.agentic.score.v1.ScoreQueryController.listFlaggedByAgent` | paged |
| `ai.stigmer.agentic.session.v1.SessionQueryController.list` | paged |
| `ai.stigmer.agentic.session.v1.SessionQueryController.listByAgent` | paged |
| `ai.stigmer.agentic.session.v1.SessionQueryController.listByChannel` | paged |
| `ai.stigmer.agentic.session.v1.SessionQueryController.listEvents` | exempt: the session's event stream, paged by token in its own `events` shape, at most 1,000 events a page |
| `ai.stigmer.agentic.skill.v1.SkillQueryController.list` | paged |
| `ai.stigmer.agentic.skill.v1.SkillQueryController.listVersions` | paged |
| `ai.stigmer.agentic.vault.v1.VaultQueryController.list` | paged |
| `ai.stigmer.billing.license.v1.LicenseQueryController.list` | paged |
| `ai.stigmer.billing.plan.v1.PlanQueryController.list` | paged |
| `ai.stigmer.billing.providerkey.v1.ProviderKeyQueryController.list` | paged |
| `ai.stigmer.billing.v1.BillingQueryController.listModelPricingBaselines` | paged |
| `ai.stigmer.iam.apikey.v1.ApiKeyQueryController.list` | paged |
| `ai.stigmer.iam.apikey.v1.ApiKeyQueryController.listByAccount` | paged |
| `ai.stigmer.iam.iampolicy.v1.IamPolicyQueryController.listAccessHistory` | paged |
| `ai.stigmer.iam.iampolicy.v1.IamPolicyQueryController.listAuthorizedPrincipalIds` | exempt: an outside system's answer, the authorization engine's enumeration, capped at 1,000 and refused past it |
| `ai.stigmer.iam.iampolicy.v1.IamPolicyQueryController.listAuthorizedResourceIds` | exempt: an outside system's answer, the authorization engine's enumeration, capped at 1,000 and refused past it |
| `ai.stigmer.iam.iampolicy.v1.IamPolicyQueryController.listResourceAccessByPrincipal` | exempt: an outside system's answer, the authorization engine's enumeration, capped at 1,000 and refused past it |
| `ai.stigmer.iam.identityaccount.v1.IdentityAccountQueryController.listServiceAccounts` | paged |
| `ai.stigmer.iam.federationissuer.v1.FederationIssuerQueryController.list` | paged |
| `ai.stigmer.iam.invitation.v1.InvitationQueryController.list` | paged |
| `ai.stigmer.iam.oauthapp.v1.OAuthAppQueryController.list` | paged |
| `ai.stigmer.iam.team.v1.TeamQueryController.list` | paged |
| `ai.stigmer.platform.github.v1.GitHubQueryController.getTree` | exempt: an outside system's answer, GitHub's tree of one repository at one ref, as GitHub returns it |
| `ai.stigmer.platform.github.v1.GitHubQueryController.listBranches` | exempt: an outside system's answer, GitHub's branches with GitHub's own paging |
| `ai.stigmer.platform.github.v1.GitHubQueryController.listRepositories` | exempt: an outside system's answer, GitHub's repositories with GitHub's own paging |
| `ai.stigmer.platform.github.v1.GitHubQueryController.searchRepositories` | exempt: an outside system's answer, GitHub's repository search with GitHub's own paging |
| `ai.stigmer.search.v1.SearchService.search` | paged |
| `ai.stigmer.tenancy.organization.v1.OrganizationQueryController.listChildOrgs` | paged |
| `ai.stigmer.tenancy.organization.v1.OrganizationQueryController.listMine` | paged |
