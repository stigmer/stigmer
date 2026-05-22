/**
 * Workflow execution state — the data bag that flows through the
 * task chain, carrying accumulated results, environment variables,
 * original input, and the current output value.
 *
 * Mirrors Go's `utils.State` struct. The five namespaces ($context,
 * $data, $env, $input, $output) are exposed to jq expressions via
 * `getAsMap()`.
 */

import type { WorkflowState as IWorkflowState } from "./types.js";
import { deepClone } from "./clone.js";

export class WorkflowStateImpl implements IWorkflowState {
  context: unknown = null;
  data: Record<string, unknown> = {};
  env: Record<string, unknown> = {};
  input: unknown = null;
  output: unknown = null;

  addData(data: Record<string, unknown>): void {
    Object.assign(this.data, data);
  }

  /**
   * Returns the state as a flat map of jq variable bindings.
   * Each key becomes a jq variable (e.g., `$context`, `$data`).
   */
  getAsMap(): Record<string, unknown> {
    return {
      $context: deepClone(this.context),
      $data: deepClone(this.data),
      $env: deepClone(this.env),
      $input: deepClone(this.input),
      $output: deepClone(this.output),
    };
  }

  clone(): WorkflowStateImpl {
    const s = new WorkflowStateImpl();
    s.context = deepClone(this.context);
    s.data = deepClone(this.data) as Record<string, unknown>;
    s.env = deepClone(this.env) as Record<string, unknown>;
    s.input = deepClone(this.input);
    s.output = deepClone(this.output);
    return s;
  }

  clearOutput(): void {
    this.output = null;
  }
}

export function createState(): WorkflowStateImpl {
  return new WorkflowStateImpl();
}
