// How an ended turn's phase reads, in the session view's words: the turn's
// closing block and the chat's closed button both say it.

const ENDINGS: Readonly<Record<string, string>> = {
  completed: "Done",
  failed: "Failed",
  cancelled: "Stopped",
  terminated: "Stopped",
};

/** The word for how a turn ended; "Ended" for a phase with no word of its own. */
export function endingWord(phase: string): string {
  return ENDINGS[phase] ?? "Ended";
}
