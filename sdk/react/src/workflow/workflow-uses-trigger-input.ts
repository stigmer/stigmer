import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";

/**
 * Patterns that indicate a workflow references the trigger message input.
 *
 * - `$input` — runtime expression referencing parsed trigger_message
 * - `workflow.input.trigger_message` — documentation-style template reference
 */
const TRIGGER_INPUT_PATTERNS = [
  "$input",
  "workflow.input.trigger_message",
] as const;

/**
 * Determines whether a workflow references the trigger message input (`$input`)
 * anywhere in its task configurations.
 *
 * Deep-scans all `taskConfig` Struct values for string fields containing
 * known trigger-input patterns. Returns `true` if any task references
 * the trigger input, meaning the "Trigger Input" field should be shown
 * in the run dialog.
 *
 * This is a pure function safe to memoize at the call site.
 */
export function workflowUsesTriggerInput(workflow: Workflow): boolean {
  const tasks = workflow.spec?.tasks;
  if (!tasks || tasks.length === 0) return false;

  for (const task of tasks) {
    if (structContainsTriggerRef(task.taskConfig)) {
      return true;
    }
  }

  return false;
}

/**
 * Recursively walks a Struct/object value looking for string leaves
 * that contain any of the trigger input patterns.
 */
function structContainsTriggerRef(value: unknown): boolean {
  if (value === null || value === undefined) return false;

  if (typeof value === "string") {
    return TRIGGER_INPUT_PATTERNS.some((pattern) => value.includes(pattern));
  }

  if (Array.isArray(value)) {
    return value.some(structContainsTriggerRef);
  }

  if (typeof value === "object") {
    return Object.values(value).some(structContainsTriggerRef);
  }

  return false;
}
