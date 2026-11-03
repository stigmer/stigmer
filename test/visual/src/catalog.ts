// The gallery's catalogue: every scene it draws, as plain data.
//
// A scene is one component in one state ("the thread with an approval
// waiting"), drawn from fixed data. This file names the scenes and how each
// is pictured (its widths, its colour modes, the acts that bring it to its
// state); the page draws them from `scenes/index.ts`, whose map is typed by
// these ids, so a scene listed here without a drawing, or drawn without
// being listed, fails the typecheck. It imports no kit source at run time:
// the Playwright spec and the unit checks read it under Node, where the
// kit's sources do not load. The values a docs page prints come from
// `docs-examples.ts`, which is plain data.
//
// Every picture is `<scene>-<mode>-<width>.png` under
// tests/__screenshots__; `screenshotsOf` is the one place that name is made.
import type { Page } from "@playwright/test";
import type { ScenarioName } from "@stigmer/react-sdk/test";
import type { ThemePresetId } from "@stigmer/design-tokens";
import { ENVIRONMENT_EXAMPLE, ROUTINE_EXAMPLE, SLACK_APP_EXAMPLE, SLACK_EXAMPLE, WHATSAPP_EXAMPLE } from "./docs-examples.ts";

/** The colour modes every scene is drawn in. */
export const MODES = ["light", "dark"] as const;
export type Mode = (typeof MODES)[number];

/**
 * The widths a scene is drawn at: the console's desktop, and the 390-wide
 * column a side panel or a popup gives the chat. The height is the first
 * screen's; the picture takes the whole page.
 */
export const WIDTHS = {
  desktop: { width: 1280, height: 800 },
  narrow: { width: 390, height: 800 },
} as const;
export type WidthName = keyof typeof WIDTHS;

/** A state the thread is drawn in. */
export type ThreadState = (typeof THREAD_STATES)[number];
/** A preset the completed thread is drawn in. */
export type Preset = (typeof PRESETS)[number];

/** Every scene's id: its address, and the start of its pictures' names. */
export type SceneId =
  | `thread-${ThreadState}`
  | "file-review-dock"
  | "models-hub-none"
  | "models-hub-connected"
  | "models-hub-local"
  | "models-hub-member"
  | "launcher-ready"
  | "launcher-connect-admin"
  | "launcher-connect-member"
  | "launcher-connect-local"
  | "model-selector-open"
  | "model-selector-not-ready"
  | "dashboard-kpis"
  | "dashboard-busy"
  | "dashboard-new-org"
  | `settings-${SettingsSceneName}`
  | "agent-profile-owner"
  | "agent-profile-viewer"
  | "agent-profile-variance-reporter"
  | "skill-detail"
  | "marketplace-admin"
  | "marketplace-member"
  | `session-${SessionSceneName}`
  | `story-${StorySceneName}`
  | `routine-${RoutineSceneName}`
  | `environment-${EnvironmentSceneName}`
  | `channel-${ChannelSceneName}`
  | "agent-chat-panel"
  | "agent-chat-popup-closed"
  | "agent-chat-popup"
  | `preset-${Preset}`;

/** The roles a control is pressed by: Playwright's own list, the one `getByRole` takes. */
export type AriaRole = Parameters<Page["getByRole"]>[0];

/**
 * One act a case performs before the picture and the audit, as a reader
 * would: press a control, or type into a field. A plain string presses the
 * button of that accessible name.
 *
 * - `{ press, role }` presses the control of that role and name: a tab, a
 *   radio, a menu item, a picker's option or a link. A picker is a press on
 *   it, then a press on its option.
 * - `{ fill, with }` types `with` into the field labelled `fill`.
 *
 * A name matches as a part of the control's or label's, as Playwright's
 * locators do (a label that wraps its hint names the field with both),
 * unless `exact` holds it to the whole: a card named `variance-reporter`
 * beside one named `variance-reporter-slack`.
 *
 * A control a scene cannot reach by its role and name has no accessible
 * name, which is the kit's defect to fix, never the scene's to work around.
 */
export type Act =
  | string
  | { readonly press: string; readonly role: AriaRole; readonly exact?: boolean }
  | { readonly fill: string; readonly with: string; readonly exact?: boolean };

/** One scene and how it is pictured. */
export interface Scene {
  readonly id: SceneId;
  /** What the picture shows, as a reviewer would say it. */
  readonly title: string;
  readonly widths: readonly WidthName[];
  /**
   * The acts the case performs, in order, before the picture and the audit:
   * a component whose state of interest opens on a click (a picker's list,
   * a panel and a File in it) is pictured open, and a form a docs page fills
   * is pictured filled.
   */
  readonly opens?: Act | readonly Act[];
}

