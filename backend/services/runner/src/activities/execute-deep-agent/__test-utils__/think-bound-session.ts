/**
 * The session the hermetic and live think-retirement nets resume: recorded on
 * the last engine that bound a `think` tool (#1976), paused at a gated
 * `execute` after a round-0 `think` call. One home for the names both nets
 * read, so the live twin resumes exactly what the hermetic net recorded
 * (`__tests__/hermetic/resume-across-think-retirement.test.ts` has the
 * scenario and the recording arm).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PausedSessionFixture } from "./paused-session-fixture.js";

/** The fixture's file, under `__tests__/hermetic/fixtures/`. */
export const THINK_BOUND_FIXTURE_FILE = "paused-session.think-bound.json";

/** The user's message the recorded session opened with. */
export const THINK_RETIREMENT_MESSAGE = "Work out the step, then run the command for me.";

/** The round-0 `think` call's id. */
export const THINK_CALL_ID = "call-hermetic-think-0001";

/** The committed fixture. */
export function thinkBoundSession(): PausedSessionFixture {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "__tests__", "hermetic", "fixtures", THINK_BOUND_FIXTURE_FILE);
  return JSON.parse(readFileSync(path, "utf8")) as PausedSessionFixture;
}
