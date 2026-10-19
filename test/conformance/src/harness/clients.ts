// Connect-RPC client factory for the conformance suite.
// Domain: conformance harness (transport + clients).
//
// The suite drives the server through the raw generated @stigmer/apis
// controllers (no SDK) so it tests the proto contract directly, independent of
// any client convenience layer that could drift from it.
import {
  createClient,
  type Client,
  type Interceptor,
  type Transport,
} from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { ActivityQueryController } from "@stigmer/apis/ai/stigmer/activity/v1/query_pb";
import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { ChannelCommandController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/command_pb";
import { ChannelConversationCommandController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/conversation_command_pb";
import { ChannelConversationQueryController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/conversation_query_pb";
import { ChannelMessageCommandController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/message_command_pb";
import { ChannelMessageQueryController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/message_query_pb";
import { ChannelQueryController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/query_pb";
import { EvalCommandController } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/command_pb";
import { EvalQueryController } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/query_pb";
import { EvalRunCommandController } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/command_pb";
import { EvalRunQueryController } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/query_pb";
import { RunCommandController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/command_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import { BillingCommandController } from "@stigmer/apis/ai/stigmer/billing/v1/command_pb";
import { ProviderKeyCommandController } from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/command_pb";
import { BillingQueryController } from "@stigmer/apis/ai/stigmer/billing/v1/query_pb";
import { PlanCommandController } from "@stigmer/apis/ai/stigmer/billing/plan/v1/command_pb";
import { PlanQueryController } from "@stigmer/apis/ai/stigmer/billing/plan/v1/query_pb";
import { SubscriptionCommandController } from "@stigmer/apis/ai/stigmer/billing/subscription/v1/command_pb";
import { SubscriptionQueryController } from "@stigmer/apis/ai/stigmer/billing/subscription/v1/query_pb";
import { ChannelAppCommandController } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/command_pb";
import { ChannelAppQueryController } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/query_pb";
import { EnvironmentCommandController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/query_pb";
import { FileCommandController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/command_pb";
import { FileMountController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/mount_pb";
import { FileQueryController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/query_pb";
import { MemoryCommandController } from "@stigmer/apis/ai/stigmer/agentic/memory/v1/command_pb";
import { MemoryQueryController } from "@stigmer/apis/ai/stigmer/agentic/memory/v1/query_pb";
import { RoutineCommandController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/command_pb";
import { RoutineQueryController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/query_pb";
import { ScoringRuleCommandController } from "@stigmer/apis/ai/stigmer/agentic/scoringrule/v1/command_pb";
import { ScoringRuleQueryController } from "@stigmer/apis/ai/stigmer/agentic/scoringrule/v1/query_pb";
import { ScoreCommandController } from "@stigmer/apis/ai/stigmer/agentic/score/v1/command_pb";
import { ScoreQueryController } from "@stigmer/apis/ai/stigmer/agentic/score/v1/query_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/query_pb";
import { PluginCommandController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/command_pb";
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { SkillCommandController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/command_pb";
import { SkillQueryController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/query_pb";
import { OAuthAppCommandController } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/command_pb";
import { OAuthAppQueryController } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/query_pb";
import { TokenService } from "@stigmer/apis/ai/stigmer/iam/token/v1/token_pb";
import { GitHubQueryController } from "@stigmer/apis/ai/stigmer/platform/github/v1/query_pb";
import { VaultCommandController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { ConnectLinkController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/connect_link_pb";
import { VaultValueController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/values_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { SearchService } from "@stigmer/apis/ai/stigmer/search/v1/query_pb";
import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { Health } from "@stigmer/apis/grpc/health/v1/health_pb";
import { ApiKeyCommandController } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/command_pb";
import { IdentityAccountCommandController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { GrantCommandController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/command_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { ApiKeyQueryController } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/query_pb";
import { FederationIssuerCommandController } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/command_pb";
import { FederationIssuerQueryController } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/query_pb";
import { InvitationCommandController } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/command_pb";
import { InvitationQueryController } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/query_pb";
import { TeamCommandController } from "@stigmer/apis/ai/stigmer/iam/team/v1/command_pb";
import { TeamQueryController } from "@stigmer/apis/ai/stigmer/iam/team/v1/query_pb";
import { rpcRecorder } from "./rpc-recorder";

export interface ConformanceClients {
  activityQuery: Client<typeof ActivityQueryController>;
  apiKeyCommand: Client<typeof ApiKeyCommandController>;
  // The billing engine's two controllers. Cloud-only by the edition
  // boundary: the local OSS targets route neither, so every call answers
  // Unimplemented there — the boundary the billing suite pins where
  // `billingEngine` is false.
  billingCommand: Client<typeof BillingCommandController>;
  billingQuery: Client<typeof BillingQueryController>;
  // An organization's own provider keys, which every native run on the
  // hosted edition needs. Cloud-only, like billing.
  providerKeyCommand: Client<typeof ProviderKeyCommandController>;
  // The plan catalog and subscriptions: cloud_only kinds, so the local OSS
  // targets route none of the four and the plans facet pins Unimplemented
  // where `billingPlans` is false.
  planCommand: Client<typeof PlanCommandController>;
  planQuery: Client<typeof PlanQueryController>;
  subscriptionCommand: Client<typeof SubscriptionCommandController>;
  subscriptionQuery: Client<typeof SubscriptionQueryController>;
  apiKeyQuery: Client<typeof ApiKeyQueryController>;
  channelAppCommand: Client<typeof ChannelAppCommandController>;
  channelAppQuery: Client<typeof ChannelAppQueryController>;
  environmentCommand: Client<typeof EnvironmentCommandController>;
  environmentQuery: Client<typeof EnvironmentQueryController>;
  fileCommand: Client<typeof FileCommandController>;
  fileQuery: Client<typeof FileQueryController>;
  // The runner's File mount: a suite sends it only to pin who is refused.
  fileMount: Client<typeof FileMountController>;
  channelCommand: Client<typeof ChannelCommandController>;
  channelConversationCommand: Client<
    typeof ChannelConversationCommandController
  >;
  channelConversationQuery: Client<typeof ChannelConversationQueryController>;
  channelMessageCommand: Client<typeof ChannelMessageCommandController>;
  channelMessageQuery: Client<typeof ChannelMessageQueryController>;
  channelQuery: Client<typeof ChannelQueryController>;
  search: Client<typeof SearchService>;
  identityAccountCommand: Client<typeof IdentityAccountCommandController>;
  identityAccountQuery: Client<typeof IdentityAccountQueryController>;
  grantCommand: Client<typeof GrantCommandController>;
  grantQuery: Client<typeof GrantQueryController>;
  // The identity kinds above open source: teams, invitation links and an
  // organization's own federation issuers. Open source routes none of the
  // six, so every call answers Unimplemented there — the boundary their
  // suites pin where `teams`, `invitations` and `federationIssuers` say
  // the target does not serve them.
  teamCommand: Client<typeof TeamCommandController>;
  teamQuery: Client<typeof TeamQueryController>;
  invitationCommand: Client<typeof InvitationCommandController>;
  invitationQuery: Client<typeof InvitationQueryController>;
  federationIssuerCommand: Client<typeof FederationIssuerCommandController>;
  federationIssuerQuery: Client<typeof FederationIssuerQueryController>;
  organizationCommand: Client<typeof OrganizationCommandController>;
  organizationQuery: Client<typeof OrganizationQueryController>;
  agentExecutionCommand: Client<typeof RunCommandController>;
  agentExecutionQuery: Client<typeof RunQueryController>;
  agentCommand: Client<typeof AgentCommandController>;
  agentQuery: Client<typeof AgentQueryController>;
  vaultCommand: Client<typeof VaultCommandController>;
  vaultQuery: Client<typeof VaultQueryController>;
  connectLink: Client<typeof ConnectLinkController>;
  vaultValue: Client<typeof VaultValueController>;
  memoryCommand: Client<typeof MemoryCommandController>;
  memoryQuery: Client<typeof MemoryQueryController>;
  routineCommand: Client<typeof RoutineCommandController>;
  routineQuery: Client<typeof RoutineQueryController>;
  scoreCommand: Client<typeof ScoreCommandController>;
  scoreQuery: Client<typeof ScoreQueryController>;
  scoringRuleCommand: Client<typeof ScoringRuleCommandController>;
  scoringRuleQuery: Client<typeof ScoringRuleQueryController>;
  sessionCommand: Client<typeof SessionCommandController>;
  sessionQuery: Client<typeof SessionQueryController>;
  skillCommand: Client<typeof SkillCommandController>;
  skillQuery: Client<typeof SkillQueryController>;
  pluginCommand: Client<typeof PluginCommandController>;
  pluginQuery: Client<typeof PluginQueryController>;
  evalCommand: Client<typeof EvalCommandController>;
  evalQuery: Client<typeof EvalQueryController>;
  evalRunCommand: Client<typeof EvalRunCommandController>;
  evalRunQuery: Client<typeof EvalRunQueryController>;
  platformQuery: Client<typeof PlatformQueryController>;
  // The standard gRPC health service — an external proto both editions serve
  // on the RPC port. The authentication suite pins its tokenless reachability
  // (the Kubernetes grpc-probe contract).
  health: Client<typeof Health>;
  githubQuery: Client<typeof GitHubQueryController>;
  oauthAppCommand: Client<typeof OAuthAppCommandController>;
  oauthAppQuery: Client<typeof OAuthAppQueryController>;
  // The token service, served by every edition: mintUserToken (a service
  // account's key, on a server that authenticates its callers) and
  // mintGuestToken where an edition hosts web channels' chat pages.
  token: Client<typeof TokenService>;
}

export interface TransportOptions {
  // Attached as `authorization: Bearer <token>` on every RPC. Used by the
  // cloud target, whose service authenticates callers; local targets run
  // without auth and omit it.
  bearerToken?: string;
  // Stamped as the plain lowercase `origin` metadata key on every RPC — the
  // header browsers attach to cross-origin fetches and page script cannot
  // forge. Suites set it to simulate a browser context (the embedding
  // allowed_origins enforcement arms replay a leaked token from a foreign
  // site this way); leaving it unset mirrors non-browser callers (curl,
  // backend services), whose absence of Origin never refuses.
  origin?: string;
}

// What a caller presenting a bearer may add: the browser context the
// embedding origin arm replays a leaked token from.
export type PresentingOptions = Pick<TransportOptions, "origin">;

export function createTransport(
  baseUrl: string,
  options: TransportOptions = {},
): Transport {
  // Plain gRPC over h2c: createGrpcTransport always speaks HTTP/2, matching
  // both backends — the OSS server and the hermetic cloud service each serve
  // native gRPC on a single insecure local port.
  // Every call is attributed to the test that sent it, so a test tagged
  // `[rpc:...]` fails if it never sends that RPC (rpc-recorder.ts).
  const interceptors: Interceptor[] = [rpcRecorder];
  if (options.bearerToken !== undefined) {
    const authorization = `Bearer ${options.bearerToken}`;
    interceptors.push((next) => (req) => {
      req.header.set("authorization", authorization);
      return next(req);
    });
  }
  if (options.origin !== undefined) {
    const origin = options.origin;
    interceptors.push((next) => (req) => {
      req.header.set("origin", origin);
      return next(req);
    });
  }
  return createGrpcTransport({ baseUrl, interceptors });
}

export function makeClients(transport: Transport): ConformanceClients {
  return {
    activityQuery: createClient(ActivityQueryController, transport),
    channelAppCommand: createClient(ChannelAppCommandController, transport),
    channelAppQuery: createClient(ChannelAppQueryController, transport),
    environmentCommand: createClient(EnvironmentCommandController, transport),
    environmentQuery: createClient(EnvironmentQueryController, transport),
    fileCommand: createClient(FileCommandController, transport),
    fileQuery: createClient(FileQueryController, transport),
    fileMount: createClient(FileMountController, transport),
    channelCommand: createClient(ChannelCommandController, transport),
    channelConversationCommand: createClient(
      ChannelConversationCommandController,
      transport,
    ),
    channelConversationQuery: createClient(
      ChannelConversationQueryController,
      transport,
    ),
    channelMessageCommand: createClient(
      ChannelMessageCommandController,
      transport,
    ),
    channelMessageQuery: createClient(ChannelMessageQueryController, transport),
    channelQuery: createClient(ChannelQueryController, transport),
    search: createClient(SearchService, transport),
    apiKeyCommand: createClient(ApiKeyCommandController, transport),
    billingCommand: createClient(BillingCommandController, transport),
    billingQuery: createClient(BillingQueryController, transport),
    providerKeyCommand: createClient(ProviderKeyCommandController, transport),
    planCommand: createClient(PlanCommandController, transport),
    planQuery: createClient(PlanQueryController, transport),
    subscriptionCommand: createClient(SubscriptionCommandController, transport),
    subscriptionQuery: createClient(SubscriptionQueryController, transport),
    apiKeyQuery: createClient(ApiKeyQueryController, transport),
    identityAccountCommand: createClient(
      IdentityAccountCommandController,
      transport,
    ),
    identityAccountQuery: createClient(
      IdentityAccountQueryController,
      transport,
    ),
    grantCommand: createClient(GrantCommandController, transport),
    grantQuery: createClient(GrantQueryController, transport),
    teamCommand: createClient(TeamCommandController, transport),
    teamQuery: createClient(TeamQueryController, transport),
    invitationCommand: createClient(InvitationCommandController, transport),
    invitationQuery: createClient(InvitationQueryController, transport),
    federationIssuerCommand: createClient(FederationIssuerCommandController, transport),
    federationIssuerQuery: createClient(FederationIssuerQueryController, transport),
    organizationCommand: createClient(OrganizationCommandController, transport),
    organizationQuery: createClient(OrganizationQueryController, transport),
    agentExecutionCommand: createClient(
      RunCommandController,
      transport,
    ),
    agentExecutionQuery: createClient(RunQueryController, transport),
    agentCommand: createClient(AgentCommandController, transport),
    agentQuery: createClient(AgentQueryController, transport),
    vaultCommand: createClient(VaultCommandController, transport),
    vaultQuery: createClient(VaultQueryController, transport),
    connectLink: createClient(ConnectLinkController, transport),
    vaultValue: createClient(VaultValueController, transport),
    memoryCommand: createClient(MemoryCommandController, transport),
    memoryQuery: createClient(MemoryQueryController, transport),
    routineCommand: createClient(RoutineCommandController, transport),
    routineQuery: createClient(RoutineQueryController, transport),
    scoreCommand: createClient(ScoreCommandController, transport),
    scoreQuery: createClient(ScoreQueryController, transport),
    scoringRuleCommand: createClient(ScoringRuleCommandController, transport),
    scoringRuleQuery: createClient(ScoringRuleQueryController, transport),
    sessionCommand: createClient(SessionCommandController, transport),
    sessionQuery: createClient(SessionQueryController, transport),
    skillCommand: createClient(SkillCommandController, transport),
    skillQuery: createClient(SkillQueryController, transport),
    pluginCommand: createClient(PluginCommandController, transport),
    pluginQuery: createClient(PluginQueryController, transport),
    evalCommand: createClient(EvalCommandController, transport),
    evalQuery: createClient(EvalQueryController, transport),
    evalRunCommand: createClient(EvalRunCommandController, transport),
    evalRunQuery: createClient(EvalRunQueryController, transport),
    platformQuery: createClient(PlatformQueryController, transport),
    health: createClient(Health, transport),
    githubQuery: createClient(GitHubQueryController, transport),
    oauthAppCommand: createClient(OAuthAppCommandController, transport),
    oauthAppQuery: createClient(OAuthAppQueryController, transport),
    token: createClient(TokenService, transport),
  };
}