/**
 * The conversation states the thread is drawn in, in the catalogue's order
 * (`SCENARIO_NAMES` in `@stigmer/react-sdk/test`): every state the thread
 * itself draws. `THREAD_DRAWN_ELSEWHERE` names the rest and why; the scene
 * sweep holds the two lists to the catalogue.
 */
export const THREAD_STATES = [
  "loading",
  "empty",
  "streaming",
  "tools",
  "approval",
  "file-review",
  "subagent-running",
  "subagent-finished",
  "failed",
  "completed",
  "markdown",
] as const satisfies readonly ScenarioName[];

/** The conversation states no thread scene draws, each with what draws it instead. */
export const THREAD_DRAWN_ELSEWHERE: Readonly<Partial<Record<ScenarioName, string>>> = {
  "load-failed": "a session that cannot load never reaches the thread: session-load-failed draws the session view's own error",
  busy: "a long turn is about the whole session view (its liveness line, its composer's Stop): session-busy and session-end-user draw it",
  finished: "a finished session is about the whole session view (its Files, its origin, its panel): session-finished and its siblings draw it",
};

/**
 * The session view's scenes: the whole `SessionViewer` (thread, composer,
 * panel and banners) for each person who looks at it, in the states that
 * tell their jobs apart: following a long turn, answering an approval,
 * reading what a turn produced, a failure, and a session that cannot load.
 */
export type SessionSceneName = (typeof SESSION_SCENES)[number]["id"] extends `session-${infer Name}` ? Name : never;

const SESSION_SCENES = [
  { id: "session-busy", title: "Session: a long turn at work, in the console", widths: ["desktop", "narrow"] },
  { id: "session-approval", title: "Session: a tool call waits for approval, in the console", widths: ["desktop"] },
  {
    id: "session-finished",
    title: "Session: a finished turn a routine started, with an edit and two Files returned, in the console",
    widths: ["desktop"],
  },
  {
    id: "session-inspector",
    title: "Session: the finished turn with the console's panel open on a File it returned",
    widths: ["desktop"],
    opens: ["Show panel", "invoice-audit.md 4.1 KB"],
  },
  { id: "session-failed", title: "Session: a failed turn, in the console", widths: ["desktop"] },
  {
    id: "session-end-user",
    title: "Session: a long turn at work, inside a customer's product (no inspector)",
    widths: ["desktop"],
  },
  { id: "session-guest", title: "Session: the finished turn, for a chat link's guest", widths: ["desktop", "narrow"] },
  { id: "session-observer", title: "Session: the finished turn, for a reviewer who reads it", widths: ["desktop"] },
  { id: "session-load-failed", title: "Session: the conversation cannot load", widths: ["desktop"] },
] as const satisfies readonly { readonly id: `session-${string}`; readonly title: string; readonly widths: readonly WidthName[]; readonly opens?: Act | readonly Act[] }[];

/**
 * The story's scenes: moments of the job every picture of Stigmer at work
 * tells (brand/job-story.ts), drawn by the real components over a session
 * built from the kit's samples, for the site and the docs to show.
 */
export type StorySceneName = (typeof STORY_SCENES)[number]["id"] extends `story-${infer Name}` ? Name : never;

const STORY_SCENES = [
  {
    id: "story-asks-first",
    title: "Story: Northwind's ledger agent asks before it posts an adjustment, inside a customer's product",
    widths: ["desktop"],
  },
  {
    id: "story-in-product",
    title: "Story: the same ask in Stigmer's chat panel, docked beside the integrator's ledger screen for Northwind Books",
    widths: ["desktop"],
  },
  {
    id: "story-own-computer",
    title: "Story: after the yes, the panel hands back the variance report the agent wrote in its outputs folder",
    widths: ["desktop"],
  },
  {
    id: "story-hours",
    title: "Story: two hours into reconciling Northwind's year, month by month, in the panel beside the year's ledger",
    widths: ["desktop"],
  },
  {
    id: "story-walls",
    title: "Story: two customers of one product ask the same agent about their own books, each in its own window and organization",
    widths: ["desktop", "narrow"],
  },
  {
    id: "story-keys",
    title: "Story: the integrator's Stigmer console, Models & providers, Anthropic and OpenAI on the organization's own keys",
    widths: ["desktop", "narrow"],
  },
  {
    id: "story-embed",
    title: "Story: the variance reporter's chat link embedded on a help page of acme.com, at the snippet's default 400×600",
    widths: ["desktop"],
  },
] as const satisfies readonly { readonly id: `story-${string}`; readonly title: string; readonly widths: readonly WidthName[] }[];

