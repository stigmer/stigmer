// The words a changed file is shown with, in one place, so the finished
// turn's Changed group and the strip that counts files while the turn works
// say "New" and "Deleted" the same way. A change arrives in two forms: a
// turn's review names it with a word (added, modified, deleted, renamed),
// the live capture with an enum (FileChangeKind); an edit says nothing, since
// an edit is what a change is.

import { FileChangeKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

/** What happened to a file, in words; "" for an edit. `previousPath` names a renamed file's old place. */
export function changeWords(change: string | FileChangeKind, previousPath = ""): string {
  if (change === "added" || change === FileChangeKind.ADD) return "New";
  if (change === "deleted" || change === FileChangeKind.DELETE) return "Deleted";
  if (change === "renamed") return previousPath === "" ? "Renamed" : `Renamed from ${previousPath.slice(previousPath.lastIndexOf("/") + 1)}`;
  return "";
}

/** The words of a changed file's state and its acts. */
export const CHANGE_WORDS = {
  undoing: "Undoing…",
  undone: "Undone",
  undoFailed: "Couldn't undo",
  tryAgain: "Try again",
  undoAll: "Undo all",
  binary: "Binary",
  undo: (name: string) => `Undo ${name}`,
} as const;
