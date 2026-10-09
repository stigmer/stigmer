/**
 * The grading workflow as it shipped before the AI judge (stigmer#2056,
 * squash da7f30368), byte for byte but for this header and the import path:
 * the replay test runs it to record a history an execution started before
 * the judge would carry, then replays that history against today's
 * workflow, which must take the `grade-run-judge` patch's old branch.
 * Registered under the same byte-pinned type.
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE, as the real workflow's.
 */
import { isCancellation, proxyActivities } from "@temporalio/workflow";

import {
  GRADE_RUN_HEALTH_ACTIVITY_NAME,
  GRADING_FAILED_REASON,
  RECORD_NOT_GRADED_ACTIVITY_NAME,
} from "../../../names.js";
import type { GradeOutcome, GradingActivities } from "../../../names.js";

const activities = proxyActivities<GradingActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

async function gradeRun(runId: string): Promise<GradeOutcome> {
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

export { gradeRun as "stigmer/grading/grade-run" };
