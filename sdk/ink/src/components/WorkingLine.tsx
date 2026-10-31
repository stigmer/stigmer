// The working turn's one line, drawn just above the composer: a spinner, what
// the turn is doing now and for how long, "⠋ Running a command · 1m 12s".
// The words come from working.ts, the derivation the browser reads too. While
// the turn waits on the person the spinner stops: nothing is working.
//
// The clock ticks on Ink's shared animation timer, with the spinner.
//
// Proven by __tests__/working-line.test.tsx.

import React from "react";
import { Box, Text, useAnimation } from "ink";
import type { Turn } from "@stigmer/client";
import { useRoles } from "../theme.js";
import { workingWords, type WorkingState } from "../working.js";
import { Spinner } from "./Spinner.js";

/** Props for {@link WorkingLine}. */
export interface WorkingLineProps extends WorkingState {
  /** The working turn; null while the turn has not reached the session's events yet. */
  readonly turn: Turn | null;
  /** A last part in the host's words, such as the key that stops the turn; none by default. */
  readonly hint?: string;
}

/** The working turn's line (module header). */
export function WorkingLine({ turn, isSlow, isStopping, hint }: WorkingLineProps) {
  const role = useRoles();
  // Re-renders each second so the time moves while nothing else does.
  useAnimation({ interval: 1000 });
  const words = workingWords(turn, Date.now(), { isSlow, isStopping });
  const parts = [words.elapsed, hint].filter((part) => part !== undefined && part !== "");
  return (
    <Box gap={1} paddingLeft={1}>
      {words.waiting ? <Text {...role.accent}>○</Text> : <Spinner style={role.accent} />}
      <Text wrap="truncate-end">
        {words.phrase}
        {parts.length > 0 && <Text {...role.muted}>{` · ${parts.join(" · ")}`}</Text>}
      </Text>
    </Box>
  );
}
