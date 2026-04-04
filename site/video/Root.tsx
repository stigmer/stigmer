import { Composition } from "remotion";
import { HelloWorld } from "./compositions/HelloWorld";
import { DemoVideo } from "./compositions/DemoVideo";
import { computeTimeline } from "./lib/timeline";
import type { NarrationManifest } from "@/components/docs/demos/engine/narration";

import { agentCreationTourSteps } from "@/components/docs/demos/scenarios/agent-creation-tour/steps";
import { apiKeySetupSteps } from "@/components/docs/demos/scenarios/api-key-setup/steps";
import { approvalFlowSteps } from "@/components/docs/demos/scenarios/approval-flow-playback/steps";
import { discoverSteps } from "@/components/docs/demos/scenarios/discover-capabilities-playback/steps";
import { generatePoliciesSteps } from "@/components/docs/demos/scenarios/generate-policies-playback/steps";
import { mcpCreationTourSteps } from "@/components/docs/demos/scenarios/mcp-server-creation-tour/steps";
import { quickstartPlaybackSteps } from "@/components/docs/demos/scenarios/quickstart-playback/steps";
import { sessionMemorySteps } from "@/components/docs/demos/scenarios/session-memory-playback/steps";
import { skillCreationTourSteps } from "@/components/docs/demos/scenarios/skill-creation-tour/steps";
import { toolCallsPlaybackSteps } from "@/components/docs/demos/scenarios/tool-calls-playback/steps";

import agentCreationManifest from "../public/demos/agent-creation-tour/manifest.json";
import apiKeySetupManifest from "../public/demos/api-key-setup/manifest.json";
import approvalFlowManifest from "../public/demos/approval-flow-playback/manifest.json";
import discoverManifest from "../public/demos/discover-capabilities-playback/manifest.json";
import generatePoliciesManifest from "../public/demos/generate-policies-playback/manifest.json";
import mcpCreationManifest from "../public/demos/mcp-server-creation-tour/manifest.json";
import quickstartManifest from "../public/demos/quickstart-playback/manifest.json";
import sessionMemoryManifest from "../public/demos/session-memory-playback/manifest.json";
import skillCreationManifest from "../public/demos/skill-creation-tour/manifest.json";
import toolCallsManifest from "../public/demos/tool-calls-playback/manifest.json";

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

/**
 * Each entry pairs a scenario ID (matching the registry key and the
 * public/demos/ directory name) with its steps array and narration
 * manifest. Timelines are computed at module load time — no runtime
 * cost during rendering.
 */
const SCENARIO_DEFS: {
  id: string;
  steps: readonly { delayMs: number }[];
  manifest: NarrationManifest;
}[] = [
  { id: "agent-creation-tour", steps: agentCreationTourSteps, manifest: agentCreationManifest as NarrationManifest },
  { id: "api-key-setup", steps: apiKeySetupSteps, manifest: apiKeySetupManifest as NarrationManifest },
  { id: "approval-flow-playback", steps: approvalFlowSteps, manifest: approvalFlowManifest as NarrationManifest },
  { id: "discover-capabilities-playback", steps: discoverSteps, manifest: discoverManifest as NarrationManifest },
  { id: "generate-policies-playback", steps: generatePoliciesSteps, manifest: generatePoliciesManifest as NarrationManifest },
  { id: "mcp-server-creation-tour", steps: mcpCreationTourSteps, manifest: mcpCreationManifest as NarrationManifest },
  { id: "quickstart-playback", steps: quickstartPlaybackSteps, manifest: quickstartManifest as NarrationManifest },
  { id: "session-memory-playback", steps: sessionMemorySteps, manifest: sessionMemoryManifest as NarrationManifest },
  { id: "skill-creation-tour", steps: skillCreationTourSteps, manifest: skillCreationManifest as NarrationManifest },
  { id: "tool-calls-playback", steps: toolCallsPlaybackSteps, manifest: toolCallsManifest as NarrationManifest },
];

const scenarios = SCENARIO_DEFS.map(({ id, steps, manifest }) => ({
  id,
  timeline: computeTimeline(steps, manifest, FPS),
}));

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HelloWorld"
        component={HelloWorld}
        durationInFrames={90}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      {scenarios.map(({ id, timeline }) => (
        <Composition
          key={id}
          id={id}
          component={DemoVideo}
          durationInFrames={timeline.totalFrames}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
          defaultProps={{ scenarioId: id, timeline }}
        />
      ))}
    </>
  );
};
