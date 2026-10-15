/**
 * A run made into a test case for a plugin's evals/ folder, as the console
 * offers it: the case's input read from what the thread already holds (the
 * run's request, the first failing grader's reason, the viewer's own
 * thumbs-down comment, whether the run continued a conversation), and the
 * case folder as a zip whose one top-level directory is the case's name,
 * so unzipping it inside evals/ adds the case.
 *
 * The console never knows whether the plugin's skill was read, so it adds
 * no skill check; the CLI's `runs to-eval-case --skill` does. Pure, so the
 * rules are unit-testable without React; pinned by
 * `__tests__/test-case.test.ts`.
 */
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { caseFromRun, suggestCaseName, type CaseFromRun } from "@stigmer/sdk";
import { strToU8, zipSync, type Zippable } from "fflate";
import {
  failingReasonOf,
  thumbsOf,
  viewerFeedbackOf,
  type ViewerIdentity,
} from "../score/score-view.js";

/** What the thread knows about a run, for {@link testCaseOfRun}. */
export interface RunForTestCase {
  readonly request: string;
  readonly scores: readonly Score[];
  readonly viewer: ViewerIdentity | null;
  readonly multiTurn: boolean;
}

/** The case folder a run becomes, named after its request. */
export function testCaseOfRun(run: RunForTestCase): CaseFromRun {
  const mine = viewerFeedbackOf(run.scores, run.viewer);
  const thumbsComment =
    thumbsOf(mine) === false ? (mine?.spec?.comment ?? "") : "";
  const judgeReason = failingReasonOf(run.scores);
  return caseFromRun({
    request: run.request,
    caseName: suggestCaseName(run.request),
    multiTurn: run.multiTurn,
    ...(judgeReason !== "" && { judgeReason }),
    ...(thumbsComment !== "" && { thumbsComment }),
  });
}

/** The case folder as a zip: `<caseName>/prompt.md`, `<caseName>/graders/...`. */
export function zipTestCase(testCase: CaseFromRun): Uint8Array {
  const entries: Zippable = {};
  for (const file of testCase.files) {
    entries[`${testCase.caseName}/${file.path}`] = strToU8(file.content);
  }
  return zipSync(entries);
}
