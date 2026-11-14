// Every scene's drawing, by the catalogue's id. The map is typed by
// `SceneId`, so a scene the catalogue lists without a drawing here, or a
// drawing for an id it does not list, fails the typecheck.
import { agentInAppScene } from "./in-app.tsx";
import { bringOthersInScene } from "./bring-others-in.tsx";
import { PRESETS, THREAD_STATES, type Preset, type SceneId, type ThreadState } from "../catalog.ts";
import { inheritedOpenAiKey, NOTHING_CONNECTED, NOTHING_ON_THE_RUNNER, ownAnthropicKey } from "../fixtures.ts";
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
  settingsServiceAccountsDeniedScene,
  settingsVaultsFailedScene,
  settingsVaultsOpenScene,
  settingsVaultsScene,
} from "./settings-pages.tsx";
import { partsScene } from "./parts.tsx";
import { helpNoneScene, helpScene } from "./help.tsx";
import type { Drawing } from "./drawing.ts";
import {
  ANTHROPIC_ONLY,
  CONNECTED,
  launcherFirstQuestionScene,
  launcherRefusedScene,
  launcherScene,
  runRefusal,
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
import {
  endingStoryScene,
  sessionAgentVersionScene,
  sessionAttachmentsScene,
  sessionAutoApproveScene,
  sessionCompactedScene,
  sessionFilePreviewScene,
  sessionFileProgressScene,
  sessionFileUndoneScene,
  sessionPlanBuildScene,
  sessionPlanWritingScene,
  sessionPullRequestsScene,
  sessionScene,
  sessionSendFailedScene,
  sessionStartingScene,
  stepStoryScene,
} from "./session.tsx";
import { asksFirstScene, hoursScene, inProductScene, keysScene, ownComputerScene, wallsScene } from "./story.tsx";
import { threadScene } from "./thread.tsx";
import {
  agentMakeItYoursScene,
  dashboardJourneyFoldedScene,
  dashboardJourneyScene,
  launcherNextLineScene,
  launcherOwnFileScene,
  MADE_YOURS,
  PICKED_NOT_RUN,
  sessionFirstJobNextScene,
} from "./journey.tsx";

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
  "models-hub-none": () => modelsHubScene(NOTHING_CONNECTED, [], "admin"),
  "models-hub-connected": () => modelsHubScene(CONNECTED, [ownAnthropicKey(), inheritedOpenAiKey()], "admin"),
  "models-hub-local": modelsHubLocalScene,
  "models-hub-member": () => modelsHubScene(NOTHING_CONNECTED, [], "member"),
  "launcher-ready": () => launcherScene(ANTHROPIC_ONLY, "admin"),
  "launcher-key-missing": () =>
    launcherRefusedScene(
      runRefusal("This organization has no Anthropic key for model 'claude-sonnet-4-6', so the run was not started.", "PROVIDER_KEY_REQUIRED", {
        org: "acme",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      }),
    ),
  "launcher-hours-used": () =>
    launcherRefusedScene(
      runRefusal("Your organization has used the 40 agent hours in its Team plan this month.", "AGENT_HOURS_USED_UP", {
        org: "acme",
        plan: "team",
        included_hours: "40",
        resets_at: "2026-12-01T00:00:00Z",
      }),
    ),
  "launcher-connect-admin": () => launcherScene(NOTHING_CONNECTED, "admin"),
  "launcher-connect-member": () => launcherScene(NOTHING_CONNECTED, "member"),
  "launcher-connect-local": () => launcherScene(NOTHING_ON_THE_RUNNER, "admin", true),
  "launcher-first-question": () => launcherFirstQuestionScene(ANTHROPIC_ONLY),
  "launcher-coding-agent": () => ({ ...launcherFirstQuestionScene(ANTHROPIC_ONLY), publicBaseUrl: "https://stigmer.acme.example" }),
  "launcher-example-connect": () => launcherFirstQuestionScene(NOTHING_CONNECTED),
  "launcher-example-rejected": () => launcherFirstQuestionScene(NOTHING_CONNECTED, "rejected"),
  "launcher-example-unchecked": () => launcherFirstQuestionScene(NOTHING_CONNECTED, "unchecked"),
  "launcher-example-ready": () => launcherFirstQuestionScene(ANTHROPIC_ONLY),
  "launcher-describe-own": () => launcherFirstQuestionScene(ANTHROPIC_ONLY),
  "launcher-own-file": launcherOwnFileScene,
  "launcher-next-line": launcherNextLineScene,
  "model-selector-open": modelSelectorScene,
  "model-selector-not-ready": modelSelectorNotReadyScene,
  "dashboard-kpis": dashboardScene,
  "dashboard-busy": () => dashboardPageScene("busy"),
  "dashboard-new-org": () => dashboardPageScene("new-org"),
  "dashboard-journey-new": () => dashboardJourneyScene(PICKED_NOT_RUN),
  "dashboard-journey-mid": () => dashboardJourneyScene(MADE_YOURS),
  "dashboard-journey-folded": dashboardJourneyFoldedScene,
  "settings-landing": settingsLandingScene,
  "settings-members": settingsMembersScene,
  "settings-api-keys": settingsApiKeysScene,
  "settings-vaults": settingsVaultsScene,
  "settings-vaults-open": settingsVaultsOpenScene,
  "settings-vaults-failed": settingsVaultsFailedScene,
  "settings-service-accounts-denied": settingsServiceAccountsDeniedScene,
  "settings-billing": settingsBillingScene,
  "settings-usage": settingsUsageScene,
  "settings-teams-oss": settingsTeamsOssScene,
  "settings-model-catalog": settingsModelCatalogScene,
  "settings-loading": settingsLoadingScene,
  "agent-profile-owner": () => agentProfileScene("owner"),
  "agent-profile-viewer": () => agentProfileScene("reader"),
  "agent-profile-variance-reporter": varianceReporterScene,
  "agent-make-it-yours": () => agentMakeItYoursScene(true),
  "agent-make-it-yours-member": () => agentMakeItYoursScene(false),
  "agent-in-app": () => agentInAppScene("todo"),
  "agent-in-app-done": () => agentInAppScene("done"),
  "agent-in-app-member": () => agentInAppScene("member"),
  "agent-in-app-local": () => agentInAppScene("local"),
  "bring-others-in": () => bringOthersInScene("unnamed"),
  "bring-others-in-link": () => bringOthersInScene("link"),
  "bring-others-in-joined": () => bringOthersInScene("joined"),
  "bring-others-in-local": () => bringOthersInScene("local"),
  "skill-detail": skillDetailScene,
  "marketplace-admin": () => marketplaceScene("admin"),
  "marketplace-member": () => marketplaceScene("member"),
  "marketplace-no-match": () => marketplaceScene("admin"),
  "session-waiting-for-sandbox": () => sessionScene("waiting-for-sandbox", { inspector: true }),
  "session-thinking": () => sessionScene("thinking", { inspector: true }),
  "session-busy": () => sessionScene("busy", { inspector: true }),
  "session-helper": () => sessionScene("subagent-running", { inspector: true }),
  "session-file-progress": () => sessionFileProgressScene(),
  "session-file-review": () => sessionScene("file-review", { inspector: true }),
  "session-plan-build": () => sessionPlanBuildScene(),
  "session-file-undone": () => sessionFileUndoneScene(),
  "session-plan-writing": () => sessionPlanWritingScene(),
  "session-compacted": () => sessionCompactedScene(),
  "session-attachments": () => sessionAttachmentsScene(),
  "session-pull-requests": () => sessionPullRequestsScene(),
  "session-usage": () => sessionScene("finished", { inspector: true }),
  "session-file-preview": () => sessionFilePreviewScene(),
  "session-auto-approve": () => sessionAutoApproveScene(),
  "session-agent-version": () => sessionAgentVersionScene(),
  "session-participant": () => sessionScene("approval", { inspector: true, role: "participant" }),
  "session-approval": () => sessionScene("approval", { inspector: true }),
  "session-finished": () => sessionScene("finished", { inspector: true }),
  "session-inspector": () => sessionScene("finished", { inspector: true }),
  "session-failed": () => sessionScene("failed", { inspector: true }),
  "session-end-user": () => sessionScene("busy", { audience: "endUser" }),
  "session-end-user-framed": () => sessionScene("busy", { audience: "endUser" }),
  "session-guest": () => sessionScene("finished", { audience: "guest" }),
  "session-observer": () => sessionScene("finished", { audience: "observer", inspector: true }),
  "session-load-failed": () => sessionScene("load-failed", { inspector: true }),
  "session-send-failed": () => sessionSendFailedScene(),
  "session-steps-opened": () => sessionScene("busy", { inspector: true, height: 1800 }),
  "session-how-opened": () => sessionScene("finished", { inspector: true, height: 1400 }),
  "session-mcp": () => stepStoryScene("mcp-turn", { inspector: true, height: 1200 }),
  "session-many-files": () => stepStoryScene("many-files", { inspector: true }),
  "session-file-steps": () => stepStoryScene("file-steps", { inspector: true, height: 2400 }),
  "session-shell-steps": () => stepStoryScene("shell-steps", { inspector: true, height: 2200 }),
  "session-slow": () => sessionScene("busy", { inspector: true }),
  "session-starting": () => sessionStartingScene(),
  "session-first-job-next": sessionFirstJobNextScene,
  "session-fail-key-rejected": () => endingStoryScene("fail-key-rejected", { inspector: true }),
  "session-fail-key-rejected-member": () => endingStoryScene("fail-key-rejected", { inspector: true }, { refused: ["can_manage_billing"] }),
  "session-fail-key-missing": () => endingStoryScene("fail-key-missing", { inspector: true }),
  "session-fail-out-of-credit": () => endingStoryScene("fail-out-of-credit", { inspector: true }),
  "session-fail-rate-limited": () => endingStoryScene("fail-rate-limited", { inspector: true }),
  "session-fail-overloaded": () => endingStoryScene("fail-overloaded", { inspector: true }),
  "session-fail-model-unavailable": () => endingStoryScene("fail-model-unavailable", { inspector: true }),
  "session-fail-unreachable": () => endingStoryScene("fail-unreachable", { inspector: true }),
  "session-fail-request-rejected": () => endingStoryScene("fail-request-rejected", { inspector: true }),
  "session-fail-cost-cap": () => endingStoryScene("fail-cost-cap", { inspector: true, height: 1200 }),
  "session-fail-tool-call-limit": () => endingStoryScene("fail-tool-call-limit", { inspector: true, height: 1200 }),
  "session-fail-stalled": () => endingStoryScene("fail-stalled", { inspector: true, height: 1200 }),
  "session-fail-operation-limit": () => endingStoryScene("fail-operation-limit", { inspector: true, height: 1200 }),
  "session-fail-workspace-busy": () => endingStoryScene("fail-workspace-busy", { inspector: true }),
  "session-fail-agent-setup": () => endingStoryScene("fail-agent-setup", { inspector: true }),
  "session-fail-app-unreachable": () => endingStoryScene("fail-app-unreachable", { inspector: true }),
  "session-fail-app-sign-in": () => endingStoryScene("fail-app-sign-in", { inspector: true }),
  "session-fail-internal": () => endingStoryScene("fail-internal", { inspector: true }),
  "session-fail-runner-lost": () => endingStoryScene("fail-runner-lost", { inspector: true, height: 1200 }),
  "session-fail-no-sandbox-room": () => endingStoryScene("fail-no-sandbox-room", { inspector: true }),
  "session-fail-platform-stop": () => endingStoryScene("fail-platform-stop", { inspector: true, height: 1200 }),
  "session-fail-user-stop": () => endingStoryScene("fail-user-stop", { inspector: true, height: 1200 }),
  "session-fail-generic-model": () => endingStoryScene("fail-generic-model", { inspector: true }),
  "session-fail-generic-failed": () => endingStoryScene("fail-generic-failed", { inspector: true }),
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
  parts: partsScene,
  help: helpScene,
  "help-none": helpNoneScene,
  ...presets,
};
