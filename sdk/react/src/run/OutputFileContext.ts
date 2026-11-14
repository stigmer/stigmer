// What opens a File a turn wrote to its outputs folder, for that write's
// step. The session view opens such a File from the turn's outcome (its Made
// cards) through its own opener, which takes the File; a step holds only the
// path it wrote. The session view provides this context so the step can ask
// it to open the File at that path, and say where it opens ("opens in the
// panel", "opens in a window"). With no provider (a host's own thread) a
// write to the outputs folder reads as any write.
//
// Internal: the session view is its one provider, the step its one reader.

import { createContext, useContext } from "react";

/** The session's opener of the Files its turns returned, as a step reaches it. */
export interface OutputFileOpener {
  /**
   * Opens the File the turn returned at `path` (the step's path, the outputs
   * folder anywhere in it); false when no such File is in the session yet.
   */
  readonly openOutputPath: (path: string) => boolean;
  /** Whether `path` names a File the session holds, so the step can offer to open it. */
  readonly hasOutputPath: (path: string) => boolean;
  /** Where a File opens: the session's panel, or a window over the conversation. */
  readonly opensIn: "panel" | "window";
}

/** The session's output-file opener, or null outside a session view. */
export const OutputFileContext = createContext<OutputFileOpener | null>(null);

/** The session's output-file opener, or null outside a session view. */
export function useOutputFileOpener(): OutputFileOpener | null {
  return useContext(OutputFileContext);
}

/** The workspace's outputs folder, as a path names it. */
const OUTPUTS_FOLDER = ".stigmer/outputs/";

/**
 * The part of `path` below the outputs folder (the folder at its start or
 * after a "/"), or undefined. Found by index, not a pattern: a path is a
 * tool's input, and a pattern over it could take quadratic time.
 */
export function underOutputs(path: string): string | undefined {
  for (let at = path.indexOf(OUTPUTS_FOLDER); at !== -1; at = path.indexOf(OUTPUTS_FOLDER, at + 1)) {
    if (at === 0 || path[at - 1] === "/") {
      const rest = path.slice(at + OUTPUTS_FOLDER.length);
      return rest === "" ? undefined : rest;
    }
  }
  return undefined;
}
