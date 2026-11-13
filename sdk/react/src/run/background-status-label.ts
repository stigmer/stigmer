// How a background command stands, in words: pure, so the kit's headless
// entry can export it without reaching the row that draws it
// (BackgroundCommandStatus.tsx imports the kit's Button, which draws).

import type { BackgroundCommandView } from "@stigmer/client";

/**
 * How a background command stands, in the row's words: "Running in the
 * background" while it runs, else how it ended ("Exited · code 1", "Timed
 * out", "Stopped by a person", "Stopped by the agent", "Stopped when the
 * turn paused for approval", "Stopped with the turn", "Failed to start").
 */
export function backgroundStatusLabel(background: BackgroundCommandView): string {
  switch (background.state) {
    case "running":
      return "Running in the background";
    case "exited":
      return `Exited · code ${background.exitCode ?? 0}`;
    case "timed_out":
      return "Timed out";
    case "failed_to_start":
      return "Failed to start";
    case "stopped":
      switch (background.stoppedBy) {
        case "person":
          return "Stopped by a person";
        case "agent":
          return "Stopped by the agent";
        case "approval":
          return "Stopped when the turn paused for approval";
        default:
          return "Stopped with the turn";
      }
  }
}
