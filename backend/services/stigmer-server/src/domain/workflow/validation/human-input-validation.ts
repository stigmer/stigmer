/**
 * Human-input timeout-policy validation — ports
 * pkg/domain/workflow/validation/human_input_validation.go.
 * FAIL/APPROVE/DENY need no shape. HUMAN_INPUT_TIMEOUT_ESCALATE carries the
 * outcome-by-name contract (oss#781): a timeout resolves to the outcome
 * NAMED "escalate" and follows its `then` branch, so the policy is only
 * valid when such an outcome exists with `then` set. Fail closed — a gate
 * whose escalation has nowhere to go must never persist; the runner's
 * loader carries the same check for hand-written YAML. Whether the `then`
 * TARGET exists (and the graph stays acyclic) is
 * validateCrossTaskReferences' job — this rule checks shape, not
 * reachability, so the layers compose without duplication.
 *
 * The rule reads the raw task_config Struct like its siblings so the error
 * speaks the author's own vocabulary. Strict JSON parsing accepts an enum
 * by name or by number, so both spellings are checked.
 */
import { enumToJson } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";

import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowSpec } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import {
  HumanInputTimeoutPolicy,
  HumanInputTimeoutPolicySchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/human_input_pb";

export function validateHumanInputTimeoutPolicies(
  spec: WorkflowSpec | undefined,
): string[] {
  if (spec === undefined || spec.tasks.length === 0) {
    return [];
  }

  const escalate = HumanInputTimeoutPolicy.HUMAN_INPUT_TIMEOUT_ESCALATE;
  const escalateName = enumToJson(HumanInputTimeoutPolicySchema, escalate);

  const errors: string[] = [];
  for (const task of spec.tasks) {
    if (task.kind !== WorkflowTaskKind.human_input || task.taskConfig === undefined) {
      continue;
    }
    const fields = task.taskConfig;
    const value = fields["on_timeout"];
    if (value === undefined) {
      continue;
    }

    let isEscalate = false;
    if (typeof value === "string") {
      isEscalate = value === escalateName;
    } else if (typeof value === "number") {
      isEscalate = value === escalate;
    }
    if (!isEscalate) {
      continue;
    }

    if (!hasEscalateOutcomeWithThen(fields["outcomes"])) {
      errors.push(
        `task '${task.name}' (human_input): on_timeout policy ${escalateName} requires an outcome named 'escalate' with 'then' set — the timeout resolves to that outcome and follows its 'then' branch`,
      );
    }
  }
  return errors;
}

/**
 * Whether the raw `outcomes` value carries an outcome named "escalate"
 * whose `then` is a non-empty string — the shape the escalate timeout
 * policy resolves to at runtime.
 */
function hasEscalateOutcomeWithThen(outcomes: JsonValue | undefined): boolean {
  if (!Array.isArray(outcomes)) {
    return false;
  }
  for (const entry of outcomes) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }
    if (stringValueOf(entry["name"]) !== "escalate") {
      continue;
    }
    if (stringValueOf(entry["then"]) !== "") {
      return true;
    }
  }
  return false;
}

function stringValueOf(v: JsonValue | undefined): string {
  return typeof v === "string" ? v : "";
}
