import type { ScenarioStep } from "@scenar/react";

export type DesktopRunnerStep =
  | { view: "desktop-empty" }
  | { view: "desktop-one" }
  | { view: "browser-launch" }
  | { view: "desktop-two" }
  | { view: "desktop-stopped" };

export const desktopRunnerSteps: ScenarioStep<DesktopRunnerStep>[] = [
  {
    delayMs: 0,
    data: { view: "desktop-empty" },
    caption: "No runners yet",
    narration:
      "You open Settings in Stigmer Desktop. The list is empty — no runners are running on this machine.",
  },
  {
    delayMs: 3000,
    data: { view: "desktop-one" },
    caption: "Start a runner",
    narration:
      "Click Start Runner, choose a name and runtime, and the runner registers in seconds.",
  },
  {
    delayMs: 3000,
    data: { view: "browser-launch" },
    caption: "Or launch from your browser",
    narration:
      "From the web console, click Launch Local Runner. The browser sends a deep link to the desktop app.",
    interactions: [
      { atPercent: 0.5, type: "set_cursor", target: "launch-runner-btn" },
    ],
  },
  {
    delayMs: 3500,
    data: { view: "desktop-two" },
    caption: "Desktop app starts the runner",
    narration:
      "The app picks up the link, exchanges the token, and starts a second runner automatically.",
    interactions: [
      { atPercent: 0.0, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 3000,
    data: { view: "desktop-stopped" },
    caption: "Stop a runner",
    narration:
      "Stop any runner from the action menu. The process shuts down and moves to the Stopped phase.",
  },
];
