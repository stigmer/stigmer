// The gallery's catalogue: every scene it draws, as plain data.
//
// A scene is one component in one state ("the thread with an approval
// waiting"), drawn from fixed data. This file names the scenes and how each
// is pictured (its widths, its colour modes, a button to press first); the
// page draws them from `scenes/index.ts`, whose map is typed by these ids,
// so a scene listed here without a drawing, or drawn without being listed,
// fails the typecheck. It imports nothing at run time: the Playwright spec
// and the unit checks read it under Node, where the kit's sources do not
// load.
//
// Every picture is `<scene>-<mode>-<width>.png` under
// tests/__screenshots__; `screenshotsOf` is the one place that name is made.
import type { ScenarioName } from "@stigmer/react-sdk/test";
import type { ThemePresetId } from "@stigmer/design-tokens";

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
  | `session-${SessionSceneName}`
  | `preset-${Preset}`;

/** One scene and how it is pictured. */
export interface Scene {
  readonly id: SceneId;
  /** What the picture shows, as a reviewer would say it. */
  readonly title: string;
  readonly widths: readonly WidthName[];
  /**
   * The accessible name of a button the case presses before the picture and
   * the audit: a component whose state of interest opens on a click (a
   * picker's list) is pictured open.
   */
  readonly opens?: string;
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
    title: "Session: the finished turn with the console's panel open",
    widths: ["desktop"],
    opens: "Show panel",
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
] as const satisfies readonly { readonly id: `session-${string}`; readonly title: string; readonly widths: readonly WidthName[]; readonly opens?: string }[];

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
  { id: "launcher-ready", title: "Launcher: a model provider connected, ready to send", widths: ["desktop"] },
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
  ...SESSION_SCENES,
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
