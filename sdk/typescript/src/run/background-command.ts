// How a command the agent ran in the background is said in words, for the
// clients that print rather than draw it (the CLI's stream, Ink): one phrase
// per state, read from the fold's `ToolUse.background`
// (@stigmer/session-log), never from the start's or the agent's prose.

import type { BackgroundCommandView, ToolUse } from "@stigmer/session-log";

/** The most characters of a command a line quotes. */
const COMMAND_CHARS = 80;

/** A background command's command line, on one line and cut to {@link COMMAND_CHARS}; "" when the call named none. */
export function backgroundCommandText(tool: Pick<ToolUse, "input">): string {
  const command = tool.input["command"];
  if (typeof command !== "string") return "";
  const line = command.replace(/\s+/g, " ").trim();
  return line.length > COMMAND_CHARS ? `${line.slice(0, COMMAND_CHARS)}…` : line;
}

/**
 * What became of a background command, as the end of a sentence that
 * begins with it: "exited with code 1", "timed out", "was stopped by the
 * person", "is running".
 */
export function backgroundEndingPhrase(background: BackgroundCommandView): string {
  switch (background.state) {
    case "running":
      return "is running";
    case "exited":
      return `exited with code ${background.exitCode ?? 0}`;
    case "timed_out":
      return `timed out after ${background.timeoutSeconds} seconds`;
    case "failed_to_start":
      return "failed to start";
    case "stopped":
      switch (background.stoppedBy) {
        case "agent":
          return "was stopped by the agent";
        case "person":
          return "was stopped by the person";
        case "approval":
          return "was stopped when the turn paused for approval";
        default:
          return "was stopped with the turn";
      }
  }
}

/** The whole sentence: "Background command `npm test` exited with code 1". */
export function backgroundEndingLine(tool: Pick<ToolUse, "input" | "background">): string | undefined {
  if (tool.background === undefined) return undefined;
  const command = backgroundCommandText(tool);
  return `Background command ${command === "" ? "" : `\`${command}\` `}${backgroundEndingPhrase(tool.background)}`;
}
