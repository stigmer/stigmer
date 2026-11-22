/**
 * The one narrowing from a turn to a turn with a computer. A conversation
 * without a computer reaches an engine with no workspace
 * (`types.ts` `NoComputerWorkspace`); an engine or a phase that only ever
 * runs on a computer (the Claude engine, file review, the owed undos) takes
 * the narrowed turn, and a turn without one handed to it is a fault the
 * server's refusals should have stopped, said in one sentence.
 */

import type { ComputerTurnInput, TurnInput } from "./types.js";

/** A turn without a computer handed to an engine or a phase that needs one. */
export class NoComputerError extends Error {
  constructor(what: string) {
    super(`${what} needs a computer, and this conversation has none`);
    this.name = "NoComputerError";
  }
}

/** `input` as a turn with a computer, or `undefined` for a turn without one. */
export function computerTurnOf(input: TurnInput): ComputerTurnInput | undefined {
  return input.workspace.computer ? (input as ComputerTurnInput) : undefined;
}