/**
 * The settings landing and the settings pages, one per shape Settings has,
 * each framed as the console's settings layout frames it: a collection with
 * rows, a collection with none yet, a collection of cards, a plan, figures,
 * what this edition does not offer, an operator's console, and any page
 * while it reads.
 */
export type SettingsSceneName = (typeof SETTINGS_SCENES)[number]["id"] extends `settings-${infer Name}` ? Name : never;

const SETTINGS_SCENES = [
  { id: "settings-landing", title: "Settings: every group of the navigation an owner sees, each page a link", widths: ["desktop"] },
  { id: "settings-members", title: "Settings, Members: the owner and the people the organization holds", widths: ["desktop", "narrow"] },
  { id: "settings-api-keys", title: "Settings, API keys: Stigmer Cloud, before the first key", widths: ["desktop"] },
  { id: "settings-vaults", title: "Settings, Vaults: the organization's vaults", widths: ["desktop"] },
  { id: "settings-billing", title: "Settings, Billing: Stigmer Cloud's plan and payment", widths: ["desktop"] },
  { id: "settings-usage", title: "Settings, Usage: the organization's figures", widths: ["desktop"] },
  { id: "settings-teams-oss", title: "Settings, Teams: the open-source server, which serves none", widths: ["desktop"] },
  { id: "settings-model-catalog", title: "Settings, Model catalogue: a platform operator's console", widths: ["desktop"] },
  { id: "settings-loading", title: "Settings, any page while its rows are read", widths: ["desktop"] },
] as const satisfies readonly { readonly id: `settings-${string}`; readonly title: string; readonly widths: readonly WidthName[] }[];

/**
 * The routines page's screens (docs/guides/routines/run-an-agent-on-a-schedule.mdx),
 * each a step the page's reader takes: the New routine form filled with the
 * page's example, the routine as made (switched off, offering Enable & run
 * now), and its History tab after that first run.
 */
export type RoutineSceneName = (typeof ROUTINE_SCENES)[number]["id"] extends `routine-${infer Name}` ? Name : never;

const ROUTINE_SCENES = [
  {
    id: "routine-new",
    title: "New routine: the routines page's daily variance report, filled in, its schedule every day at 09:00 in Kolkata",
    widths: ["desktop"],
    opens: [
      { fill: "Name", with: ROUTINE_EXAMPLE.name },
      { press: "Agent to run", role: "button" },
      { press: ROUTINE_EXAMPLE.agent, role: "option" },
      { fill: "Message", with: ROUTINE_EXAMPLE.message },
      { fill: "Time zone", with: ROUTINE_EXAMPLE.timeZone },
      { press: ROUTINE_EXAMPLE.timeZone, role: "option" },
    ],
  },
  { id: "routine-disabled", title: "Routine page: the daily variance report as made, switched off, offering Enable & run now", widths: ["desktop"] },
  { id: "routine-history", title: "Routine page, History: the daily variance report's first run, started by hand", widths: ["desktop"] },
] as const satisfies readonly { readonly id: `routine-${string}`; readonly title: string; readonly widths: readonly WidthName[]; readonly opens?: readonly Act[] }[];

/**
 * The environments page's screens (docs/guides/environments/set-up-an-environment.mdx):
 * the New environment form filled with the page's data-science, the data
 * team's Agent once its Environment section names it, and a conversation's
 * run settings naming the Environment it got and why.
 */
export type EnvironmentSceneName = (typeof ENVIRONMENT_SCENES)[number]["id"] extends `environment-${infer Name}` ? Name : never;

const ENVIRONMENT_SCENES = [
  {
    id: "environment-new",
    title: "New environment: the environments page's data-science, limited to two websites, with its apt and pip packages",
    widths: ["desktop"],
    opens: [
      { fill: "Name", with: ENVIRONMENT_EXAMPLE.slug },
      { fill: "Description (optional)", with: ENVIRONMENT_EXAMPLE.description },
      { press: "Limited to listed websites", role: "radio" },
      { fill: "Websites", with: ENVIRONMENT_EXAMPLE.hosts.join("\n") },
      { fill: "apt (Debian packages)", with: ENVIRONMENT_EXAMPLE.apt.join("\n") },
      { fill: "pip (Python packages)", with: ENVIRONMENT_EXAMPLE.pip.join("\n") },
    ],
  },
  { id: "environment-agent", title: "Agent page: the data team's Agent, its Environment section naming Data science", widths: ["desktop"] },
  {
    id: "environment-run-settings",
    title: "Session: a conversation's run settings, opened from the composer, its Environment row data-science, the agent's default",
    widths: ["desktop"],
    opens: ["Configure agent, tools, and skills", { press: "Run settings", role: "menuitem" }],
  },
] as const satisfies readonly { readonly id: `environment-${string}`; readonly title: string; readonly widths: readonly WidthName[]; readonly opens?: readonly Act[] }[];

