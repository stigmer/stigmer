/**
 * The grading workflow: one completed run, graded by the free run-health
 * checks and recorded as a score. One activity grades and records; when it
 * fails past its retries, a second records the run as not graded, because
 * a failed grade is never a missing or failing value.
 *
 * The workflow holds no state and waits on nothing, so it spans seconds;
 * a behavioural change still meets in-flight executions across a release
 * and is gated with patched()/deprecatePatch() like every workflow here.
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE: this module runs in the deterministic
 * sandbox; imports are limited to @temporalio/workflow and the pure names
 * module.
 */
import { isCancellation, proxyActivities } from "@temporalio/workflow";

import {
  GRADE_RUN_HEALTH_ACTIVITY_NAME,
  GRADING_FAILED_REASON,
  RECORD_NOT_GRADED_ACTIVITY_NAME,
} from "../names.js";
import type { GradeOutcome, GradingActivities } from "../names.js";

const activities = proxyActivities<GradingActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

export async function gradeRun(runId: string): Promise<GradeOutcome> {
  try {
    return await activities[GRADE_RUN_HEALTH_ACTIVITY_NAME](runId);
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    return await activities[RECORD_NOT_GRADED_ACTIVITY_NAME](
      runId,
      GRADING_FAILED_REASON,
    );
  }
}
