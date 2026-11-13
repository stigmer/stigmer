// The demos the docs embed live: gallery scenes drawn in the docs mode
// (`?embed=1`), each in a frame on a docs page (`<Live name>` in the site).
//
// An entry names a scene of the catalogue (catalog.ts), the height its
// frame takes on the page, and the sentence the markdown exports carry in
// its place. A demo that holds a conversation answers a reader's acts
// through the scripted server (src/live-server.ts): a send gets the
// scripted turn, an approval or a denial lets it go on, Stop ends it.
//
// It imports nothing, not even the catalogue's types: the site reads this
// file into its own build and typecheck, where the kit's sources do not
// load. `src/__tests__/live.test.ts` holds every entry to the catalogue.

/** One demo a docs page may embed. */
export interface LiveDemo {
  /** The handle pages use (`<Live name="chat-popup">`), kept apart from the scene so a scene can be swapped under it. */
  readonly name: string;
  /** The catalogue's scene it draws. */
  readonly scene: string;
  /** What the demo shows, as a reader would say it; the frame's accessible title. */
  readonly title: string;
  /** The frame's height on the page, in CSS pixels; it takes the column's width. */
  readonly height: number;
  /** Whether a reader can talk to it: a send gets the scripted turn. */
  readonly interactive: boolean;
}

/** Every demo the docs may embed. */
export const LIVE: readonly LiveDemo[] = [
  { name: "chat-page", scene: "agent-chat-page", title: "AgentChat as a full page, on a finished turn", height: 640, interactive: true },
  {
    name: "chat-panel",
    scene: "agent-chat-panel",
    title: "AgentChat as a panel docked beside a product, a long turn at work",
    height: 640,
    interactive: true,
  },
  { name: "chat-popup", scene: "agent-chat-popup", title: "AgentChat as a corner popup, open on a finished turn", height: 640, interactive: true },
  { name: "thread-loading", scene: "thread-loading", title: "The thread while the session loads", height: 300, interactive: false },
  { name: "thread-empty", scene: "thread-empty", title: "A new session with no turns", height: 240, interactive: false },
  { name: "thread-streaming", scene: "thread-streaming", title: "The thread while the agent's reply streams", height: 320, interactive: false },
  { name: "thread-tools", scene: "thread-tools", title: "The thread with one tool call returned and one still running", height: 360, interactive: false },
  { name: "thread-approval", scene: "thread-approval", title: "The thread with a tool call waiting for approval", height: 420, interactive: false },
  { name: "thread-file-review", scene: "thread-file-review", title: "The thread after a turn that edited two files", height: 380, interactive: false },
  { name: "thread-subagent-running", scene: "thread-subagent-running", title: "The thread with a subagent at work", height: 380, interactive: false },
  { name: "thread-subagent-finished", scene: "thread-subagent-finished", title: "The thread after a subagent finished", height: 420, interactive: false },
  { name: "thread-failed", scene: "thread-failed", title: "The thread after a failed turn", height: 320, interactive: false },
  { name: "thread-completed", scene: "thread-completed", title: "The thread after a completed turn", height: 360, interactive: false },
  { name: "thread-markdown", scene: "thread-markdown", title: "The thread with a long reply in markdown", height: 620, interactive: false },
  { name: "session-file-review", scene: "session-file-review", title: "A finished turn's two edited files, shown once with their Undo", height: 720, interactive: false },
  { name: "end-user", scene: "session-end-user", title: "The session view as an end user inside a product sees it", height: 640, interactive: true },
  { name: "from-hooks", scene: "from-hooks", title: "A chat built from the hooks alone", height: 560, interactive: true },
  {
    name: "parts",
    scene: "parts",
    title: "The console's shared parts: buttons, the page header, the status pill, the empty state and the error message",
    height: 720,
    interactive: false,
  },
];

/** The presets the playground offers, beside the default look (`default`, no preset): the theme package's own list, held to it by live.test.ts. */
export const LIVE_PRESETS = ["default", "corporate", "startup", "friendly", "fintech", "monochrome"] as const;
export type LivePreset = (typeof LIVE_PRESETS)[number];

/** The colour modes a demo is drawn in. */
export const LIVE_MODES = ["light", "dark"] as const;
export type LiveMode = (typeof LIVE_MODES)[number];

/** How a demo looks: its preset, its colour mode, and the corner radius in rem, or null for the preset's own. */
export interface LiveTheme {
  readonly preset: LivePreset;
  readonly mode: LiveMode;
  readonly radius: number | null;
}

/** The message the playground posts to a demo's frame when the reader changes its look; the frame accepts it from its own origin only. */
export interface LiveThemeMessage extends LiveTheme {
  readonly type: "stigmer-live-theme";
}

/** The `type` of {@link LiveThemeMessage}. */
export const LIVE_THEME_MESSAGE = "stigmer-live-theme";

/** What a demo's frame posts to the page that frames it, from its own origin, once it listens for theme messages. */
export const LIVE_READY_MESSAGE = "stigmer-live-ready";

/** Whether `data`, posted by a demo's frame, says the frame is listening. */
export function isLiveReadyMessage(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as Record<string, unknown>).type === LIVE_READY_MESSAGE;
}

/** The look a demo has when the page names none: the default preset in the site's dark mode. */
export const DEFAULT_LIVE_THEME: LiveTheme = { preset: "default", mode: "dark", radius: null };

/** The path the site serves the gallery from. */
export const LIVE_BASE = "/gallery/";

/** The demo `name` names; a name the list does not hold throws, so a page that asks for one fails the build. */
export function liveDemo(name: string): LiveDemo {
  const demo = LIVE.find((entry) => entry.name === name);
  if (demo === undefined) {
    const known = LIVE.map((entry) => `"${entry.name}"`).join(", ");
    throw new Error(`no live demo named "${name}"; the gallery's docs mode draws ${known} (test/visual/src/live.ts)`);
  }
  return demo;
}

/** The address that draws `name` in the docs mode, in `theme`. */
export function liveUrl(name: string, theme: LiveTheme = DEFAULT_LIVE_THEME): string {
  const demo = liveDemo(name);
  const params = new URLSearchParams({ scene: demo.scene, mode: theme.mode, embed: "1" });
  if (theme.preset !== "default") params.set("preset", theme.preset);
  if (theme.radius !== null) params.set("radius", String(theme.radius));
  return `${LIVE_BASE}?${params.toString()}`;
}

/** The look a docs-mode page was asked for in its address; anything unknown reads as the default. */
export function themeOf(search: string): LiveTheme {
  const params = new URLSearchParams(search);
  const preset = params.get("preset");
  const radius = Number.parseFloat(params.get("radius") ?? "");
  return {
    preset: (LIVE_PRESETS as readonly string[]).includes(preset ?? "") ? (preset as LivePreset) : "default",
    mode: params.get("mode") === "light" ? "light" : "dark",
    radius: Number.isFinite(radius) && radius >= 0 && radius <= 2 ? radius : null,
  };
}

/** Whether `data`, posted to a demo's frame, is a theme message it should take. */
export function isLiveThemeMessage(data: unknown): data is LiveThemeMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as Record<string, unknown>;
  return (
    message.type === LIVE_THEME_MESSAGE &&
    (LIVE_PRESETS as readonly unknown[]).includes(message.preset) &&
    (LIVE_MODES as readonly unknown[]).includes(message.mode) &&
    (message.radius === null || (typeof message.radius === "number" && message.radius >= 0 && message.radius <= 2))
  );
}