/**
 * The channel pages' screens (docs/guides/channels/): the variance reporter's
 * Channels tab and the dialogs the pages open from it.
 */
export type ChannelSceneName = (typeof CHANNEL_SCENES)[number]["id"] extends `channel-${infer Name}` ? Name : never;

const CHANNEL_SCENES = [
  { id: "channel-list", title: "Agent page, Channels: the variance reporter's chat link, Slack workspace and WhatsApp number", widths: ["desktop"] },
  {
    id: "channel-add",
    title: "Agent page, Channels: the chat link alone, with Add channel open on Chat link, Slack and WhatsApp",
    widths: ["desktop"],
    opens: ["Add channel"],
  },
  {
    id: "channel-chat-link",
    title: "The chat link's dialog on its Link tab: the link, its on switch and who can chat",
    widths: ["desktop"],
    opens: [{ press: "Actions for variance-reporter", role: "button", exact: true }, { press: "Edit", role: "menuitem" }],
  },
  {
    id: "channel-chat-link-embed",
    title: "The chat link's dialog on its Embed tab: the two-line snippet and the allowed embed origins",
    widths: ["desktop"],
    opens: [{ press: "Actions for variance-reporter", role: "button", exact: true }, { press: "Edit", role: "menuitem" }, { press: "Embed", role: "tab" }],
  },
  {
    id: "channel-connect-slack",
    title: "Connect to Slack: the channel's name, Connect as the platform Stigmer app, and Tool credentials",
    widths: ["desktop"],
    opens: ["Add channel", { press: "Slack", role: "menuitem" }, { fill: "Channel name", with: SLACK_EXAMPLE.channel }],
  },
  {
    id: "channel-connect-whatsapp",
    title: "Connect to WhatsApp: the connect page's phone number ID, its Meta app chosen to serve it, and Tool credentials",
    widths: ["desktop"],
    opens: [
      "Add channel",
      { press: "WhatsApp", role: "menuitem" },
      { fill: "Channel name", with: WHATSAPP_EXAMPLE.channel },
      { fill: "Phone number ID", with: WHATSAPP_EXAMPLE.phoneNumberId },
    ],
  },
  {
    id: "channel-app-new",
    title: "Settings, Channel Apps: Register channel app, Slack, named Acme Books, with its ready-to-paste manifest",
    widths: ["desktop"],
    opens: ["New channel app", { fill: "Name", with: SLACK_APP_EXAMPLE.name }],
  },
  {
    id: "channel-app-setup",
    title: "Settings, Channel Apps: the registered Acme Books app's panel, Finish setup in Slack with its events request URL",
    widths: ["desktop"],
    opens: [SLACK_APP_EXAMPLE.name],
  },
  {
    id: "channel-conversations-needs-human",
    title: "Conversations on Needs human: Northwind Books asked for a person, and the Agent escalated",
    widths: ["desktop"],
    opens: [{ press: "Conversations where a human action is wanted", role: "radio" }],
  },
  {
    id: "channel-conversation-taken-over",
    title: "Conversations: Ada holds Northwind's conversation, the platform has acknowledged, and her reply is typed",
    widths: ["desktop"],
    opens: [{ fill: "Reply to the customer", with: "Hi, this is Ada from Acme Books. We can move half of it to Q4; I'll send the adjusted budget today." }],
  },
] as const satisfies readonly { readonly id: `channel-${string}`; readonly title: string; readonly widths: readonly WidthName[]; readonly opens?: readonly Act[] }[];

/** The presets the `completed` thread is drawn in beyond the default look, which `thread-completed` is. */
export const PRESETS = ["corporate", "startup", "friendly", "fintech", "monochrome"] as const satisfies readonly ThemePresetId[];

const THREAD_TITLES: Readonly<Record<(typeof THREAD_STATES)[number], string>> = {
  loading: "the thread while the session loads",
  empty: "a new session with no turns",
  streaming: "the agent's reply streaming",
  tools: "tool calls: one returned, one still running",
  approval: "a tool call waiting for approval, with its decision",
  "file-review": "a finished turn whose file edits wait for review",
  "subagent-running": "a subagent at work",
  "subagent-finished": "a subagent finished",
  failed: "a failed turn",
  completed: "a completed turn",
  markdown: "a long reply in markdown: a heading, lists, code and a table",
};

