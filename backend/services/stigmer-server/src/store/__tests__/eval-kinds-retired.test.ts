/**
 * Pins the driver-neutral half of the plugin eval and agent eval kinds'
 * retirement (../eval-kinds-retired.ts):
 *   - a grant naming either kind as resource or principal is found, and a
 *     grant on another kind is not;
 *   - a try row of a kind that leaves no try is passed over, a try row
 *     without the old label keeps its bytes, and a row that already holds
 *     the new label keeps that value;
 *   - bytes that do not decode throw, and the step's failure names the row
 *     and keeps its cause.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

import {
  EVAL_RUN_LABEL_AT_RETIREMENT,
  RETIRED_EVAL_LABEL,
  policyNamesRetiredEvalKind,
  relabelEvalTryRow,
  unreadableEvalKindRowError,
} from "../eval-kinds-retired.js";
import { policyRow } from "./retired-instance-rows.js";

const session = (labels: Record<string, string>) =>
  toBinary(SessionSchema, create(SessionSchema, { metadata: { id: "ses_1", org: "org_1", labels } }));

describe("policyNamesRetiredEvalKind", () => {
  it.each([
    { principal: "identity_account:ida_1", resource: "plugin_eval:pev_1", named: true },
    { principal: "identity_account:ida_1", resource: "agent_eval:aev_1", named: true },
    { principal: "agent_eval:aev_1", resource: "organization:org_1", named: true },
    { principal: "identity_account:ida_1", resource: "organization:org_1", named: false },
    { principal: "identity_account:ida_1", resource: "eval_run:evr_1", named: false },
  ])("$principal -> $resource: $named", ({ principal, resource, named }) => {
    expect(policyNamesRetiredEvalKind(policyRow({ id: "iam_1", principal, relation: "viewer", resource }))).toBe(named);
  });

  it("throws on bytes that do not decode", () => {
    expect(() => policyNamesRetiredEvalKind(new Uint8Array([0x22, 0xff]))).toThrow();
  });
});

describe("relabelEvalTryRow", () => {
  it("passes over a kind no try leaves, whatever its bytes", () => {
    expect(relabelEvalTryRow("agent", session({ [RETIRED_EVAL_LABEL]: "pev_1" }))).toBeUndefined();
  });

  it("leaves a row without the old label as it is", () => {
    expect(relabelEvalTryRow("session", session({ team: "a" }))).toBeUndefined();
  });

  it("drops the old label and keeps a new label the row already holds", () => {
    const relabelled = relabelEvalTryRow(
      "session",
      session({ [RETIRED_EVAL_LABEL]: "pev_1", [EVAL_RUN_LABEL_AT_RETIREMENT]: "evr_1" }),
    );
    expect(fromBinary(SessionSchema, relabelled!).metadata?.labels).toEqual({ [EVAL_RUN_LABEL_AT_RETIREMENT]: "evr_1" });
  });

  it("throws on bytes that do not decode", () => {
    expect(() => relabelEvalTryRow("run", new Uint8Array([0x22, 0xff]))).toThrow();
  });
});

describe("unreadableEvalKindRowError", () => {
  it("names the row and keeps the cause", () => {
    const cause = new Error("premature EOF");
    const error = unreadableEvalKindRowError("session", "ses_1", cause);
    expect(error.message).toBe(
      "session 'ses_1' cannot be read to retire the plugin eval and agent eval kinds: Error: premature EOF",
    );
    expect(error.cause).toBe(cause);
  });
});
