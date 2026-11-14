"use client";

// Whether the launcher opens on its first question. It does for an admin of
// the organization (`can_edit` on it, asked fail closed: the journey is the
// organization's, the dashboard card's rule), in an organization where
// nothing has ever run (the dashboard's own rule, `useEverRan`). A member,
// a teammate who joined by invitation among them, an organization that has
// run anything, and a read that failed all get the usual launcher: a
// member's run summary holds only the runs they can see, so "nothing ran"
// is not theirs to read. Until both answers are in, the answer is "pending", so the
// launcher holds its place rather than draw the composer and swap it.
//
// The first settled answer for an organization holds for the life of the
// launcher: the hosts keep the launcher mounted while a session is open, and
// a later read must not swap one screen for the other under someone's hands.
// Another organization asks afresh.

import { useState } from "react";
import { useCheckPermission } from "../../grant/useCheckPermission.js";
import { useEverRan } from "../../dashboard/useEverRan.js";

/** The gate's answer: still asking, open on the question, or the usual launcher. */
export type FirstQuestionGate = "pending" | "ask" | "skip";

/**
 * Whether the launcher for `org` (as the host names it, like the
 * dashboard's first steps) opens on its first question. Pass
 * `enabled: false` to skip both reads (the answer is then `"skip"`).
 */
export function useFirstQuestionGate(org: string, enabled: boolean): FirstQuestionGate {
  const asking = enabled && org !== "";
  const permission = useCheckPermission(asking ? { kind: "organization", id: org } : null, "can_edit", { fail: "closed" });
  const ever = useEverRan(asking ? org : null);
  const [settled, setSettled] = useState<{ readonly org: string; readonly answer: FirstQuestionGate } | null>(null);

  let answer: FirstQuestionGate;
  if (!asking) answer = "skip";
  else if (ever.ran === true || ever.error !== null) answer = "skip";
  else if (!permission.isLoading && !permission.allowed) answer = "skip";
  else if (permission.isLoading || ever.ran === undefined) answer = "pending";
  else answer = "ask";

  // A launcher that stops asking (a deep link read after it opened) skips at
  // once, whatever it settled on before.
  if (!asking) return "skip";
  if (settled !== null && settled.org === org) return settled.answer;
  // Held from the first settled render on; set during render, which React
  // allows for a component's own state, so no frame shows the other screen.
  if (answer !== "pending") setSettled({ org, answer });
  return answer;
}
