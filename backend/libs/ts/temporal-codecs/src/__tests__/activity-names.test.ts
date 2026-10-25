/**
 * The runner-owned activity names (`activity-names/names.ts`): pins their
 * bytes, since a run in flight carries them in its history and the server
 * and the runner both read them from here.
 */

import { describe, it, expect } from "vitest";

import * as names from "../activity-names/names.js";

describe("runner-owned activity names", () => {
  it("keeps the wire bytes", () => {
    expect({ ...names }).toEqual({
      ENSURE_THREAD_ACTIVITY_NAME: "EnsureThread",
      EXECUTE_DEEP_AGENT_ACTIVITY_NAME: "ExecuteDeepAgent",
      EXECUTE_CURSOR_ACTIVITY_NAME: "ExecuteCursor",
      EXECUTE_CLAUDE_ACTIVITY_NAME: "ExecuteClaude",
      GENERATE_SESSION_SUBJECT_ACTIVITY_NAME: "GenerateSessionSubject",
    });
  });
});
