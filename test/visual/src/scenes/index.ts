// Every scene's drawing, by the catalogue's id. The map is typed by
// `SceneId`, so a scene the catalogue lists without a drawing here, or a
// drawing for an id it does not list, fails the typecheck.
import { PRESETS, THREAD_STATES, type Preset, type SceneId, type ThreadState } from "../catalog.ts";
import { inheritedOpenAiKey, NOTHING_CONNECTED, NOTHING_ON_THE_RUNNER, ownAnthropicKey } from "../fixtures.ts";
import { fileReviewDockScene } from "./conversation.tsx";
import { agentChatScene } from "./agent-chat.tsx";
import { agentProfileScene } from "./agent.tsx";
import { fromHooksScene } from "./from-hooks.tsx";
import { varianceReporterScene } from "./agent-pages.tsx";
import { skillDetailScene } from "./skill.tsx";
import { dashboardPageScene, dashboardScene } from "./dashboard.tsx";
import { marketplaceScene } from "./marketplace.tsx";
import {
  settingsApiKeysScene,
  settingsBillingScene,
  settingsLandingScene,
  settingsMembersScene,
  settingsLoadingScene,
  settingsModelCatalogScene,
  settingsTeamsOssScene,
  settingsUsageScene,
  settingsVaultsScene,
} from "./settings-pages.tsx";
import type { Drawing } from "./drawing.ts";
import {
  ANTHROPIC_ONLY,
  CONNECTED,
  launcherScene,
  modelSelectorNotReadyScene,
  modelsHubLocalScene,
  modelsHubScene,
} from "./models.tsx";
import { agentChannelsScene, embedWidgetScene } from "./channel.tsx";
import { channelAppsScene } from "./channel-app.tsx";
import { oauthAppsScene, serviceAccountsScene } from "./access.tsx";
import { conversationsScene } from "./conversations.tsx";
import { agentEnvironmentScene, environmentNewScene, runSettingsScene } from "./environment.tsx";
import { routineDetailScene, routineNewScene } from "./routine.tsx";
import { modelSelectorScene } from "./settings.tsx";
import { sessionScene, sessionStartingScene, stepStoryScene } from "./session.tsx";
import { asksFirstScene, hoursScene, inProductScene, keysScene, ownComputerScene, wallsScene } from "./story.tsx";
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
  "dashboard-busy": () => dashboardPageScene("busy"),
  "dashboard-new-org": () => dashboardPageScene("new-org"),
  "settings-landing": settingsLandingScene,
  "settings-members": settingsMembersScene,
  "settings-api-keys": settingsApiKeysScene,
  "settings-vaults": settingsVaultsScene,
  "settings-billing": settingsBillingScene,
  "settings-usage": settingsUsageScene,
  "settings-teams-oss": settingsTeamsOssScene,
  "settings-model-catalog": settingsModelCatalogScene,
  "settings-loading": settingsLoadingScene,
  "agent-profile-owner": () => agentProfileScene("owner"),
  "agent-profile-viewer": () => agentProfileScene("reader"),
  "agent-profile-variance-reporter": varianceReporterScene,
  "skill-detail": skillDetailScene,
  "marketplace-admin": () => marketplaceScene("admin"),
  "marketplace-member": () => marketplaceScene("member"),
  "session-busy": () => sessionScene("busy", { inspector: true }),
  "session-approval": () => sessionScene("approval", { inspector: true }),
  "session-finished": () => sessionScene("finished", { inspector: true }),
  "session-inspector": () => sessionScene("finished", { inspector: true }),
  "session-failed": () => sessionScene("failed", { inspector: true }),
  "session-end-user": () => sessionScene("busy", { audience: "endUser" }),
  "session-guest": () => sessionScene("finished", { audience: "guest" }),
  "session-observer": () => sessionScene("finished", { audience: "observer", inspector: true }),
  "session-load-failed": () => sessionScene("load-failed", { inspector: true }),
  "session-steps-opened": () => sessionScene("busy", { inspector: true }),
  "session-how-opened": () => sessionScene("finished", { inspector: true }),
  "session-mcp": () => stepStoryScene("mcp-turn", { inspector: true }),
  "session-many-files": () => stepStoryScene("many-files", { inspector: true }),
  "session-file-steps": () => stepStoryScene("file-steps", { inspector: true }),
  "session-shell-steps": () => stepStoryScene("shell-steps", { inspector: true }),
  "session-slow": () => sessionScene("busy", { inspector: true }),
  "session-starting": () => sessionStartingScene(),
  "story-asks-first": asksFirstScene,
  "story-in-product": inProductScene,
  "story-own-computer": ownComputerScene,
  "story-hours": hoursScene,
  "story-walls": wallsScene,
  "story-keys": keysScene,
  "story-embed": embedWidgetScene,
  "agent-chat-page": () => agentChatScene("finished", "page", true),
  "routine-new": routineNewScene,
  "routine-disabled": () => routineDetailScene("disabled"),
  "routine-history": () => routineDetailScene("history"),
  "environment-new": environmentNewScene,
  "environment-agent": agentEnvironmentScene,
  "environment-run-settings": runSettingsScene,
  "channel-list": () => agentChannelsScene("all"),
  "channel-add": () => agentChannelsScene("chat-link"),
  "channel-chat-link": () => agentChannelsScene("all"),
  "channel-chat-link-embed": () => agentChannelsScene("all"),
  "channel-connect-slack": () => agentChannelsScene("chat-link"),
  "channel-connect-whatsapp": () => agentChannelsScene("chat-link"),
  "channel-app-new": () => channelAppsScene(false),
  "channel-app-setup": () => channelAppsScene(true),
  "channel-conversations-needs-human": () => conversationsScene("agent"),
  "channel-conversation-taken-over": () => conversationsScene("ada"),
  "access-service-account-new": () => serviceAccountsScene("not-yet"),
  "access-service-account-first-key": () => serviceAccountsScene("not-yet"),
  "access-service-account-key-revealed": () => serviceAccountsScene("not-yet"),
  "access-service-account-detail": () => serviceAccountsScene("made"),
  "access-oauth-app-new": () => oauthAppsScene(),
  "agent-chat-panel": () => agentChatScene("busy", "panel", true),
  "agent-chat-popup-closed": () => agentChatScene("busy", "popup", false),
  "agent-chat-popup": () => agentChatScene("finished", "popup", true),
  "from-hooks": fromHooksScene,
  ...presets,
};
