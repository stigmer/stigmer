import type { ComponentType } from "react";
import { AgentCreationTour } from "./agent-creation-tour";
import { ApiKeySetup } from "./api-key-setup";
import { ApprovalFlowPlayback } from "./approval-flow-playback";
import { ConnectPlayback } from "./connect-playback";
import { McpServerCreationTour } from "./mcp-server-creation-tour";
import { QuickstartPlayback } from "./quickstart-playback";
import { SessionMemoryPlayback } from "./session-memory-playback";
import { SkillCreationTour } from "./skill-creation-tour";
import { ToolCallsPlayback } from "./tool-calls-playback";
import { AuthenticationFlowPlayback } from "./authentication-flow-playback";
import { FederationOverviewTour } from "./federation-overview-tour";
import { RegisterIdpPlayback } from "./register-idp-playback";
import { ProvisionGrantPlayback } from "./provision-grant-playback";
import { MultiTenantSetupPlayback } from "./multi-tenant-setup-playback";
import { SsoLoginPlayback } from "./sso-login-playback";
import { QuickstartTour } from "./quickstart-tour";
import { FirstSkillTour } from "./first-skill-tour";
import { ConnectToolsTour } from "./connect-tools-tour";
import { CreateAgentTour } from "./create-agent-tour";
import { MarketplaceConnectTour } from "./marketplace-connect-tour";
import { OAuthConnectFlow } from "./oauth-connect-flow";
import { ByoaSetup } from "./byoa-setup";

/**
 * Maps scenario directory names to their React components.
 *
 * Used by the video export page to render scenarios by ID and by
 * the export script to enumerate all recordable scenarios.
 * Only includes playback/tour scenarios — static detail views
 * are not recorded.
 */
export const SCENARIO_REGISTRY: Record<string, ComponentType> = {
  "agent-creation-tour": AgentCreationTour,
  "api-key-setup": ApiKeySetup,
  "approval-flow-playback": ApprovalFlowPlayback,
  "connect-playback": ConnectPlayback,
  "mcp-server-creation-tour": McpServerCreationTour,
  "quickstart-playback": QuickstartPlayback,
  "session-memory-playback": SessionMemoryPlayback,
  "skill-creation-tour": SkillCreationTour,
  "tool-calls-playback": ToolCallsPlayback,
  "authentication-flow-playback": AuthenticationFlowPlayback,
  "federation-overview-tour": FederationOverviewTour,
  "register-idp-playback": RegisterIdpPlayback,
  "provision-grant-playback": ProvisionGrantPlayback,
  "multi-tenant-setup-playback": MultiTenantSetupPlayback,
  "sso-login-playback": SsoLoginPlayback,
  "quickstart-tour": QuickstartTour,
  "first-skill-tour": FirstSkillTour,
  "connect-tools-tour": ConnectToolsTour,
  "create-agent-tour": CreateAgentTour,
  "marketplace-connect-tour": MarketplaceConnectTour,
  "oauth-connect-flow": OAuthConnectFlow,
  "byoa-setup": ByoaSetup,
};

export const PLAYBACK_SCENARIO_IDS = Object.keys(SCENARIO_REGISTRY);
