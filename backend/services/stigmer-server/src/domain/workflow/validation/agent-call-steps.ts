/**
 * The `agent_call` steps of a workflow, wherever they sit: the top-level
 * list, a for-each body, a fork branch, a try or catch block, and every
 * task's `compensate` list, at every depth. One
 * walk serves two readers that must agree on what a step is:
 *
 *   - the save-time rule that an `agent_call` step's name is unique across
 *     the whole workflow (`validateUniqueAgentCallNames`), so a step's name
 *     identifies it;
 *   - the run-time lookup of the step an agent turn came from
 *     (`findAgentCallStep`), which the agent-execution context build reads
 *     the step's environment_refs through. The runner labels a turn with
 *     the step's bare name (its key in its own `do` list), so the name is
 *     the only identity the two sides share; the rule is what makes it
 *     exact.
 *
 * The recursion set is `nestedTasks` (task-config-constraints.ts), the
 * converter's own, plus `compensate`. A config that does not decode is not
 * walked: the spec validation refuses the workflow for it, and this walk
 * never double-reports.
 *
 * Proven by __tests__/agent-call-steps.test.ts.
 */
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type {
  WorkflowSpec,
  WorkflowTask,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import type { AgentCallTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/agent_call_pb";

import { unmarshalTaskConfig } from "../converter/unmarshal.js";
import { nestedTasks } from "./task-config-constraints.js";

/** One `agent_call` step, with where it sits for messages. */
export interface AgentCallStep {
  readonly name: string;
  readonly config: AgentCallTaskConfig;
  /** The task names from the top level down to this step, joined by " > "; a compensate list reads as "compensate". */
  readonly path: string;
}

/** Every `agent_call` step in declaration order (depth first, a task before what it nests). */
export function agentCallSteps(
  spec: WorkflowSpec | undefined,
): AgentCallStep[] {
  const steps: AgentCallStep[] = [];
  if (spec === undefined) {
    return steps;
  }
  const visit = (task: WorkflowTask, parents: readonly string[]): void => {
    const here = [...parents, task.name];
    if (task.taskConfig !== undefined) {
      let config;
      try {
        config = unmarshalTaskConfig(task.kind, task.taskConfig);
      } catch {
        config = undefined;
      }
      if (config !== undefined) {
        if (task.kind === WorkflowTaskKind.agent_call) {
          steps.push({
            name: task.name,
            config: config as AgentCallTaskConfig,
            path: here.join(" > "),
          });
        }
        for (const nested of nestedTasks(config)) {
          visit(nested, here);
        }
      }
    }
    for (const compensate of task.compensate) {
      visit(compensate, [...here, "compensate"]);
    }
  };
  for (const task of spec.tasks) {
    visit(task, []);
  }
  return steps;
}

/**
 * Refuses two `agent_call` steps of one name anywhere in the workflow,
 * naming both places. Other task kinds may repeat a name across nested
 * lists; only an agent turn is looked up by its step's name. Two top-level
 * steps of one name are left to the top-level rule
 * (crossref.ts `validateUniqueTaskNames`), so one fault is one error.
 */
export function validateUniqueAgentCallNames(
  spec: WorkflowSpec | undefined,
): string[] {
  const first = new Map<string, string>();
  const errors: string[] = [];
  for (const step of agentCallSteps(spec)) {
    if (step.name === "") {
      continue;
    }
    const seen = first.get(step.name);
    if (seen !== undefined) {
      if (!(isTopLevel(seen) && isTopLevel(step.path))) {
        errors.push(
          `duplicate agent_call step name "${step.name}" at "${step.path}": already used at "${seen}" (an agent_call step's name must be unique across the whole workflow)`,
        );
      }
      continue;
    }
    first.set(step.name, step.path);
  }
  return errors;
}

/**
 * The `agent_call` step named `name`, the first in walk order, and how many
 * steps carry the name (more than one only in a version saved before the
 * uniqueness rule).
 */
export function findAgentCallStep(
  spec: WorkflowSpec | undefined,
  name: string,
): { readonly step: AgentCallStep | undefined; readonly matches: number } {
  const matching = agentCallSteps(spec).filter((step) => step.name === name);
  return { step: matching[0], matches: matching.length };
}

/** Whether a step's path names a top-level task (no nesting separator). */
function isTopLevel(path: string): boolean {
  return !path.includes(" > ");
}
