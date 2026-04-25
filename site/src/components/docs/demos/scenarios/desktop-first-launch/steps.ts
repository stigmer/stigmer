import type { ScenarioStep } from "@scenar/react";

export type DesktopFirstLaunchStep =
  | { view: "desktop-login" }
  | { view: "browser-auth" }
  | { view: "browser-callback" }
  | { view: "desktop-ready" };

export const desktopFirstLaunchSteps: ScenarioStep<DesktopFirstLaunchStep>[] = [
  {
    delayMs: 0,
    data: { view: "desktop-login" },
    caption: "First launch",
    narration:
      "When you open Stigmer Desktop for the first time, you see a sign-in screen.",
    interactions: [
      { atPercent: 0.6, type: "set_cursor", target: "sign-in-btn" },
    ],
  },
  {
    delayMs: 3000,
    data: { view: "browser-auth" },
    caption: "Browser handles the sign-in",
    narration:
      "Your browser opens the authentication page. Sign in with your account or create one.",
    interactions: [
      { atPercent: 0.0, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 3000,
    data: { view: "browser-callback" },
    caption: "Sign-in complete",
    narration:
      "After you sign in, the browser redirects back to the desktop app automatically.",
  },
  {
    delayMs: 2500,
    data: { view: "desktop-ready" },
    caption: "Ready to go",
    narration:
      "You see the same interface as the web console — Sessions, Agents, Skills, and Settings.",
  },
];
