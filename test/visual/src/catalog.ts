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
import {
  CHAT_LINK_EXAMPLE,
  EMBED_EXAMPLE,
  ENVIRONMENT_EXAMPLE,
  OAUTH_APP_EXAMPLE,
  ROUTINE_EXAMPLE,
  SERVICE_ACCOUNT_EXAMPLE,
  SLACK_APP_EXAMPLE,
  SLACK_EXAMPLE,
  WHATSAPP_EXAMPLE,
} from "./docs-examples.ts";

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
  | "models-hub-none"
  | "models-hub-connected"
  | "models-hub-local"
  | "models-hub-member"
  | "launcher-ready"
  | "launcher-connect-admin"
  | "launcher-connect-member"
  | "launcher-connect-local"
  | "launcher-first-question"
  | "launcher-coding-agent"
  | "launcher-example-connect"
  | "launcher-example-rejected"
  | "launcher-example-unchecked"
  | "launcher-example-ready"
  | "launcher-describe-own"
  | "launcher-own-file"
  | "launcher-next-line"
  | "model-selector-open"
  | "model-selector-not-ready"
  | "dashboard-kpis"
  | "dashboard-busy"
  | "dashboard-new-org"
  | "dashboard-journey-new"
  | "dashboard-journey-mid"
  | "dashboard-journey-folded"
  | `settings-${SettingsSceneName}`
  | "agent-profile-owner"
  | "agent-profile-viewer"
  | "agent-profile-variance-reporter"
  | "agent-make-it-yours"
  | "agent-make-it-yours-member"
  | "agent-in-app"
  | "agent-in-app-done"
  | "agent-in-app-member"
  | "agent-in-app-local"
  | "bring-others-in"
  | "bring-others-in-link"
  | "bring-others-in-joined"
  | "bring-others-in-local"
  | "skill-detail"
  | "marketplace-admin"
  | "marketplace-member"
  | "marketplace-no-match"
  | `session-${SessionSceneName}`
  | `story-${StorySceneName}`
  | "agent-chat-page"
  | `routine-${RoutineSceneName}`
  | `environment-${EnvironmentSceneName}`
  | `channel-${ChannelSceneName}`
  | `access-${AccessSceneName}`
  | "agent-chat-panel"
  | "agent-chat-popup-closed"
  | "agent-chat-popup"
  | "from-hooks"
  | "parts"
  | "help"
  | "help-none"
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
 * - `first` presses the first of several controls that share the name: a
 *   page's create act, which its empty list repeats under the header's.
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
  | { readonly press: string; readonly role: AriaRole; readonly exact?: boolean; readonly first?: boolean }
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
  /**
   * How long the page's clock runs on, in milliseconds, once the scene has
   * settled and before its acts: a state reached only by time passing (a
   * working turn gone quiet past its slow window). Timers fire as they
   * would; durations read that much later.
   */
  readonly elapse?: number;
  /**
   * The scene is pictured whole: a page that scrolls inside itself (the
   * session view's thread, a settings page under the console's frame) is
   * drawn in a viewport grown until nothing in it scrolls, so the picture
   * holds the whole turn or page, its top included, and not one screen
   * scrolled to its end. A Built look compares these pictures with the
   * drawings whole (`tests/whole.spec.ts`).
   */
  readonly whole?: boolean;
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
  "thinking",
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
  "waiting-for-sandbox": "a turn waiting for a sandbox is about the whole session view (the line under the message, the status pill): session-waiting-for-sandbox draws it",
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
  {
    id: "session-waiting-for-sandbox",
    title: "Session: every sandbox is busy, and the turn has waited 1m 20s for one, in the console",
    widths: ["desktop", "narrow"],
  },
  { id: "session-thinking", title: "Session: the agent thought, read a file, and is thinking again, in the console", widths: ["desktop", "narrow"] },
  { id: "session-busy", title: "Session: a long turn at work, in the console", widths: ["desktop", "narrow"] },
  { id: "session-helper", title: "Session: a helper agent at work on part of the job, in the console", widths: ["desktop", "narrow"] },
  {
    id: "session-file-progress",
    title: "Session: the long turn at work, with the files it is changing counted above the composer",
    widths: ["desktop", "narrow"],
  },
  { id: "session-approval", title: "Session: a tool call waits for approval, in the console", widths: ["desktop", "narrow"] },
  {
    id: "session-finished",
    title: "Session: a finished turn a routine started, with an edit and two Files returned, in the console",
    widths: ["desktop", "narrow"],
  },
  {
    id: "session-file-review",
    title: "Session: the turn ended with two file edits, shown once under Changed with their Undo",
    widths: ["desktop", "narrow"],
  },
  {
    id: "session-plan-build",
    title: "Session: a Plan-mode turn finished and returned its plan, shown as a card with Build",
    widths: ["desktop", "narrow"],
  },
  {
    id: "session-file-undone",
    title: "Session: the owner undid two of a turn's edits, one put back and one that failed, with a changed image still standing",
    widths: ["desktop", "narrow"],
  },
  {
    id: "session-plan-writing",
    title: "Session: a Plan-mode turn is writing its plan, live in the thread and in the panel",
    widths: ["desktop"],
  },
  {
    id: "session-compacted",
    title: "Session: a turn that recalled three memories and had its earlier messages summarized part-way, both opened",
    widths: ["desktop"],
    opens: ["Recalled 3 memories", "How it got there"],
  },
  {
    id: "session-attachments",
    title: "Session: a turn whose message carried a screenshot and a ledger",
    widths: ["desktop", "narrow"],
  },
  {
    id: "session-pull-requests",
    title: "Session: the finished turn with the panel open on the pull request its work was pushed to",
    widths: ["desktop"],
    opens: ["Show panel", { press: "Pull requests", role: "radio" }],
  },
  {
    id: "session-usage",
    title: "Session: the finished turn with the panel open on its usage",
    widths: ["desktop"],
    opens: ["Show panel", { press: "Usage", role: "radio" }],
  },
  {
    id: "session-file-preview",
    title: "Session: a File the finished turn made, opened in the preview window by an app's user",
    widths: ["desktop"],
    // By its kind too: "Download invoice-audit.md" names the file as well.
    opens: ["invoice-audit.md Markdown"],
  },
  {
    id: "session-auto-approve",
    title: "Session: the long turn at work with tool calls approved automatically, said above the composer",
    widths: ["desktop"],
  },
  {
    id: "session-agent-version",
    title: "Session: the finished turn after the agent's author saved a newer version, offered above the composer",
    widths: ["desktop"],
  },
  {
    id: "session-inspector",
    title: "Session: the finished turn with the console's panel open on a File it returned",
    // Desktop only: at phone width the panel lists the File by its size, not its kind, so the act that opens it differs.
    widths: ["desktop"],
    opens: ["Show panel", "invoice-audit.md Markdown"],
  },
  { id: "session-failed", title: "Session: a failed turn, in the console", widths: ["desktop", "narrow"] },
  {
    id: "session-end-user",
    title: "Session: a long turn at work, inside a customer's product (no inspector)",
    widths: ["desktop"],
  },
  {
    id: "session-end-user-framed",
    title: "Session: the same long turn inside a customer's product, at the screen's own height, the thread scrolled under its header and composer",
    widths: ["desktop"],
  },
  { id: "session-guest", title: "Session: the finished turn, for a chat link's guest", widths: ["desktop", "narrow"] },
  { id: "session-observer", title: "Session: the finished turn, for a reviewer who reads it", widths: ["desktop"] },
  {
    id: "session-participant",
    title: "Session: a tool call waits for approval, for a teammate who can send but leaves the approval to the owner",
    widths: ["desktop", "narrow"],
  },
  { id: "session-load-failed", title: "Session: the conversation cannot load", widths: ["desktop"] },
  {
    id: "session-steps-opened",
    title: "Session: the long turn at work with its steps opened: a search's matches and a command's output",
    widths: ["desktop"],
    opens: ["Find every place invoices round", "Searched for round(", "Round once, at the invoice total", "Ran a command npm test -- billing/invoice"],
  },
  {
    id: "session-how-opened",
    title: "Session: the finished turn with how it got there opened, and a read opened to its lines",
    widths: ["desktop"],
    opens: ["How it got there", "Read invoice.ts"],
  },
  {
    id: "session-mcp",
    title: "Session: a finished turn that used a connected app's tools: a search and a new issue",
    widths: ["desktop"],
    opens: ["How it got there", "Create issue"],
  },
  {
    id: "session-many-files",
    title: "Session: a finished audit a routine started, with three files changed and twenty Files made",
    widths: ["desktop"],
  },
  {
    id: "session-file-steps",
    title: "Session: every file step: list, search, find, read, edit, create, delete, a failed edit, a File written",
    widths: ["desktop"],
    opens: [
      "How it got there",
      "Looked in src/billing",
      "Searched for round(",
      "Read credit-note.ts",
      "Edited credit-note.ts",
      "Wrote rounding.test.ts",
    ],
  },
  {
    id: "session-shell-steps",
    title: "Session: every shell step: output, a described command, exit 1, running, in the background, and an ask",
    widths: ["desktop"],
    opens: ["Ran a command npm test -- billing/invoice"],
  },
  {
    id: "session-slow",
    title: "Session: the long turn has said nothing for over a minute",
    widths: ["desktop"],
    elapse: 61_000,
  },
  { id: "session-starting", title: "Session: the session is being made and has no id yet", widths: ["desktop", "narrow"] },
  {
    id: "session-first-job-next",
    title: "Session: a newcomer's first agent finished its first job, with the line that leads to making it theirs",
    // Desktop only: at phone width the thread scrolls in the browser's own
    // view of it, and where it comes to rest differs by machine.
    widths: ["desktop"],
  },
  // Every way a turn ends badly, one ending turn each (the catalogue's ENDING_STORY_NAMES).
  { id: "session-fail-key-rejected", title: "Session: the provider refused the organization's model key", widths: ["desktop", "narrow"] },
  {
    id: "session-fail-key-rejected-member",
    title: "Session: the provider refused the organization's model key, for a member who may not replace it",
    widths: ["desktop"],
  },
  { id: "session-fail-key-missing", title: "Session: the organization has no key for the model's provider", widths: ["desktop"] },
  { id: "session-fail-out-of-credit", title: "Session: the provider account is out of credit", widths: ["desktop"] },
  { id: "session-fail-rate-limited", title: "Session: the provider limited the request rate", widths: ["desktop"] },
  { id: "session-fail-overloaded", title: "Session: the provider was overloaded", widths: ["desktop"] },
  {
    id: "session-fail-model-unavailable",
    title: "Session: the model isn't available to the key, its picker opened by the notice's act",
    widths: ["desktop"],
    opens: "Choose another model",
  },
  { id: "session-fail-unreachable", title: "Session: the provider couldn't be reached", widths: ["desktop"] },
  { id: "session-fail-request-rejected", title: "Session: the provider refused the request itself", widths: ["desktop"] },
  { id: "session-fail-cost-cap", title: "Session: the turn reached its spending cap part-way through its plan", widths: ["desktop"] },
  { id: "session-fail-tool-call-limit", title: "Session: the turn reached its step limit part-way through its plan", widths: ["desktop"] },
  { id: "session-fail-stalled", title: "Session: the turn stopped making progress part-way through its plan", widths: ["desktop"] },
  { id: "session-fail-operation-limit", title: "Session: a step ran past its time limit part-way through the plan", widths: ["desktop"] },
  { id: "session-fail-workspace-busy", title: "Session: another turn held the workspace", widths: ["desktop"] },
  { id: "session-fail-agent-setup", title: "Session: the agent is set up wrong", widths: ["desktop"] },
  { id: "session-fail-app-unreachable", title: "Session: a connected app wouldn't connect", widths: ["desktop"] },
  { id: "session-fail-app-sign-in", title: "Session: a connected app needs a sign-in", widths: ["desktop"] },
  { id: "session-fail-internal", title: "Session: something broke on Stigmer's side", widths: ["desktop"] },
  { id: "session-fail-runner-lost", title: "Session: the machine running the turn stopped part-way through its plan", widths: ["desktop"] },
  { id: "session-fail-no-sandbox-room", title: "Session: every sandbox stayed busy, so the turn never started", widths: ["desktop"] },
  { id: "session-fail-platform-stop", title: "Session: Stigmer stopped the turn part-way through its plan", widths: ["desktop"] },
  { id: "session-fail-user-stop", title: "Session: the person stopped the turn part-way through its plan", widths: ["desktop"] },
  { id: "session-fail-generic-model", title: "Session: the model failed the turn and the runner named no kind", widths: ["desktop"] },
  { id: "session-fail-generic-failed", title: "Session: the turn failed and the runner named no kind", widths: ["desktop"] },
] as const satisfies readonly {
  readonly id: `session-${string}`;
  readonly title: string;
  readonly widths: readonly WidthName[];
  readonly opens?: Act | readonly Act[];
  readonly elapse?: number;
}[];

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
  {
    id: "settings-vaults-open",
    title: "Settings, Vaults: eight shared vaults, the first opened to its secrets",
    widths: ["desktop"],
    opens: { press: "Production", role: "button", exact: false },
  },
  { id: "settings-vaults-failed", title: "Settings, Vaults: the server did not answer, so neither list could be read", widths: ["desktop"] },
  { id: "settings-service-accounts-denied", title: "Settings, Service accounts: a member who may not manage them", widths: ["desktop"] },
  { id: "settings-billing", title: "Settings, Billing: Stigmer Cloud's plan and payment", widths: ["desktop"] },
  { id: "settings-usage", title: "Settings, Usage: the organization's figures", widths: ["desktop"] },
  { id: "settings-teams-oss", title: "Settings, Teams: the open-source server, which serves none", widths: ["desktop"] },
  { id: "settings-model-catalog", title: "Settings, Model catalogue: a platform operator's console", widths: ["desktop"] },
  { id: "settings-loading", title: "Settings, any page while its rows are read", widths: ["desktop"] },
] as const satisfies readonly {
  readonly id: `settings-${string}`;
  readonly title: string;
  readonly widths: readonly WidthName[];
  readonly opens?: Act;
}[];

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
      { fill: ROUTINE_EXAMPLE.nameLabel, with: ROUTINE_EXAMPLE.name, exact: true },
      { press: "Agent to run", role: "button" },
      { press: ROUTINE_EXAMPLE.agent, role: "option" },
      { fill: ROUTINE_EXAMPLE.messageLabel, with: ROUTINE_EXAMPLE.message, exact: true },
      { fill: ROUTINE_EXAMPLE.timeZoneLabel, with: ROUTINE_EXAMPLE.timeZone, exact: true },
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
      { fill: ENVIRONMENT_EXAMPLE.nameLabel, with: ENVIRONMENT_EXAMPLE.slug, exact: true },
      { fill: "Description (optional)", with: ENVIRONMENT_EXAMPLE.description },
      // The radio's label wraps its hint, so its name carries more than the page's word.
      { press: ENVIRONMENT_EXAMPLE.networkLabel, role: "radio" },
      { fill: ENVIRONMENT_EXAMPLE.hostsLabel, with: ENVIRONMENT_EXAMPLE.hosts.join("\n"), exact: true },
      { fill: ENVIRONMENT_EXAMPLE.aptLabel, with: ENVIRONMENT_EXAMPLE.apt.join("\n"), exact: true },
      { fill: ENVIRONMENT_EXAMPLE.pipLabel, with: ENVIRONMENT_EXAMPLE.pip.join("\n"), exact: true },
    ],
  },
  { id: "environment-agent", title: "Agent page: the data team's Agent, its Environment section naming Data science", widths: ["desktop"] },
  {
    id: "environment-run-settings",
    title: "Session: a conversation's run settings, opened from the composer, its Environment row data-science, the agent's default",
    widths: ["desktop"],
    opens: [
      { press: ENVIRONMENT_EXAMPLE.configureLabel, role: "button", exact: true },
      // The menu item's name carries its summary (the engine, the target) after the page's word.
      { press: ENVIRONMENT_EXAMPLE.runSettingsLabel, role: "menuitem" },
    ],
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
    opens: [{ press: CHAT_LINK_EXAMPLE.addLabel, role: "button", exact: true }],
  },
  {
    id: "channel-chat-link",
    title: "The chat link's dialog on its Link tab: the link, its on switch and who can chat",
    widths: ["desktop"],
    opens: [
      { press: "Actions for variance-reporter", role: "button", exact: true },
      { press: CHAT_LINK_EXAMPLE.editLabel, role: "menuitem", exact: true },
    ],
  },
  {
    id: "channel-chat-link-embed",
    title: "The chat link's dialog on its Embed tab: the two-line snippet and the allowed embed origins",
    widths: ["desktop"],
    opens: [
      { press: "Actions for variance-reporter", role: "button", exact: true },
      { press: EMBED_EXAMPLE.editLabel, role: "menuitem", exact: true },
      { press: EMBED_EXAMPLE.embedLabel, role: "tab", exact: true },
    ],
  },
  {
    id: "channel-connect-slack",
    title: "Connect to Slack: the channel's name, Connect as the platform Stigmer app, and Tool credentials",
    widths: ["desktop"],
    opens: [
      { press: SLACK_EXAMPLE.addLabel, role: "button", exact: true },
      { press: SLACK_EXAMPLE.slackLabel, role: "menuitem", exact: true },
      { fill: "Channel name", with: SLACK_EXAMPLE.channel },
    ],
  },
  {
    id: "channel-connect-whatsapp",
    title: "Connect to WhatsApp: the connect page's phone number ID, its Meta app chosen to serve it, and Tool credentials",
    widths: ["desktop"],
    opens: [
      { press: WHATSAPP_EXAMPLE.addLabel, role: "button", exact: true },
      { press: WHATSAPP_EXAMPLE.whatsappLabel, role: "menuitem", exact: true },
      { fill: "Channel name", with: WHATSAPP_EXAMPLE.channel },
      // The field's label wraps its hint, so its name carries more than the page's word.
      { fill: WHATSAPP_EXAMPLE.phoneNumberIdLabel, with: WHATSAPP_EXAMPLE.phoneNumberId },
    ],
  },
  {
    id: "channel-app-new",
    title: "Settings, Channel Apps: Register channel app, Slack, named Acme Books, with its ready-to-paste manifest",
    widths: ["desktop"],
    opens: [
      { press: SLACK_APP_EXAMPLE.newLabel, role: "button", exact: true, first: true },
      { fill: SLACK_APP_EXAMPLE.nameLabel, with: SLACK_APP_EXAMPLE.name, exact: true },
    ],
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

/**
 * The access pages' screens: the service accounts page's CI account from
 * its form to its first key shown once, then its own page
 * (docs/guides/authentication/service-accounts.mdx), and the
 * bring-your-own-OAuth page's Slack app in the New OAuth app form
 * (docs/guides/integrations/bring-your-own-oauth.mdx).
 */
export type AccessSceneName = (typeof ACCESS_SCENES)[number]["id"] extends `access-${infer Name}` ? Name : never;

/** The service account form, filled with the page's name: the reader's first step. */
const SERVICE_ACCOUNT_NEW: readonly Act[] = [
  { press: SERVICE_ACCOUNT_EXAMPLE.newLabel, role: "button", exact: true, first: true },
  { fill: "Name", with: SERVICE_ACCOUNT_EXAMPLE.name, exact: true },
];

/** The account created, and its first key named, with the lifetime the page's CLI line gives it. */
const SERVICE_ACCOUNT_FIRST_KEY: readonly Act[] = [
  ...SERVICE_ACCOUNT_NEW,
  { press: "Create service account", role: "button", exact: true },
  { fill: "Key name", with: SERVICE_ACCOUNT_EXAMPLE.key, exact: true },
  { press: SERVICE_ACCOUNT_EXAMPLE.expiryLabel, role: "radio", exact: true },
];

const ACCESS_SCENES = [
  {
    id: "access-service-account-new",
    title: "Settings, Service accounts: New service account named ci-deploy, Member chosen",
    widths: ["desktop"],
    opens: SERVICE_ACCOUNT_NEW,
  },
  {
    id: "access-service-account-first-key",
    title: "Settings, Service accounts: ci-deploy created with the Member role, its first key github-actions to expire in 90 days",
    widths: ["desktop"],
    opens: SERVICE_ACCOUNT_FIRST_KEY,
  },
  {
    id: "access-service-account-key-revealed",
    title: "Settings, Service accounts: github-actions's key shown once, with Copy",
    widths: ["desktop"],
    opens: [...SERVICE_ACCOUNT_FIRST_KEY, { press: SERVICE_ACCOUNT_EXAMPLE.createKeyLabel, role: "button", exact: true }],
  },
  {
    id: "access-service-account-detail",
    title: "Settings, Service accounts: ci-deploy's page, its role, its github-actions key with expiry and last use, and Delete",
    widths: ["desktop"],
    opens: [{ press: `Open ${SERVICE_ACCOUNT_EXAMPLE.name}`, role: "button", exact: true }],
  },
  {
    id: "access-oauth-app-new",
    title: "Settings, OAuth apps: New OAuth app filled for the page's Slack app, its advanced settings open",
    widths: ["desktop"],
    opens: [
      { press: OAUTH_APP_EXAMPLE.newLabel, role: "button", exact: true, first: true },
      // Whole: Advanced settings adds Scope parameter name, which holds "name".
      { fill: OAUTH_APP_EXAMPLE.nameLabel, with: OAUTH_APP_EXAMPLE.name, exact: true },
      { fill: OAUTH_APP_EXAMPLE.providerLabel, with: OAUTH_APP_EXAMPLE.provider, exact: true },
      { fill: OAUTH_APP_EXAMPLE.clientIdLabel, with: OAUTH_APP_EXAMPLE.clientId, exact: true },
      { fill: OAUTH_APP_EXAMPLE.secretLabel, with: OAUTH_APP_EXAMPLE.clientSecret, exact: true },
      { fill: "Authorization URL", with: OAUTH_APP_EXAMPLE.authorizationUrl, exact: true },
      { fill: "Token URL", with: OAUTH_APP_EXAMPLE.tokenUrl, exact: true },
      { fill: OAUTH_APP_EXAMPLE.addressesLabel, with: OAUTH_APP_EXAMPLE.addresses.join(", "), exact: true },
      { press: OAUTH_APP_EXAMPLE.advancedLabel, role: "button", exact: true },
      { fill: "Scopes", with: OAUTH_APP_EXAMPLE.scopes.join(", "), exact: true },
      { fill: "Scope parameter name", with: OAUTH_APP_EXAMPLE.scopeParameterName, exact: true },
    ],
  },
] as const satisfies readonly { readonly id: `access-${string}`; readonly title: string; readonly widths: readonly WidthName[]; readonly opens?: readonly Act[] }[];

/** The presets the `completed` thread is drawn in beyond the default look, which `thread-completed` is. */
export const PRESETS = ["corporate", "startup", "friendly", "fintech", "monochrome"] as const satisfies readonly ThemePresetId[];

const THREAD_TITLES: Readonly<Record<(typeof THREAD_STATES)[number], string>> = {
  loading: "the thread while the session loads",
  empty: "a new session with no turns",
  thinking: "the agent's thinking: one thought settled, one under way",
  streaming: "the agent's reply streaming",
  tools: "tool calls: one returned, one still running",
  approval: "a tool call waiting for approval, with its decision",
  "file-review": "a finished turn with two file edits, each one it can undo",
  "subagent-running": "a subagent at work",
  "subagent-finished": "a subagent finished",
  failed: "a failed turn",
  completed: "a completed turn",
  markdown: "a long reply in markdown: a heading, lists, code and a table",
};

/** The scene, pictured whole (`Scene.whole`). */
function whole<S extends Scene>(scene: S): S & { readonly whole: true } {
  return { ...scene, whole: true };
}

/**
 * The scene groups pictured whole: the session view, whose thread scrolls
 * inside it, and the console pages the shared parts are drawn on, whose
 * lower halves scroll under the console's frame.
 */
const WHOLE_PREFIXES = ["session-", "settings-", "models-hub-", "dashboard-", "marketplace-", "routine-", "agent-profile-"] as const;

/**
 * The scenes of those groups kept at their viewport's height: the session
 * view as a person sees it, the thread scrolled under its header and its
 * composer, so a fault that shows only when the thread overflows is still
 * pictured. Each is a copy of a scene pictured whole, under its own id.
 */
const FRAMED: readonly SceneId[] = ["session-end-user-framed"];

/** Every scene as listed, before the groups pictured whole are marked. */
const LISTED: readonly Scene[] = [
  ...THREAD_STATES.map((state) => ({
    id: `thread-${state}` as const,
    title: `Thread: ${THREAD_TITLES[state]}`,
    widths: ["desktop", "narrow"] as const,
  })),
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
  {
    id: "launcher-first-question",
    title: "Launcher: a newcomer's first question, four example jobs, describe your own or just chat",
    widths: ["desktop", "narrow"],
  },
  {
    id: "launcher-coding-agent",
    title: "Launcher: the coding-agent door under the first question, its prompt open with this console's address",
    widths: ["desktop", "narrow"],
    opens: [{ press: "Let your coding agent set it up", role: "button", exact: true }],
  },
  {
    id: "launcher-example-connect",
    title: "Launcher: an example picked before any key, its agent made and the key step under it",
    widths: ["desktop", "narrow"],
    opens: [{ press: "Variance report", role: "button", exact: true }],
  },
  {
    id: "launcher-example-rejected",
    title: "Launcher: a key the provider rejects, refused in plain words with the box kept",
    widths: ["desktop", "narrow"],
    opens: [
      { press: "Variance report", role: "button", exact: true },
      { fill: "Anthropic API key", with: "sk-ant-typo" },
      { press: "Connect Anthropic", role: "button", exact: true },
    ],
  },
  {
    id: "launcher-example-unchecked",
    title: "Launcher: a key saved while the provider did not answer, said once above the composer",
    widths: ["desktop", "narrow"],
    opens: [
      { press: "Variance report", role: "button", exact: true },
      { fill: "Anthropic API key", with: "sk-ant-quiet" },
      { press: "Connect Anthropic", role: "button", exact: true },
    ],
  },
  {
    id: "launcher-example-ready",
    title: "Launcher: an example picked with a key in, the composer holding its agent, sample and message",
    widths: ["desktop", "narrow"],
    opens: [{ press: "Variance report", role: "button", exact: true }],
  },
  {
    id: "launcher-describe-own",
    title: "Launcher: describe your own, the box open in place",
    widths: ["desktop"],
    opens: [{ press: "Describe it", role: "button", exact: true }],
  },
  {
    id: "launcher-own-file",
    title: "Launcher: the variance reporter on a file of the person's own, its message written and the attach invited",
    widths: ["desktop", "narrow"],
  },
  {
    id: "launcher-next-line",
    title: "Launcher: after the first job, the journey's next step in one quiet line under the heading",
    widths: ["desktop"],
  },
  { id: "model-selector-open", title: "Model picker: open", widths: ["desktop"], opens: "Claude Sonnet 4.6" },
  {
    id: "model-selector-not-ready",
    title: "Model picker: open, with the models that need an Anthropic key marked and listed last",
    widths: ["desktop"],
    opens: "Claude Sonnet 4.6",
  },
  { id: "dashboard-kpis", title: "Dashboard figures", widths: ["desktop"] },
  { id: "dashboard-busy", title: "Dashboard: a busy week, with its failures, as a member who may not make agents sees it", widths: ["desktop"] },
  { id: "dashboard-new-org", title: "Dashboard: an organization that has made and run nothing yet, the journey's card alone", widths: ["desktop"] },
  {
    id: "dashboard-journey-new",
    title: "Dashboard: an agent picked and a key in, nothing run yet; two of six, the card alone",
    widths: ["desktop", "narrow"],
  },
  {
    id: "dashboard-journey-mid",
    title: "Dashboard: the agent ran and was made the newcomer's own; four of six, the card above the week's figures",
    widths: ["desktop"],
  },
  { id: "dashboard-journey-folded", title: "Dashboard: every step of the journey done, the card folded to one line", widths: ["desktop"] },
  {
    id: "bring-others-in",
    title: "Bring others in: an organization named from the email at sign-up, asked for its company's name before the invite",
    widths: ["desktop", "narrow"],
  },
  {
    id: "bring-others-in-link",
    title: "Bring others in: the organization named, its invite link live for a week, nobody else here yet",
    widths: ["desktop"],
  },
  {
    id: "bring-others-in-joined",
    title: "Bring others in: two teammates joined, the journey done, and the next line for a company with customers",
    widths: ["desktop", "narrow"],
  },
  {
    id: "bring-others-in-local",
    title: "Bring others in: a Stigmer on the person's own computer, which nobody else can reach",
    widths: ["desktop"],
  },
  ...SETTINGS_SCENES,
  { id: "agent-profile-owner", title: "Agent page: the ledger agent, as its owner sees it", widths: ["desktop", "narrow"] },
  { id: "agent-profile-viewer", title: "Agent page: the ledger agent, as a person who may only read it sees it", widths: ["desktop"] },
  {
    id: "agent-profile-variance-reporter",
    title: "Agent page: the agents page's variance reporter, each section one of the YAML fields the page prints",
    widths: ["desktop"],
  },
  {
    id: "agent-make-it-yours",
    title: "Agent page: the agent the first question made, open on Make it yours: its instructions, its own file, a skill",
    widths: ["desktop", "narrow"],
  },
  {
    id: "agent-make-it-yours-member",
    title: "Agent page: Make it yours for an editor who may not make skills, told an admin adds them",
    widths: ["desktop"],
  },
  {
    id: "agent-in-app",
    title: "Agent page: In your app on a server that signs people in, for an admin with the service account, sign-in and first user still to do",
    widths: ["desktop", "narrow"],
  },
  {
    id: "agent-in-app-done",
    title: "Agent page: In your app once an admin service account exists, accounts are made as Member and the app's first users signed in",
    widths: ["desktop"],
  },
  {
    id: "agent-in-app-member",
    title: "Agent page: In your app for a member, told an admin makes the service account and turns sign-in on",
    widths: ["desktop"],
  },
  {
    id: "agent-in-app-local",
    title: "Agent page: In your app on a laptop's server that trusts every caller: the development chat alone",
    widths: ["desktop", "narrow"],
  },
  { id: "skill-detail", title: "Skill page: the skills page's variance-report, its description over its rendered body", widths: ["desktop"] },
  { id: "marketplace-admin", title: "Marketplace: the official catalogue, for an admin", widths: ["desktop", "narrow"] },
  { id: "marketplace-member", title: "Marketplace: the official catalogue, for a member", widths: ["desktop"] },
  {
    id: "marketplace-no-match",
    title: "Marketplace: a search that matches no plugin",
    widths: ["desktop"],
    opens: { fill: "Search plugins", with: "ledgr" },
  },
  ...SESSION_SCENES,
  ...STORY_SCENES,
  ...ROUTINE_SCENES,
  ...ENVIRONMENT_SCENES,
  ...CHANNEL_SCENES,
  ...ACCESS_SCENES,
  {
    id: "agent-chat-page",
    title: "AgentChat: a whole page of its own, on a finished turn",
    widths: ["desktop", "narrow"],
  },
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
  {
    id: "from-hooks",
    title: "The hooks guide's chat: a completed turn, drawn by the program built from the hooks alone",
    widths: ["desktop", "narrow"],
  },
  { id: "parts", title: "The console's shared parts, each in every variant and state it has", widths: ["desktop", "narrow"] },
  { id: "help", title: "The deployment's help link at the sidebar's foot and under a failure note", widths: ["desktop"] },
  { id: "help-none", title: "A server that names no help link: no row at the sidebar's foot, no line under the failure", widths: ["desktop"] },
  ...PRESETS.map((preset) => ({
    id: `preset-${preset}` as const,
    title: `The completed thread in the ${preset} preset`,
    widths: ["desktop"] as const,
  })),
];

/** Every scene, in the order the index page lists them. */
export const SCENES: readonly Scene[] = LISTED.map((scene) =>
  !FRAMED.includes(scene.id) && (scene.id === "parts" || WHOLE_PREFIXES.some((prefix) => scene.id.startsWith(prefix))) ? whole(scene) : scene,
);

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
