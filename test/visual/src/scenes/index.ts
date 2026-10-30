// Every scene's drawing, by the catalogue's id. The map is typed by
// `SceneId`, so a scene the catalogue lists without a drawing here, or a
// drawing for an id it does not list, fails the typecheck.
import { PRESETS, THREAD_STATES, type Preset, type SceneId, type ThreadState } from "../catalog.ts";
import { inheritedOpenAiKey, NOTHING_CONNECTED, NOTHING_ON_THE_RUNNER, ownAnthropicKey } from "../fixtures.ts";
import { fileReviewDockScene } from "./conversation.tsx";
import { agentChatScene } from "./agent-chat.tsx";
import { dashboardScene } from "./dashboard.tsx";
import type { Drawing } from "./drawing.ts";
import {
  ANTHROPIC_ONLY,
  CONNECTED,
  launcherScene,
  modelSelectorNotReadyScene,
  modelsHubLocalScene,
  modelsHubScene,
} from "./models.tsx";
import { modelSelectorScene } from "./settings.tsx";
import { sessionScene } from "./session.tsx";
import { threadScene } from "./thread.tsx";

const threads = Object.fromEntries(THREAD_STATES.map((state) => [`thread-${state}`, () => threadScene(state)])) as Record<
  `thread-${ThreadState}`,
  () => Drawing
>;

const presets = Object.fromEntries(PRESETS.map((preset) => [`preset-${preset}`, () => threadScene("completed", preset)])) as Record<
  `preset-${Preset}`,
  () => Drawing
>;

/** Every scene's drawing, built when the page draws it. */
export const DRAWINGS: Readonly<Record<SceneId, () => Drawing>> = {
  ...threads,
  "file-review-dock": fileReviewDockScene,
  "models-hub-none": () => modelsHubScene(NOTHING_CONNECTED, [], "admin"),
  "models-hub-connected": () => modelsHubScene(CONNECTED, [ownAnthropicKey(), inheritedOpenAiKey()], "admin"),
  "models-hub-local": modelsHubLocalScene,
  "models-hub-member": () => modelsHubScene(NOTHING_CONNECTED, [], "member"),
  "launcher-ready": () => launcherScene(ANTHROPIC_ONLY, "admin"),
  "launcher-connect-admin": () => launcherScene(NOTHING_CONNECTED, "admin"),
  "launcher-connect-member": () => launcherScene(NOTHING_CONNECTED, "member"),
  "launcher-connect-local": () => launcherScene(NOTHING_ON_THE_RUNNER, "admin", true),
  "model-selector-open": modelSelectorScene,
  "model-selector-not-ready": modelSelectorNotReadyScene,
  "dashboard-kpis": dashboardScene,
  "session-busy": () => sessionScene("busy", { inspector: true }),
  "session-approval": () => sessionScene("approval", { inspector: true }),
  "session-finished": () => sessionScene("finished", { inspector: true }),
  "session-inspector": () => sessionScene("finished", { inspector: true }),
  "session-failed": () => sessionScene("failed", { inspector: true }),
  "session-end-user": () => sessionScene("busy", { audience: "endUser" }),
  "session-guest": () => sessionScene("finished", { audience: "guest" }),
  "session-observer": () => sessionScene("finished", { audience: "observer", inspector: true }),
  "session-load-failed": () => sessionScene("load-failed", { inspector: true }),
  "agent-chat-panel": () => agentChatScene("busy", "panel", true),
  "agent-chat-popup-closed": () => agentChatScene("busy", "popup", false),
  "agent-chat-popup": () => agentChatScene("finished", "popup", true),
  ...presets,
};
