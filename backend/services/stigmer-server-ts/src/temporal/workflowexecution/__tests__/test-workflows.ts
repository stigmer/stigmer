/**
 * Test-only workflow barrel for the orchestrator tests and the replay
 * capture script: the REAL orchestrator under its byte-pinned name plus a
 * scriptable stub child registered under the runner's child workflow type
 * (in production the runner registers it; tests point the child memo at
 * the test worker's own queue).
 *
 * The stub child cannot see host state (the workflow sandbox), so it is
 * scripted BY ID and observed THROUGH AN ACTIVITY: behavior branches on
 * the execution_id the orchestrator forwards, and every observation
 * (started, received signals) is reported immediately via the
 * TestRecordChildEvent activity the test worker registers as a recorder.
 *
 * Behavior by execution_id:
 *   - contains "fail" → throws ApplicationFailure("child engine boom");
 *   - contains "hold" → records "started", records every received
 *     pause/resume/test-custom signal, and completes only on the
 *     "test-release" signal;
 *   - anything else → completes immediately, silently.
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE applies (sandbox module).
 */
import { ApplicationFailure } from "@temporalio/common";
import {
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";

import type { InvokeWorkflowExecutionWorkflowInput } from "../workflow-input.js";

export { invokeWorkflowExecution as "stigmer/workflow-execution/invoke" } from "../workflows/invoke-workflow-execution.js";

export const TEST_RECORD_CHILD_EVENT_ACTIVITY = "TestRecordChildEvent";
export const TEST_RELEASE_SIGNAL = "test-release";
export const TEST_CUSTOM_SIGNAL = "test-custom";

const pauseSignal = defineSignal<[string?]>("pause");
const resumeSignal = defineSignal<[string?]>("resume");
const customSignal = defineSignal<[unknown]>(TEST_CUSTOM_SIGNAL);
const releaseSignal = defineSignal(TEST_RELEASE_SIGNAL);

const recorder = proxyActivities<{
  [TEST_RECORD_CHILD_EVENT_ACTIVITY]: (event: string) => Promise<void>;
}>({
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 1 },
});

async function stubChild(
  input: InvokeWorkflowExecutionWorkflowInput,
): Promise<void> {
  const executionId = input.execution_id;

  if (executionId.includes("fail")) {
    throw ApplicationFailure.create({ message: "child engine boom" });
  }

  if (!executionId.includes("hold")) {
    return;
  }

  let released = false;
  setHandler(pauseSignal, (reason?: string) => {
    void recorder[TEST_RECORD_CHILD_EVENT_ACTIVITY](`pause:${reason ?? ""}`);
  });
  setHandler(resumeSignal, () => {
    void recorder[TEST_RECORD_CHILD_EVENT_ACTIVITY]("resume");
  });
  setHandler(customSignal, (payload: unknown) => {
    void recorder[TEST_RECORD_CHILD_EVENT_ACTIVITY](
      `custom:${JSON.stringify(payload ?? null)}`,
    );
  });
  setHandler(releaseSignal, () => {
    released = true;
  });

  await recorder[TEST_RECORD_CHILD_EVENT_ACTIVITY]("started");
  await condition(() => released);
}

export { stubChild as "stigmer/workflow/execute-from-execution" };
