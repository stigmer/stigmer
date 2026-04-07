import type { ComponentType } from "react";
import { AgentCreationTour } from "./agent-creation-tour";
import { ApiKeySetup } from "./api-key-setup";
import { ApprovalFlowPlayback } from "./approval-flow-playback";
import { DiscoverCapabilitiesPlayback } from "./discover-capabilities-playback";
import { GeneratePoliciesPlayback } from "./generate-policies-playback";
import { McpServerCreationTour } from "./mcp-server-creation-tour";
import { QuickstartPlayback } from "./quickstart-playback";
import { SessionMemoryPlayback } from "./session-memory-playback";
import { SkillCreationTour } from "./skill-creation-tour";
import { ToolCallsPlayback } from "./tool-calls-playback";
import { AuthenticationFlowPlayback } from "./authentication-flow-playback";
import { FederationOverviewTour } from "./federation-overview-tour";
import { RegisterIdpPlayback } from "./register-idp-playback";
import { ProvisionGrantPlayback } from "./provision-grant-playback";

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
  "discover-capabilities-playback": DiscoverCapabilitiesPlayback,
  "generate-policies-playback": GeneratePoliciesPlayback,
  "mcp-server-creation-tour": McpServerCreationTour,
  "quickstart-playback": QuickstartPlayback,
  "session-memory-playback": SessionMemoryPlayback,
  "skill-creation-tour": SkillCreationTour,
  "tool-calls-playback": ToolCallsPlayback,
  "authentication-flow-playback": AuthenticationFlowPlayback,
  "federation-overview-tour": FederationOverviewTour,
  "register-idp-playback": RegisterIdpPlayback,
  "provision-grant-playback": ProvisionGrantPlayback,
};

export const PLAYBACK_SCENARIO_IDS = Object.keys(SCENARIO_REGISTRY);
