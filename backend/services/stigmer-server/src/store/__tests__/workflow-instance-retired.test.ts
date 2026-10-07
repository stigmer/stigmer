/**
 * Pins the driver-neutral half of the workflow instance kind's removal
 * (../workflow-instance-retired.ts):
 *   - a grant naming an instance as resource or principal is found, and a
 *     grant on another kind is not;
 *   - bytes that do not decode throw (the step must not pass over them).
 */
import { describe, expect, it } from "vitest";

import {
  policyNamesRetiredWorkflowInstance,
  unreadableWorkflowRowError,
} from "../workflow-instance-retired.js";
import { policyRow } from "./retired-instance-rows.js";

describe("policyNamesRetiredWorkflowInstance", () => {
  it.each([
    {
      principal: "identity_account:ida_1",
      resource: "workflow_instance:win_1",
      named: true,
    },
    {
      principal: "workflow_instance:win_1",
      resource: "workflow_execution:wex_1",
      named: true,
    },
    {
      principal: "identity_account:ida_1",
      resource: "workflow:wfl_1",
      named: false,
    },
    {
      principal: "identity_account:ida_1",
      resource: "agent_instance:ain_1",
      named: false,
    },
  ])("$principal -> $resource: $named", ({ principal, resource, named }) => {
    expect(
      policyNamesRetiredWorkflowInstance(
        policyRow({ id: "iam_1", principal, relation: "viewer", resource }),
      ),
    ).toBe(named);
  });

  it("throws on bytes that do not decode", () => {
    expect(() =>
      policyNamesRetiredWorkflowInstance(new Uint8Array([0x22, 0xff])),
    ).toThrow();
  });
});

describe("unreadableWorkflowRowError", () => {
  it("names the row and keeps the cause", () => {
    const cause = new Error("premature EOF");
    const error = unreadableWorkflowRowError(
      "workflow_execution",
      "wex_1",
      cause,
    );
    expect(error.message).toBe(
      "workflow_execution 'wex_1' cannot be read to retire the workflow instance kind: Error: premature EOF",
    );
    expect(error.cause).toBe(cause);
  });
});
