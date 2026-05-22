/**
 * WorkflowError — typed, serializable error following the CNCF
 * Serverless Workflow error shape (type, status, title, detail, instance).
 *
 * Used by:
 * - `raise` tasks to throw structured errors
 * - `try` executor to normalize caught errors
 * - `catch.errors.with` to filter errors by type/status
 * - `catch.as` to bind error details into state for jq expressions
 *
 * Sandbox-safe: zero dependencies, no Node.js or Temporal imports.
 */

import type { CatchErrors } from "./types.js";

const RUNTIME_ERROR_TYPE =
  "https://serverlessworkflow.io/spec/1.0.0/errors/runtime";

export class WorkflowError extends Error {
  readonly type: string;
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly instance: string;

  constructor(fields: {
    type: string;
    status: number;
    title?: string;
    detail?: string;
    instance?: string;
  }) {
    const message =
      fields.title ?? fields.detail ?? `WorkflowError [${fields.type}]`;
    super(message);
    this.name = "WorkflowError";
    this.type = fields.type;
    this.status = fields.status;
    this.title = fields.title ?? "";
    this.detail = fields.detail ?? "";
    this.instance = fields.instance ?? "";
  }

  /**
   * Serializes to a plain object for binding into workflow state
   * via `catch.as`. The shape matches the CNCF error definition,
   * making it accessible to jq expressions like `${ .error.type }`.
   */
  toJSON(): Record<string, unknown> {
    return {
      type: this.type,
      status: this.status,
      title: this.title,
      detail: this.detail,
      instance: this.instance,
    };
  }

  /**
   * Wraps any caught value into a WorkflowError with a consistent
   * CNCF shape. WorkflowError instances pass through unchanged.
   */
  static fromUnknown(err: unknown): WorkflowError {
    if (err instanceof WorkflowError) {
      return err;
    }

    if (err instanceof Error) {
      return new WorkflowError({
        type: RUNTIME_ERROR_TYPE,
        status: 500,
        title: err.name,
        detail: err.message,
      });
    }

    if (typeof err === "string") {
      return new WorkflowError({
        type: RUNTIME_ERROR_TYPE,
        status: 500,
        title: "Error",
        detail: err,
      });
    }

    if (err !== null && typeof err === "object") {
      const obj = err as Record<string, unknown>;
      return new WorkflowError({
        type: typeof obj.type === "string" ? obj.type : RUNTIME_ERROR_TYPE,
        status: typeof obj.status === "number" ? obj.status : 500,
        title: typeof obj.title === "string" ? obj.title : "",
        detail: typeof obj.detail === "string" ? obj.detail : "",
        instance: typeof obj.instance === "string" ? obj.instance : "",
      });
    }

    return new WorkflowError({
      type: RUNTIME_ERROR_TYPE,
      status: 500,
      title: "Unknown error",
      detail: String(err),
    });
  }

  /**
   * Tests whether an error matches a `catch.errors.with` filter.
   * Returns true if the error satisfies ALL specified filter fields
   * (AND semantics). An empty or undefined filter matches all errors.
   *
   * Matching is exact equality: `type` by string, `status` by number.
   */
  static matches(
    error: WorkflowError,
    filter: CatchErrors | undefined,
  ): boolean {
    if (!filter?.with) return true;

    const conditions = filter.with;

    if ("type" in conditions && conditions.type !== error.type) {
      return false;
    }

    if ("status" in conditions && conditions.status !== error.status) {
      return false;
    }

    return true;
  }
}