/** Every scene, in the order the index page lists them. */
export const SCENES: readonly Scene[] = [
  ...THREAD_STATES.map((state) => ({
    id: `thread-${state}` as const,
    title: `Thread: ${THREAD_TITLES[state]}`,
    widths: ["desktop", "narrow"] as const,
  })),
  { id: "file-review-dock", title: "File review dock: two edited files waiting for a decision", widths: ["desktop"] },
  { id: "models-hub-none", title: "Models & providers: an admin, nothing connected yet", widths: ["desktop", "narrow"] },
  {
    id: "models-hub-connected",
    title: "Models & providers: Anthropic on the organization's key, OpenAI on its parent's",
    widths: ["desktop"],
  },
  { id: "models-hub-local", title: "Models & providers: a laptop whose runner has no key", widths: ["desktop"] },
  { id: "models-hub-member", title: "Models & providers: a member, nothing connected yet", widths: ["desktop"] },
  { id: "launcher-ready", title: "Launcher: a model provider connected, ready to send", widths: ["desktop", "narrow"] },
  {
    id: "launcher-connect-admin",
    title: "Launcher: nothing can run, an admin connects a provider in place",
    widths: ["desktop", "narrow"],
  },
  { id: "launcher-connect-member", title: "Launcher: nothing can run, a member is told who connects it", widths: ["desktop"] },
  { id: "launcher-connect-local", title: "Launcher: nothing can run on a laptop, with the command", widths: ["desktop"] },
  { id: "model-selector-open", title: "Model picker: open", widths: ["desktop"], opens: "Claude Sonnet 4.6" },
  {
    id: "model-selector-not-ready",
    title: "Model picker: open, with the models that need an Anthropic key marked and listed last",
    widths: ["desktop"],
    opens: "Claude Sonnet 4.6",
  },
  { id: "dashboard-kpis", title: "Dashboard figures", widths: ["desktop"] },
  { id: "dashboard-busy", title: "Dashboard: a busy week, with its failures", widths: ["desktop"] },
  { id: "dashboard-new-org", title: "Dashboard: an organization that has run nothing yet", widths: ["desktop"] },
  ...SETTINGS_SCENES,
  { id: "agent-profile-owner", title: "Agent page: the ledger agent, as its owner sees it", widths: ["desktop", "narrow"] },
  { id: "agent-profile-viewer", title: "Agent page: the ledger agent, as a person who may only read it sees it", widths: ["desktop"] },
  {
    id: "agent-profile-variance-reporter",
    title: "Agent page: the agents page's variance reporter, each section one of the YAML fields the page prints",
    widths: ["desktop"],
  },
  { id: "skill-detail", title: "Skill page: the skills page's variance-report, its description over its rendered body", widths: ["desktop"] },
  { id: "marketplace-admin", title: "Marketplace: the official catalogue, for an admin", widths: ["desktop", "narrow"] },
  { id: "marketplace-member", title: "Marketplace: the official catalogue, for a member", widths: ["desktop"] },
  ...SESSION_SCENES,
  ...STORY_SCENES,
  ...ROUTINE_SCENES,
  ...ENVIRONMENT_SCENES,
  ...CHANNEL_SCENES,
  {
    id: "agent-chat-panel",
    title: "AgentChat: a long turn at work, in a panel docked beside a product",
    widths: ["desktop"],
  },
  {
    id: "agent-chat-popup-closed",
    title: "AgentChat: the popup closed while a long turn works, its button saying what the agent is doing",
    widths: ["desktop", "narrow"],
  },
  {
    id: "agent-chat-popup",
    title: "AgentChat: the popup open on a finished turn (a phone's screen is the popup)",
    widths: ["desktop", "narrow"],
  },
  ...PRESETS.map((preset) => ({
    id: `preset-${preset}` as const,
    title: `The completed thread in the ${preset} preset`,
    widths: ["desktop"] as const,
  })),
];

/** One picture: a scene in one mode at one width, and the file it is compared with. */
export interface Shot {
  readonly scene: Scene;
  readonly mode: Mode;
  readonly width: WidthName;
  readonly file: string;
}

/** Every picture the gallery takes, in catalogue order. */
export function screenshotsOf(scenes: readonly Scene[]): Shot[] {
  return scenes.flatMap((scene) =>
    MODES.flatMap((mode) => scene.widths.map((width) => ({ scene, mode, width, file: `${scene.id}-${mode}-${width}.png` }))),
  );
}

/** The page address that draws one scene in one mode. */
export function sceneUrl(id: SceneId, mode: Mode): string {
  return `/?scene=${encodeURIComponent(id)}&mode=${mode}`;
}
