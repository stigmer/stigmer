/**
 * Pins the lane-admission decorator (lane-admission.ts): a caller the
 * predicate names is ADMITTED on the run-gate checks without the inner
 * Authorizer being consulted, and every other combination — an admitted
 * lane on a non-run-gate check, any other caller on any check — reaches
 * the inner Authorizer untouched, its answer returned as-is (deny and
 * unavailable included, so the decorator can never turn a refusal into
 * an allow off the run gate). The predicate is the whole policy; this
 * file proves the decorator's arithmetic with a plain one, and the
 * built-in provider's tests prove the predicate open source composes.
 */
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { RUN_GATE_CHECKS } from "../../pipeline/steps/authorize-run-target.js";
import { newLaneAdmittedAuthorizer } from "../lane-admission.js";

const WORKFLOW_RUNNER: CallerIdentity = {
  identityId: "ida_carol",
  callerClass: "runner",
  issuer: "",
  rawToken: "wex-bound",
};
const AGENT_RUNNER: CallerIdentity = {
  ...WORKFLOW_RUNNER,
  rawToken: "aex-bound",
};
const PERSON: CallerIdentity = {
  identityId: "ida_carol",
  callerClass: "user",
  issuer: "https://issuer.example/",
  rawToken: "eyJ.person.token",
};

const isWorkflowRunner = (caller: CallerIdentity): boolean =>
  caller.callerClass === "runner" && caller.rawToken === "wex-bound";

const runGate: AuthzCheck = { ...RUN_GATE_CHECKS.agent, resourceId: "agt_1" };
const sessionGate: AuthzCheck = {
  ...RUN_GATE_CHECKS.session,
  resourceId: "ses_1",
};
const notRunGate: AuthzCheck = {
  permission: IamPermission.can_edit,
  resourceKind: ApiResourceKind.agent_execution,
  resourceId: "aex_1",
};

function recording(answer: AuthzDecision) {
  const seen: Array<{ caller: CallerIdentity; check: AuthzCheck }> = [];
  const inner: Authorizer = {
    authorize(caller, check) {
      seen.push({ caller, check });
      return Promise.resolve(answer);
    },
  };
  return { inner, seen };
}

describe("newLaneAdmittedAuthorizer", () => {
  it("an admitted lane on a run-gate check is allowed without consulting the inner Authorizer", async () => {
    const { inner, seen } = recording({ kind: "deny", reason: "would deny" });
    const authorizer = newLaneAdmittedAuthorizer(inner, isWorkflowRunner);
    expect(await authorizer.authorize(WORKFLOW_RUNNER, runGate)).toEqual({
      kind: "allow",
    });
    expect(await authorizer.authorize(WORKFLOW_RUNNER, sessionGate)).toEqual({
      kind: "allow",
    });
    expect(seen).toEqual([]);
  });

  it("an admitted lane on a NON-run-gate check reaches the inner Authorizer untouched — the reach is the run gate alone", async () => {
    const { inner, seen } = recording({ kind: "deny", reason: "not yours" });
    const authorizer = newLaneAdmittedAuthorizer(inner, isWorkflowRunner);
    expect(await authorizer.authorize(WORKFLOW_RUNNER, notRunGate)).toEqual({
      kind: "deny",
      reason: "not yours",
    });
    expect(seen).toEqual([{ caller: WORKFLOW_RUNNER, check: notRunGate }]);
  });

  it.each([
    ["an agent-bound runner", AGENT_RUNNER],
    ["a person", PERSON],
  ])(
    "%s on a run-gate check is checked by the inner Authorizer as themselves",
    async (_label, caller) => {
      const { inner, seen } = recording({ kind: "not-found" });
      const authorizer = newLaneAdmittedAuthorizer(inner, isWorkflowRunner);
      expect(await authorizer.authorize(caller, runGate)).toEqual({
        kind: "not-found",
      });
      expect(seen).toEqual([{ caller, check: runGate }]);
    },
  );

  it("an unavailable answer off the run gate is returned as-is — the decorator never masks a fault", async () => {
    const cause = new Error("evaluator down");
    const { inner } = recording({ kind: "unavailable", cause });
    const authorizer = newLaneAdmittedAuthorizer(inner, isWorkflowRunner);
    expect(await authorizer.authorize(PERSON, runGate)).toEqual({
      kind: "unavailable",
      cause,
    });
  });
});
